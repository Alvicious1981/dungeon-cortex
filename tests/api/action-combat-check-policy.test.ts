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
import {
  executeCombatAction,
  finalizeEncounterTurn,
} from "@/lib/rules/combat-pipeline";
import { resolveCachedSpell } from "@/lib/rules/spell-resolution-service";
import {
  acquireActionReceipt,
  completeActionReceipt,
} from "@/lib/actions/request-receipt";

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

vi.mock("@/lib/rules/combat-pipeline", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/rules/combat-pipeline")>();
  return {
    ...actual,
    executeCombatAction: vi.fn(),
    finalizeEncounterTurn: vi.fn(),
  };
});

vi.mock("@/lib/rules/weapon-attack", () => ({
  resolveWeaponAttack: vi.fn(async () => ({
    weaponDice: "1d8",
    damageType: "slashing",
    attackModifier: 6,
    flatDamageBonus: 4,
    qualities: {},
  })),
  unresolvedCategoryLog: vi.fn(() => "CATEGORY_UNRESOLVED"),
}));

vi.mock("@/lib/rules/spell-resolution-service", async (importActual) => {
  const actual = await importActual<
    typeof import("@/lib/rules/spell-resolution-service")
  >();
  return { ...actual, resolveCachedSpell: vi.fn() };
});

vi.mock("@/lib/actions/request-receipt", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/actions/request-receipt")>();
  return {
    ...actual,
    acquireActionReceipt: vi.fn(),
    completeActionReceipt: vi.fn(),
    rejectActionReceipt: vi.fn(),
  };
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

const inventory = [
  {
    id: "weapon_longsword",
    name: "Longsword",
    type: "weapon",
    quantity: 1,
    properties: { damageDice: "1d8", damageType: "slashing" },
    equippedSlot: "MAIN_HAND",
  },
  {
    id: "potion_healing",
    name: "Healing Potion",
    type: "consumable",
    quantity: 1,
    properties: { healingDice: "2d4", healingBonus: 2 },
    equippedSlot: null,
  },
];

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
      inventory,
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

async function post(
  action: string,
  options: { requestId?: string; targetIds?: string[] } = {}
) {
  return POST(
    new NextRequest(`http://localhost/api/campaign/${campaignId}/action`, {
      method: "POST",
      body: JSON.stringify({ action, ...options }),
    }),
    { params: Promise.resolve({ id: campaignId }) }
  );
}

const canonicalCharacter = {
  id: characterId,
  class: "wizard",
  level: 9,
  stats: { ...player.stats, INT: 18 },
  skillProficiencies: ["Investigation"],
  exhaustionLevel: 0,
  inventory: [],
};

const tx = {
  $queryRaw: vi.fn(async () => [{ id: characterId }]),
  character: { findUnique: vi.fn(async () => canonicalCharacter) },
  gameLog: { create: vi.fn(async () => ({})) },
};

const commitMarker = vi.fn();

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
  (prisma.$transaction as any).mockImplementation(async (callback: any) => {
    const value = await callback(tx);
    commitMarker();
    return value;
  });
  (finalizeEncounterTurn as any).mockResolvedValue({
    events: [
      {
        type: "TURN_ADVANCE",
        payload: {
          encounterId: "enc_check_policy",
          previousTurnIndex: 0,
          currentTurnIndex: 1,
          round: 2,
        },
      },
    ],
    turnAdvanceConflict: false,
  });
  (executeCombatAction as any).mockResolvedValue({
    events: [{ type: "DAMAGE_DEALT", payload: { damage: 1 } }],
    consequences: [],
    totalDamageDealt: 1,
    consequenceDetails: [],
    systemLogs: [],
  });
  (resolveCachedSpell as any).mockResolvedValue({
    id: "spell_guidance",
    name: "Guidance",
    level: 0,
    slotLevel: 0,
    concentration: false,
    sourceEndpoint: "/api/spells/guidance",
    area: null,
    unsupportedAreaType: null,
    range: { kind: "self" },
    type: "utility",
    dice: null,
    damageType: null,
    hasSavingThrow: false,
    saveAbility: null,
    saveDamage: "none",
    condition: null,
  });
  (acquireActionReceipt as any).mockResolvedValue({
    outcome: "acquired",
    receiptId: "receipt_check_policy",
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

describe("transición atómica de un chequeo permitido", () => {
  it("bloquea y relee el personaje, registra en tx y publica tras commit", async () => {
    const res = await post("I inspect the room", {
      requestId: "req_check_policy",
    });
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.character.findUnique).toHaveBeenCalledWith({
      where: { id: characterId },
      select: {
        id: true,
        class: true,
        level: true,
        stats: true,
        skillProficiencies: true,
        exhaustionLevel: true,
        inventory: {
          select: {
            id: true,
            name: true,
            type: true,
            quantity: true,
            properties: true,
            equippedSlot: true,
          },
        },
      },
    });
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.character.findUnique.mock.invocationCallOrder[0]!
    );

    expect(resolveAbilityCheck).toHaveBeenCalledOnce();
    expect(resolveAbilityCheck).toHaveBeenCalledWith(
      expect.objectContaining({ skill: "Investigation", band: "medium" }),
      expect.objectContaining({
        stats: expect.objectContaining({ INT: 18 }),
        level: 9,
        skillProficiencies: ["Investigation"],
      })
    );
    expect(tx.character.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
      (resolveAbilityCheck as any).mock.invocationCallOrder[0]
    );

    expect(finalizeEncounterTurn).toHaveBeenCalledWith({
      tx,
      encounterId: "enc_check_policy",
      currentTurnIndex: 0,
      round: 2,
      failOnStaleTurn: true,
    });
    expect(tx.gameLog.create).toHaveBeenNthCalledWith(1, {
      data: { campaignId, role: "user", content: "I inspect the room" },
    });
    expect(tx.gameLog.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          campaignId,
          role: "system",
          content: expect.stringContaining("Investigation check"),
        }),
      })
    );
    const globalMechanicalLogs = (prisma.gameLog.create as any).mock.calls.filter(
      ([args]: [{ data?: { role?: string } }]) =>
        args?.data?.role === "user" || args?.data?.role === "system"
    );
    expect(globalMechanicalLogs).toHaveLength(0);

    const checkAt = body.indexOf("ABILITY_CHECK_RESOLVED");
    const turnAt = body.indexOf("TURN_ADVANCE");
    expect(checkAt).toBeGreaterThanOrEqual(0);
    expect(turnAt).toBeGreaterThan(checkAt);
    expect(commitMarker).toHaveBeenCalledOnce();
    expect(commitMarker.mock.invocationCallOrder[0]).toBeLessThan(
      (streamNarrative as any).mock.invocationCallOrder[0]
    );
    expect(completeActionReceipt).toHaveBeenCalledWith(
      "receipt_check_policy",
      expect.arrayContaining([
        expect.objectContaining({ type: "ABILITY_CHECK_RESOLVED" }),
        expect.objectContaining({ type: "TURN_ADVANCE" }),
      ])
    );
  });

  it("aborta y devuelve conflicto cuando pierde el CAS de turno", async () => {
    (finalizeEncounterTurn as any).mockResolvedValue({
      events: [],
      turnAdvanceConflict: true,
    });

    const res = await post("I inspect the room");

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: "TURN_STATE_CONFLICT" });
    expect(resolveAbilityCheck).toHaveBeenCalledOnce();
    expect(tx.gameLog.create).not.toHaveBeenCalled();
    expect(commitMarker).not.toHaveBeenCalled();
    expect(prisma.gameLog.create).not.toHaveBeenCalled();
    expect(streamNarrative).not.toHaveBeenCalled();
    expect(completeActionReceipt).not.toHaveBeenCalled();
  });
});

