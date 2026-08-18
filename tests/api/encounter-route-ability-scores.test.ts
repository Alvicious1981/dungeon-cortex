/**
 * POST /api/campaign/[id]/encounter — Combatant.stats contract.
 *
 * The route read ability scores from a nested `data.ability_scores` object that
 * the stored SRD JSON does not have: the scores are flat top-level fields
 * ("wisdom": 15), exactly as the route's own `data.dexterity` read assumes. The
 * lookup therefore found nothing every time and each enemy was persisted with
 * an empty stat block.
 *
 * That was harmless while nothing read Combatant.stats. It stopped being
 * harmless once contested checks derived their DC from it: a creature with no
 * recorded Wisdom resists at passive 10, so hiding from an Aboleth resolved at
 * DC 10 instead of DC 12 — easier than hiding with nobody in the room.
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
const ABOLETH_DATA = {
  hit_points: 135,
  armor_class: [{ type: "natural", value: 17 }],
  strength: 21,
  dexterity: 9,
  constitution: 15,
  intelligence: 18,
  wisdom: 15,
  charisma: 18,
};

function post(body: unknown): Promise<Response> {
  const req = new NextRequest(`http://localhost/api/campaign/${CAMPAIGN_ID}/encounter`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id: CAMPAIGN_ID }) });
}

function mockTransaction(): { createMany: ReturnType<typeof vi.fn> } {
  let combatants: any[] = [];
  const createMany = vi.fn(async ({ data }: any) => {
    combatants = data;
    return { count: data.length };
  });
  (prisma.$transaction as any).mockImplementation(async (cb: any) => {
    const tx = {
      encounter: {
        create: vi.fn(async () => ({ id: "enc_1" })),
        findUnique: vi.fn(async () => ({ id: "enc_1", combatants, zones: [] })),
      },
      zone: {
        create: vi.fn(async ({ data }: any) => ({ id: `zone_${data.x}_${data.y}`, ...data })),
      },
      combatant: { createMany },
    };
    return cb(tx);
  });
  return { createMany };
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

describe("POST /api/campaign/[id]/encounter — Combatant.stats", () => {
  it("persists the monster's real SRD ability scores, not an empty block", async () => {
    const { createMany } = mockTransaction();
    (prisma.srdMonster.findUnique as any).mockResolvedValue({
      id: "srd-aboleth",
      xp: 5900,
      data: ABOLETH_DATA,
    });

    const res = await post({
      enemies: [
        { name: "Aboleth", hp: 135, maxHp: 135, dexModifier: -1, monsterIndex: "srd-aboleth" },
      ],
    });

    expect(res.status).toBe(201);
    const enemy = persisted(createMany).find((c: any) => !c.isPlayer);
    expect(enemy.stats).toEqual({
      STR: 21,
      DEX: 9,
      CON: 15,
      INT: 18,
      WIS: 15,
      CHA: 18,
    });
  });

  it("never persists an enemy without a complete stat block", async () => {
    // A partial block is indistinguishable from missing data downstream, and a
    // creature with no recorded Wisdom cannot be contested for Perception.
    const { createMany } = mockTransaction();

    const res = await post({
      enemies: [{ name: "Mystery", hp: 10, maxHp: 10, dexModifier: 0 }],
    });

    expect(res.status).toBe(201);
    const enemy = persisted(createMany).find((c: any) => !c.isPlayer);
    expect(Object.keys(enemy.stats).sort()).toEqual(
      ["CHA", "CON", "DEX", "INT", "STR", "WIS"]
    );
  });

  it("falls back to the 10 average when the SRD record is missing", async () => {
    const { createMany } = mockTransaction();
    (prisma.srdMonster.findUnique as any).mockResolvedValue(null);

    const res = await post({
      enemies: [
        { name: "Ghost", hp: 10, maxHp: 10, dexModifier: 0, monsterIndex: "does-not-exist" },
      ],
    });

    expect(res.status).toBe(201);
    const enemy = persisted(createMany).find((c: any) => !c.isPlayer);
    expect(enemy.stats).toEqual({
      STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10,
    });
  });

  it("ignores non-numeric scores in the stored JSON rather than persisting them", async () => {
    // The column is untyped JSON. A string score would reach abilityModifier and
    // propagate NaN into every contested DC that reads it.
    const { createMany } = mockTransaction();
    (prisma.srdMonster.findUnique as any).mockResolvedValue({
      id: "srd-odd",
      xp: 10,
      data: { ...ABOLETH_DATA, wisdom: "fifteen" },
    });

    const res = await post({
      enemies: [{ name: "Odd", hp: 10, maxHp: 10, dexModifier: 0, monsterIndex: "srd-odd" }],
    });

    expect(res.status).toBe(201);
    const enemy = persisted(createMany).find((c: any) => !c.isPlayer);
    expect(enemy.stats.WIS).toBe(10);
    expect(Number.isFinite(enemy.stats.WIS)).toBe(true);
  });
});
