/**
 * POST /api/campaign/[id]/encounter — the SRD snapshot a combatant carries.
 *
 * spawnCombatEncounter snapshots a monster's damage modifiers and condition
 * immunities, and has no production caller. This route is the live spawn
 * path, and it wrote none of them: every creature in real play fought with no
 * resistance, no immunity and no condition immunity, however carefully the
 * rules that read those columns were built. It also now snapshots the SRD
 * creature type, which Hold Person and Hold Monster read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/campaign/[id]/encounter/route";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    encounter: { findFirst: vi.fn() },
    srdMonster: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: vi.fn(),
  AuthError: class extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "AuthError";
    }
  },
}));

const CAMPAIGN_ID = "camp_1";
const USER = { id: "user_1" };
const CAMPAIGN = {
  id: CAMPAIGN_ID,
  userId: USER.id,
  status: "active",
  character: {
    id: "char_1",
    name: "Aldric",
    hp: 18,
    maxHp: 20,
    stats: { DEX: 14, WIS: 12 },
    concentrationSpellId: null,
    inventory: [],
  },
};

/** The shape the SrdMonster.data column actually holds — verified against the
 *  live table: no `ability_scores` key, flat `wisdom` / `dexterity` fields. */
const OGRE_DATA = {
  hit_points: 45,
  armor_class: [{ type: "natural", value: 11 }],
  strength: 19,
  dexterity: 8,
  constitution: 16,
  intelligence: 5,
  wisdom: 7,
  charisma: 7,
};

function post(body: unknown): Promise<Response> {
  const req = new NextRequest(`http://localhost/api/campaign/${CAMPAIGN_ID}/encounter`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id: CAMPAIGN_ID }) });
}

function mockTransaction(): {
  createMany: ReturnType<typeof vi.fn>;
  zoneCreate: ReturnType<typeof vi.fn>;
  encounterFindUnique: ReturnType<typeof vi.fn>;
} {
  let combatants: any[] = [];
  const createMany = vi.fn(async ({ data }: any) => {
    combatants = data;
    return { count: data.length };
  });
  const zoneCreate = vi.fn(async ({ data }: any) => ({
    id: `zone_${data.x}_${data.y}`,
    ...data,
  }));
  const encounterFindUnique = vi.fn(async () => ({ id: "enc_1", combatants }));
  (prisma.$transaction as any).mockImplementation(async (cb: any) => {
    const tx = {
      encounter: {
        create: vi.fn(async () => ({ id: "enc_1" })),
        findUnique: encounterFindUnique,
      },
      zone: {
        create: zoneCreate,
      },
      combatant: { createMany },
    };
    return cb(tx);
  });
  return { createMany, zoneCreate, encounterFindUnique };
}

function persisted(createMany: ReturnType<typeof vi.fn>): any[] {
  return createMany.mock.calls[0][0].data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  (getAuthUser as any).mockResolvedValue(USER);
  (prisma.campaign.findUnique as any).mockResolvedValue(CAMPAIGN);
  (prisma.encounter.findFirst as any).mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/campaign/[id]/encounter — SRD snapshot", () => {
  it("persists the monster's creature type, damage modifiers and condition immunities", async () => {
    const { createMany } = mockTransaction();
    (prisma.srdMonster.findUnique as any).mockResolvedValue({
      id: "srd-zombie",
      xp: 50,
      type: "undead",
      damageImmunities: ["poison"],
      damageResistances: [],
      damageVulnerabilities: [],
      conditionImmunities: ["poisoned"],
      data: OGRE_DATA,
    });

    const res = await post({
      enemies: [{ name: "Zombie", hp: 22, maxHp: 22, dexModifier: -2, monsterIndex: "srd-zombie" }],
    });

    expect(res.status).toBe(201);
    const enemy = persisted(createMany).find((c: any) => !c.isPlayer);
    expect(enemy).toMatchObject({
      creatureType: "undead",
      damageImmunities: ["poison"],
      damageResistances: [],
      damageVulnerabilities: [],
      conditionImmunities: ["poisoned"],
    });
  });

  it("records the player as a humanoid", async () => {
    const { createMany } = mockTransaction();

    await post({ enemies: [{ name: "Goblin", hp: 7, maxHp: 7, dexModifier: 2 }] });

    const player = persisted(createMany).find((c: any) => c.isPlayer);
    expect(player.creatureType).toBe("humanoid");
  });

  it("claims no type and no modifiers for an enemy with no SRD record", async () => {
    const { createMany } = mockTransaction();

    await post({ enemies: [{ name: "Goblin", hp: 7, maxHp: 7, dexModifier: 2 }] });

    const enemy = persisted(createMany).find((c: any) => !c.isPlayer);
    expect(enemy).toMatchObject({
      creatureType: null,
      damageImmunities: [],
      damageResistances: [],
      damageVulnerabilities: [],
      conditionImmunities: [],
    });
  });
});
