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
  resolveSavingThrow,
  resolveConcentrationCheck,
  rollDamage,
  rollHitLocation,
} from "@/lib/rules/combat";
import { abilityModifier, rollDie } from "@/lib/rules/dice";
import { planEnemyTurn } from "@/lib/rules/enemy-turn";
import { chebyshevSquares, toSizeCategory, type GridCombatant } from "@/lib/rules/geometry";
import {
  isMonsterAttackProfile,
  type MonsterAttackProfileV1,
} from "@/lib/rules/monster-attack-profile";
import { proficiencyBonus } from "@/lib/rules/proficiency";
import { isProficientInSave } from "@/lib/rules/saving-throw-proficiency";
import { COMBATANT_INITIATIVE_ORDER } from "@/lib/rules/turn-authority";
import { claimMoveTransition, MoveStateConflictError } from "@/lib/db/move-transition";
import { setPlayerHp } from "@/lib/db/player-hp";
import { applyPlayerDowned } from "@/lib/db/player-downed";
import { effectiveMaxHp, exhaustionEffects } from "@/lib/rules/exhaustion";
import { TurnStateConflictError } from "@/lib/db/turn-state-conflict";
import { concentrationOf, endSpellConditions } from "@/lib/db/spell-condition-end";

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

const ABILITY_FULL_NAME: Record<string, string> = {
  STR: "Strength", DEX: "Dexterity", CON: "Constitution",
  INT: "Intelligence", WIS: "Wisdom", CHA: "Charisma",
};

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
  /** This turn's blow brought the player to 0 HP. */
  playerDowned: boolean;
  /** ...and killed them outright: massive damage (death-saves spec §6.1). */
  playerDied: boolean;
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
  breathAvailable?: boolean | null;
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

  // The recharge roll happens at the start of the turn, whether or not the
  // action ends up used this turn (spec §6.1).
  let breathAvailable = enemy.breathAvailable ?? undefined;
  if (profile?.areaSaveAttack && breathAvailable === false) {
    const roll = rollDie(6);
    if (roll >= profile.areaSaveAttack.rechargeMin) {
      breathAvailable = true;
      await tx.combatant.updateMany({ where: { id: enemy.id }, data: { breathAvailable: true } });
      await tx.gameLog.create({
        data: {
          campaignId: ctx.campaignId, role: "system",
          content: `${enemy.name} recharges its ${profile.areaSaveAttack.name} (${roll}).`,
        },
      });
    } else {
      await tx.gameLog.create({
        data: {
          campaignId: ctx.campaignId, role: "system",
          content: `${enemy.name} fails to recharge its ${profile.areaSaveAttack.name} (${roll}).`,
        },
      });
    }
  }

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
    playerDowned: player.hp <= 0,
    breathAvailable,
  });
  if (
    player.hp <= 0 &&
    (plan.move !== null || plan.attacks.length > 0 || plan.areaSaveAttack !== null)
  ) {
    throw new EnemyTurnInvariantError(`Enemy ${enemy.id} planned to act against a downed player.`);
  }

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

  if ((plan.attacks.length === 0 && plan.areaSaveAttack === null) || !profile) {
    return { events, playerDowned: false, playerDied: false };
  }

  const character = (await tx.character.findUnique({
    where: { id: ctx.characterId },
    select: {
      hp: true,
      maxHp: true,
      stats: true,
      class: true,
      level: true,
      exhaustionLevel: true,
      concentrationSpellId: true,
      inventory: { select: { type: true, quantity: true, equippedSlot: true, properties: true } },
    },
  })) as {
    hp: number; maxHp: number; stats: unknown; class: string; level: number;
    exhaustionLevel?: number | null;
    concentrationSpellId?: string | null;
    inventory: ArmorInventoryRow[];
  } | null;
  if (!character) {
    throw new EnemyTurnInvariantError(`Character ${ctx.characterId} not found.`);
  }
  // SRD exhaustion: level 3+ puts the player's saves at disadvantage, and
  // level 4+ halves the hit point maximum — which is also the massive-damage
  // threshold, since that rule is written against the hit point maximum.
  const exhaustion = exhaustionEffects(character.exhaustionLevel);
  const playerMaxHp = effectiveMaxHp(character.maxHp, character.exhaustionLevel);

  // SRD: taking damage while concentrating forces a Constitution save, DC 10
  // or half the damage, whichever is higher — one save per source of damage.
  // Falling unconscious (0 HP) ends concentration outright: an incapacitated
  // creature cannot concentrate. Until this existed, enemy hits never touched
  // the player's concentration at all, so a spell the player was holding
  // survived every blow and the narrator was told it was still active.
  let concentratingOn = character.concentrationSpellId ?? null;

  // Resolves to true when concentration ended, so a caller mid-turn can
  // re-read the conditions the spell was holding on this enemy.
  const checkPlayerConcentration = async (damage: number, hpAfter: number): Promise<boolean> => {
    if (!concentratingOn || damage <= 0) return false;
    const spell = concentratingOn;
    let content: string;
    let check: ReturnType<typeof resolveConcentrationCheck> | null = null;
    if (hpAfter <= 0) {
      content = `${player.name} falls unconscious and loses concentration on ${spell}.`;
    } else {
      const conSaveModifier =
        abilityModifier(((character.stats ?? {}) as Record<string, number>).CON ?? 10) +
        (isProficientInSave(character.class, "CON") ? proficiencyBonus(character.level) : 0);
      check = resolveConcentrationCheck(damage, conSaveModifier, exhaustion.savingThrowDisadvantage);
      content =
        `Concentration (${spell}): DC ${check.dc} Constitution save, ${player.name} rolls ` +
        `${check.total} — ${check.success ? "holds" : "concentration broken"}.`;
    }
    await tx.gameLog.create({ data: { campaignId: ctx.campaignId, role: "system", content } });
    if (check?.success) return false;

    concentratingOn = null;
    // Character first, then its Combatant mirror — the lock order setPlayerHp keeps.
    await tx.character.update({
      where: { id: ctx.characterId },
      data: { concentrationSpellId: null },
    });
    await tx.combatant.updateMany({
      where: { encounterId: ctx.encounterId, isPlayer: true },
      data: { concentrationSpellId: null },
    });
    // The spell ends, and with it every condition it was holding.
    const ended = await endSpellConditions(tx, {
      encounterId: ctx.encounterId,
      shouldEnd: concentrationOf(player.id),
      reason: check ? "concentration broken" : "caster fell unconscious",
    });
    for (const entry of ended) {
      await tx.gameLog.create({ data: { campaignId: ctx.campaignId, role: "system", content: entry.log } });
      // This enemy's own attacks for the rest of its turn roll without the
      // condition that just ended.
      if (entry.combatantId === enemy.id) enemyConditions = entry.conditions;
    }
    if (ctx.collectEvents) {
      events.push({
        type: "CONCENTRATION_BROKEN",
        payload: {
          targetName: player.name,
          spellName: spell,
          reason: check ? "failed_save" : "unconscious",
          ...(check ? { dc: check.dc, roll: check.total } : {}),
        },
      });
    }
    return true;
  };

  // The player's current AC, from current inventory — never the Combatant.ac
  // copy, which no in-combat equipment change updates (spec §5.5).
  const stats = (character.stats ?? {}) as Record<string, number>;
  const playerAC = armorClassFor({
    inventory: character.inventory,
    dexModifier: abilityModifier(stats.DEX ?? 10),
  }).armorClass;
  let enemyConditions = extractConditions(enemy.conditions);
  const playerConditions = extractConditions(player.conditions);
  let hp = character.hp;

  for (const name of plan.attacks) {
    const attack = profile.attacks.find((a) => a.name === name);
    if (!attack) {
      throw new EnemyTurnInvariantError(`Planned attack ${name} is not in ${enemy.id}'s profile.`);
    }

    const hpBeforeHit = hp;
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
        targetIsPlayer: player.isPlayer,
        damage,
        naturalRoll: roll.roll,
        isCrit: roll.critical,
        isFumble: roll.fumble,
        hitLocation: roll.hit ? rollHitLocation() : "chest",
        narrativeTags: [],
        hpAfter: hp,
        targetMaxHp: playerMaxHp,
        isKill: hp <= 0,
        conditionsApplied: [],
      };
      // Built as a typed literal: buildCombatConsequenceEvent lives in
      // combat-pipeline.ts, which imports this module.
      const consequenceEvent: CombatConsequenceEvent = {
        type: "COMBAT_CONSEQUENCE",
        payload: {
          attackerName: enemy.name,
          attackerIsPlayer: enemy.isPlayer,
          targets: [consequence],
        },
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

    await checkPlayerConcentration(damage, hp);

    if (hp <= 0) {
      const fall = await applyPlayerDowned(tx, {
        encounterId: ctx.encounterId,
        hpBefore: hpBeforeHit,
        damage,
        maxHp: playerMaxHp,
        collectEvents: ctx.collectEvents,
        events,
      });
      await tx.gameLog.create({
        data: {
          campaignId: ctx.campaignId,
          role: "system",
          content:
            fall === "dead"
              ? `${player.name} dies from massive damage.`
              : `${player.name} falls unconscious and is dying.`,
        },
      });
      // The remaining multiattack attacks are not rolled (death-saves spec §6.1).
      return { events, playerDowned: true, playerDied: fall === "dead" };
    }
  }

  if (plan.areaSaveAttack && profile.areaSaveAttack) {
    const attack = profile.areaSaveAttack;
    const saveStats = (character.stats ?? {}) as Record<string, number>;
    const saveModifier =
      abilityModifier(saveStats[attack.saveAbility] ?? 10) +
      (isProficientInSave(character.class, attack.saveAbility) ? proficiencyBonus(character.level) : 0);
    const save = resolveSavingThrow(saveModifier, attack.saveDC, false, exhaustion.savingThrowDisadvantage);

    const rolled = attack.damage.reduce(
      (sum, part) => sum + Math.max(0, rollDamage(part.dice, false).total),
      0,
    );
    const damage = save.success ? Math.floor(rolled / 2) : rolled;
    const hpBeforeHit = hp;
    hp = await setPlayerHp(tx, { characterId: ctx.characterId, encounterId: ctx.encounterId, hp: hp - damage });

    await tx.combatant.updateMany({ where: { id: enemy.id }, data: { breathAvailable: false } });

    const abilityName = ABILITY_FULL_NAME[attack.saveAbility];
    await tx.gameLog.create({
      data: {
        campaignId: ctx.campaignId,
        role: "system",
        content:
          `${enemy.name} — ${attack.name}: DC ${attack.saveDC} ${abilityName} save, ${player.name} rolls ` +
          `${save.total} — ${save.success ? "succeeds" : "fails"}, ${damage} ${attack.damage[0]!.type} damage.`,
      },
    });

    if (ctx.collectEvents) {
      const consequence: SingleTargetConsequence = {
        targetName: player.name, targetId: player.id, targetIsPlayer: player.isPlayer, damage,
        naturalRoll: save.roll, isCrit: false, isFumble: false,
        hitLocation: "chest", narrativeTags: [], hpAfter: hp,
        targetMaxHp: playerMaxHp, isKill: hp <= 0, conditionsApplied: [],
      };
      events.push({
        type: "COMBAT_CONSEQUENCE",
        payload: {
          attackerName: enemy.name,
          attackerIsPlayer: enemy.isPlayer,
          targets: [consequence],
        },
      });
      if (damage > 0) {
        events.push({ type: "DAMAGE_DEALT", payload: { damage, naturalRoll: save.roll, targetName: player.name } });
      }
    }

    await checkPlayerConcentration(damage, hp);

    if (hp <= 0) {
      const fall = await applyPlayerDowned(tx, {
        encounterId: ctx.encounterId, hpBefore: hpBeforeHit, damage,
        maxHp: playerMaxHp, collectEvents: ctx.collectEvents, events,
      });
      await tx.gameLog.create({
        data: {
          campaignId: ctx.campaignId, role: "system",
          content:
            fall === "dead"
              ? `${player.name} dies from massive damage.`
              : `${player.name} falls unconscious and is dying.`,
        },
      });
      return { events, playerDowned: true, playerDied: fall === "dead" };
    }
  }

  return { events, playerDowned: false, playerDied: false };
}
