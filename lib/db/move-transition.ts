import type { Prisma } from "@prisma/client";

export interface MoveTransitionInput {
  campaignId: string;
  combatantId: string;
  expectedFromX: number;
  expectedFromY: number;
  targetX: number;
  targetY: number;
  playerAction: string;
}

export type MoveTransitionResult = "claimed" | "stale";

/**
 * Claims one movement transition from the exact origin observed by the route.
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

  await tx.gameLog.create({
    data: {
      campaignId: input.campaignId,
      role: "user",
      content: input.playerAction,
    },
  });

  return "claimed";
}
