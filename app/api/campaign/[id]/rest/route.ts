import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser, AuthError } from "@/lib/auth/session";
import { roll } from "@/lib/rules/dice";
import { abilityModifier } from "@/lib/rules/dice";
import { isSpellSlots, restoreAllSlots } from "@/lib/rules/magic";
import type { Prisma } from "@/app/generated/prisma/client";

interface RestBody {
  type: "long" | "short";
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Returns the hit die size for a D&D 5e 2014 character class.
 * Used to roll Hit Dice during a short rest (PHB p. 186).
 */
function hitDieForClass(characterClass: string): number {
  switch (characterClass.toLowerCase()) {
    case "barbarian":
      return 12;
    case "fighter":
    case "paladin":
    case "ranger":
      return 10;
    case "bard":
    case "cleric":
    case "druid":
    case "monk":
    case "rogue":
    case "warlock":
      return 8;
    case "sorcerer":
    case "wizard":
      return 6;
    default:
      return 8; // safe baseline
  }
}

/**
 * POST /api/campaign/[id]/rest
 *
 * Body: { type: "long" | "short" }
 *
 * Long rest (5e 2014 SRD p. 186):
 *   - HP restored to maxHp.
 *   - All spell slots restored to max.
 *
 * Short rest (5e 2014 SRD p. 186):
 *   - Roll 1 Hit Die (class-specific) + CON modifier; add to HP (capped at maxHp).
 *   - Spell slots are NOT restored.
 *
 * Guards:
 *   - Campaign must be active and belong to the dev user.
 *   - Cannot rest while an active encounter is in progress.
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: campaignId } = await params;

  let body: RestBody;
  try {
    const raw = await req.json();
    if (raw?.type !== "long" && raw?.type !== "short") {
      return NextResponse.json(
        { error: "type must be \"long\" or \"short\"." },
        { status: 400 }
      );
    }
    body = raw as RestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
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

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { character: true },
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }
  if (campaign.userId !== user.id) {
    return NextResponse.json(
      { error: "Campaign does not belong to this user." },
      { status: 403 }
    );
  }
  if (campaign.status !== "active") {
    return NextResponse.json({ error: "Campaign is not active." }, { status: 409 });
  }

  // Guard: cannot rest while combat is in progress (5e RAW)
  const activeEncounter = await prisma.encounter.findFirst({
    where: { campaignId, status: "active" },
  });
  if (activeEncounter) {
    return NextResponse.json(
      { error: "Cannot rest during an active encounter." },
      { status: 409 }
    );
  }

  const character = campaign.character;

  if (body.type === "long") {
    // Long rest: full HP, all spell slots restored
    const rawSlots = character.spellSlots;
    const restoredSlots = isSpellSlots(rawSlots) ? restoreAllSlots(rawSlots) : rawSlots;

    const updated = await prisma.character.update({
      where: { id: character.id },
      data: {
        hp: character.maxHp,
        ...(restoredSlots !== null && restoredSlots !== undefined
          ? { spellSlots: restoredSlots as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });

    return NextResponse.json(
      {
        restType: "long",
        hpBefore: character.hp,
        hpAfter: updated.hp,
        slotsRestored: isSpellSlots(rawSlots),
        character: {
          id: updated.id,
          hp: updated.hp,
          maxHp: updated.maxHp,
          spellSlots: updated.spellSlots,
        },
      },
      { status: 200 }
    );
  }

  // Short rest: roll 1 Hit Die + CON modifier, add to HP (capped at maxHp)
  const stats = character.stats as Record<string, number>;
  const conMod = abilityModifier(stats.CON ?? 10);
  const hitDie = hitDieForClass(character.class);
  const diceExpression = `1d${hitDie}`;

  const rolled = roll(diceExpression).total;
  const healing = Math.max(1, rolled + conMod); // floor of 1 — CON penalty never makes rest harmful
  const hpBefore = character.hp;
  const hpAfter = Math.min(character.maxHp, character.hp + healing);

  const updated = await prisma.character.update({
    where: { id: character.id },
    data: { hp: hpAfter },
  });

  return NextResponse.json(
    {
      restType: "short",
      hitDie: diceExpression,
      rolled,
      conMod,
      healing,
      hpBefore,
      hpAfter: updated.hp,
      character: {
        id: updated.id,
        hp: updated.hp,
        maxHp: updated.maxHp,
        spellSlots: updated.spellSlots,
      },
    },
    { status: 200 }
  );
}
