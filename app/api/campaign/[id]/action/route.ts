import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser, AuthError } from "@/lib/auth/session";
import { roll } from "@/lib/rules/dice";
import { streamNarrative } from "@/lib/ai/narrator";
import { buildCampaignContext } from "@/lib/memory/context";
import { formatSystemPrompt } from "@/lib/memory/formatter";
import { parseIntent } from "@/lib/ai/intent";
import { NARRATOR_DATA_LIMITS } from "@/lib/ai/trust-boundary";
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
import { resolveWeaponAttack, unresolvedCategoryLog } from "@/lib/rules/weapon-attack";
import {
  armorPenaltyFor,
  describeArmorPenalty,
  penalisedByArmor,
} from "@/lib/rules/armor-proficiency";
import { slotFor } from "@/lib/rules/equipment-slot";
import { abilityCheckAdvantageFrom } from "@/lib/rules/item-effects";
import { stealthDisadvantageFor } from "@/lib/rules/armor-stealth";
import {
  evaluateAbilityCheckAdvantage,
  isUnawareOfSurroundings,
} from "@/lib/rules/conditions";
import {
  applyShortRest,
  applyLongRest,
  type CharacterState,
} from "@/lib/rules/exploration";
import { moveToNode } from "@/lib/rules/navigation";
import { travelDistanceMiles, resolveJourney } from "@/lib/rules/travel";
import { resolveAbilityCheck, type Ability } from "@/lib/rules/ability-check";
import { parseSkillProficiencies } from "@/lib/rules/class-skills";
import { matchImprovisedAction } from "@/lib/rules/improvised-actions";
import { checkSpellRange, resolveAreaTargets } from "@/lib/rules/spell-targeting";
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
import {
  ACTION_REQUEST_ID_MAX_CHARS,
  type DungeonActionRequestBody,
} from "@/lib/events/action-transport";
import {
  acquireActionReceipt,
  completeActionReceipt,
  completeActionReceiptWithResponse,
  fingerprintActionRequest,
  rejectActionReceipt,
} from "@/lib/actions/request-receipt";
import { Prisma } from "@prisma/client";
import type { ContextCombatant } from "@/lib/memory/context";

/**
 * The request body, declared once in `lib/events/action-transport.ts` and
 * shared with the client that builds it. A type-only import, so nothing from
 * that browser-facing module reaches this route at runtime.
 */
type ActionBody = DungeonActionRequestBody;

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Coerces a persisted `Combatant.size` into a SizeCategory.
 *
 * The column is a plain string, so an unrecognised value degrades to Medium
 * rather than throwing: a malformed row should resolve as an ordinary creature,
 * not fail a legal turn. Shared by the movement gate and the spell gate so the
 * two cannot disagree about how big a creature is.
 */
const VALID_SIZES: SizeCategory[] = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"];

function toSizeCategory(raw: unknown): SizeCategory {
  return VALID_SIZES.includes(raw as SizeCategory) ? (raw as SizeCategory) : "Medium";
}

const encoder = new TextEncoder();

