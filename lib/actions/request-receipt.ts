/**
 * lib/actions/request-receipt.ts
 *
 * Persistent idempotency for submitted player actions (DC-AUD-003).
 *
 * DC-AUD-002 carried the client's `requestId` to the server and stopped there.
 * This module gives it meaning: a durable receipt, so a retry after a lost
 * connection is *recognised* rather than executed a second time. The window is
 * not exotic — the action route streams narration for the whole turn, so the
 * gap between "mechanics committed" and "client knows" is as long as the model
 * takes to narrate.
 *
 * Design contract ("Code is Law"):
 *   - The database decides who owns a submission. Acquisition is a single
 *     `create` against a unique constraint, never `find → if absent → create`,
 *     which has no exclusion at all between two concurrent readers.
 *   - Terminal states are terminal. Every settle is a conditional write
 *     predicated on `PROCESSING`, so nothing can walk a finished receipt back.
 *   - `PROCESSING` means *outcome unknown*, not "certainly still running": an
 *     interrupted request leaves exactly the same row a live one does. It is
 *     therefore never re-executed — refusing an uncertain retry is safe, while
 *     re-running one risks a second attack, a second spent slot, a second
 *     potion.
 *   - No AI or model code participates in any of this.
 *
 * INVARIANT: `COMPLETED` means the authoritative mechanical outcome finished.
 * It says nothing about whether narration was delivered or persisted.
 */

