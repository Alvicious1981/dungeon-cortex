import type { Prisma } from "@prisma/client";
import type {
  CombatConsequenceEvent,
  GameEvent,
  SingleTargetConsequence,
} from "@/lib/events/game-events";
import { armorClassFor, type ArmorInventoryRow } from "@/lib/rules/armor-class";
import {
  extractConditions,
  resolveAttackRoll,
  rollDamage,
  rollHitLocation,
} from "@/lib/rules/combat";
import { abilityModifier } from "@/lib/rules/dice";
import { planEnemyTurn } from "@/lib/rules/enemy-turn";
import { chebyshevSquares, toSizeCategory, type GridCombatant } from "@/lib/rules/geometry";
import {
  isMonsterAttackProfile,
  type MonsterAttackProfileV1,
} from "@/lib/rules/monster-attack-profile";
import { COMBATANT_INITIATIVE_ORDER } from "@/lib/rules/turn-authority";
import { claimMoveTransition, MoveStateConflictError } from "@/lib/db/move-transition";
import { setPlayerHp } from "@/lib/db/player-hp";
import { TurnStateConflictError } from "@/lib/db/turn-state-conflict";

/**
 * A state the enemy-turn chain must never reach. The action route maps it to
 * HTTP 500 ENEMY_TURN_INVARIANT, and it is never retried
 * (docs/superpowers/specs/2026-09-15-enemy-turns-design.md §8).
 */
export class EnemyTurnInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnemyTurnInvariantError";
  }
}

export interface EnemyTurnContext {
  campaignId: string;
  encounterId: string;
  characterId: string;
  round: number;
  turnIndex: number;
  collectEvents: boolean;
}

export interface EnemyTurnOutcome {
  events: GameEvent[];
  playerDowned: boolean;
}

interface CombatantRow {
  id: string;
  name: string;
  isPlayer: boolean;
  hp: number;
  x: number;
  y: number;
  size: string;
  conditions: unknown;
  attackProfile?: unknown;
}

function grid(row: CombatantRow): GridCombatant {
  return { id: row.id, x: row.x, y: row.y, size: toSizeCategory(row.size) };
}

/**
 * Resolves the enemy that owns (round, turnIndex): its move, then its attacks
 * on the player (spec §5, §6.2).
 *
 * The caller, finalizeEncounterTurn, holds the Character row lock and owns the
 * transaction. Every write here goes through `tx`, and any conflict throws, so
 * the whole transaction — including the player's own turn — rolls back.
 */