function sseFrame(frame: ActionStreamFrame): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(frame)}\n\n`);
}

/**
 * Persists `CombatOutcome.systemLogs` — the declared refusals
 * `executeCombatAction` collects for both the weapon and spell damage paths
 * (see `unresolvedModifierLog` in `lib/rules/damage-modifiers.ts`) — the same
 * way `categoryLog` and `unenforcedRangeLog` already reach the game log
 * elsewhere in this route. Unlike those two, the content here is only known
 * once `executeCombatAction` has resolved inside the transaction, so this
 * writes through `tx` rather than the top-level `prisma` client.
 */
async function writeSystemLogs(
  tx: Prisma.TransactionClient,
  campaignId: string,
  lines: readonly string[]
): Promise<void> {
  for (const content of lines) {
    await tx.gameLog.create({ data: { campaignId, role: "system", content } });
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

/**
 * Carries the acquired receipt id back out to the wrapper below.
 *
 * A mutable reference rather than a return value because `resolveAction`
 * returns a `Response` through roughly thirty-four separate `return`
 * statements; threading a second value through every one of them would mean
 * editing all of them, which is exactly the refactor this design avoids.
 */
interface ReceiptRef {
  id?: string;
}

/**
 * Settles a mechanical refusal (DC-AUD-003).
 *
 * This wrapper exists for one job: recording that an acquired request ended in
 * a 4xx, without touching any of the route's ~34 refusal `return` sites. The
 * two success paths — `/roll` and the ordinary action — settle themselves
 * *inside* `resolveAction`, because their receipts must be marked before the
 * response is built, and a wrapper by definition runs after that.
 *
 * A throw propagates untouched, leaving the receipt `PROCESSING`. That is
 * deliberate: an interrupted request cannot be distinguished from a live one,
 * and refusing an uncertain retry is safe where re-running one is not.
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<Response> {
  const receiptRef: ReceiptRef = {};
  const res = await resolveAction(req, ctx, receiptRef);

  // A pre-acquisition failure (bad body, auth, ownership, inactive campaign)
  // holds no receipt id, so it settles nothing — exactly as before.
  if (receiptRef.id && res.status >= 400 && res.status < 500) {
    // Only JSON is cloned; the SSE stream is never read here. `clone()` keeps
    // the original body intact for the client.
    const body = await res.clone().json().catch(() => null);
    await rejectActionReceipt(receiptRef.id, res.status, body ?? { error: "Refused." });
  }

  return res;
}

async function resolveAction(
  req: NextRequest,
  { params }: RouteContext,
  receiptRef: ReceiptRef
): Promise<Response> {
  const { id: campaignId } = await params;

  let body: ActionBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { action } = body;

  if (typeof action !== "string" || !action.trim()) {
    return NextResponse.json({ error: "action is required." }, { status: 400 });
  }

  const trimmedAction = action.trim();
  if (trimmedAction.length > NARRATOR_DATA_LIMITS.playerActionChars) {
    return NextResponse.json(
      { error: `action must be at most ${NARRATOR_DATA_LIMITS.playerActionChars} characters.` },
      { status: 400 }
    );
  }

  // ── requestId ────────────────────────────────────────────────────────────────
  // The correlation id the client generated for this submission. Validation is
  // unchanged from DC-AUD-002; what changed is that the normalised value is now
  // bound and keyed on — it is the idempotency key acquired further below.
  //
  // Optional, because callers predating this contract must keep working — but
  // a present-and-malformed id is a client bug, not a legacy caller, and is
  // refused rather than silently ignored. Checked beside the other cheap body
  // validation, before authentication touches anything.
  const { requestId: rawRequestId } = body;
  let requestId: string | undefined;

  if (rawRequestId !== undefined) {
    if (typeof rawRequestId !== "string") {
      return NextResponse.json(
        { error: "requestId must be a string when present." },
        { status: 400 }
      );
    }

    // Trimmed the way `action` is, so the same submission cannot arrive under
    // two spellings and be treated as two.
    const trimmedRequestId = rawRequestId.trim();

    if (!trimmedRequestId) {
      return NextResponse.json(
        { error: "requestId must not be empty when present." },
        { status: 400 }
      );
    }

    if (trimmedRequestId.length > ACTION_REQUEST_ID_MAX_CHARS) {
      return NextResponse.json(
        { error: `requestId must be at most ${ACTION_REQUEST_ID_MAX_CHARS} characters.` },
        { status: 400 }
      );
    }

    requestId = trimmedRequestId;
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

  // ── Idempotency acquisition (DC-AUD-003) ─────────────────────────────────────
  // Placed after ownership and campaign state, so an unauthenticated or
  // unauthorised caller can never create a row, and before everything else, so
  // a duplicate is stopped before it can write history or spend a slot.
  //
  // A request with no `requestId` skips this entirely and behaves exactly as it
  // did before — legacy callers keep working, at the cost of no protection.
  if (requestId) {
    const acquisition = await acquireActionReceipt({
      actorUserId: user.id,
      campaignId,
      requestId,
      requestHash: fingerprintActionRequest({
        action: trimmedAction,
        targetIds: body.targetIds,
        targetX: body.targetX,
        targetY: body.targetY,
      }),
    });

    switch (acquisition.outcome) {
      case "acquired":
        // This request owns the submission. Publish the id so the wrapper can
        // settle a refusal, and fall through into ordinary resolution.
        receiptRef.id = acquisition.receiptId;
        break;

      case "in_flight":
        // Deliberately worded as uncertainty rather than "still running": a
        // receipt left behind by an interrupted request is indistinguishable
        // from a live one, and claiming otherwise would be a lie the player
        // cannot check. Nothing is executed either way.
        return NextResponse.json(
          {
            error:
              "Esta acción ya se envió y su resultado aún no se ha confirmado. " +
              "Sincroniza el estado antes de volver a intentarlo.",
            code: "ACTION_IN_FLIGHT",
          },
          { status: 409 }
        );

      case "reused":
        return NextResponse.json(
          {
            error:
              "Ese identificador de petición ya corresponde a otra acción. " +
              "Vuelve a declarar la acción para enviarla de nuevo.",
            code: "REQUEST_ID_REUSED",
          },
          { status: 409 }
        );

      case "rejected":
      case "completed_replay":
        // Replayed verbatim: the stored body IS the original outcome, so the
        // refusal or the roll result is neither re-evaluated nor re-rolled,
        // and nothing is written.
        return NextResponse.json(acquisition.responseBody, {
          status: acquisition.responseStatus,
        });

      case "completed_stream":
        // The mechanics of this submission are already committed. Answer in
        // the transport shape the client expects — a terminal duplicate frame
        // and `done` — so its ordinary `router.refresh()` reconciles state.
        // No narration, and no replay of the original event frames.
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(sseFrame({ t: "duplicate", requestId }));
              controller.enqueue(sseFrame({ t: "done" }));
              controller.close();
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "text/event-stream; charset=utf-8",
              "Cache-Control": "no-cache, no-transform",
              "X-Accel-Buffering": "no",
            },
          }
        );
    }
  }

  // Step 1: The player's action becomes canonical history only once the request
  // is committed to proceeding.
  //
  // This used to be written unconditionally, right here, before any of the
  // resolution gates below had run. Every mechanical refusal after this point
  // returns 4xx without unwinding it, so a rejected action — "Attack" with no
  // encounter, a target outside the fight, a spell with no slot left — stayed
  // in the log as something the player had done. `buildCampaignContext` reads
  // these rows back and `lib/ai/narrator.ts` hands them to the model as
  // `recentDialogue`, so a refused action became narratable fiction on every
  // later turn: the AI gaining, by omission, an outcome the rules engine had
  // explicitly denied.
  //
  // Each gate calls this at its own point of no return — after its last 4xx,
  // before its first write — so the player's line still precedes the system
  // lines that answer it. Idempotent because only one gate resolves per
  // request but the trailing call below covers whatever matched no gate; a
  // second call is a no-op, not a duplicate row.
  let playerActionLogged = false;
  const persistPlayerAction = async (): Promise<void> => {
    if (playerActionLogged) return;
    playerActionLogged = true;
    await prisma.gameLog.create({
      data: {
        campaignId,
        role: "user",
        content: trimmedAction,
      },
    });
  };

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

    // /roll is not a mechanical gate and has no rejection path: bad notation is
    // answered with a system line and 202, not a 4xx. The command is therefore
    // always canonical, and is written before the result that answers it.
    await persistPlayerAction();

    await prisma.gameLog.create({
      data: {
        campaignId,
        role: "system",
        content: rollContent,
      },
    });

    // `/roll` returns early and never reaches the convergence point where the
    // ordinary action settles its receipt, so it settles its own — storing the
    // exact body a duplicate must receive instead of rolling a second time.
    //
    // Not wrapped in a try/catch: if the receipt cannot be recorded, this must
    // not answer 202 as though durable idempotency existed. The failure
    // propagates and the receipt stays PROCESSING, which a retry refuses.
    const rollResponseBody = { ok: true };
    if (receiptRef.id) {
      await completeActionReceiptWithResponse(receiptRef.id, 202, rollResponseBody);
    }

    return NextResponse.json(rollResponseBody, { status: 202 });
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
      await persistPlayerAction();

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
      const playerCombatant = activeEncounter.combatants.find(c => c.isPlayer);
      const playerConditions = extractConditions(playerCombatant?.conditions);

      const attack = await resolveWeaponAttack({
        weapon: foundWeapon
          ? { name: foundWeapon.name, properties: foundWeapon.properties }
          : null,
        stats: charStats,
        characterClass: context.character.class,
        level: context.character.level,
        fallbackDamageType: "bludgeoning",
      });

      // Declared before the transaction opens: at this point the attack is
      // confirmed to proceed, so the line never describes an attack that was
      // rejected. Same discipline as the unenforceable-range log above.
      const categoryLog = foundWeapon
        ? unresolvedCategoryLog({ weaponName: foundWeapon.name, attack })
        : null;

      // Point of no return for the macro attack: targets are resolved and every
      // refusal above has been passed, so the action is canonical from here.
      await persistPlayerAction();

      if (categoryLog) {
        await prisma.gameLog.create({
          data: { campaignId, role: "system", content: categoryLog },
        });
      }

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
          actorArmorPenalty: armorPenaltyFor({
            inventory: context.character.inventory,
            characterClass: context.character.class,
          }).applies,
          targetCombatants: targets,
          weaponName: foundWeapon?.name || "Unarmed",
          weaponDice: attack.weaponDice,
          damageType: attack.damageType as DamageType,
          attackModifier: attack.attackModifier,
          flatDamageBonus: attack.flatDamageBonus,
          weaponQualities: attack.qualities,
          playerCharacterId: context.character.id,
        }, tx as Prisma.TransactionClient);

        await writeSystemLogs(tx as Prisma.TransactionClient, campaignId, attackOutcome.systemLogs);

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
      const moverSize: SizeCategory = toSizeCategory(playerCombatant.size);

      const otherCombatants: GridCombatant[] = context.activeEncounter.combatants
        .filter(c => c.id !== playerCombatant.id)
        .map(c => ({
          id: c.id,
          x: c.x,
          y: c.y,
          size: toSizeCategory(c.size),
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
      // Distance and collision have both cleared, so the move is legal and the
      // action is canonical.
      await persistPlayerAction();

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

      // SRD: armour you lack proficiency with gives disadvantage on any check
      // that involves Strength or Dexterity — four of the eighteen skills. It is
      // passed as a value rather than modelled as a condition: an unproficient
      // wearer is not an SRD condition, and a CONDITION_REGISTRY entry would
      // leak into everywhere conditions are listed and narrated.
      const armorPenalty = armorPenaltyFor({
        inventory: charData.inventory,
        characterClass: charData.class,
      });
      const armorDisadvantage =
        armorPenalty.applies && penalisedByArmor(intent.skill);

      // SRD: armour marked "Stealth: Disadvantage" costs its wearer the Stealth
      // check, whether or not they are proficient with it — a different rule
      // from the one above, which is why it is a second term and not a widening
      // of the first. A proficient fighter in chain mail takes this one alone.
      const stealthDisadvantage = stealthDisadvantageFor({
        inventory: charData.inventory,
        skill: intent.skill,
      });

      // A worn item can grant advantage. Passed beside the condition result
      // rather than folded into it for the same reason the armour penalty is:
      // an equipped item is not an SRD condition, and a CONDITION_REGISTRY
      // entry would leak into everywhere conditions are listed and narrated.
      // The two cancel inside resolveAbilityCheck, per the SRD.
      const itemAdvantage = abilityCheckAdvantageFrom({
        inventory: charData.inventory,
        skill: intent.skill,
      });

      // Who, if anyone, is resisting. The rules table is consulted again rather
      // than carried on the intent: which creature opposes a shove is a rules
      // question, and the AI layer's schema should not be the place it lives.
      // matchImprovisedAction normalises its input, so this lookup and the
      // parser's agree by construction.
      const opposedBy = matchImprovisedAction(trimmedAction)?.action.opposedBy;

      // A creature that is unaware of its surroundings resists nothing: an
      // unconscious sentry sets no difficulty for sneaking past it. Only the two
      // conditions the SRD describes that way are excluded — a stunned guard
      // cannot act but is still watching.
      const candidates = (context.activeEncounter?.combatants ?? []).filter(
        (c) =>
          !c.isPlayer &&
          c.hp > 0 &&
          !isUnawareOfSurroundings(extractConditions(c.conditions))
      );

      // "observers" is anyone who might notice; "target" is the one creature the
      // action names, since the SRD contests a pickpocket against the mark and a
      // lie against the listener, not against the sharpest bystander. A named
      // target that matches no one, or more than one, falls back to the band
      // rather than contesting against a guess — the rule the attack gate uses.
      let resisting: typeof candidates = [];
      if (opposedBy?.scope === "observers") {
        resisting = candidates;
      } else if (opposedBy?.scope === "target") {
        if (intent.targetName) {
          const needle = intent.targetName.toLowerCase();
          const named = candidates.filter((c) => c.name.toLowerCase().includes(needle));
          if (named.length === 1) resisting = named;
        } else if (candidates.length === 1) {
          // Unnamed but unambiguous: only one creature it could be.
          resisting = candidates;
        }
      }

      const opponents = resisting.map(
        (c) => (c.stats ?? {}) as Partial<Record<Ability, number>>
      );

      const result = resolveAbilityCheck(
        {
          skill: intent.skill,
          band: intent.band,
          advantage: advantage || itemAdvantage,
          disadvantage: disadvantage || armorDisadvantage || stealthDisadvantage,
          ...(opposedBy && opponents.length > 0
            ? { opposition: { opponents, skills: opposedBy.skills } }
            : {}),
        },
        {
          stats: (charData.stats ?? {}) as Partial<Record<Ability, number>>,
          level: charData.level,
          skillProficiencies: parseSkillProficiencies(charData.skillProficiencies),
        }
      );

      // The check has resolved; the action is canonical. Written before the
      // line below so the transcript reads as the attempt and then its result,
      // not a die rolled for nothing.
      await persistPlayerAction();

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
            ` = ${result.total} vs DC ${result.dc} ` +
            `(${result.dcSource === "contest" ? "contested" : result.band}) → ` +
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

      // SRD: armour you lack proficiency with stops you casting altogether — a
      // refusal, not a penalty. It comes before any resolution so that a refused
      // cast spends no slot, rolls nothing, and never reaches the narrator.
      const castArmorPenalty = armorPenaltyFor({
        inventory: context.character.inventory,
        characterClass: context.character.class,
      });
      if (castArmorPenalty.applies) {
        // Declared rather than silent, the way an unenforceable spell range and
        // an unresolved weapon category already are.
        await prisma.gameLog.create({
          data: {
            campaignId,
            role: "system",
            content:
              `⚠️ Casting refused: ${context.character.name} is using ` +
              `${describeArmorPenalty(castArmorPenalty)} without proficiency, and the ` +
              `SRD forbids casting with gear you cannot use.`,
          },
        });
        return NextResponse.json(
          {
            error:
              `You cannot cast while using ${describeArmorPenalty(castArmorPenalty)} ` +
              `you are not proficient with.`,
          },
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

      // ── Who the spell reaches ───────────────────────────────────────────────
      // An area spell's targets are not the caller's to choose. The SRD says the
      // area decides, so the client's list can at most say where to aim.
      if (effect.unsupportedAreaType) {
        return NextResponse.json(
          {
            error:
              `${effect.name} has an area of type "${effect.unsupportedAreaType}", which the ` +
              `rules engine does not know how to resolve.`,
          },
          { status: 400 }
        );
      }

      const encounterCombatants = context.activeEncounter?.combatants ?? [];
      const asGrid = (c: ContextCombatant) => ({
        id: c.id,
        x: c.x,
        y: c.y,
        size: toSizeCategory(c.size),
        name: c.name,
      });

      const isSelfSpell = effect.range.kind === "self";

      // The creature(s) the client selected, computed once and shared by aim
      // derivation below and the non-area target set further down — the two
      // used to run this same filter separately and disagree about which of
      // targetIds/targetName took precedence when both were present. An
      // explicit id list wins because the player chose those directly; the
      // name path keeps every match here, since aim derivation still needs the
      // count to detect an ambiguous point of origin.
      const selectedByIds = body.targetIds?.length
        ? encounterCombatants.filter((c) => body.targetIds!.includes(c.id))
        : null;
      const selectedByName = !selectedByIds && intent.targetName
        ? encounterCombatants.filter((c) =>
            c.name.toLowerCase().includes(intent.targetName!.toLowerCase())
          )
        : null;

      // Aim: an explicit square wins; otherwise the selected creature's
      // square. Skipped entirely for a caster-only spell — it has no point to
      // choose, and the client's coordinates or selection must not redirect
      // it; the aim is forced to the caster's own square below instead. The
      // search covers every combatant, not only living hostiles — centring a
      // blast on an ally or a fallen creature is a legal aim.
      let aim: { x: number; y: number } | null = null;
      if (!isSelfSpell) {
        if (Number.isInteger(body.targetX) && Number.isInteger(body.targetY)) {
          aim = { x: body.targetX!, y: body.targetY! };
        } else {
          const named = selectedByIds ?? selectedByName ?? [];

          // Several candidates and no coordinates: where the caster meant to aim
          // is unknowable, so refuse rather than pick one. Distinct from "no aim
          // at all" because the fix differs — name one creature, or send a square.
          if (effect.area && named.length > 1) {
            return NextResponse.json(
              {
                error:
                  "That names more than one creature, so the point of origin is ambiguous. " +
                  "Name a single creature or pick a square.",
                code: "AIM_AMBIGUOUS",
              },
              { status: 400 }
            );
          }
          if (named.length === 1) aim = { x: named[0]!.x, y: named[0]!.y };
        }
      }

      const casterCombatant = encounterCombatants.find((c) => c.isPlayer);

      // Both the range gate below and the area gate further down measure from
      // the caster's own square. Without one to measure from, the area branch
      // used to fall back to the map corner (0,0) and resolve with range
      // enforcement silently absent. An encounter whose player row lacks
      // `isPlayer` is a data problem, not license to skip enforcement: refuse
      // the cast rather than resolve it from a square nobody occupies.
      if (context.activeEncounter && !casterCombatant) {
        return NextResponse.json(
          { error: "Could not find your combatant in the active encounter." },
          { status: 400 }
        );
      }

      // A caster-only spell's origin is the caster, not whatever the client
      // sent — this replaces the aim derived above (always null for a self
      // spell at this point), it does not merely supplement it.
      if (isSelfSpell && casterCombatant) {
        aim = { x: casterCombatant.x, y: casterCombatant.y };
      }

      let targets: ContextCombatant[] = [];

      // The selection a non-area spell would use, needed by the range check
      // before the area branch decides anything. targetIds is honoured in
      // full — an explicit multi-select is a legitimate choice the player
      // made — but a name match is narrowed to a single creature: a name
      // matching several must not fan the spell out across all of them.
      const requestedTargets = selectedByIds ?? selectedByName?.slice(0, 1) ?? [];

      // ── Range, before anything is derived ───────────────────────────────────
      // Out of range is the more useful diagnostic and the cheaper one: deriving
      // a set first would report "the spell hit nobody" for a reach problem.
      let unenforcedRangeLog: string | null = null;
      if (casterCombatant) {
        const rangeVerdict = checkSpellRange({
          range: effect.range,
          caster: asGrid(casterCombatant),
          aim: effect.area ? aim : null,
          targets: effect.area ? [] : requestedTargets.map(asGrid),
        });

        if (!rangeVerdict.ok) {
          return NextResponse.json(
            { error: rangeVerdict.message, code: rangeVerdict.code },
            { status: 400 }
          );
        }

        if (!rangeVerdict.enforced) {
          // Declared rather than silent: a rule that did not apply and left no
          // trace is how a gap survives unnoticed. The line itself is written
          // only once the cast is confirmed to proceed — see below — so a
          // refusal from the area branch that follows does not leave a log
          // entry describing a spell that was never cast.
          unenforcedRangeLog =
            `⚠️ ${effect.name}: range not verified — the SRD records it as ` +
            `"${rangeVerdict.raw ?? "missing"}", which carries no measurable distance.`;
        }
      }

      if (isSelfSpell && !effect.area) {
        // No area and no selection to compute: a caster-only spell reaches
        // only the caster, whatever targetIds the client sent.
        targets = casterCombatant ? [casterCombatant] : [];
      } else if (effect.area && context.activeEncounter) {
        const outcome = resolveAreaTargets({
          area: effect.area,
          aim,
          // casterCombatant is guaranteed here: an active encounter with no
          // caster already returned 400 above.
          caster: { x: casterCombatant!.x, y: casterCombatant!.y },
          combatants: encounterCombatants.map(asGrid),
        });

        if (!outcome.ok) {
          return NextResponse.json(
            { error: outcome.message, code: outcome.code },
            { status: 400 }
          );
        }

        const hitIds = new Set(outcome.targets.map((t) => t.id));
        targets = encounterCombatants.filter((c) => hitIds.has(c.id));
      } else {
        // Spells with no area still take the caller's selection: the SRD cache
        // stores no target count, so there is no field to validate against.
        // Recorded as a remaining leak in the design doc.
        targets = requestedTargets;
      }

      // The cast is going ahead: now, and only now, is the action canonical and
      // an unenforceable range worth declaring in the log.
      await persistPlayerAction();

      if (unenforcedRangeLog) {
        await prisma.gameLog.create({
          data: { campaignId, role: "system", content: unenforcedRangeLog },
        });
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

        await writeSystemLogs(tx as Prisma.TransactionClient, campaignId, spellOutcome.systemLogs);

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

      // Ownership is proven, so the action is canonical.
      await persistPlayerAction();

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

          healingDice: consumableProps?.healingDice,
          healingBonus: consumableProps?.healingBonus,
          playerCharacterId: context.character.id,
        }, tx as Prisma.TransactionClient);

        await writeSystemLogs(tx as Prisma.TransactionClient, campaignId, itemOutcome.systemLogs);

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

      const { slot: targetSlot } = slotFor(foundItem);

      // Ownership is proven, so the action is canonical.
      await persistPlayerAction();

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

      const charStats = context.character.stats as Record<string, number>;
      const playerCombatant = context.activeEncounter.combatants.find(c => c.isPlayer);
      const playerConditions = extractConditions(playerCombatant?.conditions);

      const attack = await resolveWeaponAttack({
        weapon: { name: foundWeapon.name, properties: foundWeapon.properties },
        stats: charStats,
        characterClass: context.character.class,
        level: context.character.level,
        fallbackDamageType: "slashing",
      });

      const categoryLog = unresolvedCategoryLog({
        weaponName: foundWeapon.name,
        attack,
      });

      // Exactly one living hostile target and a weapon to swing: the attack is
      // canonical from here.
      await persistPlayerAction();

      if (categoryLog) {
        await prisma.gameLog.create({
          data: { campaignId, role: "system", content: categoryLog },
        });
      }

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
          actorArmorPenalty: armorPenaltyFor({
            inventory: context.character.inventory,
            characterClass: context.character.class,
          }).applies,
          targetCombatants: targets,
          weaponName: foundWeapon.name,
          weaponDice: attack.weaponDice,
          damageType: attack.damageType as DamageType,
          attackModifier: attack.attackModifier,
          flatDamageBonus: attack.flatDamageBonus,
          weaponQualities: attack.qualities,
          playerCharacterId: context.character.id,
        }, tx as Prisma.TransactionClient);

        await writeSystemLogs(tx as Prisma.TransactionClient, campaignId, attackOutcome.systemLogs);

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

      // A rest has no refusal path: the gate resolves whatever state it finds.
      await persistPlayerAction();

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

    // ── Gate: travel ────────────────────────────────────────────────────────────
    if (intent.actionType === "travel") {
      if (!intent.destination) {
        return NextResponse.json(
          { error: "A destination is required for backend resolution." },
          { status: 400 }
        );
      }

      // Travelling days away would leave a live encounter's initiative order
      // running at a place the party no longer occupies. Refuse rather than
      // hand the narrator a new location and a stale fight on the next turn.
      if (context.activeEncounter) {
        return NextResponse.json(
          { error: "You cannot march away from a fight that is still happening." },
          { status: 409 }
        );
      }

      const originId = context.currentExploration?.location?.id ?? null;
      if (!originId) {
        return NextResponse.json(
          { error: "You are nowhere to travel from yet." },
          { status: 400 }
        );
      }

      const destination = await prisma.location.findFirst({
        where: {
          campaignId,
          name: { equals: intent.destination, mode: "insensitive" },
        },
        select: { id: true, name: true, seed: true },
      });

      if (!destination) {
        const known = await prisma.location.findMany({
          where: { campaignId },
          select: { name: true },
        });
        return NextResponse.json(
          {
            error:
              `You know no place called "${intent.destination}". ` +
              `Known: ${known.map((l) => l.name).join(", ") || "nowhere yet"}.`,
          },
          { status: 400 }
        );
      }

      if (destination.id === originId) {
        return NextResponse.json(
          { error: `You are already at ${destination.name}.` },
          { status: 400 }
        );
      }

      const entryNode = await prisma.locationNode.findFirst({
        where: { locationId: destination.id },
        orderBy: { index: "asc" },
        select: { id: true },
      });
      if (!entryNode) {
        return NextResponse.json(
          { error: `${destination.name} has no way in.` },
          { status: 409 }
        );
      }

      const origin = await prisma.location.findUnique({
        where: { id: originId },
        select: { name: true, seed: true },
      });

      // fetchExplorationContext already proved originId's row exists, so this
      // is a data-consistency guard, not an expected path — but if the row
      // vanished between then and now, refuse rather than let a missing seed
      // silently fall back to the id and change the distance on the return leg.
      if (!origin) {
        return NextResponse.json(
          { error: "Your current location could not be resolved." },
          { status: 409 }
        );
      }

      // Every figure is resolved here, before anything is written or narrated.
      const stats = (context.character.stats ?? {}) as Partial<Record<string, number>>;
      const journey = resolveJourney({
        distanceMiles: travelDistanceMiles(origin.seed, destination.seed),
        forceMarch: intent.forceMarch === true,
        conModifier: abilityModifier(stats.CON ?? 10),
        currentExhaustion: context.character.exhaustionLevel,
      });

      const dayCount = journey.days === 1 ? "1 day" : `${journey.days} days`;
      const logLine = journey.forcedHours > 0
        ? `Travel: ${origin.name} → ${destination.name}, ` +
          `${journey.distanceMiles} mi forced march, ${journey.hours} h. ` +
          `Forced march: ${journey.forcedHours} h, ` +
          `DC ${journey.saves.map((s) => s.dc).join("/")} → ` +
          `${journey.saves.filter((s) => !s.success).length} failed, ` +
          `exhaustion ${context.character.exhaustionLevel} → ` +
          `${context.character.exhaustionLevel + journey.exhaustionGained}.`
        : `Travel: ${origin.name} → ${destination.name}, ` +
          `${journey.distanceMiles} mi at normal pace, ${dayCount}.`;

      // Origin, destination, entry node and journey are all resolved, and the
      // gate has no refusal left. Written before the transaction so the
      // player's line precedes the travel line it writes, and so the
      // transaction's own boundary is unchanged.
      await persistPlayerAction();

      await prisma.$transaction(async (tx) => {
        if (journey.exhaustionGained > 0) {
          await tx.character.update({
            where: { id: context.character.id },
            data: {
              exhaustionLevel:
                context.character.exhaustionLevel + journey.exhaustionGained,
            },
          });
        }

        await tx.campaign.update({
          where: { id: campaignId },
          data: { currentLocationId: destination.id, currentNodeId: entryNode.id },
        });

        await tx.gameLog.create({
          data: { campaignId, role: "system", content: logLine },
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

      // `moveToNode` writes nothing on any of its failure paths, so a refused
      // move leaves neither state nor history — and the success it just
      // reported is what makes the action canonical.
      await persistPlayerAction();

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
  // Every gate above either committed its transaction or returned a 4xx. A
  // request that reaches here is going to be narrated, so its action is
  // canonical whether or not any gate claimed it: ordinary narrative input
  // ("I look around the room") matches none, and this is the only place it can
  // be recorded. A no-op for anything a gate already logged.
  await persistPlayerAction();

  // ── The submission is mechanically settled (DC-AUD-003) ──────────────────────
  // Every gate has committed or returned, and the player's line is written. A
  // retry from here on must be told "already done" rather than re-executed.
  //
  // Deliberately BEFORE the level-up read, `streamNarrative` and the SSE
  // response: everything past this point is narration, and narration is not
  // mechanical truth. Marking after it would hold the receipt PROCESSING for
  // the whole model latency — precisely the window in which a player whose
  // connection dropped retries — so a legitimate retry would meet a 409 during
  // the exact interval this feature exists to serve.
  //
  // The consequence, accepted: COMPLETED means the mechanical outcome
  // finished, not that narration was delivered or persisted. A crash in
  // narration leaves a turn that is mechanically correct and narratively
  // silent, which is strictly better than one resolved twice.
  //
  // Unlike the level-up detection below — wrapped so a presentation failure
  // cannot fail a valid turn — a failure here propagates. Continuing into
  // narration as though the receipt had settled would leave a PROCESSING row
  // no retry could ever distinguish from a live request.
  if (receiptRef.id) {
    await completeActionReceipt(receiptRef.id);
  }

  // This is also the only safe point to check for a pending level-up: earlier would risk a
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
