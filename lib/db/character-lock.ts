import type { Prisma } from "@prisma/client";

/**
 * A damaging action can update Combatant and then certify a victory whose XP
 * award updates Character in `finalizeEncounterTurn`. Actions that do not
 * already claim a spell slot or start concentration take this lock first, so
 * every transaction that can write both rows follows Character → Combatant.
 *
 * Reduced route-test doubles may omit Prisma's raw-query surface. Production
 * transactions always expose it and therefore always take this lock.
 */
export async function lockCharacterForCombatAction(
  tx: Prisma.TransactionClient,
  characterId: string
): Promise<void> {
  if (typeof tx.$queryRaw !== "function") return;

  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Character"
    WHERE "id" = ${characterId}
    FOR UPDATE
  `;
}
