/**
 * Combat ability-check contract through the real deterministic classifier.
 *
 * I/O is isolated, but `parseIntent` and `matchImprovisedAction` are real so
 * these tests bind player wording to the backend-owned combat policy.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/campaign/[id]/action/route";
import { getAuthUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { buildCampaignContext } from "@/lib/memory/context";
import { streamNarrative } from "@/lib/ai/narrator";
import { resolveAbilityCheck } from "@/lib/rules/ability-check";

vi.mock("next/server", async (importActual) => {
  const actual = await importActual<any>();
  return { ...actual, after: vi.fn((fn) => fn()) };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    gameLog: {
      create: vi.fn(),
      count: vi.fn(() => 1),
      findMany: vi.fn(() => []),
    },
    character: { findUnique: vi.fn(), update: vi.fn() },
    encounter: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    combatant: { findMany: vi.fn(() => []), update: vi.fn() },
    inventoryItem: { delete: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    srdSpell: { findUnique: vi.fn(), findMany: vi.fn(() => []) },
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (cb) => cb(prisma)),
  },
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: vi.fn(),
  AuthError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = "AuthError";
    }
  },
}));

vi.mock("@/lib/memory/context", () => ({ buildCampaignContext: vi.fn() }));

vi.mock("@/lib/ai/narrator", () => ({
  streamNarrative: vi.fn(() => ({
    textStream: new ReadableStream({ start: (controller) => controller.close() }),
    textPromise: Promise.resolve("Done"),
    levelUpPayload: Promise.resolve(null),
    merchantPayload: Promise.resolve(null),
  })),
}));

vi.mock("@/lib/rules/ability-check", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/rules/ability-check")>();
  return { ...actual, resolveAbilityCheck: vi.fn(actual.resolveAbilityCheck) };
});

const campaignId = "camp_check_policy";
const characterId = "char_check_policy";
const mockUser = { id: "user_check_policy" };

const player = {
  id: "player_combatant",
  name: "Mira",
  isPlayer: true,
  hp: 20,
  maxHp: 20,
  ac: 14,
  conditions: [],
  concentrationSpellId: null,
  damageImmunities: [],
  damageResistances: [],
  damageVulnerabilities: [],
  conditionImmunities: [],
  stats: { STR: 14, DEX: 12, CON: 12, INT: 16, WIS: 12, CHA: 10 },
  x: 0,
  y: 0,
  size: "Medium",
  initiativeTotal: 20,
  initiativeOrder: 0,
};

const enemy = {
  id: "enemy_combatant",
  name: "Goblin",
  isPlayer: false,
  hp: 7,
  maxHp: 7,
  ac: 12,
  conditions: [],
  concentrationSpellId: null,
  damageImmunities: [],
  damageResistances: [],
  damageVulnerabilities: [],
  conditionImmunities: [],
  stats: { DEX: 14, WIS: 10 },
  x: 1,
  y: 0,
  size: "Small",
  initiativeTotal: 10,
  initiativeOrder: 1,
};

function contextWithEncounter(currentTurnIndex: number) {
  return {
    character: {
      id: characterId,
      name: "Mira",
      class: "wizard",
      level: 5,
      hp: 20,
      maxHp: 20,
      xp: 0,
      hitDiceTotal: 5,
      hitDiceRemaining: 5,
      exhaustionLevel: 0,
      stats: player.stats,
      spellSlots: null,
      concentrationSpellId: null,
      skillProficiencies: ["Investigation", "Perception"],
      inventory: [],
    },
    relevantMemories: [],
    recentLogs: [],
    quests: [],
    currentExploration: null,
    activeEncounter: {
      id: "enc_check_policy",
      status: "active",
      round: 2,
      currentTurnIndex,
      totalDamageDealt: 0,
      combatants: [player, enemy],
    },
  };
}

async function post(action: string) {
  return POST(
    new NextRequest(`http://localhost/api/campaign/${campaignId}/action`, {
      method: "POST",
      body: JSON.stringify({ action }),
    }),
    { params: Promise.resolve({ id: campaignId }) }
  );
}

function expectNoMechanicalWork(): void {
  expect(resolveAbilityCheck).not.toHaveBeenCalled();
  expect(prisma.gameLog.create).not.toHaveBeenCalled();
  expect(prisma.encounter.update).not.toHaveBeenCalled();
  expect(prisma.encounter.updateMany).not.toHaveBeenCalled();
  expect(prisma.$transaction).not.toHaveBeenCalled();
  expect(streamNarrative).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  (getAuthUser as any).mockResolvedValue(mockUser);
  (prisma.campaign.findUnique as any).mockResolvedValue({
    id: campaignId,
    userId: mockUser.id,
    status: "active",
    characterId,
  });
  (prisma.character.findUnique as any).mockResolvedValue({
    id: characterId,
    class: "wizard",
    level: 5,
    xp: 0,
    maxHp: 20,
    hitDiceTotal: 5,
    stats: player.stats,
  });
  (buildCampaignContext as any).mockResolvedValue(contextWithEncounter(0));
});

describe("autoridad de turno para chequeos en combate", () => {
  it("rechaza un chequeo durante el turno enemigo", async () => {
    (buildCampaignContext as any).mockResolvedValue(contextWithEncounter(1));

    const res = await post("I inspect the room");

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: "NOT_PLAYER_TURN" });
    expectNoMechanicalWork();
  });

  it("conserva el código de estado de turno inválido", async () => {
    (buildCampaignContext as any).mockResolvedValue(contextWithEncounter(9));

    const res = await post("I inspect the room");

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: "INVALID_TURN_INDEX" });
    expectNoMechanicalWork();
  });
});

describe("política fail-closed de chequeos en combate", () => {
  it.each(["I hide behind the crates", "me escondo tras las cajas"])(
    "%s rechaza el efecto no representado",
    async (action) => {
      const res = await post(action);

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        code: "COMBAT_EFFECT_UNSUPPORTED",
      });
      expectNoMechanicalWork();
    }
  );

  it.each(["I climb the wall", "trepo el muro"])(
    "%s rechaza el movimiento no representado",
    async (action) => {
      const res = await post(action);

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        code: "COMBAT_MOVEMENT_CHECK_UNSUPPORTED",
      });
      expectNoMechanicalWork();
    }
  );

  it("mantiene disponible el chequeo fuera de combate", async () => {
    const context = contextWithEncounter(0);
    (buildCampaignContext as any).mockResolvedValue({
      ...context,
      activeEncounter: null,
    });

    const res = await post("I inspect the room");
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(resolveAbilityCheck).toHaveBeenCalledOnce();
    expect(body).toContain("ABILITY_CHECK_RESOLVED");
    expect(streamNarrative).toHaveBeenCalledOnce();
  });
});