import { createHash } from "node:crypto";
import { Prisma, ActionRequestStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

/** The mechanically relevant fields of a submitted action. */
export interface ActionRequestFingerprintInput {
  action: string;
  targetIds?: string[];
  targetX?: number;
  targetY?: number;
}

/**
 * A stable hash of what the action actually *does*, so one `requestId` can
 * never come to mean two different actions.
 *
 * Canonicalisation, field by field:
 *   - `action` is the already-trimmed string the route resolved.
 *   - `targetIds` is **sorted**. Order carries no mechanical meaning anywhere
 *     it is read: the macro attack gate uses it as a membership filter, the
 *     spell gate as a selection set, and the weapon-attack gate requires
 *     exactly one entry. Sorting therefore makes a retry that re-sends the
 *     same creatures in a different order the same action, which is the
 *     forgiving and correct direction. If a future gate ever makes order
 *     significant, this must be revisited.
 *   - An absent `targetIds` and an empty one collapse together, because the
 *     route already treats them identically (`body.targetIds ?? []` and then a
 *     length check, or `body.targetIds?.length`).
 *   - Coordinates keep the route's own `Number.isInteger` rule; anything else
 *     is the same as not aiming.
 *
 * The literal below has a fixed key order and a closed field set, so
 * `JSON.stringify` is deterministic without sorting keys. Raw request JSON is
 * deliberately NOT hashed: it would make an irrelevant key or a reordered
 * object look like a different action.
 *
 * `requestId` is not part of its own fingerprint.
 *
 * @pure
 */
export function fingerprintActionRequest(
  input: ActionRequestFingerprintInput
): string {
  // `Array.isArray` rather than a spread of `input.targetIds ?? []`. The
  // declared type is a claim about client JSON, not a guarantee: a body with
  // `targetIds: 5` type-checks nowhere and arrives anyway, and spreading a
  // number throws. This code runs BEFORE any gate, so a throw here would turn
  // input that the route already handles into a fresh 500. Anything that is
  // not an array collapses to "no targets", which is what the gates' own
  // `?? []` plus length check already amounts to.
  const targetIds = Array.isArray(input.targetIds)
    ? input.targetIds.map((id) => String(id)).sort()
    : [];

  const canonical = {
    action: input.action,
    targetIds,
    targetX: Number.isInteger(input.targetX) ? input.targetX! : null,
    targetY: Number.isInteger(input.targetY) ? input.targetY! : null,
  };

  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** What the caller should do about a submission it tried to acquire. */
export type ActionReceiptAcquisition =
  /** Nobody held this id: this request owns the submission and must proceed. */
  | { outcome: "acquired"; receiptId: string }
  /** Another request owns it and has not settled. Never re-execute. */
  | { outcome: "in_flight" }
  /** The id already denotes a different campaign or a different payload. */
  | { outcome: "reused" }
  /** Settled as a stream; replay a terminal duplicate frame. */
  | { outcome: "completed_stream" }
  /** Settled with a stored JSON response (`/roll`); replay it verbatim. */
  | { outcome: "completed_replay"; responseStatus: number; responseBody: unknown }
  /** Settled as a mechanical refusal; replay it verbatim. */
  | { outcome: "rejected"; responseStatus: number; responseBody: unknown };

/** The persisted shape `classifyExistingReceipt` needs. */
export interface ExistingActionReceipt {
  campaignId: string;
  requestHash: string;
  status: ActionRequestStatus;
  responseStatus: number | null;
  responseBody: unknown;
}

/**
 * Decides what an already-existing receipt means for the current request.
 *
 * Split out as a pure function on purpose: the unit-test lane has no
 * PostgreSQL, so this is the part of the protocol that *can* be exhaustively
 * covered there. What it cannot prove — that the database really rejects the
 * second insert — is proven by the E2E lane instead.
 *
 * @pure
 */
export function classifyExistingReceipt(
  existing: ExistingActionReceipt,
  expected: { campaignId: string; requestHash: string }
): ActionReceiptAcquisition {
  // Identity before status: an id that already denotes another campaign or
  // another payload is a client bug, and answering it with the *other*
  // action's stored outcome would be worse than refusing.
  if (
    existing.campaignId !== expected.campaignId ||
    existing.requestHash !== expected.requestHash
  ) {
    return { outcome: "reused" };
  }

  if (existing.status === ActionRequestStatus.REJECTED) {
    return {
      outcome: "rejected",
      // A REJECTED row is always written with its status and body together;
      // the fallback only guards a row mutated outside this module.
      responseStatus: existing.responseStatus ?? 400,
      responseBody: existing.responseBody ?? { error: "This action was refused." },
    };
  }

  if (existing.status === ActionRequestStatus.COMPLETED) {
    // A stored status is what distinguishes a non-streaming outcome (`/roll`)
    // from the ordinary SSE action, which stores nothing.
    return existing.responseStatus !== null
      ? {
          outcome: "completed_replay",
          responseStatus: existing.responseStatus,
          responseBody: existing.responseBody,
        }
      : { outcome: "completed_stream" };
  }

  return { outcome: "in_flight" };
}

/**
 * True only for a unique violation on *this* module's idempotency constraint.
 *
 * A bare `code === "P2002"` check would read any unique violation raised
 * anywhere in the acquire path as an idempotency hit and replay someone else's
 * outcome. `meta.target` is the discriminator, and its shape varies by Prisma
 * version and driver — a field-name array on some, the index name on others —
 * so both are accepted. An unrecognised shape returns false and the error
 * propagates: a 500 is the safe answer, a wrong replay is not.
 */
function isReceiptUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2002") return false;

  const target = (error.meta as { target?: unknown } | undefined)?.target;
  const names = Array.isArray(target)
    ? target.map((entry) => String(entry))
    : typeof target === "string"
      ? [target]
      : [];

  if (names.length === 0) return false;

  const asSet = new Set(names);
  const byFieldNames = asSet.has("actorUserId") && asSet.has("requestId");
  const byIndexName = names.some((name) => name.includes("actorUserId_requestId"));

  return byFieldNames || byIndexName;
}

/**
 * Claims ownership of one submission.
 *
 * The `create` is the whole concurrency story. Two identical requests both
 * reach it; exactly one row can win the unique index, and the loser is told
 * what the winner is doing. No read-then-write, no application-side lock.
 */
export async function acquireActionReceipt(input: {
  actorUserId: string;
  campaignId: string;
  requestId: string;
  requestHash: string;
}): Promise<ActionReceiptAcquisition> {
  try {
    const created = await prisma.actionRequestReceipt.create({
      data: {
        actorUserId: input.actorUserId,
        campaignId: input.campaignId,
        requestId: input.requestId,
        requestHash: input.requestHash,
        status: ActionRequestStatus.PROCESSING,
      },
      select: { id: true },
    });

    return { outcome: "acquired", receiptId: created.id };
  } catch (error) {
    if (!isReceiptUniqueViolation(error)) throw error;

    const existing = await prisma.actionRequestReceipt.findUnique({
      where: {
        actorUserId_requestId: {
          actorUserId: input.actorUserId,
          requestId: input.requestId,
        },
      },
      select: {
        campaignId: true,
        requestHash: true,
        status: true,
        responseStatus: true,
        responseBody: true,
      },
    });

    // The row that caused the conflict is gone. Rather than invent an outcome,
    // surface the original error: this is not a state the protocol describes.
    if (!existing) throw error;

    return classifyExistingReceipt(existing, {
      campaignId: input.campaignId,
      requestHash: input.requestHash,
    });
  }
}

/**
 * Every settle is conditional on the receipt still being `PROCESSING`, so a
 * terminal state can never be walked back or overwritten by a late writer.
 */
async function settle(
  receiptId: string,
  data: Prisma.ActionRequestReceiptUpdateManyMutationInput
): Promise<void> {
  const settled = await prisma.actionRequestReceipt.updateMany({
    where: { id: receiptId, status: ActionRequestStatus.PROCESSING },
    data,
  });

  // Fail closed. Only the execution owner settles, and it holds a receipt it
  // just created as PROCESSING, so exactly one row must match. Zero means the
  // row is gone or is no longer PROCESSING — the protocol has been violated
  // somewhere, and swallowing it would be the worst possible response: the
  // caller would return an apparently durable 200/202/4xx while the receipt
  // still says PROCESSING, so the player's retry would be refused forever for
  // a turn we told them had settled.
  //
  // Throwing surfaces it as a 500 with the receipt left PROCESSING, which is
  // the safe direction: an uncertain retry is refused, never re-executed.
  if (settled.count !== 1) {
    throw new ActionReceiptSettlementError(receiptId, settled.count);
  }
}

/** Raised when a terminal transition matched no PROCESSING row. */
export class ActionReceiptSettlementError extends Error {
  constructor(receiptId: string, matched: number) {
    super(
      `Action receipt ${receiptId} could not be settled: expected exactly one ` +
        `PROCESSING row, matched ${matched}.`
    );
    this.name = "ActionReceiptSettlementError";
  }
}

/**
 * The ordinary streaming action succeeded.
 *
 * Stores no response: the duplicate of a stream is answered with a terminal
 * duplicate frame, not a replayed body. Narration is deliberately absent —
 * see the invariant at the top of this file.
 */
export async function completeActionReceipt(receiptId: string): Promise<void> {
  await settle(receiptId, { status: ActionRequestStatus.COMPLETED });
}

/**
 * A non-streaming action succeeded and its response is replayable — today only
 * `/roll`, whose 202 body a duplicate must receive instead of rolling again.
 * The body is always server-created; nothing from the client is stored.
 */
export async function completeActionReceiptWithResponse(
  receiptId: string,
  responseStatus: number,
  responseBody: unknown
): Promise<void> {
  await settle(receiptId, {
    status: ActionRequestStatus.COMPLETED,
    responseStatus,
    responseBody: responseBody as Prisma.InputJsonValue,
  });
}

/**
 * A deterministic mechanical refusal. Storing it makes the refusal terminal
 * for that id: a retry is answered with the same 4xx rather than re-evaluated
 * against state that may have changed since.
 *
 * This preserves PR #120 rather than weakening it — a refused action never
 * created a canonical `role:"user"` row, and replaying one writes nothing.
 */
export async function rejectActionReceipt(
  receiptId: string,
  responseStatus: number,
  responseBody: unknown
): Promise<void> {
  await settle(receiptId, {
    status: ActionRequestStatus.REJECTED,
    responseStatus,
    responseBody: responseBody as Prisma.InputJsonValue,
  });
}
