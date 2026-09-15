import type { Prisma } from "@prisma/client";

export interface MoveTransitionInput {
  campaignId: string;
  encounterId: string;
  combatantId: string;
  expectedFromX: number;
  expectedFromY: number;
  expectedRound: number;
  expectedTurnIndex: number;
  expectedMovementSpentFt: number;
  requestedDistanceFt: number;
  speedFt: number;
  targetX: number;
  targetY: number;
  playerAction: string;
}

export type MoveTransitionResult = "claimed" | "stale" | "budget-exceeded";

export class MoveStateConflictError extends Error {
  constructor() {
    super("The authoritative Move state changed before the transition committed.");
    this.name = "MoveStateConflictError";
  }
}

/** A move claim without the player's canonical log line: enemy turns log as `system`. */
export type MoveClaimInput = Omit<MoveTransitionInput, "campaignId" | "playerAction">;

function assertMovementTransitionInput(input: MoveClaimInput): void {
  const nonNegativeIntegers = [
    input.expectedRound,
    input.expectedTurnIndex,
    input.expectedMovementSpentFt,
    input.speedFt,
  ];
  if (
    nonNegativeIntegers.some((value) => !Number.isInteger(value) || value < 0) ||
    !Number.isInteger(input.requestedDistanceFt) ||
    input.requestedDistanceFt <= 0
  ) {
    throw new RangeError("Move transition budget values must be non-negative integer feet.");
  }
}

/**
 * The two conditional writes of one move — the origin CAS on the Combatant,
 * then the Encounter turn budget — with no history. The player's Move adds its
 * canonical `user` line in persistMoveTransition; an enemy turn logs its move
 * as `system` (enemy-turns spec §6.2).
 *
 * The caller owns the transaction. A stale origin writes nothing; a lost budget
 * claim throws, so the transaction rolls the coordinate update back.
 */
export async function claimMoveTransition(
  tx: Prisma.TransactionClient,
  input: MoveClaimInput
): Promise<MoveTransitionResult> {
  assertMovementTransitionInput(input);

  if (input.requestedDistanceFt > input.speedFt - input.expectedMovementSpentFt) {
    return "budget-exceeded";
  }

  const claim = await tx.combatant.updateMany({
    where: {
      id: input.combatantId,
      x: input.expectedFromX,
      y: input.expectedFromY,
    },
    data: {
      x: input.targetX,
      y: input.targetY,
    },
  });

  if (claim.count === 0) return "stale";

  const budgetClaim = await tx.encounter.updateMany({
    where: {
      id: input.encounterId,
      status: "active",
      round: input.expectedRound,
      currentTurnIndex: input.expectedTurnIndex,
      currentTurnMovementSpentFt: {
        equals: input.expectedMovementSpentFt,
        lte: input.speedFt - input.requestedDistanceFt,
      },
    },
    data: {
      currentTurnMovementSpentFt: { increment: input.requestedDistanceFt },
    },
  });

  // The Combatant origin was already claimed. Throwing is required here so
  // the caller-owned transaction rolls that coordinate mutation back.
  if (budgetClaim.count !== 1) throw new MoveStateConflictError();

  return "claimed";
}

/**
 * Claims one movement transition from the exact origin and Encounter turn
 * budget observed by the route.
 *
 * The caller owns the transaction. Keeping the conditional coordinate update
 * and the canonical player log on the same transaction client means a stale
 * claim writes no history, while a later log failure rolls the coordinate
 * update back with the transaction.
 */
export async function persistMoveTransition(
  tx: Prisma.TransactionClient,
  input: MoveTransitionInput
): Promise<MoveTransitionResult> {
  const result = await claimMoveTransition(tx, input);
  if (result !== "claimed") return result;

  await tx.gameLog.create({
    data: {
      campaignId: input.campaignId,
      role: "user",
      content: input.playerAction,
    },
  });

  return "claimed";
}
