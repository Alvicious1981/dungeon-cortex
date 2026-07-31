import { Prisma } from "@prisma/client";
import type { GameEvent } from "@/lib/events/game-events";
import { runSerializableTransaction } from "@/lib/db/serializable-transaction";
import {
  assertSessionTransition,
  type SessionModeName,
} from "@/lib/session/contracts";

export type ActionReservation =
  | { ok: true; duplicate: false; requestId: string; requestRecordId: string; sessionId: string }
  | { ok: true; duplicate: true; requestId: string; status: string; sessionId: string }
  | { ok: false; code: "SESSION_PAUSED"; sessionId: string };

export async function reserveActionRequest(input: {
  campaignId: string;
  requestId: string;
  action: string;
}): Promise<ActionReservation> {
  return runSerializableTransaction(async (tx) => {
    const existing = await tx.actionRequest.findUnique({
      where: {
        campaignId_requestId: {
          campaignId: input.campaignId,
          requestId: input.requestId,
        },
      },
      select: { status: true, sessionId: true },
    });
    if (existing) {
      return {
        ok: true,
        duplicate: true,
        requestId: input.requestId,
        status: existing.status,
        sessionId: existing.sessionId,
      };
    }

    let session = await tx.gameSession.findFirst({
      where: { campaignId: input.campaignId, status: "ACTIVE" },
      orderBy: { sessionNumber: "desc" },
      select: { id: true, sessionNumber: true },
    });

    if (!session) {
      const latest = await tx.gameSession.findFirst({
        where: { campaignId: input.campaignId },
        orderBy: { sessionNumber: "desc" },
        select: { id: true, sessionNumber: true, status: true },
      });
      if (latest?.status === "PAUSED") {
        return { ok: false, code: "SESSION_PAUSED", sessionId: latest.id };
      }
      session = await tx.gameSession.create({
        data: {
          campaignId: input.campaignId,
          sessionNumber: (latest?.sessionNumber ?? 0) + 1,
          status: "ACTIVE",
          mode: "PREPARING",
        },
        select: { id: true, sessionNumber: true },
      });
    }

    const request = await tx.actionRequest.create({
      data: {
        campaignId: input.campaignId,
        sessionId: session.id,
        requestId: input.requestId,
        action: input.action,
      },
      select: { id: true },
    });

    return {
      ok: true,
      duplicate: false,
      requestId: input.requestId,
      requestRecordId: request.id,
      sessionId: session.id,
    };
  }, {
    // P2002 is expected when concurrent requests race either the idempotency
    // key or the one-open-session guard. Retrying lets the loser re-read the
    // row committed by the winner and return a stable result instead of 500.
    retryCodes: ["P2034", "P2002"],
  });
}

interface AcceptedActionCheckpoint {
  campaignId: string;
  sessionId: string;
  requestId: string;
  action: string;
  mode: SessionModeName;
  events: GameEvent[];
  additionalLogs?: Array<{ role: string; content: string }>;
}

async function checkpointAcceptedActionInTransaction(
  tx: Prisma.TransactionClient,
  input: AcceptedActionCheckpoint
): Promise<void> {
  const session = await tx.gameSession.findUnique({
    where: { id: input.sessionId },
    select: { status: true, mode: true, eventSequence: true },
  });
  if (!session || session.status !== "ACTIVE") {
    throw new Error("The active session disappeared before the action checkpoint.");
  }

  assertSessionTransition(session.mode, input.mode);
  const records = [
    { type: "ACTION_ACCEPTED", payload: { action: input.action } },
    ...input.events,
  ];
  const lastSequence = session.eventSequence + records.length;

  await tx.gameSession.update({
    where: { id: input.sessionId },
    data: { mode: input.mode, eventSequence: lastSequence },
  });
  await tx.actionRequest.update({
    where: {
      campaignId_requestId: {
        campaignId: input.campaignId,
        requestId: input.requestId,
      },
    },
    data: { status: "COMPLETED" },
  });
  await tx.gameLog.createMany({
    data: [
      { campaignId: input.campaignId, role: "user", content: input.action },
      ...(input.additionalLogs ?? []).map((log) => ({
        campaignId: input.campaignId,
        role: log.role,
        content: log.content,
      })),
    ],
  });
  await tx.gameEventRecord.createMany({
    data: records.map((record, index) => ({
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      requestId: input.requestId,
      sequence: session.eventSequence + index + 1,
      type: record.type,
      payload: JSON.parse(JSON.stringify(record.payload)) as Prisma.InputJsonValue,
    })),
  });
}

export async function checkpointAcceptedAction(
  input: AcceptedActionCheckpoint,
  tx?: Prisma.TransactionClient
): Promise<void> {
  if (tx) {
    await checkpointAcceptedActionInTransaction(tx, input);
    return;
  }

  await runSerializableTransaction(async (transaction) => {
    await checkpointAcceptedActionInTransaction(transaction, input);
  });
}

/**
 * Converts an uncompleted reservation into an auditable rejection. The action
 * route schedules this after the response; accepted actions are already marked
 * COMPLETED and therefore become a no-op here.
 */
export async function rejectPendingActionRequest(input: {
  campaignId: string;
  requestId: string;
}): Promise<void> {
  await runSerializableTransaction(async (tx) => {
    const request = await tx.actionRequest.findUnique({
      where: {
        campaignId_requestId: {
          campaignId: input.campaignId,
          requestId: input.requestId,
        },
      },
      select: {
        status: true,
        session: { select: { id: true, eventSequence: true } },
      },
    });
    if (!request || request.status !== "PENDING") return;

    const sequence = request.session.eventSequence + 1;
    await tx.actionRequest.update({
      where: {
        campaignId_requestId: {
          campaignId: input.campaignId,
          requestId: input.requestId,
        },
      },
      data: { status: "REJECTED" },
    });
    await tx.gameSession.update({
      where: { id: request.session.id },
      data: { eventSequence: sequence },
    });
    await tx.gameEventRecord.create({
      data: {
        campaignId: input.campaignId,
        sessionId: request.session.id,
        requestId: input.requestId,
        sequence,
        type: "ACTION_REJECTED",
        payload: { reason: "validation_or_resolution_rejected" },
      },
    });
  });
}
