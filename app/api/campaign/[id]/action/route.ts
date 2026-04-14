import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser, AuthError } from "@/lib/auth/session";
import { roll } from "@/lib/rules/dice";
import { streamNarrative } from "@/lib/ai/narrator";
import { buildCampaignContext } from "@/lib/memory/context";
import { formatSystemPrompt } from "@/lib/memory/formatter";
import { parseIntent } from "@/lib/ai/intent";
import { summarizeAndStore } from "@/lib/memory/consolidator";
import { isSpellSlots, hasAvailableSlot, consumeSlot, spellcastingAbility, resolveSpellEffect } from "@/lib/rules/magic";
import { getSpellInfo } from "@/lib/ai/tools/srd-lookup";
import {
  advanceTurn, resolveEncounterEnd, resolveAttackRoll,
  rollHitLocation, computeOverkill, deriveNarrativeTags,
  type CombatFacts, type DamageType,
} from "@/lib/rules/combat";
import { abilityModifier } from "@/lib/rules/dice";
import { getItemProperties } from "@/lib/rules/inventory";
import type { GameEvent, ActionStreamFrame, CombatConsequencePayload } from "@/lib/events/game-events";
import type { Prisma } from "@/app/generated/prisma/client";

interface ActionBody {
  action: string;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

function sseFrame(frame: ActionStreamFrame): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(frame)}\n\n`);
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
  const intent = await parseIntent(trimmedAction, systemContext);

  // "Code is Law" — spell gate: validate slot, deduct, then resolve mechanical effect.
  // All state mutations happen before narration is generated.
  // ── Gate: cast_spell ────────────────────────────────────────────────────────
  if (intent.actionType === "cast_spell" && intent.spellLevel !== undefined) {
    const rawSlots = context.character.spellSlots;

    if (!isSpellSlots(rawSlots)) {
      return NextResponse.json(
        { error: "This character has no spellcasting ability." },
        { status: 400 }
      );
    }

    if (!hasAvailableSlot(rawSlots, intent.spellLevel)) {
      return NextResponse.json(
        { error: `No available spell slots remaining at level ${intent.spellLevel}.` },
        { status: 400 }
      );
    }

    // Deduct the slot — Code is Law, this happens before any narration
    const updatedSlots = consumeSlot(rawSlots, intent.spellLevel);
    await prisma.character.update({
      where: { id: context.character.id },
      data: { spellSlots: updatedSlots as unknown as Prisma.InputJsonValue },
    });

    gameEvents.push({
      type: "SPELL_CAST",
      payload: { spellLevel: intent.spellLevel, spellName: intent.targetName ?? null },
    });

    // Resolve spell mechanical effect if the spell name was parsed
    if (intent.spellName) {
      const spellData = await getSpellInfo(intent.spellName);
      if (spellData) {
        const charStats = context.character.stats as Record<string, number>;
        const spellAbilityKey = spellcastingAbility(context.character.class);
        const spellMod = abilityModifier(charStats[spellAbilityKey] ?? 10);
        const effect = resolveSpellEffect(
          spellData as Record<string, unknown>,
          intent.spellLevel,
          spellMod
        );

        if (effect.type === "damage" && effect.dice && context.activeEncounter && intent.targetName) {
          // Damage spell targeting an active encounter combatant
          const normalizedTarget = intent.targetName.toLowerCase();
          const targetCombatant = context.activeEncounter.combatants.find(
            (c) => c.name.toLowerCase().includes(normalizedTarget)
          );

          if (targetCombatant) {
            const damage = roll(effect.dice).total;
            const newHp = Math.max(0, targetCombatant.hp - damage);

            await prisma.combatant.update({
              where: { id: targetCombatant.id },
              data: { hp: newHp },
            });

            const updatedCombatants = await prisma.combatant.findMany({
              where: { encounterId: context.activeEncounter.id },
              orderBy: { initiativeTotal: "desc" },
            });
            const resolution = resolveEncounterEnd(updatedCombatants);

            if (resolution.shouldEnd) {
              await prisma.encounter.update({
                where: { id: context.activeEncounter.id },
                data: { status: "resolved" },
              });
            } else {
              const { nextTurnIndex, nextRound } = advanceTurn({
                currentTurnIndex: context.activeEncounter.currentTurnIndex,
                round: context.activeEncounter.round,
                combatantCount: updatedCombatants.length,
              });
              await prisma.encounter.update({
                where: { id: context.activeEncounter.id },
                data: { currentTurnIndex: nextTurnIndex, round: nextRound },
              });
            }
          }
        } else if (effect.type === "healing" && effect.dice) {
          // Healing spell: apply to the caster (self) and advance turn if in combat
          const healed = roll(effect.dice).total;
          const newHp = Math.min(context.character.hp + healed, context.character.maxHp);
          await prisma.character.update({
            where: { id: context.character.id },
            data: { hp: newHp },
          });

          if (context.activeEncounter) {
            const allCombatants = await prisma.combatant.findMany({
              where: { encounterId: context.activeEncounter.id },
              orderBy: { initiativeTotal: "desc" },
            });
            const { nextTurnIndex, nextRound } = advanceTurn({
              currentTurnIndex: context.activeEncounter.currentTurnIndex,
              round: context.activeEncounter.round,
              combatantCount: allCombatants.length,
            });
            await prisma.encounter.update({
              where: { id: context.activeEncounter.id },
              data: { currentTurnIndex: nextTurnIndex, round: nextRound },
            });
          }
        } else if (effect.type === "utility" && context.activeEncounter) {
          // Utility spell: the action was spent — advance the turn
          const allCombatants = await prisma.combatant.findMany({
            where: { encounterId: context.activeEncounter.id },
            orderBy: { initiativeTotal: "desc" },
          });
          const { nextTurnIndex, nextRound } = advanceTurn({
            currentTurnIndex: context.activeEncounter.currentTurnIndex,
            round: context.activeEncounter.round,
            combatantCount: allCombatants.length,
          });
          await prisma.encounter.update({
            where: { id: context.activeEncounter.id },
            data: { currentTurnIndex: nextTurnIndex, round: nextRound },
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
      return NextResponse.json(
        { error: "No active encounter. You must be in combat to attack." },
        { status: 400 }
      );
    }

    const normalizedTarget = intent.targetName.toLowerCase();
    const targetCombatant = context.activeEncounter.combatants.find(
      (c) => c.name.toLowerCase().includes(normalizedTarget)
    );

    if (!targetCombatant) {
      return NextResponse.json(
        { error: `Target "${intent.targetName}" not found in the current encounter.` },
        { status: 400 }
      );
    }

    const foundWeapon = context.character.inventory.find(
      (item) => item.type === "weapon"
    );

    if (!foundWeapon) {
      return NextResponse.json(
        { error: "No weapon found in inventory. Unarmed combat is not yet supported." },
        { status: 400 }
      );
    }

    const weaponProps = getItemProperties(
      { ...foundWeapon, characterId: context.character.id },
      "weapon"
    );

    if (!weaponProps) {
      return NextResponse.json(
        { error: "Weapon item has invalid properties." },
        { status: 400 }
      );
    }

    // Attack roll vs target AC — Code is Law (5e 2014 SRD p. 194–196).
    // Attack modifier: STR modifier + proficiency bonus (simplified to +2 for all levels).
    const charStats = context.character.stats as Record<string, number>;
    const strMod = abilityModifier(charStats.STR ?? 10);
    const attackModifier = strMod + 2; // proficiency bonus baseline
    const targetAC = targetCombatant.ac ?? 10;

    const attackResult = resolveAttackRoll(attackModifier, targetAC);
    const naturalRoll = attackResult.roll;

    if (!attackResult.hit) {
      if (attackResult.fumble) {
        gameEvents.push({
          type: "CRITICAL_MISS",
          payload: { naturalRoll, targetName: targetCombatant.name },
        });
      }

      // Miss: advance turn (the action was spent) but do not mutate HP.
      const allCombatants = await prisma.combatant.findMany({
        where: { encounterId: context.activeEncounter.id },
        orderBy: { initiativeTotal: "desc" },
      });
      const { nextTurnIndex, nextRound } = advanceTurn({
        currentTurnIndex: context.activeEncounter.currentTurnIndex,
        round: context.activeEncounter.round,
        combatantCount: allCombatants.length,
      });
      await prisma.encounter.update({
        where: { id: context.activeEncounter.id },
        data: { currentTurnIndex: nextTurnIndex, round: nextRound },
      });
    } else {
      // Hit: roll damage. Critical hit doubles the damage dice (5e 2014 SRD p. 196).
      const baseDamage = roll(weaponProps.damageDice).total;
      const critBonus = attackResult.critical ? roll(weaponProps.damageDice).total : 0;
      const damage = baseDamage + critBonus + (weaponProps.damageBonus ?? 0);
      const newHp = Math.max(0, targetCombatant.hp - damage);

      await prisma.combatant.update({
        where: { id: targetCombatant.id },
        data: { hp: newHp },
      });

      if (attackResult.critical) {
        gameEvents.push({
          type: "CRITICAL_HIT",
          payload: { naturalRoll, damage, targetName: targetCombatant.name },
        });
      } else {
        gameEvents.push({
          type: "DAMAGE_DEALT",
          payload: { damage, naturalRoll, targetName: targetCombatant.name },
        });
      }

      if (newHp <= 0) {
        gameEvents.push({
          type: "ENEMY_DEFEATED",
          payload: { name: targetCombatant.name },
        });
      }

      // Enrich the attack event with Consequences Engine data (hit location + narrative tags).
      // These are display-only — state has already been mutated above.
      const hitLocation = rollHitLocation();
      const consequenceFacts: CombatFacts = {
        attacker: context.character.name,
        defender: targetCombatant.name,
        weapon: foundWeapon.name,
        damage,
        damage_type: (weaponProps.damageType ?? "slashing") as DamageType,
        hp_before: targetCombatant.hp,
        hp_after: newHp,
        maxHp: targetCombatant.maxHp ?? damage * 3,
        is_crit: attackResult.critical,
        is_fumble: false,
        hit_location: hitLocation,
        status_applied: [],
        overkill: computeOverkill(damage, targetCombatant.hp),
      };
      const consequencePayload: CombatConsequencePayload = {
        attackerName:  context.character.name,
        targetName:    targetCombatant.name,
        damage,
        naturalRoll,
        isCrit:        attackResult.critical,
        hitLocation,
        narrativeTags: deriveNarrativeTags(consequenceFacts),
        hpAfter:       newHp,
        targetMaxHp:   targetCombatant.maxHp,
        isKill:        newHp <= 0,
      };
      gameEvents.push({
        type: "COMBAT_CONSEQUENCE",
        payload: consequencePayload as unknown as Record<string, unknown>,
      });

      // Re-fetch the full roster with updated HP to evaluate encounter end state
      const updatedCombatants = await prisma.combatant.findMany({
        where: { encounterId: context.activeEncounter.id },
        orderBy: { initiativeTotal: "desc" },
      });

      const resolution = resolveEncounterEnd(updatedCombatants);

      if (resolution.shouldEnd) {
        await prisma.encounter.update({
          where: { id: context.activeEncounter.id },
          data: { status: "resolved" },
        });
      } else {
        const { nextTurnIndex, nextRound } = advanceTurn({
          currentTurnIndex: context.activeEncounter.currentTurnIndex,
          round: context.activeEncounter.round,
          combatantCount: updatedCombatants.length,
        });
        await prisma.encounter.update({
          where: { id: context.activeEncounter.id },
          data: { currentTurnIndex: nextTurnIndex, round: nextRound },
        });
      }
    }
  }

  // ── State is now safely mutated.  Start the narrative stream. ────────────────

  const { textStream, textPromise, levelUpPayload } = await streamNarrative(campaignId, trimmedAction);

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
