import type { Prisma } from "@prisma/client";
import type { GameEvent } from "@/lib/events/game-events";
import { lockCharacterForCombatAction } from "@/lib/db/character-lock";
import { setPlayerHp } from "@/lib/db/player-hp";
import { TurnStateConflictError } from "@/lib/db/turn-state-conflict";
import { rollDie } from "@/lib/rules/dice";
import {
  DeathSaveInvariantError,
  derivePlayerLifeState,
  resolveDeathSave,
  stabilize,
} from "@/lib/rules/death-save";

export interface DeathSaveContext {
  campaignId: string;
  encounterId: string;
  characterId: string;
  round: number;
  turnIndex: number;
  collectEvents: boolean;
}

export interface DeathSaveDice {
  d20(): number;
  d4(): number;
}

const LIVE_DICE: DeathSaveDice = { d20: () => rollDie(20), d4: () => rollDie(4) };

/**
 * One death save on the dying player's turn
 * (docs/superpowers/specs/2026-09-15-death-saves-design.md §6.3).
 *
 * Lock order Character → Combatant → Encounter: the Character lock first, the
 * Combatant write, then the conditional touch that binds the save to the
 * observed turn. Any lost race throws and rolls the whole transaction back.
 * The caller finalizes the turn when `endsTurn` is true.
 */
export async function rollPlayerDeathSave(
  tx: Prisma.TransactionClient,
  ctx: DeathSaveContext,
  dice: DeathSaveDice = LIVE_DICE
): Promise<{
  events: GameEvent[];
  outcome: "revived" | "dying" | "stable" | "dead";
  endsTurn: boolean;
}> {
  await lockCharacterForCombatAction(tx, ctx.characterId);

  const player = await tx.combatant.findFirst({
    where: { encounterId: ctx.encounterId, isPlayer: true },
    select: {
      id: true,
      name: true,
      hp: true,
      deathSaveSuccesses: true,
      deathSaveFailures: true,
      stableWakeRound: true,
    },
  });
  if (!player) {
    throw new DeathSaveInvariantError(`Encounter ${ctx.encounterId} has no player combatant.`);
  }
  // Under the lock: a concurrent save that already revived, stabilised or
  // killed the player owns this turn.
  if (derivePlayerLifeState(player) !== "dying") throw new TurnStateConflictError();

  const natural = dice.d20();
  const result = resolveDeathSave(
    { successes: player.deathSaveSuccesses, failures: player.deathSaveFailures },
    natural
  );
  const where = { encounterId: ctx.encounterId, isPlayer: true };

  if (result.outcome === "revived") {
    // setPlayerHp's mirror resets the counters (spec §4).
    await setPlayerHp(tx, { characterId: ctx.characterId, encounterId: ctx.encounterId, hp: 1 });
  } else if (result.outcome === "stable") {
    await tx.combatant.updateMany({
      where,
      data: {
        deathSaveSuccesses: result.successes,
        deathSaveFailures: result.failures,
        stableWakeRound: stabilize(ctx.round, dice.d4()),
      },
    });
  } else {
    await tx.combatant.updateMany({
      where,
      data: { deathSaveSuccesses: result.successes, deathSaveFailures: result.failures },
    });
  }

  const touch = await tx.encounter.updateMany({
    where: {
      id: ctx.encounterId,
      status: "active",
      currentTurnIndex: ctx.turnIndex,
      round: ctx.round,
    },
    data: { currentTurnMovementSpentFt: 0 },
  });
  if (touch.count !== 1) throw new TurnStateConflictError();

  const successes = result.outcome === "revived" ? 0 : result.successes;
  const failures = result.outcome === "revived" ? 0 : result.failures;
  const verdict = natural === 20 ? "natural 20" : natural >= 10 ? "success" : "failure";
  await tx.gameLog.create({
    data: {
      campaignId: ctx.campaignId,
      role: "system",
      // The counters alone do not tell the player what they mean.
      content:
        `Death save: ${natural} — ${verdict} (${successes}/3 successes, ${failures}/3 failures).` +
        (result.outcome === "stable"
          ? ` ${player.name} is stable.`
          : result.outcome === "dead"
            ? ` ${player.name} dies.`
            : result.outcome === "revived"
              ? ` ${player.name} regains consciousness with 1 HP.`
              : ""),
    },
  });

  const events: GameEvent[] = [];
  if (ctx.collectEvents) {
    events.push({
      type: "DEATH_SAVE_ROLLED",
      payload: { natural, successes, failures, outcome: result.outcome },
    });
    if (result.outcome === "revived") events.push({ type: "PLAYER_REVIVED", payload: { hp: 1 } });
    if (result.outcome === "stable") events.push({ type: "PLAYER_STABILIZED", payload: {} });
    if (result.outcome === "dead") {
      events.push({ type: "PLAYER_DIED", payload: { cause: "death_saves" } });
    }
  }

  return { events, outcome: result.outcome, endsTurn: result.outcome !== "revived" };
}