export async function resolveEnemyTurn(
  tx: Prisma.TransactionClient,
  ctx: EnemyTurnContext
): Promise<EnemyTurnOutcome> {
  const events: GameEvent[] = [];
  const combatants = (await tx.combatant.findMany({
    where: { encounterId: ctx.encounterId },
    orderBy: COMBATANT_INITIATIVE_ORDER,
  })) as unknown as CombatantRow[];

  const enemy = combatants[ctx.turnIndex];
  const player = combatants.find((c) => c.isPlayer);
  if (!enemy || enemy.isPlayer || !player) {
    throw new EnemyTurnInvariantError(
      `Encounter ${ctx.encounterId} has no enemy at turn ${ctx.turnIndex}.`
    );
  }

  // Prisma returns SQL NULL as null; reduced route-test doubles may omit the
  // field entirely. Both mean "no profile": the turn is skipped, not failed.
  const rawProfile = enemy.attackProfile ?? null;
  if (rawProfile !== null && !isMonsterAttackProfile(rawProfile)) {
    throw new EnemyTurnInvariantError(`Combatant ${enemy.id} carries a malformed attack profile.`);
  }
  const profile = rawProfile as MonsterAttackProfileV1 | null;

  const enemyGrid = grid(enemy);
  const plan = planEnemyTurn({
    enemy: {
      ...enemyGrid,
      hp: enemy.hp,
      conditions: extractConditions(enemy.conditions),
      profile,
    },
    player: grid(player),
    others: combatants.filter((c) => c.id !== enemy.id).map(grid),
  });

  if (plan.move && profile) {
    const distanceFt = chebyshevSquares(enemyGrid, plan.move) * 5;
    let claim: Awaited<ReturnType<typeof claimMoveTransition>>;
    try {
      claim = await claimMoveTransition(tx, {
        encounterId: ctx.encounterId,
        combatantId: enemy.id,
        expectedFromX: enemy.x,
        expectedFromY: enemy.y,
        expectedRound: ctx.round,
        expectedTurnIndex: ctx.turnIndex,
        // The turn claim that made this enemy active reset the budget to 0.
        expectedMovementSpentFt: 0,
        requestedDistanceFt: distanceFt,
        speedFt: profile.walkSpeedFt,
        targetX: plan.move.x,
        targetY: plan.move.y,
      });
    } catch (error) {
      if (error instanceof MoveStateConflictError) throw new TurnStateConflictError();
      throw error;
    }
    if (claim !== "claimed") throw new TurnStateConflictError();

    await tx.gameLog.create({
      data: {
        campaignId: ctx.campaignId,
        role: "system",
        content: `${enemy.name} moves ${distanceFt} ft.`,
      },
    });
    if (ctx.collectEvents) {
      events.push({
        type: "MOVE_COMBATANT",
        payload: {
          combatantId: enemy.id,
          fromX: enemy.x,
          fromY: enemy.y,
          toX: plan.move.x,
          toY: plan.move.y,
          distanceFt,
        },
      });
    }
  }

  if (plan.attacks.length === 0 || !profile) return { events, playerDowned: false };

  const character = (await tx.character.findUnique({
    where: { id: ctx.characterId },
    select: {
      hp: true,
      maxHp: true,
      stats: true,
      inventory: { select: { type: true, equippedSlot: true, properties: true } },
    },
  })) as { hp: number; maxHp: number; stats: unknown; inventory: ArmorInventoryRow[] } | null;
  if (!character) {
    throw new EnemyTurnInvariantError(`Character ${ctx.characterId} not found.`);
  }

  // The player's current AC, from current inventory — never the Combatant.ac
  // copy, which no in-combat equipment change updates (spec §5.5).
  const stats = (character.stats ?? {}) as Record<string, number>;
  const playerAC = armorClassFor({
    inventory: character.inventory,
    dexModifier: abilityModifier(stats.DEX ?? 10),
  }).armorClass;
  const enemyConditions = extractConditions(enemy.conditions);
  const playerConditions = extractConditions(player.conditions);
  let hp = character.hp;

  for (const name of plan.attacks) {
    const attack = profile.attacks.find((a) => a.name === name);
    if (!attack) {
      throw new EnemyTurnInvariantError(`Planned attack ${name} is not in ${enemy.id}'s profile.`);
    }

    const roll = resolveAttackRoll(
      attack.attackBonus,
      playerAC,
      enemyConditions,
      playerConditions,
      plan.mode === "melee"
    );
    let damage = 0;
    let damageText = "";
    if (roll.hit) {
      const parts = attack.damage.map((d) => ({
        type: d.type,
        amount: Math.max(0, rollDamage(d.dice, roll.critical).total),
      }));
      damage = parts.reduce((sum, part) => sum + part.amount, 0);
      damageText = parts.map((part) => `${part.amount} ${part.type}`).join(" + ");
      hp = await setPlayerHp(tx, {
        characterId: ctx.characterId,
        encounterId: ctx.encounterId,
        hp: hp - damage,
      });
    }

    const verdict = roll.critical ? "critical hit" : roll.hit ? "hit" : "miss";
    await tx.gameLog.create({
      data: {
        campaignId: ctx.campaignId,
        role: "system",
        content:
          `${enemy.name} — ${attack.name}: ${roll.total} vs AC ${playerAC}, ${verdict}` +
          `${roll.hit ? `, ${damageText} damage` : ""}.`,
      },
    });

    if (ctx.collectEvents) {
      const consequence: SingleTargetConsequence = {
        targetName: player.name,
        targetId: player.id,
        damage,
        naturalRoll: roll.roll,
        isCrit: roll.critical,
        isFumble: roll.fumble,
        hitLocation: roll.hit ? rollHitLocation() : "chest",
        narrativeTags: [],
        hpAfter: hp,
        targetMaxHp: character.maxHp,
        isKill: hp <= 0,
        conditionsApplied: [],
      };
      // Built as a typed literal: buildCombatConsequenceEvent lives in
      // combat-pipeline.ts, which imports this module.
      const consequenceEvent: CombatConsequenceEvent = {
        type: "COMBAT_CONSEQUENCE",
        payload: { attackerName: enemy.name, targets: [consequence] },
      };
      events.push(consequenceEvent);
      // The same per-hit companions executeCombatAction emits for a player attack.
      if (roll.fumble) {
        events.push({
          type: "CRITICAL_MISS",
          payload: { naturalRoll: roll.roll, targetName: player.name },
        });
      } else if (roll.critical) {
        events.push({
          type: "CRITICAL_HIT",
          payload: { damage, naturalRoll: roll.roll, targetName: player.name },
        });
      } else if (damage > 0) {
        events.push({
          type: "DAMAGE_DEALT",
          payload: { damage, naturalRoll: roll.roll, targetName: player.name },
        });
      }
    }

    if (hp <= 0) {
      if (ctx.collectEvents) events.push({ type: "PLAYER_DOWNED", payload: {} });
      return { events, playerDowned: true };
    }
  }

  return { events, playerDowned: false };
}
