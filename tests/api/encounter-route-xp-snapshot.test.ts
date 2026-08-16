/**
 * POST /api/campaign/[id]/encounter — Combatant.xpValue snapshot contract.
 *
 * docs/DECISION_XP_AWARD_AUTHORITY.md §5-§6: xpValue is a backend-authorized snapshot,
 * fixed once at encounter creation. Its only permitted origin is SrdMonster.xp, already
 * resolved in memory by this route; the client request must never be able to supply or
 * override it. This test covers persistence only — no XP is granted here.
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
    stats: { DEX: 14 },
    concentrationSpellId: null,
    inventory: [],
  },
};

function post(body: unknown): Promise<Response> {
  const req = new NextRequest(`http://localhost/api/campaign/${CAMPAIGN_ID}/encounter`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id: CAMPAIGN_ID }) });
}

/** Captures the `data` array passed to `tx.combatant.createMany` for inspection. */
function mockTransaction(): { createMany: ReturnType<typeof vi.fn> } {
  let encounterId = "enc_1";
  let combatants: any[] = [];
  const createMany = vi.fn(async ({ data }: any) => {
    combatants = data;
    return { count: data.length };
  });
  (prisma.$transaction as any).mockImplementation(async (cb: any) => {
    const tx = {
      encounter: {
        create: vi.fn(async () => ({ id: encounterId })),
        findUnique: vi.fn(async () => ({ id: encounterId, combatants, zones: [] })),
      },
      zone: {
        create: vi.fn(async ({ data }: any) => ({ id: `zone_${data.x}_${data.y}`, ...data })),
      },
      combatant: {
        createMany,
      },
    };
    return cb(tx);
  });
  return { createMany };
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

/** The array of Combatant rows passed to `tx.combatant.createMany({ data })`. */
function persistedCombatants(createMany: ReturnType<typeof vi.fn>): any[] {
  return createMany.mock.calls[0][0].data;
}

describe("POST /api/campaign/[id]/encounter — Combatant.xpValue snapshot", () => {
  it("persists the exact SRD-authorized xp for a monsterIndex enemy", async () => {
    const { createMany } = mockTransaction();
    (prisma.srdMonster.findUnique as any).mockResolvedValue({
      id: "srd-goblin",
      xp: 50,
      data: { hit_points: 7, dexterity: 14, armor_class: [{ type: "natural", value: 15 }] },
    });

    const res = await post({
      enemies: [{ name: "Goblin", hp: 7, maxHp: 7, dexModifier: 2, monsterIndex: "srd-goblin" }],
    });

    expect(res.status).toBe(201);
    const enemy = persistedCombatants(createMany).find((c: any) => !c.isPlayer);
    expect(enemy.xpValue).toBe(50);
  });

  it("ignores a client-supplied xpValue: the persisted snapshot always comes from SrdMonster.xp", async () => {
    const { createMany } = mockTransaction();
    (prisma.srdMonster.findUnique as any).mockResolvedValue({
      id: "srd-goblin",
      xp: 50,
      data: { hit_points: 7, dexterity: 14, armor_class: [{ type: "natural", value: 15 }] },
    });

    const res = await post({
      enemies: [
        {
          name: "Goblin",
          hp: 7,
          maxHp: 7,
          dexModifier: 2,
          monsterIndex: "srd-goblin",
          // Not part of the declared EnemyInput contract — must have no effect.
          xpValue: 999999,
        },
      ],
    });

    expect(res.status).toBe(201);
    const enemy = persistedCombatants(createMany).find((c: any) => !c.isPlayer);
    expect(enemy.xpValue).toBe(50);
    expect(enemy.xpValue).not.toBe(999999);
  });

  it("persists xpValue: null for an ad-hoc enemy without monsterIndex", async () => {
    const { createMany } = mockTransaction();

    const res = await post({
      enemies: [{ name: "Bandit", hp: 11, maxHp: 11, dexModifier: 1 }],
    });

    expect(res.status).toBe(201);
    expect(prisma.srdMonster.findUnique).not.toHaveBeenCalled();
    const enemy = persistedCombatants(createMany).find((c: any) => !c.isPlayer);
    expect(enemy.xpValue).toBeNull();
  });

  it("persists xpValue: null when monsterIndex does not resolve to any SrdMonster row", async () => {
    const { createMany } = mockTransaction();
    (prisma.srdMonster.findUnique as any).mockResolvedValue(null);

    const res = await post({
      enemies: [{ name: "Mystery Beast", hp: 9, maxHp: 9, dexModifier: 0, monsterIndex: "does-not-exist" }],
    });

    expect(res.status).toBe(201);
    const enemy = persistedCombatants(createMany).find((c: any) => !c.isPlayer);
    expect(enemy.xpValue).toBeNull();
  });

  it("persists a canonical xp of 0 as exactly 0, never as null", async () => {
    const { createMany } = mockTransaction();
    (prisma.srdMonster.findUnique as any).mockResolvedValue({
      id: "srd-commoner",
      xp: 0,
      data: { hit_points: 4, dexterity: 10, armor_class: [{ type: "natural", value: 10 }] },
    });

    const res = await post({
      enemies: [{ name: "Commoner", hp: 4, maxHp: 4, dexModifier: 0, monsterIndex: "srd-commoner" }],
    });

    expect(res.status).toBe(201);
    const enemy = persistedCombatants(createMany).find((c: any) => !c.isPlayer);
    expect(enemy.xpValue).toBe(0);
    expect(enemy.xpValue).not.toBeNull();
  });

  it("always persists xpValue: null for the player combatant", async () => {
    const { createMany } = mockTransaction();
    (prisma.srdMonster.findUnique as any).mockResolvedValue({
      id: "srd-goblin",
      xp: 50,
      data: { hit_points: 7, dexterity: 14, armor_class: [{ type: "natural", value: 15 }] },
    });

    const res = await post({
      enemies: [{ name: "Goblin", hp: 7, maxHp: 7, dexModifier: 2, monsterIndex: "srd-goblin" }],
    });

    expect(res.status).toBe(201);
    const player = persistedCombatants(createMany).find((c: any) => c.isPlayer);
    expect(player.xpValue).toBeNull();
  });
});
