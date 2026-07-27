import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { assertSessionTransition, type SessionModeName } from "@/lib/session/contracts";

export class SessionLifecycleError extends Error {
  constructor(
    public readonly code: "NO_ACTIVE_SESSION" | "NO_PAUSED_SESSION",
    message: string
  ) {
    super(message);
    this.name = "SessionLifecycleError";
  }
}

async function writeLifecycleEvent(
  tx: Prisma.TransactionClient,
  input: {
    campaignId: string;
    sessionId: string;
    currentSequence: number;
    type: string;
    payload: Prisma.InputJsonValue;
  }
): Promise<number> {
  const sequence = input.currentSequence + 1;
  await tx.gameEventRecord.create({
    data: {
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      sequence,
      type: input.type,
      payload: input.payload,
    },
  });
  return sequence;
}

export async function pauseSession(campaignId: string) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.gameSession.findFirst({
      where: { campaignId, status: "ACTIVE" },
      orderBy: { sessionNumber: "desc" },
    });
    if (!session) {
      throw new SessionLifecycleError("NO_ACTIVE_SESSION", "No active session to pause.");
    }
    assertSessionTransition(session.mode, "PAUSED");
    const sequence = await writeLifecycleEvent(tx, {
      campaignId,
      sessionId: session.id,
      currentSequence: session.eventSequence,
      type: "SESSION_PAUSED",
      payload: { previousMode: session.mode },
    });
    return tx.gameSession.update({
      where: { id: session.id },
      data: {
        status: "PAUSED",
        mode: "PAUSED",
        pausedAt: new Date(),
        eventSequence: sequence,
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function resumeSession(campaignId: string) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.gameSession.findFirst({
      where: { campaignId, status: "PAUSED" },
      orderBy: { sessionNumber: "desc" },
    });
    if (!session) {
      throw new SessionLifecycleError("NO_PAUSED_SESSION", "No paused session to resume.");
    }
    const activeEncounter = await tx.encounter.findFirst({
      where: { campaignId, status: "active" },
      select: { id: true },
    });
    const nextMode: SessionModeName = activeEncounter ? "COMBAT" : "NARRATIVE";
    assertSessionTransition("PAUSED", nextMode);
    const sequence = await writeLifecycleEvent(tx, {
      campaignId,
      sessionId: session.id,
      currentSequence: session.eventSequence,
      type: "SESSION_RESUMED",
      payload: { mode: nextMode },
    });
    return tx.gameSession.update({
      where: { id: session.id },
      data: {
        status: "ACTIVE",
        mode: nextMode,
        pausedAt: null,
        eventSequence: sequence,
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function completeSession(campaignId: string) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.gameSession.findFirst({
      where: { campaignId, status: { in: ["ACTIVE", "PAUSED"] } },
      orderBy: { sessionNumber: "desc" },
    });
    if (!session) {
      throw new SessionLifecycleError("NO_ACTIVE_SESSION", "No open session to complete.");
    }
    assertSessionTransition(session.mode, "COMPLETED");

    const [campaign, resolvedEncounters, activeQuests] = await Promise.all([
      tx.campaign.findUniqueOrThrow({
        where: { id: campaignId },
        select: {
          title: true,
          character: { select: { name: true, hp: true, maxHp: true } },
        },
      }),
      tx.encounter.count({ where: { campaignId, status: "resolved" } }),
      tx.quest.count({ where: { campaignId, status: "active" } }),
    ]);
    const summary = [
      `Session ${session.sessionNumber} completed for ${campaign.character.name}.`,
      `Hit points: ${campaign.character.hp}/${campaign.character.maxHp}.`,
      `Resolved encounters: ${resolvedEncounters}.`,
      `Active quests: ${activeQuests}.`,
    ].join(" ");
    const sequence = await writeLifecycleEvent(tx, {
      campaignId,
      sessionId: session.id,
      currentSequence: session.eventSequence,
      type: "SESSION_COMPLETED",
      payload: { summary },
    });
    return tx.gameSession.update({
      where: { id: session.id },
      data: {
        status: "COMPLETED",
        mode: "COMPLETED",
        endedAt: new Date(),
        summary,
        eventSequence: sequence,
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
