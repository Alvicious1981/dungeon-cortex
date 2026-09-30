import type { Prisma } from "@prisma/client";

/**
 * Writes the permanent death marker (death-saves spec §9): `Character.diedAt`.
 *
 * The only writer of that column, so there is exactly one definition of what
 * death writes. Two rules reach it: a combat that ends `player_dead`
 * (`lib/rules/combat-pipeline.ts`) and a forced march that takes exhaustion to
 * level 6 (`lib/actions/travel-command.ts`).
 * `tests/architecture/died-at-single-writer.test.ts` pins both ends: this
 * module as the writer, and those two as its callers.
 *
 * `diedAt: null` in the predicate makes a retry, or a second cause of death in
 * a racing transaction, a no-op: the first death recorded stands.
 */
export async function markCharacterDead(
  tx: Prisma.TransactionClient,
  characterId: string
): Promise<void> {
  await tx.character.updateMany({
    where: { id: characterId, diedAt: null },
    data: { diedAt: new Date() },
  });
}
