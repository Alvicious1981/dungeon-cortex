import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser, AuthError } from "@/lib/auth/session";
import { roll } from "@/lib/rules/dice";
import { streamNarrative } from "@/lib/ai/narrator";
import { buildCampaignContext } from "@/lib/memory/context";
import { formatSystemPrompt } from "@/lib/memory/formatter";
import { parseIntent } from "@/lib/ai/intent";
import { summarizeAndStore } from "@/lib/memory/consolidator";
import { 
  isSpellSlots, hasAvailableSlot, consumeSlot, 
  spellcastingAbility, resolveSpellEffect, 
  calculateProficiency, calculateSpellSaveDC 
} from "@/lib/rules/magic";
import { getSpellInfo } from "@/lib/ai/tools/srd-lookup";
import {
  advanceTurn, resolveEncounterEnd, resolveAttackRoll,
  rollHitLocation, computeOverkill, deriveNarrativeTags,
  extractConditions, applyCondition, removeCondition,
  resolveSavingThrow, resolveConcentrationCheck,
  type CombatFacts, type DamageType,
} from "@/lib/rules/combat";
import { abilityModifier } from "@/lib/rules/dice";
import { getItemProperties } from "@/lib/rules/inventory";
import type { 
  GameEvent, ActionStreamFrame, 
  CombatConsequencePayload, SingleTargetConsequence 
} from "@/lib/events/game-events";
import type { HitLocation } from "@/lib/rules/combat";
import type { Prisma } from "@/app/generated/prisma/client";

