import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser, AuthError } from "@/lib/auth/session";
import { rollInitiative, acFromMonsterData, acFromInventory } from "@/lib/rules/combat";
import { abilityModifier } from "@/lib/rules/dice";
import {
  findAvailablePosition,
  normalizeSizeCategory,
  type GridCombatant,
  type SizeCategory,
  type TacticalMap,
} from "@/lib/rules/geometry";

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

function allocateEncounterPositions(enemySizes: SizeCategory[]): {
  map: TacticalMap;
  positions: Map<string, GridCombatant>;
} {
  const occupiedSquares = 1 + enemySizes.reduce((total, size) => {
    const side = size === "Large" ? 2 : size === "Huge" ? 3 : size === "Gargantuan" ? 4 : 1;
    return total + side * side;
  }, 0);
  let dimension = Math.max(10, Math.ceil(Math.sqrt(occupiedSquares)) + 2);

  for (;;) {
    const map: TacticalMap = {
      gridType: "SQUARE",
      width: dimension,
      height: dimension,
      cellSize: 5,
    };
    const player: GridCombatant = {
      id: "player",
      x: Math.floor(dimension / 2),
      y: Math.floor(dimension / 2),
      size: "Medium",
    };
    const placed: GridCombatant[] = [player];

    for (const [index, size] of enemySizes.entries()) {
      const position = findAvailablePosition(map, size, placed);
      if (!position) break;
      placed.push({ id: `enemy-${index}`, ...position, size });
    }

    if (placed.length === enemySizes.length + 1) {
      return { map, positions: new Map(placed.map((combatant) => [combatant.id, combatant])) };
    }
    dimension += 2;
  }
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
      { error: "Each enemy must have name, hp, maxHp, and dexModifier." },
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

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { character: { include: { inventory: true } } },
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }
  if (campaign.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  if (campaign.status !== "active") {
    return NextResponse.json({ error: "Campaign is not active." }, { status: 409 });
  }

  const existingEncounter = await prisma.encounter.findFirst({
    where: { campaignId, status: "active" },
  });
  if (existingEncounter) {
    return NextResponse.json(
      { error: "An active encounter already exists.", encounterId: existingEncounter.id },
      { status: 409 }
    );
  }

  // Resolve HP, DEX, and AC for enemies from SRD or inputs
  const resolvedEnemies = await Promise.all(
    enemies.map(async (e) => {
      if (!e.monsterIndex) return { ...e, ac: 10, stats: { DEX: 10, CON: 10 }, size: "Medium" as const };
      const srdMonster = await prisma.srdMonster.findUnique({
        where: { id: e.monsterIndex },
      });
      if (!srdMonster) return { ...e, ac: 10, stats: { DEX: 10, CON: 10 }, size: "Medium" as const };
      const data = srdMonster.data as Record<string, unknown>;
      const abilityScores = (data.ability_scores || {}) as Record<string, number>;
      const size = normalizeSizeCategory(String(data.size ?? srdMonster.size ?? "Medium"));
      return {
        ...e,
        hp: typeof data.hit_points === "number" ? data.hit_points : e.hp,
        maxHp: typeof data.hit_points === "number" ? data.hit_points : e.maxHp,
        dexModifier:
          typeof data.dexterity === "number"
            ? abilityModifier(data.dexterity)
            : e.dexModifier,
        ac: acFromMonsterData(data),
        stats: abilityScores,
        size,
      };
    })
  );

  const stats = campaign.character.stats as Record<string, number>;
  const playerDexMod = abilityModifier(stats.DEX ?? 10);
  const playerAC = acFromInventory(campaign.character.inventory, playerDexMod);

  const combatantInputs = [
    {
      id: "player",
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

  const { map, positions } = allocateEncounterPositions(
    resolvedEnemies.map((enemy) => enemy.size)
  );

  // Transaction for atomic spatial initialization
  const encounter = await prisma.$transaction(async (tx) => {
    // 1. Create Encounter
    const e = await tx.encounter.create({
      data: {
        campaignId,
        status: "active",
        round: 1,
        currentTurnIndex: 0,
      },
    });

    // 2. Persist one authoritative tactical map.
    await tx.encounterMap.create({
      data: {
        encounterId: e.id,
        gridType: map.gridType,
        width: map.width,
        height: map.height,
        cellSize: map.cellSize,
      },
    });

    // 3. Prepare combatants at deterministic, non-overlapping coordinates.
    const combatantData = order.map((entry) => {
      const isPlayer = entry.id === "player";
      const placement = positions.get(entry.id)!;
      
      if (isPlayer) {
        return {
          encounterId: e.id,
          name: campaign.character.name,
          isPlayer: true,
          hp: campaign.character.hp,
          maxHp: campaign.character.maxHp,
          ac: playerAC,
          initiativeTotal: entry.initiative,
          stats: campaign.character.stats || {},
          concentrationSpellId: campaign.character.concentrationSpellId,
          size: placement.size,
          x: placement.x,
          y: placement.y,
        };
      }
      
      const idx = parseInt(entry.id.replace("enemy-", ""), 10);
      const enemy = resolvedEnemies[idx];

      return {
        encounterId: e.id,
        name: enemy.name,
        isPlayer: false,
        hp: enemy.hp,
        maxHp: enemy.maxHp,
        ac: enemy.ac,
        initiativeTotal: entry.initiative,
        stats: enemy.stats || {},
        size: enemy.size,
        x: placement.x,
        y: placement.y,
      };
    });

    // 4. Create Combatants
    await tx.combatant.createMany({
      data: combatantData,
    });

    // 5. Return complete graph
    return tx.encounter.findUnique({
      where: { id: e.id },
      include: {
        combatants: { orderBy: { initiativeTotal: "desc" } },
        map: true,
      },
    });
  });

  return NextResponse.json(encounter, { status: 201 });
}
