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
  isSpellSlots, hasAvailableSlot, 
  spellcastingAbility,
  calculateProficiency, calculateSpellSaveDC 
} from "@/lib/rules/magic";
import {
  resolveCachedSpell,
  type ResolvedSpellEffect,
} from "@/lib/rules/spell-resolution-service";
import {
  extractConditions,
  type DamageType,
} from "@/lib/rules/combat";
import { evaluateAbilityCheckAdvantage } from "@/lib/rules/conditions";
import {
  applyShortRest,
  applyLongRest,
  type CharacterState,
} from "@/lib/rules/exploration";
import { moveToNode } from "@/lib/rules/navigation";
import { resolveAbilityCheck, type Ability } from "@/lib/rules/ability-check";
import { parseSkillProficiencies } from "@/lib/rules/class-skills";
import {
  buildCombatConsequenceEvent,
  finalizeEncounterTurn,
  executeCombatAction,
  type PipelineCombatant,
} from "@/lib/rules/combat-pipeline";
import { adaptCombatEventsToNarrativeContext } from "@/lib/narrative/combat-fact-adapter";
import { detectPendingLevelUp } from "@/lib/actions/backend-presentation-resolution";
import { abilityModifier } from "@/lib/rules/dice";
import { getItemProperties, validateOwnership } from "@/lib/rules/inventory";
import {
  chebyshevSquares,
  isOccupied,
  sizeToSquares,
  type GridCombatant,
  type SizeCategory,
} from "@/lib/rules/geometry";
import type {
  GameEvent, ActionStreamFrame
} from "@/lib/events/game-events";
import { Prisma } from "@prisma/client";
import type { ContextCombatant } from "@/lib/memory/context";

interface ActionBody {
  action: string;
  targetIds?: string[];
  targetX?: number;
  targetY?: number;
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

