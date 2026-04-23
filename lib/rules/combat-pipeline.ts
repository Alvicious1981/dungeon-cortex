import type { Prisma } from "@/app/generated/prisma/client";
import type {
  CombatConsequencePayload,
  GameEvent,
  SingleTargetConsequence,
} from "@/lib/events/game-events";
import { abilityModifier, roll } from "@/lib/rules/dice";
import {
  advanceTurn,
  computeConsequences,
  extractConditions,
  resolveConcentrationCheck,
  resolveEncounterEnd,
  rollHitLocation,
  computeOverkill,
  deriveNarrativeTags,
  applyCondition,
  resolveSavingThrow,
  type CombatConsequences,
  type DamageType,
  type EncounterSnapshot,
  type CombatFacts,
  type HitLocation,
} from "@/lib/rules/combat";
import { consumeSlot } from "@/lib/rules/magic";

export interface PipelineCombatant {
  id: string;
  name: string;
  isPlayer: boolean;
  hp: number;
  maxHp: number;
  ac: number;
  conditions: unknown;
  stats: unknown;
  concentrationSpellId: string | null;
}

export interface PipelineEncounterState {
  id: string;
  round: number;
  currentTurnIndex: number;
  totalDamageDealt: number;
  status: "active" | "resolved" | "fled";
  combatants: PipelineCombatant[];
}

export type CombatActionType = "attack" | "cast_spell" | "use_item";

export interface CombatActionPayload {
  actionType: CombatActionType;
  encounter: PipelineEncounterState;
  actorId: string;
  actorName: string;
  actorConditions: string[];
  targetCombatants: PipelineCombatant[];
  
  // Weapon/Attack data
  weaponName?: string;
  weaponDice?: string;
  damageType?: DamageType;
  attackModifier?: number;
  flatDamageBonus?: number;

  // Spell data
  spellName?: string;
  spellLevel?: number;
  spellEffect?: any;
  spellSaveDC?: number;
  rawSpellSlots?: unknown;

  // Item data
  itemId?: string;
  itemName?: string;
  itemQuantity?: number;
  healingDice?: string;
  healingBonus?: number;

  playerCharacterId?: string;
  collectEvents?: boolean;
}

export interface CombatOutcome {
  events: GameEvent[];
  consequences: SingleTargetConsequence[];
  totalDamageDealt: number;
  consequenceDetails?: CombatConsequences[];
}

export interface FinalizeEncounterTurnInput {
  tx: Prisma.TransactionClient;
  encounterId: string;
  currentTurnIndex: number;
  round: number;
  collectEvents?: boolean;
}

export interface FinalizeTurnResult {
  events: GameEvent[];
  encounterResolved: boolean;
  nextTurnIndex?: number;
  nextRound?: number;
}

export function buildCombatConsequenceEvent(input: {
  attackerName: string;
  targets: SingleTargetConsequence[];
}): GameEvent {
  const first = input.targets[0];
  const payload: CombatConsequencePayload = {
    attackerName: input.attackerName,
    targets: input.targets,
    targetId: first?.targetId ?? "",
    targetName: first?.targetName ?? "",
    damage: first?.damage ?? 0,
    hpAfter: first?.hpAfter ?? 0,
    targetMaxHp: first?.targetMaxHp ?? 0,
    isCrit: first?.isCrit ?? false,
    isFumble: first?.isFumble ?? false,
    naturalRoll: first?.naturalRoll ?? 0,
    isKill: first?.isKill ?? false,
    hitLocation: first?.hitLocation,
    narrativeTags: first?.narrativeTags ?? [],
  };

  return {
    type: "COMBAT_CONSEQUENCE",
    payload: payload as Record<string, unknown>,
  };
}

