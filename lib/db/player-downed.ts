import type { Prisma } from "@prisma/client";
import type { GameEvent } from "@/lib/events/game-events";
import { DEATH_SAVE_LIMIT, resolveDownedBlow } from "@/lib/rules/death-save";

/**
 * The blow that brought the player to 0 HP
 * (docs/superpowers/specs/2026-09-15-death-saves-design.md §6.1). Runs after
 * setPlayerHp, whose mirror already reset the death state to "dying"; only
 * massive damage writes more — the canonical death marker.
 */
export async function applyPlayerDowned(
  tx: Prisma.TransactionClient,
  input: {
    encounterId: string;
    hpBefore: number;
    damage: number;
    maxHp: number;
    collectEvents: boolean;
    events: GameEvent[];
  }
): Promise<"dying" | "dead"> {
  const fall = resolveDownedBlow(input);
  if (fall === "instant_death") {
    await tx.combatant.updateMany({
      where: { encounterId: input.encounterId, isPlayer: true },
      data: { deathSaveFailures: DEATH_SAVE_LIMIT },
    });
    if (input.collectEvents) {
      input.events.push({ type: "PLAYER_DIED", payload: { cause: "massive_damage" } });
    }
    return "dead";
  }
  if (input.collectEvents) input.events.push({ type: "PLAYER_DOWNED", payload: {} });
  return "dying";
}
