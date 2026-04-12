import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser, AuthError } from "@/lib/auth/session";
import { CLASS_HIT_DICE, ABILITY_SCORES, type AbilityScore } from "@/lib/dnd-api/constants";

interface CreateCharacterBody {
  name: string;
  race: string;
  class: string;
  stats: Record<AbilityScore, number>;
}

function conModifier(con: number): number {
  return Math.floor((con - 10) / 2);
}

function calcMaxHp(classIndex: string, con: number): number {
  const hitDie = CLASS_HIT_DICE[classIndex.toLowerCase()] ?? 8;
  return hitDie + conModifier(con);
}

function validateStats(stats: unknown): stats is Record<AbilityScore, number> {
  if (!stats || typeof stats !== "object") return false;
  return ABILITY_SCORES.every(
    (key) =>
      key in (stats as Record<string, unknown>) &&
      typeof (stats as Record<string, unknown>)[key] === "number"
  );
}

export async function POST(req: NextRequest) {
  let body: CreateCharacterBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { name, race, stats } = body;
  const characterClass = body.class;

  if (!name?.trim()) {
    return NextResponse.json({ error: "name is required." }, { status: 400 });
  }
  if (!race?.trim()) {
    return NextResponse.json({ error: "race is required." }, { status: 400 });
  }
  if (!characterClass?.trim()) {
    return NextResponse.json({ error: "class is required." }, { status: 400 });
  }
  if (!validateStats(stats)) {
    return NextResponse.json(
      { error: "stats must include numeric values for STR, DEX, CON, INT, WIS, CHA." },
      { status: 400 }
    );
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
  const maxHp = calcMaxHp(characterClass, stats.CON);

  const SPELLCASTING_CLASSES = ["wizard", "cleric", "sorcerer"];
  const spellSlots = SPELLCASTING_CLASSES.includes(characterClass.trim().toLowerCase())
    ? { "1": { current: 2, max: 2 } }
    : undefined;

  const character = await prisma.character.create({
    data: {
      userId: user.id,
      name: name.trim(),
      race: race.trim(),
      class: characterClass.trim(),
      level: 1,
      hp: maxHp,
      maxHp,
      stats,
      spellSlots,
      inventory: {
        create: [
          {
            name: "Longsword",
            type: "weapon",
            quantity: 1,
            properties: { damageDice: "1d8", damageBonus: 0, damageType: "slashing" },
          },
          {
            name: "Health Potion",
            type: "consumable",
            quantity: 2,
            properties: { healingDice: "2d4", healingBonus: 2 },
          },
        ],
      },
    },
  });

  return NextResponse.json({ id: character.id }, { status: 201 });
}