export async function executeCombatAction(
  payload: CombatActionPayload,
  tx: Prisma.TransactionClient
): Promise<CombatOutcome> {
  const events: GameEvent[] = [];
  const consequences: SingleTargetConsequence[] = [];
  const consequenceDetails: CombatConsequences[] = [];
  let totalDamageDealt = 0;

  const {
    actionType,
    encounter,
    actorName,
    actorConditions,
    targetCombatants,
    playerCharacterId,
    collectEvents = true,
  } = payload;

  const enemyCombatants = encounter.combatants.filter((c) => !c.isPlayer);

  // RESOURCE DRAIN
  if (actionType === "cast_spell" && payload.spellLevel !== undefined && payload.rawSpellSlots) {
    const updatedSlots = consumeSlot(payload.rawSpellSlots as any, payload.spellLevel);
    if (playerCharacterId) {
      await tx.character.update({
        where: { id: playerCharacterId },
        data: { spellSlots: updatedSlots as unknown as Prisma.InputJsonValue },
      });
    }
    if (collectEvents) {
      events.push({
        type: "SPELL_CAST",
        payload: { spellLevel: payload.spellLevel, spellName: payload.spellName ?? null },
      });
    }
  } else if (actionType === "use_item" && payload.itemId && payload.itemQuantity !== undefined) {
    if (payload.itemQuantity <= 1) {
      await tx.inventoryItem.delete({ where: { id: payload.itemId } });
    } else {
      await tx.inventoryItem.update({
        where: { id: payload.itemId },
        data: { quantity: payload.itemQuantity - 1 },
      });
    }
  }

  // CONCENTRATION START
  if (actionType === "cast_spell" && payload.spellName && payload.spellEffect?.concentration && playerCharacterId) {
    await tx.character.update({
      where: { id: playerCharacterId },
      data: { concentrationSpellId: payload.spellName }
    });
    if (collectEvents) {
      events.push({ type: "CONCENTRATION_STARTED", payload: { spellName: payload.spellName } });
    }
  }

  // HEALING SPELLS
  if (actionType === "cast_spell" && payload.spellEffect?.type === "healing" && payload.spellEffect.dice) {
    const healed = roll(payload.spellEffect.dice).total;
    if (playerCharacterId) {
      const character = await tx.character.findUnique({ where: { id: playerCharacterId } });
      if (character) {
        const newHp = Math.min(character.hp + healed, character.maxHp);
        await tx.character.update({
          where: { id: playerCharacterId },
          data: { hp: newHp },
        });
        if (collectEvents) {
          events.push({ type: "HEALING_RECEIVED", payload: { amount: healed, newHp, spellName: payload.spellName } });
        }
      }
    }
  }

  // USE ITEM HEALING
  if (actionType === "use_item" && payload.healingDice) {
    const healed = roll(payload.healingDice).total + (payload.healingBonus ?? 0);
    if (playerCharacterId) {
      const character = await tx.character.findUnique({ where: { id: playerCharacterId } });
      if (character) {
        const newHp = Math.min(character.hp + healed, character.maxHp);
        await tx.character.update({
          where: { id: playerCharacterId },
          data: { hp: newHp },
        });
        if (collectEvents) {
          events.push({
            type: "HEALING_RECEIVED",
            payload: { amount: healed, newHp, itemName: payload.itemName },
          });
          if (newHp <= 0) {
            events.push({ type: "PLAYER_DOWNED", payload: {} });
          }
        }
      }
    }
  }

  // RESOLVE TARGETS
  for (const target of targetCombatants) {
    let damage = 0;
    let saved = false;
    let saveRoll = 0;
    let hitLoc: HitLocation | undefined;
    let tags: string[] = [];
    let isFumble = false;
    let isCrit = false;
    let newHp = target.hp;
    let naturalRoll = 0;
    let conditionsToApply: string[] = [];

    if (actionType === "attack") {
      const snapshot: EncounterSnapshot = {
        round: encounter.round,
        totalDamageDealt: encounter.totalDamageDealt + totalDamageDealt,
        status: encounter.status,
        currentBeat: "opening",
        defenderId: target.id,
        combatants: encounter.combatants.map((c) => ({
          id: c.id,
          isPlayer: c.isPlayer,
          hp: c.hp,
          maxHp: c.maxHp,
          hpBeforeThisTurn: c.hp,
          isBoss: !c.isPlayer && enemyCombatants.length === 1,
        })),
      };

      const consequencesPayload = computeConsequences({
        attacker: actorName,
        defender: target.name,
        weapon: payload.weaponName ?? "Unarmed",
        weaponDice: payload.weaponDice ?? "1d4",
        attackModifier: payload.attackModifier ?? 0,
        flatDamageBonus: payload.flatDamageBonus ?? 0,
        damageType: payload.damageType ?? "bludgeoning",
        targetAC: target.ac,
        targetHp: target.hp,
        targetMaxHp: target.maxHp,
        targetIsPlayer: target.isPlayer,
        targetIsBoss: !target.isPlayer && enemyCombatants.length === 1,
        statusApplied: [],
        attackerConditions: actorConditions,
        defenderConditions: extractConditions(target.conditions),
        isMelee: true,
        encounterSnapshot: snapshot,
        usedSenses: [],
        zones: [],
      });

      damage = consequencesPayload.combat_facts.damage;
      newHp = consequencesPayload.combat_facts.hp_after;
      isFumble = consequencesPayload.combat_facts.is_fumble;
      isCrit = consequencesPayload.combat_facts.is_crit;
      naturalRoll = consequencesPayload.combat_facts.attack_roll ?? 0;
      hitLoc = consequencesPayload.combat_facts.hit_location as HitLocation;
      tags = consequencesPayload.narrative_tags;
      consequenceDetails.push(consequencesPayload);
      
    } else if (actionType === "cast_spell" && payload.spellEffect) {
      const effect = payload.spellEffect;
      if (effect.hasSavingThrow && effect.saveAbility && payload.spellSaveDC) {
        const targetStats = (target.stats as Record<string, number>) || {};
        const targetMod = abilityModifier(targetStats[effect.saveAbility] ?? 10);
        const saveResult = resolveSavingThrow(targetMod, payload.spellSaveDC);
        saved = saveResult.success;
        saveRoll = saveResult.total;
        naturalRoll = saveRoll;
        
        if (effect.dice) {
          const diceTotal = roll(effect.dice).total;
          damage = saved ? Math.floor(diceTotal / 2) : diceTotal;
        }
      } else if (effect.dice && effect.type !== "healing") {
        damage = roll(effect.dice).total;
      }

      if (damage > 0) {
        hitLoc = rollHitLocation();
        const facts: CombatFacts = {
          attacker: actorName,
          defender: target.name,
          weapon: payload.spellName || "Spell",
          damage,
          damage_type: effect.damageType || "force",
          hp_before: target.hp,
          hp_after: Math.max(0, target.hp - damage),
          maxHp: target.maxHp,
          is_crit: false,
          is_fumble: false,
          hit_location: hitLoc,
          status_applied: !saved && effect.condition ? [effect.condition] : [],
          overkill: computeOverkill(damage, target.hp),
        };
        tags = deriveNarrativeTags(facts);
      }

      newHp = Math.max(0, target.hp - damage);

      if (!saved && effect.condition) {
        conditionsToApply = [effect.condition];
      }
    }

    totalDamageDealt += damage;

    const finalConditions = conditionsToApply.reduce(
      (acc, cond) => applyCondition(acc, cond),
      extractConditions(target.conditions)
    );

    if (actionType === "attack" || (actionType === "cast_spell" && payload.spellEffect?.type !== "healing")) {
      await tx.combatant.update({
        where: { id: target.id },
        data: { hp: newHp, conditions: finalConditions },
      });
    }

    const singleConsequence: SingleTargetConsequence = {
      targetName: target.name,
      targetId: target.id,
      damage,
      naturalRoll,
      isCrit,
      isFumble,
      hitLocation: hitLoc ?? "chest",
      hpAfter: newHp,
      targetMaxHp: target.maxHp,
      isKill: newHp <= 0,
      conditionsApplied: conditionsToApply,
      narrativeTags: tags,
    };
    consequences.push(singleConsequence);

    if (collectEvents) {
      if (isFumble) {
        events.push({
          type: "CRITICAL_MISS",
          payload: { naturalRoll, targetName: target.name },
        });
      } else if (isCrit) {
        events.push({
          type: "CRITICAL_HIT",
          payload: { damage, naturalRoll, targetName: target.name },
        });
      } else if (damage > 0) {
        events.push({
          type: "DAMAGE_DEALT",
          payload: { damage, naturalRoll: singleConsequence.naturalRoll, targetName: target.name },
        });
      }

      if (newHp <= 0) {
        events.push({ type: "ENEMY_DEFEATED", payload: { name: target.name } });
      }
    }

    // Concentration Check
    if (damage > 0 && target.concentrationSpellId) {
      const targetStats = (target.stats as Record<string, number>) || {};
      const conMod = abilityModifier(targetStats.CON ?? 10);
      const conSave = resolveConcentrationCheck(damage, conMod);

      if (!conSave.success) {
        if (target.isPlayer && playerCharacterId) {
          await tx.character.update({
            where: { id: playerCharacterId },
            data: { concentrationSpellId: null },
          });
        }
        await tx.combatant.update({
          where: { id: target.id },
          data: { concentrationSpellId: null },
        });

        if (collectEvents) {
          events.push({
            type: "CONCENTRATION_BROKEN",
            payload: { targetName: target.name, dc: conSave.dc, roll: conSave.total },
          });
        }
      }
    }
  }

  if (totalDamageDealt > 0 && encounter.id) {
    await tx.encounter.update({
      where: { id: encounter.id },
      data: { totalDamageDealt: { increment: totalDamageDealt } },
    });
  }

  return {
    events,
    consequences,
    totalDamageDealt,
    consequenceDetails,
  };
}

export async function finalizeEncounterTurn(
  input: FinalizeEncounterTurnInput
): Promise<FinalizeTurnResult> {
  const {
    tx,
    encounterId,
    currentTurnIndex,
    round,
    collectEvents = true,
  } = input;

  const events: GameEvent[] = [];
  const allCombatants = await tx.combatant.findMany({ where: { encounterId } });
  const resolution = resolveEncounterEnd(allCombatants);

  if (resolution.shouldEnd) {
    await tx.encounter.update({
      where: { id: encounterId },
      data: { status: "resolved" },
    });
  } else {
    const { nextTurnIndex, nextRound, roundAdvanced } = advanceTurn({
      currentTurnIndex,
      round,
      combatantCount: allCombatants.length,
    });

    await tx.encounter.update({
      where: { id: encounterId },
      data: { currentTurnIndex: nextTurnIndex, round: nextRound },
    });

    if (collectEvents) {
      events.push({
        type: roundAdvanced ? "ROUND_ADVANCE" : "TURN_ADVANCE",
        payload: { nextTurnIndex, nextRound },
      });
    }

    return {
      events,
      encounterResolved: false,
      nextTurnIndex,
      nextRound,
    };
  }

  return {
    events,
    encounterResolved: true,
  };
}

