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
  checkpointAcceptedAction,
  reserveActionRequest,
  rejectPendingActionRequest,
} from "@/lib/db/session-journal";
import { deriveSessionMode } from "@/lib/session/contracts";

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
import {
  advanceTurn as advanceExplorationTurn,
  consumeResources,
} from "@/lib/rules/exploration";
import { resolveRest, RestServiceError } from "@/lib/rules/rest-service";
import { moveToNode } from "@/lib/rules/navigation";
import {
  buildCombatConsequenceEvent,
  finalizeEncounterTurn,
  executeCombatAction,
  type PipelineCombatant,
} from "@/lib/rules/combat-pipeline";
import { adaptCombatEventsToNarrativeContext } from "@/lib/narrative/combat-fact-adapter";
import { abilityModifier } from "@/lib/rules/dice";
import { getItemProperties, validateOwnership } from "@/lib/rules/inventory";
import {
  getAoETargets,
  normalizeSizeCategory,
  validateMovement,
  type AreaShape,
  type GridCombatant,
  type TacticalMap,
} from "@/lib/rules/geometry";
import { getSrdRaceWalkingSpeedFt } from "@/lib/rules/movement";
import { resolveWeaponAttackProfile } from "@/lib/rules/weapons";
import type {
  GameEvent, ActionStreamFrame
} from "@/lib/events/game-events";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { ContextCombatant, ContextInventoryItem } from "@/lib/memory/context";
import type { PartyInventoryState } from "@/lib/rules/exploration";

const ActionBodySchema = z.object({
  action: z.string().trim().min(1).max(2_000),
  requestId: z.string().trim().min(8).max(128).optional(),
  targetIds: z.array(z.string().trim().min(1)).max(50).optional(),
  targetX: z.number().int().optional(),
  targetY: z.number().int().optional(),
}).strict();

type ActionBody = z.infer<typeof ActionBodySchema>;

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

