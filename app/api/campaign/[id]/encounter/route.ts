import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ensureDevUser } from "@/lib/db/dev-user";
import { rollInitiative } from "@/lib/rules/combat";
import { abilityModifier } from "@/lib/rules/dice";

interface EnemyInput {
  name: string;
  hp: number;
  maxHp: number;
  dexModifier: number;
}

interface RequestBody {
  enemies: EnemyInput[];
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

function isEnemyInput(v: unknown): v is EnemyInput {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.name === "string" && o.name.trim().length > 0 &&
    typeof o.hp === "number" && o.hp > 0 &&
    typeof o.maxHp === "number" && o.maxHp > 0 &&
    typeof o.dexModifier === "number"
  );
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: campaignId } = await params;

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { enemies } = body;

  if (!Array.isArray(enemies) || enemies.length === 0) {
    return NextResponse.json(
      { error: "enemies must be a non-empty array." },
      { status: 400 }
    );
  }
  if (!enemies.every(isEnemyInput)) {
    return NextResponse.json(
      { error: "Each enemy must have name (string), hp (number > 0), maxHp (number > 0), and dexModifier (number)." },
      { status: 400 }
    );
  }

  const user = await ensureDevUser();

  // Fetch campaign with character — validates existence and ownership in one query
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

  // Guard: only one active encounter per campaign at a time
  const existingEncounter = await prisma.encounter.findFirst({
    where: { campaignId, status: "active" },
  });
  if (existingEncounter) {
    return NextResponse.json(
      { error: "An active encounter already exists for this campaign.", encounterId: existingEncounter.id },
      { status: 409 }
    );
  }

  // Derive player DEX modifier from the character's stats JSON
  const stats = campaign.character.stats as Record<string, number>;
  const playerDexMod = abilityModifier(stats.DEX ?? 10);

  // Build CombatantInput list: player first, then enemies
  // rollInitiative accepts any order — it sorts internally
  const combatantInputs = [
    {
      id: `player-${campaign.character.id}`,
      name: campaign.character.name,
      dexModifier: playerDexMod,
    },
    ...enemies.map((e, i) => ({
      id: `enemy-${i}`,
      name: e.name,
      dexModifier: e.dexModifier,
    })),
  ];

  const { order } = rollInitiative(combatantInputs);

  // Map initiative order back to full combatant data for persistence.
  // order is sorted DESC by initiativeTotal — index 0 acts first, matching
  // Encounter.currentTurnIndex default of 0.
  const combatantData = order.map((entry) => {
    const isPlayer = entry.id.startsWith("player-");
    if (isPlayer) {
      return {
        name: campaign.character.name,
        isPlayer: true,
        hp: campaign.character.hp,
        maxHp: campaign.character.maxHp,
        initiativeTotal: entry.initiative,
      };
    }
    // Recover original enemy input by stripping the "enemy-{i}" prefix
    const idx = parseInt(entry.id.replace("enemy-", ""), 10);
    const enemy = enemies[idx];
    return {
      name: enemy.name,
      isPlayer: false,
      hp: enemy.hp,
      maxHp: enemy.maxHp,
      initiativeTotal: entry.initiative,
    };
  });

  // Create encounter with all combatants in a single transaction
  const encounter = await prisma.encounter.create({
    data: {
      campaignId,
      status: "active",
      round: 1,
      currentTurnIndex: 0,
      combatants: {
        create: combatantData,
      },
    },
    include: {
      combatants: {
        orderBy: { initiativeTotal: "desc" },
      },
    },
  });

  return NextResponse.json(encounter, { status: 201 });
}
