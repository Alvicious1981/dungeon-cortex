import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser, AuthError } from "@/lib/auth/session";
import { rollInitiative, acFromMonsterData } from "@/lib/rules/combat";
import { armorClassFor } from "@/lib/rules/armor-class";
import { abilityModifier } from "@/lib/rules/dice";
import {
  monsterAbilityScores,
  type MonsterAbilityFields,
} from "@/lib/rules/encounter-service";

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

  // Resolve HP, DEX, AC, and the backend-authorized XP snapshot for enemies from SRD or inputs.
  // `srdXp` is assigned after every spread of the client-supplied `e` below, so no request field
  // can ever populate it — it always reflects only what the backend itself resolved.
  const resolvedEnemies = await Promise.all(
    enemies.map(async (e) => {
      // No SRD record to draw from, so every score is the 10 average rather
      // than a partial block. A missing WIS used to leave the creature with no
      // Perception at all, which any contested check reads as "unknown".
      if (!e.monsterIndex) {
        return { ...e, ac: 10, stats: monsterAbilityScores({}), srdXp: null };
      }
      const srdMonster = await prisma.srdMonster.findUnique({
        where: { id: e.monsterIndex },
      });
      if (!srdMonster) {
        return { ...e, ac: 10, stats: monsterAbilityScores({}), srdXp: null };
      }
      const data = srdMonster.data as Record<string, unknown>;
      // The stored SRD JSON spells ability scores as flat top-level fields
      // ("wisdom": 15), exactly as the `dexterity` read below already assumes.
      // Reading a nested `ability_scores` object found nothing, every time, so
      // each enemy was persisted with an empty stat block.
      const abilityScores = monsterAbilityScores(data as MonsterAbilityFields);
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
        srdXp: srdMonster.xp ?? null,
      };
    })
  );

  const stats = campaign.character.stats as Record<string, number>;
  const playerDexMod = abilityModifier(stats.DEX ?? 10);
  const playerAC = armorClassFor({
    inventory: campaign.character.inventory,
    dexModifier: playerDexMod,
  }).armorClass;

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

  // Define spatial scaling
  const totalCombatants = combatantInputs.length;
  const mapSize = totalCombatants > 9 ? 5 : 3;
  const centerX = Math.floor(mapSize / 2);
  const centerY = Math.floor(mapSize / 2);

  // Available slots for enemies (all cells except center)
  const enemySlots: Array<{ x: number; y: number }> = [];
  for (let x = 0; x < mapSize; x++) {
    for (let y = 0; y < mapSize; y++) {
      if (x === centerX && y === centerY) continue;
      enemySlots.push({ x, y });
    }
  }

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

    // 2. Create Zones (Grid Cells)
    const zonesToCreate = [];
    for (let x = 0; x < mapSize; x++) {
      for (let y = 0; y < mapSize; y++) {
        zonesToCreate.push({
          encounterId: e.id,
          name: `z_${x}_${y}`,
          x,
          y,
        });
      }
    }

    // Using a loop to ensure we have the created objects with IDs
    const createdZones = await Promise.all(
      zonesToCreate.map((z) => tx.zone.create({ data: z }))
    );

    // Map coordinates to zone IDs for fast lookup
    const zoneMap: Record<string, string> = {};
    createdZones.forEach((z) => {
      zoneMap[`${z.x},${z.y}`] = z.id;
    });

    // 3. Prepare Combatant Data with spatial placement tied to zoneId
    let enemyIdx = 0;
    const combatantData = order.map((entry) => {
      const isPlayer = entry.id === "player";
      let posX, posY;

      if (isPlayer) {
        posX = centerX;
        posY = centerY;
      } else {
        const slot = enemySlots[enemyIdx % enemySlots.length];
        posX = slot.x;
        posY = slot.y;
        enemyIdx++;
      }
      
      const zoneId = zoneMap[`${posX},${posY}`];
      
      if (isPlayer) {
        return {
          encounterId: e.id,
          zoneId,
          name: campaign.character.name,
          isPlayer: true,
          hp: campaign.character.hp,
          maxHp: campaign.character.maxHp,
          ac: playerAC,
          initiativeTotal: entry.initiative,
          stats: campaign.character.stats || {},
          concentrationSpellId: campaign.character.concentrationSpellId,
          x: posX,
          y: posY,
          // The player is never a source of the combat XP award (§7 of the decision only
          // sums isPlayer === false combatants), so it never carries an authorized value.
          xpValue: null,
        };
      }

      const idx = parseInt(entry.id.replace("enemy-", ""), 10);
      const enemy = resolvedEnemies[idx];

      return {
        encounterId: e.id,
        zoneId,
        name: enemy.name,
        isPlayer: false,
        hp: enemy.hp,
        maxHp: enemy.maxHp,
        ac: enemy.ac,
        initiativeTotal: entry.initiative,
        stats: enemy.stats || {},
        x: posX,
        y: posY,
        // Backend-authorized snapshot resolved above; never derived from the request body.
        xpValue: enemy.srdXp,
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
        zones: { orderBy: [{ x: "asc" }, { y: "asc" }] },
      },
    });
  });

  return NextResponse.json(encounter, { status: 201 });
}
