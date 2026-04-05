import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ensureDevUser } from "@/lib/db/dev-user";
import { roll } from "@/lib/rules/dice";
import { validateAttackRange } from "@/lib/rules/combat";
import type { WeaponRange } from "@/lib/rules/combat";
import type { Zone } from "@/lib/rules/spatial";
import { generateNarrative } from "@/lib/ai/narrator";
import { buildCampaignContext } from "@/lib/memory/context";
import { formatSystemPrompt } from "@/lib/memory/formatter";
import { parseIntent } from "@/lib/ai/intent";
import { summarizeAndStore } from "@/lib/memory/consolidator";
import { isSpellSlots, hasAvailableSlot, consumeSlot } from "@/lib/rules/magic";
import { getItemProperties } from "@/lib/rules/inventory";
import type { Prisma } from "@/app/generated/prisma/client";

interface ActionBody {
  action: string;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

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

  const user = await ensureDevUser();

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

  // Step 2 (Milestone B): Detect and resolve /roll commands
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

  // Milestone D: Build context and parse structured intent
  const context = await buildCampaignContext(campaignId);
  const systemContext = formatSystemPrompt(context);
  const intent = await parseIntent(trimmedAction, systemContext);

  // "Code is Law" — spell gate: validate and deduct slot before narration
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

    const updatedSlots = consumeSlot(rawSlots, intent.spellLevel);

    await prisma.character.update({
      where: { id: context.character.id },
      data: { spellSlots: updatedSlots as unknown as Prisma.InputJsonValue },
    });
  }

  // "Code is Law" — item gate: validate inventory and apply consumable effects before narration
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
    }
  }

  // "Code is Law" — attack gate: validate encounter, target, and weapon before narration
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

    // "Code is Law" — range gate: resolve spatial validity BEFORE dice roll or narration.
    // Zones are stored as Zone[] JSON on the Encounter; combatants carry currentZoneId.
    // If either zone is null (encounter has no zone graph), the check is skipped.
    const weaponRange: WeaponRange =
      weaponProps.range === "ranged" ? "ranged" : "melee";

    const encounterZones = (context.activeEncounter.zones ?? []) as Zone[];

    if (encounterZones.length > 0) {
      // Find the player combatant row (isPlayer === true) within the active encounter.
      const playerCombatant = context.activeEncounter.combatants.find(
        (c) => c.isPlayer
      );

      const attackerZoneId = playerCombatant?.currentZoneId ?? null;
      const targetZoneId   = targetCombatant.currentZoneId ?? null;

      const attackerZone = attackerZoneId
        ? (encounterZones.find((z) => z.id === attackerZoneId) ?? null)
        : null;
      const targetZone = targetZoneId
        ? (encounterZones.find((z) => z.id === targetZoneId) ?? null)
        : null;

      const rangeResult = validateAttackRange(attackerZone, targetZone, weaponRange);
      if (!rangeResult.valid) {
        return NextResponse.json(
          { error: rangeResult.reason },
          { status: 400 }
        );
      }
    }

    const damage = roll(weaponProps.damageDice).total + (weaponProps.damageBonus ?? 0);
    const newHp = Math.max(0, targetCombatant.hp - damage);

    await prisma.combatant.update({
      where: { id: targetCombatant.id },
      data: { hp: newHp },
    });
  }

  // State is now safely mutated. Generate and persist the narrative.
  const narrative = await generateNarrative(campaignId, trimmedAction);

  const assistantLog = await prisma.gameLog.create({
    data: {
      campaignId,
      role: "assistant",
      content: narrative,
    },
  });

  // Background memory consolidation — every 5 complete turns (assistant logs).
  // Runs entirely inside after() so the embedding + LLM work never delays the
  // HTTP response. The count check and log fetch are also deferred: even a
  // fast indexed query should not add latency to the player's action loop.
  after(async () => {
    try {
      const turnCount = await prisma.gameLog.count({
        where: { campaignId, role: "assistant" },
      });

      if (turnCount % 5 === 0) {
        // Fetch the 10 most recent logs and reverse to chronological order
        // so the consolidator receives them oldest-first.
        const logsDesc = await prisma.gameLog.findMany({
          where: { campaignId },
          orderBy: { createdAt: "desc" },
          take: 10,
        });
        await summarizeAndStore(campaignId, logsDesc.reverse());
      }
    } catch (err) {
      console.error("[action] Background memory consolidation failed:", err);
    }
  });

  return NextResponse.json(assistantLog, { status: 200 });
}
