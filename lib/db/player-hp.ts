import type { Prisma } from "@prisma/client";

/**
 * Every player HP write clears the death state: falling to 0 starts a fresh
 * dying state, and any HP above 0 (a natural 20, waking, healing) ends it
 * (docs/superpowers/specs/2026-09-15-death-saves-design.md §4).
 */
export const DEATH_STATE_RESET = {
  deathSaveSuccesses: 0,
  deathSaveFailures: 0,
  stableWakeRound: null,
} as const;

/**
 * The player's HP has one source of truth, Character.hp; the player's
 * Combatant row in an active encounter is its mirror. resolveEncounterEnd
 * reads the mirror, so the two must never diverge
 * (docs/superpowers/specs/2026-09-15-enemy-turns-design.md §6.3).
 */
export async function mirrorPlayerCombatantHp(
  tx: Prisma.TransactionClient,
  encounterId: string | null,
  hp: number
): Promise<void> {
  if (!encounterId) return;
  await tx.combatant.updateMany({
    where: { encounterId, isPlayer: true },
    data: { hp, ...DEATH_STATE_RESET },
  });
}

/**
 * Writes the player's HP, then its mirror, in lock order (Character →
 * Combatant). The caller must already hold the Character row lock
 * (lockCharacterForCombatAction). Returns the value written, clamped at 0.
 */
export async function setPlayerHp(
  tx: Prisma.TransactionClient,
  input: { characterId: string; encounterId: string | null; hp: number }
): Promise<number> {
  const hp = Math.max(0, Math.trunc(input.hp));
  await tx.character.update({ where: { id: input.characterId }, data: { hp } });
  await mirrorPlayerCombatantHp(tx, input.encounterId, hp);
  return hp;
}
