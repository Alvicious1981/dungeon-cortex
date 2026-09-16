/**
 * POST /api/campaign/[id]/encounter — Combatant.attackProfile snapshot contract.
 *
 * docs/superpowers/specs/2026-09-15-enemy-turns-design.md §4.1, §7: the enemy's
 * recognised SRD attacks are snapshotted once, at encounter creation, from
 * SrdMonster.data — the same way xpValue is. Its only permitted origin is
 * profileMonster over the resolved SRD row; the request body must never be able
 * to supply it. An enemy with no recognised attack carries no profile (NULL),
 * which skips its turn.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/campaign/[id]/encounter/route";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { profileMonster } from "@/lib/rules/monster-attack-profile";

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

const GOBLIN = (
  JSON.parse(
    readFileSync(join(process.cwd(), "data", "srd-es", "monsters.json"), "utf8"),
  ) as Array<Record<string, unknown>>
).find((m) => m.index === "goblin")!;

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
  let combatants: unknown[] = [];
  const createMany = vi.fn(async ({ data }: { data: unknown[] }) => {
    combatants = data;
    return { count: data.length };
  });
  (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
    async (cb: (tx: unknown) => unknown) =>
      cb({
        encounter: {
          create: vi.fn(async () => ({ id: "enc_1" })),
          findUnique: vi.fn(async () => ({ id: "enc_1", combatants })),
        },
        combatant: { createMany },
      }),
  );
  return { createMany };
}

function persisted(createMany: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  return createMany.mock.calls[0]![0].data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(USER);
  (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CAMPAIGN);
  (prisma.encounter.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/campaign/[id]/encounter — Combatant.attackProfile snapshot", () => {
  it("persists the recognised profile of an SRD enemy", async () => {
    const { createMany } = mockTransaction();
    (prisma.srdMonster.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "srd-goblin",
      xp: 50,
      data: GOBLIN,
    });

    const res = await post({
      enemies: [{ name: "Goblin", hp: 7, maxHp: 7, dexModifier: 2, monsterIndex: "srd-goblin" }],
    });

    expect(res.status).toBe(201);
    const enemy = persisted(createMany).find((c) => !c.isPlayer)!;
    expect(enemy.attackProfile).toEqual(profileMonster(GOBLIN));
  });

  it("ignores a client-supplied attackProfile", async () => {
    const { createMany } = mockTransaction();
    (prisma.srdMonster.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "srd-goblin",
      xp: 50,
      data: GOBLIN,
    });
    const forged = {
      version: 1,
      walkSpeedFt: 60,
      attacks: [
        {
          name: "Forged",
          attackBonus: 99,
          melee: { reachFt: 50 },
          ranged: null,
          damage: [{ dice: "20d20", type: "force" }],
        },
      ],
      multiattack: null,
    };

    const res = await post({
      enemies: [
        {
          name: "Goblin",
          hp: 7,
          maxHp: 7,
          dexModifier: 2,
          monsterIndex: "srd-goblin",
          // Not part of the declared EnemyInput contract — must have no effect.
          attackProfile: forged,
        },
      ],
    });

    expect(res.status).toBe(201);
    const enemy = persisted(createMany).find((c) => !c.isPlayer)!;
    expect(enemy.attackProfile).toEqual(profileMonster(GOBLIN));
    expect(enemy.attackProfile).not.toEqual(forged);
  });

  it("leaves the column NULL for an ad-hoc enemy without monsterIndex", async () => {
    const { createMany } = mockTransaction();

    const res = await post({ enemies: [{ name: "Bandit", hp: 11, maxHp: 11, dexModifier: 1 }] });

    expect(res.status).toBe(201);
    const enemy = persisted(createMany).find((c) => !c.isPlayer)!;
    expect(enemy).not.toHaveProperty("attackProfile");
  });

  it("leaves the column NULL when monsterIndex resolves to no SrdMonster row", async () => {
    const { createMany } = mockTransaction();
    (prisma.srdMonster.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await post({
      enemies: [{ name: "Mystery", hp: 9, maxHp: 9, dexModifier: 0, monsterIndex: "does-not-exist" }],
    });

    expect(res.status).toBe(201);
    const enemy = persisted(createMany).find((c) => !c.isPlayer)!;
    expect(enemy).not.toHaveProperty("attackProfile");
  });

  it("leaves the column NULL for a monster with no recognised attack", async () => {
    const { createMany } = mockTransaction();
    (prisma.srdMonster.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "srd-mute",
      xp: 10,
      data: { hit_points: 5, dexterity: 10, armor_class: [{ type: "natural", value: 10 }], actions: [] },
    });

    const res = await post({
      enemies: [{ name: "Mute", hp: 5, maxHp: 5, dexModifier: 0, monsterIndex: "srd-mute" }],
    });

    expect(res.status).toBe(201);
    const enemy = persisted(createMany).find((c) => !c.isPlayer)!;
    expect(enemy).not.toHaveProperty("attackProfile");
  });

  it("never gives the player combatant a profile", async () => {
    const { createMany } = mockTransaction();
    (prisma.srdMonster.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "srd-goblin",
      xp: 50,
      data: GOBLIN,
    });

    const res = await post({
      enemies: [{ name: "Goblin", hp: 7, maxHp: 7, dexModifier: 2, monsterIndex: "srd-goblin" }],
    });

    expect(res.status).toBe(201);
    const player = persisted(createMany).find((c) => c.isPlayer)!;
    expect(player).not.toHaveProperty("attackProfile");
  });
});

const ADULT_RED_DRAGON = (
  JSON.parse(readFileSync(join(process.cwd(), "data", "srd-es", "monsters.json"), "utf8")) as Array<
    Record<string, unknown>
  >
).find((m) => m.index === "adult-red-dragon")!;

describe("POST /api/campaign/[id]/encounter — Combatant.breathAvailable", () => {
  it("starts true for an enemy with a recognised area-save attack", async () => {
    const { createMany } = mockTransaction();
    (prisma.srdMonster.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "srd-dragon", xp: 18000, data: ADULT_RED_DRAGON,
    });

    const res = await post({
      enemies: [{ name: "Adult Red Dragon", hp: 256, maxHp: 256, dexModifier: 1, monsterIndex: "srd-dragon" }],
    });

    expect(res.status).toBe(201);
    const enemy = persisted(createMany).find((c) => !c.isPlayer)!;
    expect(enemy.breathAvailable).toBe(true);
  });

  it("leaves the column unset for an enemy with no area-save attack", async () => {
    const { createMany } = mockTransaction();
    (prisma.srdMonster.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "srd-goblin", xp: 50, data: GOBLIN,
    });

    const res = await post({
      enemies: [{ name: "Goblin", hp: 7, maxHp: 7, dexModifier: 2, monsterIndex: "srd-goblin" }],
    });

    expect(res.status).toBe(201);
    const enemy = persisted(createMany).find((c) => !c.isPlayer)!;
    expect(enemy).not.toHaveProperty("breathAvailable");
  });

  it("never gives the player breathAvailable", async () => {
    const { createMany } = mockTransaction();
    (prisma.srdMonster.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "srd-dragon", xp: 18000, data: ADULT_RED_DRAGON,
    });

    const res = await post({
      enemies: [{ name: "Adult Red Dragon", hp: 256, maxHp: 256, dexModifier: 1, monsterIndex: "srd-dragon" }],
    });

    expect(res.status).toBe(201);
    const player = persisted(createMany).find((c) => c.isPlayer)!;
    expect(player).not.toHaveProperty("breathAvailable");
  });
});

describe("POST /api/campaign/[id]/encounter — a character at 0 HP (death-saves spec §8.3)", () => {
  it("refuses to start a fight the character would begin downed", async () => {
    (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...CAMPAIGN,
      character: { ...CAMPAIGN.character, hp: 0 },
    });

    const res = await post({ enemies: [{ name: "Bandit", hp: 11, maxHp: 11, dexModifier: 1 }] });

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("CHARACTER_AT_ZERO_HP");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