const TURN_SPENDING_ACTIONS: Array<
  [string, string, { requestId?: string; targetIds?: string[] }]
> = [
  ["macro attack", "Attack", { targetIds: [enemy.id] }],
  ["parsed attack", "I attack Goblin", {}],
  ["combat spell", "I cast Guidance", {}],
  ["combat item", "I use Healing Potion", {}],
  ["combat check", "I inspect the room", {}],
];

describe("contrato fail-closed compartido por acciones que terminan turno", () => {
  it.each(TURN_SPENDING_ACTIONS)(
    "%s solicita el CAS contra el turno observado",
    async (_name, action, options) => {
      const res = await post(action, options);

      expect(res.status).toBe(200);
      expect(finalizeEncounterTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          encounterId: "enc_check_policy",
          currentTurnIndex: 0,
          round: 2,
          failOnStaleTurn: true,
        })
      );
      expect(tx.gameLog.create).toHaveBeenCalledWith({
        data: { campaignId, role: "user", content: action },
      });
      const globalMechanicalLogs = (prisma.gameLog.create as any).mock.calls.filter(
        ([args]: [{ data?: { role?: string } }]) =>
          args?.data?.role === "user" || args?.data?.role === "system"
      );
      expect(globalMechanicalLogs).toHaveLength(0);
      if (_name.includes("attack")) {
        expect(tx.gameLog.create).toHaveBeenCalledWith({
          data: {
            campaignId,
            role: "system",
            content: "CATEGORY_UNRESOLVED",
          },
        });
      }
    }
  );

  it.each(TURN_SPENDING_ACTIONS)(
    "%s aborta sin hechos cuando pierde el CAS",
    async (_name, action, options) => {
      (finalizeEncounterTurn as any).mockResolvedValue({
        events: [],
        turnAdvanceConflict: true,
      });

      const res = await post(action, options);

      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({
        code: "TURN_STATE_CONFLICT",
      });
      expect(tx.gameLog.create).not.toHaveBeenCalled();
      const globalMechanicalLogs = (prisma.gameLog.create as any).mock.calls.filter(
        ([args]: [{ data?: { role?: string } }]) =>
          args?.data?.role === "user" || args?.data?.role === "system"
      );
      expect(globalMechanicalLogs).toHaveLength(0);
      expect(commitMarker).not.toHaveBeenCalled();
      expect(streamNarrative).not.toHaveBeenCalled();
      expect(completeActionReceipt).not.toHaveBeenCalled();
    }
  );
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