  // ── Macro Action Detector (Strategic Gate) ──────────────────────────────────
  // Authoritative "fast-path" for UI-triggered buttons (CombatHUD).
  // This bypasses LLM intent parsing to ensure 100% reliability for core mechanics.
  const MACRO_ACTIONS = ["Attack", "End Turn", "Move"];
  if (MACRO_ACTIONS.includes(trimmedAction)) {
    if (!context.activeEncounter) {
      return NextResponse.json({ error: "No active encounter." }, { status: 400 });
    }

    if (trimmedAction === "End Turn") {
      await prisma.$transaction(async (tx) => {
        const finalizeOutcome = await finalizeEncounterTurn({
          tx: tx as Prisma.TransactionClient,
          encounterId: context.activeEncounter!.id,
          currentTurnIndex: context.activeEncounter!.currentTurnIndex,
          round: context.activeEncounter!.round,
        });
        gameEvents.push(...finalizeOutcome.events);
      });
    }

    if (trimmedAction === "Attack") {
      const activeEncounter = context.activeEncounter;
      const targetIds = body.targetIds ?? [];
      
      let targets: ContextCombatant[] = [];
      if (targetIds.length > 0) {
        // targetIds arrive from the client, so membership in the encounter is not
        // enough: restrict to living hostiles, matching the auto-target branch
        // below. Otherwise a caller could name the player or an already-downed
        // combatant and have the attack resolve against them.
        targets = activeEncounter.combatants.filter(
          c => targetIds.includes(c.id) && !c.isPlayer && c.hp > 0
        );
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
        ? (foundWeapon.properties as Record<string, unknown>).damageDice as string ?? "1d4"
        : "1d4";
      const weaponBonus = foundWeapon 
        ? (foundWeapon.properties as Record<string, unknown>).damageBonus as number ?? 0 
        : 0;

      const playerCombatant = activeEncounter.combatants.find(c => c.isPlayer);
      const playerConditions = extractConditions(playerCombatant?.conditions);
      const attackModifier = strMod + 2; // Proficiency baseline

      await prisma.$transaction(async (tx) => {
        const attackOutcome = await executeCombatAction({
          actionType: "attack",
          encounter: {
            id: activeEncounter.id,
            round: activeEncounter.round,
            currentTurnIndex: activeEncounter.currentTurnIndex,
            totalDamageDealt: activeEncounter.totalDamageDealt,
            status: "active",
            combatants: activeEncounter.combatants as PipelineCombatant[],
          },
          actorId: playerCombatant?.id ?? context.character.id,
          actorName: context.character.name,
          actorConditions: playerConditions,
          targetCombatants: targets,
          weaponName: foundWeapon?.name || "Unarmed",
          weaponDice,
          damageType: ((foundWeapon?.properties as Record<string, unknown>)?.damageType || "bludgeoning") as DamageType,
          attackModifier,
          flatDamageBonus: strMod + weaponBonus,
          playerCharacterId: context.character.id,
        }, tx as Prisma.TransactionClient);

        gameEvents.push(...attackOutcome.events);

        const finalizeOutcome = await finalizeEncounterTurn({
          tx: tx as Prisma.TransactionClient,
          encounterId: activeEncounter.id,
          currentTurnIndex: activeEncounter.currentTurnIndex,
          round: activeEncounter.round,
        });
        gameEvents.push(...finalizeOutcome.events);

        if (attackOutcome.consequences.length > 0) {
          gameEvents.push(buildCombatConsequenceEvent({
            attackerName: context.character.name,
            targets: attackOutcome.consequences,
          }));
        }
      });
    }

    if (trimmedAction === "Move") {
      // ── Gate: Move (tactical grid) ──────────────────────────────────────────
      // Validates coordinates, distance against speed, and collision before
      // mutating the combatant's (x, y) on the grid.  Pure geometry from
      // lib/rules/geometry.ts — the AI narrator never decides movement legality.

      const targetX = body.targetX;
      const targetY = body.targetY;

      if (targetX === undefined || targetY === undefined
        || !Number.isInteger(targetX) || !Number.isInteger(targetY)) {
        return NextResponse.json(
          { error: "Move requires integer targetX and targetY." },
          { status: 400 }
        );
      }

      const playerCombatant = context.activeEncounter.combatants.find(c => c.isPlayer);
      if (!playerCombatant) {
        return NextResponse.json(
          { error: "Player combatant not found in encounter." },
          { status: 400 }
        );
      }

      // ── Speed extraction ──────────────────────────────────────────────────
      // Attempt to read speed from the combatant's stats JSON.
      // Fallback: 30 ft (6 squares) — the D&D 5e 2014 SRD default.
      const DEFAULT_SPEED_FT = 30;
      const combatantStats = (playerCombatant.stats as Record<string, unknown>) ?? {};
      const rawSpeed = combatantStats.speed;
      const speedFt = typeof rawSpeed === "number" && rawSpeed > 0
        ? rawSpeed
        : DEFAULT_SPEED_FT;
      const speedSquares = Math.floor(speedFt / 5);

      // ── Distance validation (Chebyshev — 5e grid diagonal = 1 square) ─────
      const from = { x: playerCombatant.x, y: playerCombatant.y };
      const to   = { x: targetX, y: targetY };
      const distSquares = chebyshevSquares(from, to);

      if (distSquares === 0) {
        return NextResponse.json(
          { error: "Already at that position." },
          { status: 400 }
        );
      }

      if (distSquares > speedSquares) {
        return NextResponse.json(
          { error: `Movement exceeds speed. Distance: ${distSquares * 5} ft, speed: ${speedFt} ft.` },
          { status: 400 }
        );
      }

      // ── Collision validation (size-aware footprint) ────────────────────────
      // Build a list of all other combatants as GridCombatants, then check
      // every square the mover's footprint would cover at the destination.
      const VALID_SIZES: SizeCategory[] = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"];
      const moverSize: SizeCategory = VALID_SIZES.includes(playerCombatant.size as SizeCategory)
        ? (playerCombatant.size as SizeCategory)
        : "Medium";

      const otherCombatants: GridCombatant[] = context.activeEncounter.combatants
        .filter(c => c.id !== playerCombatant.id)
        .map(c => ({
          id: c.id,
          x: c.x,
          y: c.y,
          size: VALID_SIZES.includes(c.size as SizeCategory)
            ? (c.size as SizeCategory)
            : "Medium",
        }));

      const footprintSide = sizeToSquares(moverSize);
      for (let row = targetY; row < targetY + footprintSide; row++) {
        for (let col = targetX; col < targetX + footprintSide; col++) {
          if (isOccupied({ x: col, y: row }, otherCombatants)) {
            return NextResponse.json(
              { error: "Target square is occupied." },
              { status: 400 }
            );
          }
        }
      }

      // ── State mutation ─────────────────────────────────────────────────────
      await prisma.combatant.update({
        where: { id: playerCombatant.id },
        data: { x: targetX, y: targetY },
      });

      gameEvents.push({
        type: "MOVE_COMBATANT",
        payload: {
          combatantId: playerCombatant.id,
          fromX: from.x,
          fromY: from.y,
          toX: targetX,
          toY: targetY,
          distanceFt: distSquares * 5,
        },
      });
    }

    // After mechanical resolution, proceed to narration using the NEW state.
    // The buildCampaignContext inside streamNarrative will see the updated DB.
  } else {
    // Deterministic intent classification for natural-language actions. No
    // model call: parseIntent resolves by pattern and fails closed, so the same
    // input always reaches the same gate.
    const intent = await parseIntent(trimmedAction, systemContext);

    // ── Gate: improvised action → ability check ─────────────────────────────────
    // The SRD's universal fallback. The action has no dedicated rule, so the
    // dice settle it rather than the narrator. The result is written to the log
    // as a resolved fact before narration, so the AI describes an outcome the
    // backend already determined instead of inventing one.
    if (intent.actionType === "ability_check" && intent.skill) {
      const charData = context.character;

      // Advantage and disadvantage come from persisted state, never from the
      // wording of the action. Exhaustion applies everywhere; conditions live on
      // the Combatant, so outside an encounter there are none to read.
      const checkConditions = context.activeEncounter
        ? extractConditions(
            context.activeEncounter.combatants.find((c) => c.isPlayer)?.conditions
          )
        : [];
      const { advantage, disadvantage } = evaluateAbilityCheckAdvantage(
        checkConditions,
        charData.exhaustionLevel
      );

      const result = resolveAbilityCheck(
        { skill: intent.skill, band: intent.band, advantage, disadvantage },
        {
          stats: (charData.stats ?? {}) as Partial<Record<Ability, number>>,
          level: charData.level,
          skillProficiencies: parseSkillProficiencies(charData.skillProficiencies),
        }
      );

      // The log line states where the DC came from and how the die was rolled,
      // so the player can audit the number instead of being handed a bare "DC
      // 15" with no provenance.
      await prisma.gameLog.create({
        data: {
          campaignId,
          role: "system",
          content:
            `🎲 ${result.skill} check (${result.ability}): rolled ${result.roll} ` +
            `${result.abilityModifier >= 0 ? "+" : ""}${result.abilityModifier}` +
            `${result.proficiencyApplied ? ` +${result.proficiencyApplied} prof` : ""}` +
            `${result.rollMode !== "normal" ? ` with ${result.rollMode}` : ""}` +
            ` = ${result.total} vs DC ${result.dc} (${result.band}) → ` +
            `${result.success ? "SUCCESS" : "FAILURE"}` +
            `${result.isCriticalSuccess ? " (natural 20)" : ""}` +
            `${result.isCriticalFailure ? " (natural 1)" : ""}.`,
        },
      });

      gameEvents.push({
        type: "ABILITY_CHECK_RESOLVED",
        payload: { ...result },
      });
    }

    // ── Gate: unclassifiable mechanical intent ──────────────────────────────────
    // Fail closed. The parser could not positively classify this input, so it may
    // be a mechanical action the rules engine never resolved. Ask for a precise
    // restatement instead of letting the narrator describe an unresolved outcome.
    if (intent.actionType === "mechanical_ambiguous") {
      return NextResponse.json(
        {
          error:
            "That sounds like a mechanical action, but it could not be resolved safely. State the exact action and target.",
          code: "MECHANICAL_CLARIFICATION_REQUIRED",
        },
        { status: 400 }
      );
    }

    // ── Gate: cast_spell ────────────────────────────────────────────────────────
    if (intent.actionType === "cast_spell") {
      if (!intent.spellName) {
        return NextResponse.json(
          { error: "An exact spell name is required for backend resolution." },
          { status: 400 }
        );
      }

      // Resolution comes first, because the SRD record is what decides the cost.
      // A player who names no level — "I cast Fireball", the ordinary case — is
      // casting at the spell's own level, not casting for free. This gate used
      // to be skipped outright whenever intent.spellLevel was undefined, so the
      // slot went unspent, nothing was rolled, and the narrator described a
      // spell the rules engine never resolved.
      const charStats = context.character.stats as Record<string, number>;
      const spellAbilityKey = spellcastingAbility(context.character.class);
      const abilityMod = abilityModifier(charStats[spellAbilityKey] ?? 10);
      const profBonus = calculateProficiency(context.character.level);

      const effect: ResolvedSpellEffect | null = await resolveCachedSpell({
        query: intent.spellName,
        ...(intent.spellLevel !== undefined ? { slotLevel: intent.spellLevel } : {}),
        spellcastingMod: abilityMod,
        characterLevel: context.character.level,
      });

      if (!effect) {
        return NextResponse.json(
          { error: `Spell "${intent.spellName}" is unavailable in the SRD cache.` },
          { status: 400 }
        );
      }

      // Upcasting is legal; downcasting is not. Without this the requested slot
      // was charged verbatim, so a level-1 slot could pay for a Fireball.
      if (effect.slotLevel < effect.level) {
        return NextResponse.json(
          {
            error:
              `${effect.name} is a level ${effect.level} spell and cannot be cast ` +
              `from a level ${effect.slotLevel} slot.`,
          },
          { status: 400 }
        );
      }

      const saveDC = calculateSpellSaveDC(abilityMod, profBonus);
      const rawSlots = context.character.spellSlots;
      const effectiveSlotLevel = effect.slotLevel;
      const usesSpellSlot = effectiveSlotLevel > 0;

      if (usesSpellSlot && !isSpellSlots(rawSlots)) {
        return NextResponse.json(
          { error: "This character has no spellcasting ability." },
          { status: 400 }
        );
      }

      if (
        usesSpellSlot &&
        isSpellSlots(rawSlots) &&
        !hasAvailableSlot(rawSlots, effectiveSlotLevel)
      ) {
        return NextResponse.json(
          { error: `No available spell slots remaining at level ${effectiveSlotLevel}.` },
          { status: 400 }
        );
      }

      let targets: ContextCombatant[] = [];
      if (body.targetIds && body.targetIds.length > 0 && context.activeEncounter) {
        targets = context.activeEncounter.combatants.filter(c => body.targetIds!.includes(c.id));
      } else if (intent.targetName && context.activeEncounter) {
        const normalizedTarget = intent.targetName.toLowerCase();
        const found = context.activeEncounter.combatants.find(c => c.name.toLowerCase().includes(normalizedTarget));
        if (found) targets = [found];
      }

      const playerCombatant = context.activeEncounter?.combatants.find(c => c.isPlayer);
      const playerConditions = extractConditions(playerCombatant?.conditions);

      await prisma.$transaction(async (tx) => {
        const spellOutcome = await executeCombatAction({
          actionType: "cast_spell",
          encounter: context.activeEncounter ? {
            id: context.activeEncounter.id,
            round: context.activeEncounter.round,
            currentTurnIndex: context.activeEncounter.currentTurnIndex,
            totalDamageDealt: context.activeEncounter.totalDamageDealt,
            status: "active",
            combatants: context.activeEncounter.combatants as PipelineCombatant[],
          } : { id: "", round: 0, currentTurnIndex: 0, totalDamageDealt: 0, status: "active", combatants: [] },
          actorId: playerCombatant?.id ?? context.character.id,
          actorName: context.character.name,
          actorConditions: playerConditions,
          targetCombatants: targets,
          spellName: intent.spellName,
          spellLevel: effectiveSlotLevel,
          spellEffect: effect,
          spellSaveDC: saveDC,
          rawSpellSlots: isSpellSlots(rawSlots) ? rawSlots : undefined,
          playerCharacterId: context.character.id,
          actorConcentrationSpellId: context.character.concentrationSpellId,
        }, tx as Prisma.TransactionClient);

        gameEvents.push(...spellOutcome.events);

        if (context.activeEncounter) {
          const finalizeOutcome = await finalizeEncounterTurn({
            tx: tx as Prisma.TransactionClient,
            encounterId: context.activeEncounter.id,
            currentTurnIndex: context.activeEncounter.currentTurnIndex,
            round: context.activeEncounter.round,
          });
          gameEvents.push(...finalizeOutcome.events);
        }

        if (spellOutcome.consequences.length > 0) {
          gameEvents.push(buildCombatConsequenceEvent({
            attackerName: context.character.name,
            targets: spellOutcome.consequences,
          }));
        }
      });
    }

  if (intent.actionType === "use_item" && intent.targetName) {
      const foundItem = validateOwnership(context.character.inventory, intent.targetName);

      if (!foundItem) {
        return NextResponse.json(
          { error: `Item "${intent.targetName}" not found in inventory.` },
          { status: 400 }
        );
      }

      const consumableProps = getItemProperties(
        { ...foundItem, characterId: context.character.id },
        "consumable"
      );

      const playerCombatant = context.activeEncounter?.combatants.find(c => c.isPlayer);
      const playerConditions = extractConditions(playerCombatant?.conditions);

      await prisma.$transaction(async (tx) => {
        const itemOutcome = await executeCombatAction({
          actionType: "use_item",
          encounter: context.activeEncounter ? {
            id: context.activeEncounter.id,
            round: context.activeEncounter.round,
            currentTurnIndex: context.activeEncounter.currentTurnIndex,
            totalDamageDealt: context.activeEncounter.totalDamageDealt,
            status: "active",
            combatants: context.activeEncounter.combatants as PipelineCombatant[],
          } : { id: "", round: 0, currentTurnIndex: 0, totalDamageDealt: 0, status: "active", combatants: [] },
          actorId: playerCombatant?.id ?? context.character.id,
          actorName: context.character.name,
          actorConditions: playerConditions,
          targetCombatants: [],
          itemId: foundItem.id,
          itemName: foundItem.name,
          itemQuantity: foundItem.quantity,
          healingDice: consumableProps?.healingDice,
          healingBonus: consumableProps?.healingBonus,
          playerCharacterId: context.character.id,
        }, tx as Prisma.TransactionClient);

        gameEvents.push(...itemOutcome.events);

        if (context.activeEncounter) {
          const finalizeOutcome = await finalizeEncounterTurn({
            tx: tx as Prisma.TransactionClient,
            encounterId: context.activeEncounter.id,
            currentTurnIndex: context.activeEncounter.currentTurnIndex,
            round: context.activeEncounter.round,
          });
          gameEvents.push(...finalizeOutcome.events);
        }
      });
    }

    // ── Gate: equip ─────────────────────────────────────────────────────────────
    if (intent.actionType === "equip" && intent.targetName) {
      const foundItem = validateOwnership(context.character.inventory, intent.targetName);

      if (!foundItem) {
        return NextResponse.json(
          { error: `Item "${intent.targetName}" not found in inventory.` },
          { status: 400 }
        );
      }

      let targetSlot = "ACCESSORY";
      if (foundItem.type === "weapon") targetSlot = "MAIN_HAND";
      else if (foundItem.type === "armor") targetSlot = "ARMOR";

      await prisma.$transaction(async (tx) => {
        await tx.inventoryItem.updateMany({
          where: { characterId: context.character.id, equippedSlot: targetSlot },
          data: { equippedSlot: null },
        });

        await tx.inventoryItem.update({
          where: { id: foundItem.id },
          data: { equippedSlot: targetSlot },
        });
      });
      
      // Send event to update the UI
      gameEvents.push({
        type: "EQUIP_ITEM",
        payload: { itemId: foundItem.id, itemName: foundItem.name, targetSlot },
      });
    }

    // ── Gate: attack ────────────────────────────────────────────────────────────
    if (intent.actionType === "attack") {
      if (!context.activeEncounter) {
        return NextResponse.json({ error: "No active encounter. You must be in combat to attack." }, { status: 400 });
      }

      // Resolve the target before anything is rolled. A weapon attack names one
      // creature, so an attack that cannot be pinned to exactly one living
      // hostile is refused rather than resolved against a guess — or, as before,
      // silently skipped past this gate and left to the narrator.
      const living = context.activeEncounter.combatants.filter(
        c => !c.isPlayer && c.hp > 0
      );

      let targets: typeof living;
      if (body.targetIds?.length) {
        // An explicit selection from the tactical map (see MacroDeck).
        if (body.targetIds.length !== 1) {
          return NextResponse.json(
            { error: "A weapon attack requires exactly one target." },
            { status: 400 }
          );
        }
        targets = living.filter(c => c.id === body.targetIds![0]);
      } else if (intent.targetName) {
        const normalizedTarget = intent.targetName.toLowerCase();
        targets = living.filter(c => c.name.toLowerCase().includes(normalizedTarget));
      } else {
        return NextResponse.json(
          { error: "Attack requires one exact target." },
          { status: 400 }
        );
      }

      if (targets.length !== 1) {
        return NextResponse.json(
          {
            error: intent.targetName
              ? `Target "${intent.targetName}" was not found or is ambiguous.`
              : "The selected hostile target is invalid.",
          },
          { status: 400 }
        );
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
      const attackModifier = strMod + 2;

      await prisma.$transaction(async (tx) => {
        const attackOutcome = await executeCombatAction({
          actionType: "attack",
          encounter: {
            id: context.activeEncounter!.id,
            round: context.activeEncounter!.round,
            currentTurnIndex: context.activeEncounter!.currentTurnIndex,
            totalDamageDealt: context.activeEncounter!.totalDamageDealt,
            status: "active",
            combatants: context.activeEncounter!.combatants as PipelineCombatant[],
          },
          actorId: playerCombatant?.id ?? context.character.id,
          actorName: context.character.name,
          actorConditions: playerConditions,
          targetCombatants: targets,
          weaponName: foundWeapon.name,
          weaponDice: weaponProps?.damageDice || "1d4",
          damageType: (weaponProps?.damageType as DamageType) || "slashing",
          attackModifier,
          flatDamageBonus: strMod + (weaponProps?.damageBonus || 0),
          playerCharacterId: context.character.id,
        }, tx as Prisma.TransactionClient);

        gameEvents.push(...attackOutcome.events);

        const finalizeOutcome = await finalizeEncounterTurn({
          tx: tx as Prisma.TransactionClient,
          encounterId: context.activeEncounter!.id,
          currentTurnIndex: context.activeEncounter!.currentTurnIndex,
          round: context.activeEncounter!.round,
        });
        gameEvents.push(...finalizeOutcome.events);

        if (attackOutcome.consequences.length > 0) {
          gameEvents.push(buildCombatConsequenceEvent({
            attackerName: context.character.name,
            targets: attackOutcome.consequences,
          }));
        }
      });
    }

    // ── Gate: rest ──────────────────────────────────────────────────────────────
    if (intent.actionType === "rest") {
      const charData = context.character;
      
      await prisma.$transaction(async (tx) => {
        const charState: CharacterState = {
          hp: charData.hp,
          maxHp: charData.maxHp,
          level: charData.level,
          class: charData.class,
          stats: charData.stats as Record<string, number>,
          spellSlots: charData.spellSlots as Record<string, { current: number; max: number }> | null,
          hitDiceTotal: charData.hitDiceTotal,
          hitDiceRemaining: charData.hitDiceRemaining,
          exhaustionLevel: charData.exhaustionLevel,
        };

        const isLongRest = intent.restType === "long" || trimmedAction.toLowerCase().includes("long rest");
        
        let nextChar: CharacterState;
        let eventPayload: Record<string, unknown>;

        if (isLongRest) {
          const result = applyLongRest(charState);
          nextChar = result.next;
          eventPayload = { type: "LONG_REST", hpRecovered: result.hpRecovered, hitDiceRecovered: result.hitDiceRecovered, exhaustionReduced: result.exhaustionReduced, spellSlotsRecovered: result.spellSlotsRecovered };
        } else {
          const result = applyShortRest(charState);
          nextChar = result.next;
          eventPayload = { type: "SHORT_REST", hpRecovered: result.hpRecovered, hitDiceSpent: result.hitDiceSpent };
        }

        await tx.character.update({
          where: { id: charData.id },
          data: {
            hp: nextChar.hp,
            hitDiceRemaining: nextChar.hitDiceRemaining,
            exhaustionLevel: nextChar.exhaustionLevel,
            spellSlots: nextChar.spellSlots ? (nextChar.spellSlots as Prisma.InputJsonValue) : Prisma.JsonNull,
          },
        });

        gameEvents.push({
          type: "REST_COMPLETED",
          payload: eventPayload,
        });
      });
    }

    // ── Gate: move ──────────────────────────────────────────────────────────────
    if (intent.actionType === "move" && intent.destination) {
      const moveResult = await prisma.$transaction(async (tx) => {
        return await moveToNode(
          tx as Prisma.TransactionClient,
          campaignId,
          intent.destination!
        );
      });

      if (!moveResult.success) {
        return NextResponse.json(
          { error: moveResult.error },
          { status: 400 }
        );
      }

      gameEvents.push({
        type: "PLAYER_MOVE",
        payload: { 
          targetNodeId: moveResult.targetNodeId,
          passageType: moveResult.passageType 
        },
      });
    }
  }

  // ── State is now safely mutated. ─────────────────────────────────────────────
  // Every gate above either committed its transaction or returned a 4xx, so this
  // is the only safe point to check for a pending level-up: earlier would risk a
  // later gate rejecting the request after the player was already shown an
  // outcome, and reusing the pre-gate `context.character` snapshot would be an
  // accidental equivalence a future gate could silently break.
  //
  // This is presentation, not resolution: detection never applies the level-up,
  // never rolls hit points, and never touches level/xp/maxHp/hitDiceTotal. A
  // failure here must not fail an already-valid mechanical turn — whatever is
  // pending will simply be detected again on the next turn.
  let levelUpAvailablePayload: ReturnType<typeof detectPendingLevelUp> = null;
  try {
    const freshCharacter = await prisma.character.findUnique({
      where: { id: context.character.id },
      select: {
        id: true,
        class: true,
        level: true,
        xp: true,
        maxHp: true,
        hitDiceTotal: true,
        stats: true,
      },
    });

    if (freshCharacter) {
      levelUpAvailablePayload = detectPendingLevelUp(freshCharacter);
    }
  } catch (err) {
    console.error("[action] Level-up presentation detection failed:", err);
  }

  // ── Start the narrative stream. ──────────────────────────────────────────────

  const narrativeContext = adaptCombatEventsToNarrativeContext(gameEvents);
  const { textStream, textPromise, levelUpPayload, merchantPayload } = await streamNarrative(
    campaignId,
    trimmedAction,
    narrativeContext.facts.length > 0 ? narrativeContext : undefined
  );

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
  //   Phase 1   — all deterministic game events (instant, before any LLM latency)
  //   Phase 1.5 — a backend-detected pending level-up, if any (not applied)
  //   Phase 2   — AI narrator tokens, streamed as they arrive
  //   Phase 3   — done sentinel so the client knows to call router.refresh()
  const sseStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Phase 1: flush game events immediately
        for (const ev of gameEvents) {
          controller.enqueue(sseFrame({ t: "evt", e: ev }));
        }

        // Phase 1.5: a pending level-up the backend detected from canonical
        // state. Emitted before any narrator token so the UI learns this from
        // backend state, never from prose. Detection only — see the try/catch
        // above where this payload was derived; applying it is a separate,
        // player-confirmed operation behind POST /api/campaign/[id]/level-up.
        if (levelUpAvailablePayload) {
          controller.enqueue(
            sseFrame({ t: "level_up_available", payload: levelUpAvailablePayload })
          );
        }

        // Phase 2: stream narrative tokens
        for await (const delta of textStream) {
          controller.enqueue(sseFrame({ t: "txt", d: delta }));
        }

        // Phase 2.5: legacy-compatible frames. Narrator mutation tools are
        // contained in SEC-AI-001 PR2, so both payloads currently resolve null.
        // Keep the conditional branches until PR3 restores backend-authorised emitters.
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
