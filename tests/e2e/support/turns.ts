import { advanceTurn } from "../../../lib/rules/combat";

/**
 * Where the enemy-turn chain leaves the initiative pointer after a successful
 * player turn claim when no enemy can act — every enemy's `attackProfile` is
 * NULL, as it is for any enemy created without an SRD `monsterIndex`.
 *
 * The chain claims the player's edge, then one edge per skipped enemy, until it
 * reaches the player again (docs/superpowers/specs/2026-09-15-enemy-turns-design.md §6.2).
 * `claims` is the number of TURN_ADVANCE / ROUND_ADVANCE events that emits.
 */
export function turnAfterSkippedEnemies(input: {
  combatants: ReadonlyArray<{ isPlayer: boolean; initiativeOrder: number }>;
  currentTurnIndex: number;
  round: number;
}): { turnIndex: number; round: number; claims: number } {
  const ordered = [...input.combatants].sort((a, b) => a.initiativeOrder - b.initiativeOrder);
  let turnIndex = input.currentTurnIndex;
  let round = input.round;
  let claims = 0;
  do {
    const next = advanceTurn({
      currentTurnIndex: turnIndex,
      round,
      combatantCount: ordered.length,
    });
    turnIndex = next.nextTurnIndex;
    round = next.nextRound;
    claims += 1;
  } while (!ordered[turnIndex]!.isPlayer);
  return { turnIndex, round, claims };
}