function sseFrame(frame: ActionStreamFrame): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(frame)}\n\n`);
}

function findMainHandWeapon(inventory: ContextInventoryItem[]): ContextInventoryItem | null {
  return inventory.find((item) => item.type === "weapon" && item.equippedSlot === "MAIN_HAND") ?? null;
}

function getCharacterProficiencyBonus(level: number | undefined): number {
  return calculateProficiency(level ?? 1);
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: campaignId } = await params;

  let body: ActionBody;
  try {
    const parsed = ActionBodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid action request.", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { action } = body;

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
  const requestId = body.requestId ?? crypto.randomUUID();
  const reservation = await reserveActionRequest({
    campaignId,
    requestId,
    action: trimmedAction,
  });
  if (!reservation.ok) {
    return NextResponse.json(
      { error: "This session is paused.", code: reservation.code },
      { status: 409 }
    );
  }
  if (reservation.duplicate) {
    return NextResponse.json(
      { error: "This action request was already received.", code: "DUPLICATE_ACTION", status: reservation.status },
      { status: 409 }
    );
  }

  after(async () => {
    await rejectPendingActionRequest({ campaignId, requestId }).catch((error) => {
      console.error("[action] Failed to checkpoint a rejected request:", error);
    });
  });

  // Detect and resolve /roll commands (non-streaming, quick response).
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

    await checkpointAcceptedAction({
      campaignId,
      sessionId: reservation.sessionId,
      requestId,
      action: trimmedAction,
      mode: "NARRATIVE",
      events: [],
      additionalLogs: [{ role: "system", content: rollContent }],
    });

    return NextResponse.json({ ok: true, requestId }, { status: 202 });
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
  let actionTypeForSession: string | undefined;
  let actionCheckpointed = false;
  const checkpointMode = () => gameEvents.some((event) => event.type === "COMBAT_ENDED")
    ? "RESOLUTION" as const
    : deriveSessionMode({
        hasActiveEncounter: Boolean(context.activeEncounter),
        actionType: actionTypeForSession,
      });
  const checkpointInTransaction = async (tx: Prisma.TransactionClient) => {
    await checkpointAcceptedAction({
      campaignId,
      sessionId: reservation.sessionId,
      requestId,
      action: trimmedAction,
      mode: checkpointMode(),
      events: gameEvents,
    }, tx);
    actionCheckpointed = true;
  };

  if (MACRO_ACTIONS.includes(trimmedAction)) {
    if (!context.activeEncounter) {
      return NextResponse.json({ error: "No active encounter." }, { status: 400 });
    }
    const activeCombatant = context.activeEncounter.combatants[
      context.activeEncounter.currentTurnIndex
    ];
    if (!activeCombatant?.isPlayer || activeCombatant.hp <= 0) {
      return NextResponse.json(
        { error: "It is not the player character's active combat turn.", code: "NOT_ACTIVE_ACTOR" },
        { status: 409 }
      );
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
        await checkpointInTransaction(tx as Prisma.TransactionClient);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }

    if (trimmedAction === "Attack") {
      const activeEncounter = context.activeEncounter;
      const targetIds = body.targetIds ?? [];

      if (targetIds.length !== 1) {
        return NextResponse.json({ error: "A weapon attack requires exactly one target." }, { status: 400 });
      }
      const targets: ContextCombatant[] = activeEncounter.combatants.filter(
        (combatant) => targetIds[0] === combatant.id && !combatant.isPlayer && combatant.hp > 0
      );
      if (targets.length !== 1) {
        return NextResponse.json({ error: "The selected hostile target is invalid." }, { status: 400 });
      }

      const foundWeapon = findMainHandWeapon(context.character.inventory);

      const charStats = context.character.stats as Record<string, number>;
      const weaponProps = foundWeapon
        ? getItemProperties({ ...foundWeapon, characterId: context.character.id }, "weapon")
        : null;
      
      const weaponDice = foundWeapon 
        ? weaponProps?.damageDice ?? "1d4"
        : "1d4";
      const weaponBonus = foundWeapon 
        ? weaponProps?.damageBonus ?? 0
        : 0;

      const playerCombatant = activeEncounter.combatants.find(c => c.isPlayer);
      if (!activeEncounter.map || !playerCombatant) {
        return NextResponse.json(
          { error: "A tactical map and player position are required to validate attack range." },
          { status: 409 }
        );
      }
      const range = resolveWeaponAttackProfile({
        properties: weaponProps,
        attacker: playerCombatant,
        target: targets[0]!,
        map: activeEncounter.map,
        actorStats: charStats,
      });
      if (range.distanceFt > range.maxRangeFt) {
        return NextResponse.json(
          { error: `Target is out of range (${range.distanceFt} ft > ${range.maxRangeFt} ft).` },
          { status: 400 }
        );
      }
      const playerConditions = extractConditions(playerCombatant?.conditions);
      const attackModifier = range.attackAbilityModifier + getCharacterProficiencyBonus(context.character.level);

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
          damageType: (weaponProps?.damageType || "bludgeoning") as DamageType,
          attackModifier,
          flatDamageBonus: range.damageAbilityModifier + weaponBonus,
          attackDisadvantage: range.longRangeDisadvantage,
          isMeleeAttack: range.isMeleeAttack,
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
        await checkpointInTransaction(tx as Prisma.TransactionClient);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }

    if (trimmedAction === "Move") {
      // ── Gate: Move (tactical grid) ──────────────────────────────────────────
      // Validates coordinates, distance against speed, and collision before
      // mutating the combatant's (x, y) on the grid.  Pure geometry from
      // lib/rules/geometry.ts — the AI narrator never decides movement legality.

      const targetX = body.targetX;
      const targetY = body.targetY;

      if (targetX === undefined || targetY === undefined) {
        return NextResponse.json(
          { error: "Move requires integer targetX and targetY." },
          { status: 400 }
        );
      }

      const moveResult = await prisma.$transaction(async (tx) => {
        const encounterState = await tx.encounter.findUnique({
          where: { id: context.activeEncounter!.id },
          select: {
            map: {
              select: { gridType: true, width: true, height: true, cellSize: true },
            },
            combatants: {
              select: {
                id: true,
                isPlayer: true,
                stats: true,
                x: true,
                y: true,
                size: true,
              },
            },
          },
        });

        if (!encounterState?.map) {
          return {
            valid: false as const,
            status: 409,
            code: "MISSING_MAP",
            error: "Encounter has no authoritative tactical map.",
          };
        }

        const playerCombatant = encounterState.combatants.find((combatant) => combatant.isPlayer);
        if (!playerCombatant) {
          return {
            valid: false as const,
            status: 400,
            code: "MISSING_PLAYER",
            error: "Player combatant not found in encounter.",
          };
        }

        const combatantStats = (playerCombatant.stats as Record<string, unknown>) ?? {};
        const rawSpeed = combatantStats.speed;
        const speedFt = typeof rawSpeed === "number" && rawSpeed > 0
          ? rawSpeed
          : getSrdRaceWalkingSpeedFt(context.character.race);
        if (speedFt === null) {
          return {
            valid: false as const,
            status: 409,
            code: "MISSING_SPEED",
            error: "Character walking speed is not available from authoritative SRD data.",
          };
        }
        const gridCombatants: GridCombatant[] = encounterState.combatants.map((combatant) => ({
          id: combatant.id,
          x: combatant.x,
          y: combatant.y,
          size: normalizeSizeCategory(combatant.size),
        }));
        const mover = gridCombatants.find((combatant) => combatant.id === playerCombatant.id)!;
        const map: TacticalMap = {
          gridType: encounterState.map.gridType,
          width: encounterState.map.width,
          height: encounterState.map.height,
          cellSize: encounterState.map.cellSize,
        };
        const movement = validateMovement({
          combatant: mover,
          target: { x: targetX, y: targetY },
          map,
          combatants: gridCombatants,
          speedFt,
        });

        if (!movement.valid) {
          return {
            valid: false as const,
            status: 400,
            code: movement.code,
            error: movement.message,
          };
        }

        await tx.combatant.update({
          where: { id: playerCombatant.id },
          data: { x: targetX, y: targetY },
        });

        const result = {
          valid: true as const,
          combatantId: playerCombatant.id,
          fromX: playerCombatant.x,
          fromY: playerCombatant.y,
          distanceFt: movement.distanceFt,
        };
        gameEvents.push({
          type: "MOVE_COMBATANT",
          payload: {
            combatantId: result.combatantId,
            fromX: result.fromX,
            fromY: result.fromY,
            toX: targetX,
            toY: targetY,
            distanceFt: result.distanceFt,
          },
        });
        await checkpointInTransaction(tx as Prisma.TransactionClient);
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      if (!moveResult.valid) {
        return NextResponse.json(
          { error: moveResult.error, code: moveResult.code },
          { status: moveResult.status }
        );
      }

    }

    // After mechanical resolution, proceed to narration using the NEW state.
    // The buildCampaignContext inside streamNarrative will see the updated DB.
  } else {
    // LLM Intent Parsing (for natural language actions)
    const intent = await parseIntent(trimmedAction, systemContext);
    actionTypeForSession = intent.actionType;
    if (intent.actionType === "cast_spell" && !intent.spellName) {
      return NextResponse.json(
        { error: "An exact spell name is required for backend resolution." },
        { status: 400 }
      );
    }
    if (
      (intent.actionType === "use_item" || intent.actionType === "equip") &&
      !intent.targetName
    ) {
      return NextResponse.json(
        { error: "That mechanical action requires an exact item name." },
        { status: 400 }
      );
    }
    if (intent.actionType === "attack" && !intent.targetName && !body.targetIds?.length) {
      return NextResponse.json({ error: "Attack requires one exact target." }, { status: 400 });
    }
    if (intent.actionType === "move" && !intent.destination) {
      return NextResponse.json({ error: "Move requires an exact destination." }, { status: 400 });
    }
    const consumesCombatTurn = ["cast_spell", "attack", "use_item"].includes(
      intent.actionType
    );
    if (consumesCombatTurn && context.activeEncounter) {
      const activeCombatant = context.activeEncounter.combatants[
        context.activeEncounter.currentTurnIndex
      ];
      if (!activeCombatant?.isPlayer || activeCombatant.hp <= 0) {
        return NextResponse.json(
          { error: "It is not the player character's active combat turn.", code: "NOT_ACTIVE_ACTOR" },
          { status: 409 }
        );
      }
    }



    // ── Gate: cast_spell ────────────────────────────────────────────────────────
    if (intent.actionType === "cast_spell") {
      if (!intent.spellName) {
        return NextResponse.json(
          { error: "An exact spell name is required for backend resolution." },
          { status: 400 }
        );
      }

      const spellLevel = intent.spellLevel ?? intent.spellEffect?.level;
      if (spellLevel === undefined) {
        return NextResponse.json(
          { error: `Spell "${intent.spellName}" is unavailable in the SRD cache.` },
          { status: 400 }
        );
      }

      const rawSlots = context.character.spellSlots;
      const usesSpellSlot = spellLevel > 0;

      if (usesSpellSlot && !isSpellSlots(rawSlots)) {
        return NextResponse.json(
          { error: "This character has no spellcasting ability." },
          { status: 400 }
        );
      }

      if (
        usesSpellSlot &&
        isSpellSlots(rawSlots) &&
        !hasAvailableSlot(rawSlots, spellLevel)
      ) {
        return NextResponse.json(
          { error: `No available spell slots remaining at level ${spellLevel}.` },
          { status: 400 }
        );
      }

      let effect: ResolvedSpellEffect | null = null;
      let saveDC: number | undefined = undefined;

      {
        const charStats = context.character.stats as Record<string, number>;
        const spellAbilityKey = spellcastingAbility(context.character.class);
        const abilityMod = abilityModifier(charStats[spellAbilityKey] ?? 10);
        const profBonus = calculateProficiency(context.character.level);
        const spellEffect = await resolveCachedSpell({
          query: intent.spellName,
          slotLevel: spellLevel,
          spellcastingMod: abilityMod,
          characterLevel: context.character.level,
        });

        if (!spellEffect) {
          return NextResponse.json(
            { error: `Spell "${intent.spellName}" is unavailable in the SRD cache.` },
            { status: 400 }
          );
        }

        saveDC = calculateSpellSaveDC(abilityMod, profBonus);
        effect = spellEffect;
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

      if (effect?.areaOfEffect && effect.type === "damage") {
        const activeEncounter = context.activeEncounter;
        if (!activeEncounter || !playerCombatant) {
          return NextResponse.json(
            { error: "An active encounter is required for an area spell." },
            { status: 400 }
          );
        }
        if (!activeEncounter.map) {
          return NextResponse.json(
            { error: "Encounter has no authoritative tactical map." },
            { status: 409 }
          );
        }

        const anchor = targets[0];
        if (!anchor) {
          return NextResponse.json(
            { error: "Area spells require one target as the area anchor or direction." },
            { status: 400 }
          );
        }

        const shape: AreaShape = effect.areaOfEffect.shape;
        const directional = shape === "CONE" || shape === "LINE";
        const areaOrigin = directional
          ? { x: playerCombatant.x, y: playerCombatant.y }
          : { x: anchor.x, y: anchor.y };
        const direction = directional
          ? { x: anchor.x - playerCombatant.x, y: anchor.y - playerCombatant.y }
          : undefined;
        const gridCombatants: GridCombatant[] = activeEncounter.combatants
          .filter((combatant) => combatant.hp > 0)
          .map((combatant) => ({
            id: combatant.id,
            x: combatant.x,
            y: combatant.y,
            size: normalizeSizeCategory(combatant.size),
          }));
        const affectedIds = new Set(getAoETargets({
          origin: areaOrigin,
          direction,
          shape,
          sizeFt: effect.areaOfEffect.sizeFt,
          gridType: activeEncounter.map.gridType,
          cellSize: activeEncounter.map.cellSize,
        }, gridCombatants).map((combatant) => combatant.id));
        targets = activeEncounter.combatants.filter((combatant) => affectedIds.has(combatant.id));

        if (targets.length === 0) {
          return NextResponse.json(
            { error: "No living combatants intersect the selected spell area." },
            { status: 400 }
          );
        }
      }

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
          spellLevel,
          spellEffect: effect ?? undefined,
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
        await checkpointInTransaction(tx as Prisma.TransactionClient);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
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
        await checkpointInTransaction(tx as Prisma.TransactionClient);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
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
        gameEvents.push({
          type: "EQUIP_ITEM",
          payload: { itemId: foundItem.id, itemName: foundItem.name, targetSlot },
        });
        await checkpointInTransaction(tx as Prisma.TransactionClient);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }

    // ── Gate: attack ────────────────────────────────────────────────────────────
    if (intent.actionType === "attack" && intent.targetName) {
      if (!context.activeEncounter) {
        return NextResponse.json({ error: "No active encounter. You must be in combat to attack." }, { status: 400 });
      }

      const normalizedTarget = intent.targetName.toLowerCase();
      const targets = context.activeEncounter.combatants.filter(
        (combatant) =>
          !combatant.isPlayer &&
          combatant.hp > 0 &&
          combatant.name.toLowerCase().includes(normalizedTarget)
      );

      if (targets.length !== 1) {
        return NextResponse.json({ error: `Target "${intent.targetName}" not found.` }, { status: 400 });
      }

      const foundWeapon = findMainHandWeapon(context.character.inventory);
      const weaponProps = foundWeapon
        ? getItemProperties({ ...foundWeapon, characterId: context.character.id }, "weapon")
        : null;
      const charStats = context.character.stats as Record<string, number>;
      const playerCombatant = context.activeEncounter.combatants.find(c => c.isPlayer);
      if (!context.activeEncounter.map || !playerCombatant) {
        return NextResponse.json(
          { error: "A tactical map and player position are required to validate attack range." },
          { status: 409 }
        );
      }
      const range = resolveWeaponAttackProfile({
        properties: weaponProps,
        attacker: playerCombatant,
        target: targets[0]!,
        map: context.activeEncounter.map,
        actorStats: charStats,
      });
      if (range.distanceFt > range.maxRangeFt) {
        return NextResponse.json(
          { error: `Target is out of range (${range.distanceFt} ft > ${range.maxRangeFt} ft).` },
          { status: 400 }
        );
      }
      const playerConditions = extractConditions(playerCombatant?.conditions);
      const attackModifier = range.attackAbilityModifier + getCharacterProficiencyBonus(context.character.level);

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
          weaponName: foundWeapon?.name || "Unarmed",
          weaponDice: weaponProps?.damageDice || "1d4",
          damageType: (weaponProps?.damageType as DamageType) || "bludgeoning",
          attackModifier,
          flatDamageBonus: range.damageAbilityModifier + (weaponProps?.damageBonus || 0),
          attackDisadvantage: range.longRangeDisadvantage,
          isMeleeAttack: range.isMeleeAttack,
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
        await checkpointInTransaction(tx as Prisma.TransactionClient);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }

    // ── Gate: rest ──────────────────────────────────────────────────────────────
    if (intent.actionType === "rest") {
      try {
        await prisma.$transaction(async (tx) => {
          const restResult = await resolveRest({
            campaignId,
            characterId: context.character.id,
            restType: intent.restType ?? "short",
            tx,
          });

          gameEvents.push({
            type: "REST_COMPLETED",
            payload: { ...restResult.facts },
          });
          await checkpointInTransaction(tx as Prisma.TransactionClient);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (error instanceof RestServiceError) {
          const status = error.code === "ACTIVE_ENCOUNTER" ? 409 : 400;
          return NextResponse.json(
            { error: error.message, code: error.code },
            { status }
          );
        }
        throw error;
      }
    }

    // ── Gate: explore / travel ──────────────────────────────────────────────────
    if (intent.actionType === "explore" || intent.actionType === "travel") {
      await prisma.$transaction(async (tx) => {
        const campaignTime = await tx.campaignTime.findUnique({ where: { campaignId } });
        const partyInventory = await tx.partyInventory.findUnique({ where: { campaignId } });
        
        if (campaignTime && partyInventory) {
          const advanceResult = advanceExplorationTurn(campaignTime, 1);
          
          await tx.campaignTime.update({
            where: { campaignId },
            data: advanceResult.next,
          });

          if (advanceResult.rationConsumptionDue || advanceResult.turnsAdvanced > 0) {
             const consumeResult = consumeResources(partyInventory as unknown as PartyInventoryState, { rationConsumptionDue: advanceResult.rationConsumptionDue, partySize: 1 }, advanceResult.turnsAdvanced);
             
             await tx.partyInventory.update({
               where: { campaignId },
               data: consumeResult.next,
             });
             
             if (consumeResult.warnings.length > 0) {
               gameEvents.push({
                 type: "EXPLORATION_WARNING",
                 payload: { warnings: consumeResult.warnings },
               });
             }
          }
        }
        await checkpointInTransaction(tx as Prisma.TransactionClient);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }

    // ── Gate: move ──────────────────────────────────────────────────────────────
    if (intent.actionType === "move" && intent.destination) {
      const moveResult = await prisma.$transaction(async (tx) => {
        const result = await moveToNode(
          tx as Prisma.TransactionClient,
          campaignId,
          intent.destination!
        );
        if (!result.success) return result;

        gameEvents.push({
          type: "PLAYER_MOVE",
          payload: {
            targetNodeId: result.targetNodeId,
            passageType: result.passageType,
          },
        });
        await checkpointInTransaction(tx as Prisma.TransactionClient);
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      if (!moveResult.success) {
        return NextResponse.json(
          { error: moveResult.error },
          { status: 400 }
        );
      }

    }
  }

  // Only accepted actions enter the canonical transcript. Rejected requests
  // return before this checkpoint and therefore cannot become campaign facts.
  if (!actionCheckpointed) {
    await checkpointAcceptedAction({
      campaignId,
      sessionId: reservation.sessionId,
      requestId,
      action: trimmedAction,
      mode: checkpointMode(),
      events: gameEvents,
    });
  }
  // ── State is now safely mutated.  Start the narrative stream. ────────────────

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
