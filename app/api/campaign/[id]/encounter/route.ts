import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ensureDevUser } from "@/lib/db/dev-user";
import { rollInitiative, acFromMonsterData, acFromInventory } from "@/lib/rules/combat";
import { abilityModifier } from "@/lib/rules/dice";

interface EnemyInput {
  name: string;
  hp: number;
  maxHp: number;
  dexModifier: number;
  /** Optional SRD monster slug (e.g. "goblin"). When provided, real HP and DEX
   *  modifier from the SrdMonster table override the caller-supplied values. */
  monsterIndex?: string;
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

  // Fetch campaign with character + inventory — validates existence and ownership,
  // and provides the inventory needed to derive player AC.
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { character: { include: { inventory: true } } },
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

  // Resolve optional monsterIndex fields: fetch real HP, DEX, and AC from SrdMonster.
  // Callers without monsterIndex are unaffected (backward compatible).
  const resolvedEnemies = await Promise.all(
    enemies.map(async (e) => {
      if (!e.monsterIndex) return { ...e, ac: 10 };
      const srdMonster = await prisma.srdMonster.findUnique({
        where: { id: e.monsterIndex },
      });
      if (!srdMonster) return { ...e, ac: 10 };
      const data = srdMonster.data as Record<string, unknown>;
      return {
        ...e,
        hp: typeof data.hit_points === "number" ? data.hit_points : e.hp,
        maxHp: typeof data.hit_points === "number" ? data.hit_points : e.maxHp,
        dexModifier:
          typeof data.dexterity === "number"
            ? abilityModifier(data.dexterity)
            : e.dexModifier,
        ac: acFromMonsterData(data),
      };
    })
  );

  // Derive player DEX modifier and AC from the character's stats and inventory
  const stats = campaign.character.stats as Record<string, number>;
  const playerDexMod = abilityModifier(stats.DEX ?? 10);
  const playerAC = acFromInventory(campaign.character.inventory, playerDexMod);

  // Build CombatantInput list: player first, then enemies
  // rollInitiative accepts any order — it sorts internally
  const combatantInputs = [
    {
      id: `player-${campaign.character.id}`,
      name: campaign.character.name,
      dexModifier: playerDexMod,
    },
    ...resolvedEnemies.map((e, i) => ({
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
        ac: playerAC,
        initiativeTotal: entry.initiative,
      };
    }
    // Recover original enemy input by stripping the "enemy-{i}" prefix
    const idx = parseInt(entry.id.replace("enemy-", ""), 10);
    const enemy = resolvedEnemies[idx];
    return {
      name: enemy.name,
      isPlayer: false,
      hp: enemy.hp,
      maxHp: enemy.maxHp,
      ac: enemy.ac,
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