interface ActionBody {
  action: string;
  targetIds?: string[];
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

function sseFrame(frame: ActionStreamFrame): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(frame)}\n\n`);
}

/**
 * Standardized helper to advance turn and emit required SSE events.
 */
async function emitTurnAdvance(
  tx: Prisma.TransactionClient,
  encounterId: string,
  currentTurnIndex: number,
  round: number,
  combatantCount: number,
  gameEvents: GameEvent[]
) {
  const { nextTurnIndex, nextRound, roundAdvanced } = advanceTurn({
    currentTurnIndex,
    round,
    combatantCount,
  });

  await tx.encounter.update({
    where: { id: encounterId },
    data: { currentTurnIndex: nextTurnIndex, round: nextRound },
  });

  gameEvents.push({
    type: roundAdvanced ? "ROUND_ADVANCE" : "TURN_ADVANCE",
    payload: { nextTurnIndex, nextRound },
  });

  return { nextTurnIndex, nextRound, roundAdvanced };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: campaignId } = await params;

  let body: ActionBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { action } = body;

  if (!action?.trim()) {
    return NextResponse.json({ error: "action is required." }, { status: 400 });
  }

  let user;
  try {
    user = await getAuthUser();
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    throw e;
  }

  // Validate campaign exists and belongs to this user
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }
  if (campaign.userId !== user.id) {
    return NextResponse.json({ error: "Campaign does not belong to this user." }, { status: 403 });
  }
  if (campaign.status !== "active") {
    return NextResponse.json({ error: "Campaign is not active." }, { status: 409 });
  }

  const trimmedAction = action.trim();

  // Step 1: Persist the player's action to the GameLog
  await prisma.gameLog.create({
    data: {
      campaignId,
      role: "user",
      content: trimmedAction,
    },
  });

  // Step 2: Detect and resolve /roll commands (non-streaming, quick response)
  const ROLL_PREFIX = "/roll ";
  if (trimmedAction.toLowerCase().startsWith(ROLL_PREFIX)) {
    const notation = trimmedAction.slice(ROLL_PREFIX.length).trim();

    let rollContent: string;
    try {
      const result = roll(notation);
      const diceList = result.dice.map((d) => d.result).join(", ");
      const modifierPart = result.modifier !== 0
        ? ` ${result.modifier > 0 ? "+" : ""}${result.modifier}`
        : "";
      rollContent =
        `🎲 Roll ${result.notation}: [${diceList}]${modifierPart} = **${result.total}**`;
    } catch {
      rollContent = `⚠️ Invalid dice notation: "${notation}". Use format like 1d20+5 or 2d6.`;
    }

    await prisma.gameLog.create({
      data: {
        campaignId,
        role: "system",
        content: rollContent,
      },
    });

    return NextResponse.json({ ok: true }, { status: 202 });
  }

  // ── "Code is Law" resolution gates ──────────────────────────────────────────
  // Each gate validates, mutates state, and appends a GameEvent describing the
  // outcome.  Events are flushed to the client BEFORE the AI narrator starts,
  // so the UI can react to dice results immediately.

  const gameEvents: GameEvent[] = [];

  // Milestone D+G: Build context with semantic memory recall for this action.
  // Passing trimmedAction causes buildCampaignContext to query the vector DB
  // for the top-2 relevant MemoryEntry rows and attach them as relevantMemories.
  // formatSystemPrompt will inject them under "## Long-Term Memory" if any exist.
  const context = await buildCampaignContext(campaignId, trimmedAction);
  const systemContext = formatSystemPrompt(context);

  // ── Macro Action Detector (Strategic Gate) ──────────────────────────────────
  // Authoritative "fast-path" for UI-triggered buttons (CombatHUD).
  // This bypasses LLM intent parsing to ensure 100% reliability for core mechanics.
  const MACRO_ACTIONS = ["Attack", "End Turn"];
  if (MACRO_ACTIONS.includes(trimmedAction)) {
    if (!context.activeEncounter) {
      return NextResponse.json({ error: "No active encounter." }, { status: 400 });
    }

    if (trimmedAction === "End Turn") {
      const allCombatants = await prisma.combatant.findMany({
        where: { encounterId: context.activeEncounter.id },
        orderBy: { initiativeTotal: "desc" },
      });

      await prisma.$transaction(async (tx) => {
        await emitTurnAdvance(
          tx,
          context.activeEncounter!.id,
          context.activeEncounter!.currentTurnIndex,
          context.activeEncounter!.round,
          allCombatants.length,
          gameEvents
        );
      });
    }

    if (trimmedAction === "Attack") {
      const activeEncounter = context.activeEncounter;
      const targetIds = body.targetIds ?? [];
      
      let targets: any[] = [];
      if (targetIds.length > 0) {
        targets = activeEncounter.combatants.filter(c => targetIds.includes(c.id));
        if (targets.length === 0) {
          return NextResponse.json({ error: "None of the specified targets were found in this encounter." }, { status: 400 });
        }
      } else {
        const autoTarget = activeEncounter.combatants.find((c) => !c.isPlayer && c.hp > 0);
        if (!autoTarget) {
          return NextResponse.json({ error: "No valid hostile targets." }, { status: 400 });
        }
        targets = [autoTarget];
      }

      const foundWeapon = context.character.inventory.find(
        (i) => i.type === "weapon" && i.equippedSlot === "MAIN_HAND"
      );

      const charStats = context.character.stats as Record<string, number>;
      const strMod = abilityModifier(charStats.STR ?? 10);
      
      const weaponDice = foundWeapon 
        ? (foundWeapon.properties as Record<string, any>).damageDice ?? "1d4"
        : "1d4";
      const weaponBonus = foundWeapon 
        ? (foundWeapon.properties as Record<string, any>).damageBonus ?? 0 
        : 0;

      const playerCombatant = activeEncounter.combatants.find(c => c.isPlayer);
      const playerConditions = extractConditions(playerCombatant?.conditions);

      const consequences: SingleTargetConsequence[] = [];
      let totalDamage = 0;

      await prisma.$transaction(async (tx) => {
        for (const target of targets) {
          const defenderConditions = extractConditions(target.conditions);
          const attackModifier = strMod + 2; // Proficiency baseline
          
          const attackResult = resolveAttackRoll(
            attackModifier, 
            target.ac,
            playerConditions,
            defenderConditions,
            true
          );

          let damage = 0;
          let hitLoc: HitLocation = "chest";
          let tags: string[] = [];

          if (attackResult.hit) {
            const baseDamage = roll(weaponDice).total;
            const critBonus = attackResult.critical ? roll(weaponDice).total : 0;
            damage = baseDamage + critBonus + strMod + weaponBonus;
            totalDamage += damage;
            hitLoc = rollHitLocation();
            
            const facts: CombatFacts = {
              attacker: context.character.name,
              defender: target.name,
              weapon: foundWeapon?.name || "Unarmed",
              damage,
              damage_type: (foundWeapon?.properties as any)?.damageType || "bludgeoning",
              hp_before: target.hp,
              hp_after: Math.max(0, target.hp - damage),
              maxHp: target.maxHp,
              is_crit: attackResult.critical,
              is_fumble: false,
              hit_location: hitLoc,
              status_applied: [],
              overkill: computeOverkill(damage, target.hp),
            };
            tags = deriveNarrativeTags(facts);
          }

          const newHp = Math.max(0, target.hp - damage);

          // Concentration Disruption
          if (damage > 0 && target.concentrationSpellId) {
            const targetStats = (target.stats as Record<string, number>) || {};
            const conMod = abilityModifier(targetStats.CON ?? 10);
            const conSave = resolveConcentrationCheck(damage, conMod);
            
            if (!conSave.success) {
              await tx.combatant.update({
                where: { id: target.id },
                data: { concentrationSpellId: null }
              });
              gameEvents.push({ type: "CONCENTRATION_BROKEN", payload: { targetName: target.name, dc: conSave.dc, roll: conSave.total } });
            }
          }

          await tx.combatant.update({
            where: { id: target.id },
            data: { hp: newHp },
          });

          consequences.push({
            targetName: target.name,
            targetId: target.id,
            damage,
            naturalRoll: attackResult.roll,
            isCrit: attackResult.critical,
            isFumble: attackResult.fumble,
            hitLocation: hitLoc,
            hpAfter: newHp,
            targetMaxHp: target.maxHp,
            isKill: newHp <= 0,
            conditionsApplied: [],
            narrativeTags: tags
          });

          if (attackResult.fumble) {
            gameEvents.push({ type: "CRITICAL_MISS", payload: { naturalRoll: attackResult.roll, targetName: target.name } });
          } else if (attackResult.critical) {
            gameEvents.push({ type: "CRITICAL_HIT", payload: { damage, naturalRoll: attackResult.roll, targetName: target.name } });
          } else if (attackResult.hit) {
            gameEvents.push({ type: "DAMAGE_DEALT", payload: { damage, naturalRoll: attackResult.roll, targetName: target.name } });
          }

          if (newHp <= 0) {
            gameEvents.push({ type: "ENEMY_DEFEATED", payload: { name: target.name } });
          }
        }

        const allCombatants = await tx.combatant.findMany({
          where: { encounterId: activeEncounter.id }
        });

        const resolution = resolveEncounterEnd(allCombatants);

        if (resolution.shouldEnd) {
          await tx.encounter.update({
            where: { id: activeEncounter.id },
            data: { status: "resolved" }
          });
        } else {
          await emitTurnAdvance(
            tx,
            activeEncounter.id,
            activeEncounter.currentTurnIndex,
            activeEncounter.round,
            allCombatants.length,
            gameEvents
          );
        }

        await tx.encounter.update({
          where: { id: activeEncounter.id },
          data: { totalDamageDealt: { increment: totalDamage } }
        });
      });

      if (consequences.length > 0) {
        gameEvents.push({
          type: "COMBAT_CONSEQUENCE",
          payload: {
            attackerName: context.character.name,
            targets: consequences,
          } as CombatConsequencePayload,
        });
      }
    }

    // After mechanical resolution, proceed to narration using the NEW state.
    // The buildCampaignContext inside streamNarrative will see the updated DB.
  } else {
    // LLM Intent Parsing (for natural language actions)
    const intent = await parseIntent(trimmedAction, systemContext);

    // ── Gate: cast_spell ────────────────────────────────────────────────────────
    if (intent.actionType === "cast_spell" && intent.spellLevel !== undefined) {
    const rawSlots = context.character.spellSlots;

    if (!isSpellSlots(rawSlots)) {
      return NextResponse.json(
        { error: "This character has no spellcasting ability." },
        { status: 400 }
      );
    }

    if (intent.spellLevel !== undefined && !hasAvailableSlot(rawSlots, intent.spellLevel)) {
      return NextResponse.json(
        { error: `No available spell slots remaining at level ${intent.spellLevel}.` },
        { status: 400 }
      );
    }

    // Deduct the slot — Code is Law, this happens before any narration
    const updatedSlots = consumeSlot(rawSlots, intent.spellLevel ?? 0);
    await prisma.character.update({
      where: { id: context.character.id },
      data: { spellSlots: updatedSlots as unknown as Prisma.InputJsonValue },
    });

    gameEvents.push({
      type: "SPELL_CAST",
      payload: { spellLevel: intent.spellLevel ?? 0, spellName: intent.targetName ?? null },
    });

    // Resolve spell mechanical effect if the spell name was parsed
    if (intent.spellName) {
      const spellData = (await getSpellInfo(intent.spellName)) as any;
      if (spellData) {
        const charStats = context.character.stats as Record<string, number>;
        const spellAbilityKey = spellcastingAbility(context.character.class);
        const abilityMod = abilityModifier(charStats[spellAbilityKey] ?? 10);
        const profBonus = calculateProficiency(context.character.level);
        const saveDC = calculateSpellSaveDC(abilityMod, profBonus);

        const effect = resolveSpellEffect(
          spellData as Record<string, unknown>,
          intent.spellLevel ?? 0,
          abilityMod
        );

        const isConcentration = !!spellData.data?.concentration;
        const consequences: any[] = [];
        let totalDamageDealt = 0;

        // Resolve Targets
        let targets: any[] = [];
        if (body.targetIds && body.targetIds.length > 0 && context.activeEncounter) {
          targets = context.activeEncounter.combatants.filter(c => body.targetIds!.includes(c.id));
        } else if (intent.targetName && context.activeEncounter) {
          const normalizedTarget = intent.targetName.toLowerCase();
          const found = context.activeEncounter.combatants.find(c => c.name.toLowerCase().includes(normalizedTarget));
          if (found) targets = [found];
        }

        await prisma.$transaction(async (tx) => {
          if (isConcentration) {
            await tx.character.update({
              where: { id: context.character.id },
              data: { concentrationSpellId: intent.spellName! }
            });
            gameEvents.push({ type: "CONCENTRATION_STARTED", payload: { spellName: intent.spellName } });
          }

          for (const target of targets) {
            let damage = 0;
            let saved = false;
            let saveRoll = 0;
            let hitLoc: HitLocation = "chest";
            let tags: string[] = [];

            if (effect.hasSavingThrow && effect.saveAbility) {
              const targetStats = target.stats as Record<string, number>;
              const targetMod = abilityModifier(targetStats[effect.saveAbility] ?? 10);
              const saveResult = resolveSavingThrow(targetMod, saveDC);
              saved = saveResult.success;
              saveRoll = saveResult.total;
              
              const diceTotal = roll(effect.dice!).total;
              damage = saved ? Math.floor(diceTotal / 2) : diceTotal;
              totalDamageDealt += damage;
              
              if (damage > 0) {
                hitLoc = rollHitLocation();
                const facts: CombatFacts = {
                  attacker: context.character.name,
                  defender: target.name,
                  weapon: intent.spellName || "Spell",
                  damage,
                  damage_type: (effect as any).damageType || "force",
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
            } else if (effect.dice) {
              damage = roll(effect.dice).total;
              totalDamageDealt += damage;
              hitLoc = rollHitLocation();
              const facts: CombatFacts = {
                attacker: context.character.name,
                defender: target.name,
                weapon: intent.spellName || "Spell",
                damage,
                damage_type: (effect as any).damageType || "force",
                hp_before: target.hp,
                hp_after: Math.max(0, target.hp - damage),
                maxHp: target.maxHp,
                is_crit: false,
                is_fumble: false,
                hit_location: hitLoc,
                status_applied: effect.condition ? [effect.condition] : [],
                overkill: computeOverkill(damage, target.hp),
              };
              tags = deriveNarrativeTags(facts);
            }

            const newHp = Math.max(0, target.hp - damage);

            let conditionsToApply: string[] = [];
            if (!saved && effect.condition) {
              conditionsToApply = [effect.condition];
            }
            const finalConditions = conditionsToApply.reduce(
              (acc, cond) => applyCondition(acc, cond), 
              extractConditions(target.conditions)
            );

            if (damage > 0 && target.concentrationSpellId) {
              const targetStats = (target.stats as Record<string, number>) || {};
              const conMod = abilityModifier(targetStats.CON ?? 10);
              const conSave = resolveConcentrationCheck(damage, conMod);
              
              if (!conSave.success) {
                if (target.isPlayer) {
                  await tx.character.update({
                    where: { id: context.character.id },
                    data: { concentrationSpellId: null }
                  });
                }
                await tx.combatant.update({
                  where: { id: target.id },
                  data: { concentrationSpellId: null }
                });
                gameEvents.push({ type: "CONCENTRATION_BROKEN", payload: { targetName: target.name, dc: conSave.dc, roll: conSave.total } });
              }
            }

            await tx.combatant.update({
              where: { id: target.id },
              data: { hp: newHp, conditions: finalConditions }
            });

            consequences.push({
              targetName: target.name,
              targetId: target.id,
              damage,
              naturalRoll: saveRoll,
              isCrit: false,
              isFumble: false,
              hitLocation: hitLoc,
              hpAfter: newHp,
              targetMaxHp: target.maxHp,
              isKill: newHp <= 0,
              conditionsApplied: conditionsToApply,
              narrativeTags: tags
            });

            if (damage > 0) gameEvents.push({ type: "DAMAGE_DEALT", payload: { damage, targetName: target.name, naturalRoll: saveRoll } });
            if (newHp <= 0) gameEvents.push({ type: "ENEMY_DEFEATED", payload: { name: target.name } });
          }

          if (effect.type === "healing" && effect.dice) {
            const healed = roll(effect.dice).total;
            const newHp = Math.min(context.character.hp + healed, context.character.maxHp);
            await tx.character.update({
              where: { id: context.character.id },
              data: { hp: newHp },
            });
            gameEvents.push({ type: "HEALING_RECEIVED", payload: { amount: healed, newHp, spellName: intent.spellName } });
          }

          if (context.activeEncounter) {
            const allCombatants = await tx.combatant.findMany({
              where: { encounterId: context.activeEncounter.id }
            });

            const resolution = resolveEncounterEnd(allCombatants);

            if (resolution.shouldEnd) {
              await tx.encounter.update({
                where: { id: context.activeEncounter.id },
                data: { status: "resolved" }
              });
            } else {
              await emitTurnAdvance(
                tx,
                context.activeEncounter.id,
                context.activeEncounter.currentTurnIndex,
                context.activeEncounter.round,
                allCombatants.length,
                gameEvents
              );
            }

            await tx.encounter.update({
              where: { id: context.activeEncounter.id },
              data: { totalDamageDealt: { increment: totalDamageDealt } }
            });
          }
        });

        if (consequences.length > 0) {
          gameEvents.push({
            type: "COMBAT_CONSEQUENCE",
            payload: {
              attackerName: context.character.name,
              targets: consequences,
            } as CombatConsequencePayload,
          });
        }
      }
    }
  }

  // ── Gate: use_item ──────────────────────────────────────────────────────────
  if (intent.actionType === "use_item" && intent.targetName) {
      const normalizedTarget = intent.targetName.toLowerCase();
      const foundItem = context.character.inventory.find(
        (item) => item.name.toLowerCase().includes(normalizedTarget)
      );

      if (!foundItem) {
        return NextResponse.json(
          { error: `Item "${intent.targetName}" not found in inventory.` },
          { status: 400 }
        );
      }

      // Decrement quantity; delete the row when the last charge is consumed
      if (foundItem.quantity <= 1) {
        await prisma.inventoryItem.delete({ where: { id: foundItem.id } });
      } else {
        await prisma.inventoryItem.update({
          where: { id: foundItem.id },
          data: { quantity: foundItem.quantity - 1 },
        });
      }

      // Healing consumables: calculate and apply HP delta
      const consumableProps = getItemProperties(
        { ...foundItem, characterId: context.character.id },
        "consumable"
      );

      if (consumableProps?.healingDice) {
        const healed =
          roll(consumableProps.healingDice).total + (consumableProps.healingBonus ?? 0);
        const newHp = Math.min(
          context.character.hp + healed,
          context.character.maxHp
        );
        await prisma.character.update({
          where: { id: context.character.id },
          data: { hp: newHp },
        });

        gameEvents.push({
          type: "HEALING_RECEIVED",
          payload: { amount: healed, newHp, itemName: foundItem.name },
        });

        if (newHp <= 0) {
          gameEvents.push({ type: "PLAYER_DOWNED", payload: {} });
        }
      }
    }

    // ── Gate: attack ────────────────────────────────────────────────────────────
    if (intent.actionType === "attack" && intent.targetName) {
      if (!context.activeEncounter) {
        return NextResponse.json({ error: "No active encounter. You must be in combat to attack." }, { status: 400 });
      }

      const normalizedTarget = intent.targetName.toLowerCase();
      const targets = context.activeEncounter.combatants.filter(c => 
        c.name.toLowerCase().includes(normalizedTarget)
      );

      if (targets.length === 0) {
        return NextResponse.json({ error: `Target "${intent.targetName}" not found.` }, { status: 400 });
      }

      const foundWeapon = context.character.inventory.find(item => item.type === "weapon");
      if (!foundWeapon) {
        return NextResponse.json({ error: "No weapon found." }, { status: 400 });
      }

      const weaponProps = getItemProperties({...foundWeapon, characterId: context.character.id}, "weapon");
      const charStats = context.character.stats as Record<string, number>;
      const strMod = abilityModifier(charStats.STR ?? 10);
      const playerCombatant = context.activeEncounter.combatants.find(c => c.isPlayer);
      const playerConditions = extractConditions(playerCombatant?.conditions);

      const consequences: SingleTargetConsequence[] = [];
      let totalDamage = 0;

      await prisma.$transaction(async (tx) => {
        for (const target of targets) {
          const defenderConditions = extractConditions(target.conditions);
          const attackModifier = strMod + 2;
          
          const attackResult = resolveAttackRoll(
            attackModifier, target.ac, playerConditions, defenderConditions, true
          );

          let damage = 0;
          let hitLoc: HitLocation = "chest";
          let tags: string[] = [];

          if (attackResult.hit) {
            const baseDamage = roll(weaponProps?.damageDice || "1d4").total;
            const critBonus = attackResult.critical ? roll(weaponProps?.damageDice || "1d4").total : 0;
            damage = baseDamage + critBonus + (weaponProps?.damageBonus || 0);
            totalDamage += damage;
            hitLoc = rollHitLocation();
            
            const facts: CombatFacts = {
              attacker: context.character.name,
              defender: target.name,
              weapon: foundWeapon.name,
              damage,
              damage_type: (weaponProps?.damageType as any) || "slashing",
              hp_before: target.hp,
              hp_after: Math.max(0, target.hp - damage),
              maxHp: target.maxHp,
              is_crit: attackResult.critical,
              is_fumble: false,
              hit_location: hitLoc,
              status_applied: [],
              overkill: computeOverkill(damage, target.hp),
            };
            tags = deriveNarrativeTags(facts);
          }

          const newHp = Math.max(0, target.hp - damage);

          if (damage > 0 && target.concentrationSpellId) {
            const targetStats = (target.stats as Record<string, number>) || {};
            const conMod = abilityModifier(targetStats.CON ?? 10);
            const conSave = resolveConcentrationCheck(damage, conMod);
            
            if (!conSave.success) {
              await tx.combatant.update({ where: { id: target.id }, data: { concentrationSpellId: null } });
              gameEvents.push({ type: "CONCENTRATION_BROKEN", payload: { targetName: target.name, dc: conSave.dc, roll: conSave.total } });
            }
          }

          await tx.combatant.update({ where: { id: target.id }, data: { hp: newHp } });

          consequences.push({
            targetName: target.name,
            targetId: target.id,
            damage,
            naturalRoll: attackResult.roll,
            isCrit: attackResult.critical,
            isFumble: attackResult.fumble,
            hitLocation: hitLoc,
            hpAfter: newHp,
            targetMaxHp: target.maxHp,
            isKill: newHp <= 0,
            conditionsApplied: [],
            narrativeTags: tags
          });

          if (attackResult.fumble) gameEvents.push({ type: "CRITICAL_MISS", payload: { naturalRoll: attackResult.roll, targetName: target.name } });
          else if (attackResult.critical) gameEvents.push({ type: "CRITICAL_HIT", payload: { damage, naturalRoll: attackResult.roll, targetName: target.name } });
          else if (attackResult.hit) gameEvents.push({ type: "DAMAGE_DEALT", payload: { damage, naturalRoll: attackResult.roll, targetName: target.name } });
          if (newHp <= 0) gameEvents.push({ type: "ENEMY_DEFEATED", payload: { name: target.name } });
        }

        const allCombatants = await tx.combatant.findMany({ where: { encounterId: context.activeEncounter!.id } });
        const resolution = resolveEncounterEnd(allCombatants);

        if (resolution.shouldEnd) {
          await tx.encounter.update({ where: { id: context.activeEncounter!.id }, data: { status: "resolved" } });
        } else {
          await emitTurnAdvance(
            tx, context.activeEncounter!.id, context.activeEncounter!.currentTurnIndex,
            context.activeEncounter!.round, allCombatants.length, gameEvents
          );
        }

        await tx.encounter.update({
          where: { id: context.activeEncounter!.id },
          data: { totalDamageDealt: { increment: totalDamage } }
        });
      });

      if (consequences.length > 0) {
        gameEvents.push({
          type: "COMBAT_CONSEQUENCE",
          payload: {
            attackerName: context.character.name,
            targets: consequences,
          } as CombatConsequencePayload,
        });
      }
    }
  }

  // ── State is now safely mutated.  Start the narrative stream. ────────────────

  const { textStream, textPromise, levelUpPayload, merchantPayload } = await streamNarrative(campaignId, trimmedAction);

  // After the stream body is fully read by the client, persist the full
  // narrative text and run memory consolidation.
  after(async () => {
    try {
      const narrative = await textPromise;

      await prisma.gameLog.create({
        data: {
          campaignId,
          role: "assistant",
          content: narrative,
        },
      });

      // Memory consolidation — every 5 complete assistant turns.
      const turnCount = await prisma.gameLog.count({
        where: { campaignId, role: "assistant" },
      });

      if (turnCount % 5 === 0) {
        const logsDesc = await prisma.gameLog.findMany({
          where: { campaignId },
          orderBy: { createdAt: "desc" },
          take: 10,
        });
        await summarizeAndStore(campaignId, logsDesc.reverse());
      }
    } catch (err) {
      console.error("[action] Post-stream persistence failed:", err);
    }
  });

  // Build the SSE response:
  //   Phase 1 — all deterministic game events (instant, before any LLM latency)
  //   Phase 2 — AI narrator tokens, streamed as they arrive
  //   Phase 3 — done sentinel so the client knows to call router.refresh()
  const sseStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Phase 1: flush game events immediately
        for (const ev of gameEvents) {
          controller.enqueue(sseFrame({ t: "evt", e: ev }));
        }

        // Phase 2: stream narrative tokens
        for await (const delta of textStream) {
          controller.enqueue(sseFrame({ t: "txt", d: delta }));
        }

        // Phase 2.5: emit level-up payload if triggerLevelUp was called this turn.
        // By the time the text stream is exhausted, all tool calls have completed.
        const luPayload = await levelUpPayload;
        if (luPayload) {
          controller.enqueue(sseFrame({ t: "level_up", payload: luPayload }));
        }

        const mPayload = await merchantPayload;
        if (mPayload) {
          controller.enqueue(sseFrame({ t: "merchant", payload: mPayload }));
        }

        // Phase 3: signal completion
        controller.enqueue(sseFrame({ t: "done" }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(sseStream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
