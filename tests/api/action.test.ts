import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/campaign/[id]/action/route";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { NextRequest } from "next/server";
import { buildCampaignContext } from "@/lib/memory/context";
import { parseIntent } from "@/lib/ai/intent";
import { resolveCachedSpell } from "@/lib/rules/spell-resolution-service";
import { checkpointAcceptedAction } from "@/lib/db/session-journal";

// Mock after for Next.js 15
vi.mock("next/server", async (importActual) => {
  const actual = await importActual<any>();
  return {
    ...actual,
    after: vi.fn((fn) => fn()),
  };
});

// Mock dependencies
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    gameLog: { create: vi.fn(), count: vi.fn(() => 1), findMany: vi.fn() },
    encounter: { findUnique: vi.fn(), update: vi.fn() },
    combatant: { findMany: vi.fn(), update: vi.fn() },
    inventoryItem: { delete: vi.fn(), update: vi.fn() },
    character: { findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (cb) => cb(prisma)),
  },
}));
vi.mock("@/lib/db/session-journal", () => ({
  reserveActionRequest: vi.fn(async ({ requestId }: { requestId: string }) => ({
    ok: true,
    duplicate: false,
    requestId,
    requestRecordId: "request-record-1",
    sessionId: "session-1",
  })),
  checkpointAcceptedAction: vi.fn(),
  rejectPendingActionRequest: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: vi.fn(),
  AuthError: class extends Error {
    constructor(msg: string) { super(msg); this.name = "AuthError"; }
  },
}));

vi.mock("@/lib/memory/context", () => ({
  buildCampaignContext: vi.fn(),
}));

vi.mock("@/lib/ai/intent", () => ({
  parseIntent: vi.fn(),
}));
vi.mock("@/lib/rules/spell-resolution-service", () => ({
  resolveCachedSpell: vi.fn(),
}));


vi.mock("@/lib/rules/combat", async (importActual) => {
  const actual = await importActual<any>();
  return {
    ...actual,
    resolveAttackRoll: vi.fn(() => ({ hit: true, critical: false, roll: 10, total: 12 })),
    extractConditions: vi.fn((c) => (Array.isArray(c) ? c : JSON.parse(c || "[]"))),
    applyCondition: vi.fn((list, c) => [...new Set([...list, c])]),
    removeCondition: vi.fn((list, c) => list.filter((x: string) => x !== c)),
  };
});

vi.mock("@/lib/ai/narrator", () => ({
  streamNarrative: vi.fn(() => ({
    textStream: new ReadableStream({
      start(controller) {
        controller.close();
      }
    }),
    textPromise: Promise.resolve("Done"),
    levelUpPayload: null,
    merchantPayload: null,
  })),
}));

describe("Action Route - Slice 2 (Multi-Targeting)", () => {
  const campaignId = "camp_123";
  const mockUser = { id: "user_123" };
  const mockCampaign = { id: campaignId, userId: mockUser.id, status: "active" };

  beforeEach(() => {
    vi.clearAllMocks();
    (getAuthUser as any).mockResolvedValue(mockUser);
    (prisma.campaign.findUnique as any).mockResolvedValue(mockCampaign);
  });

  it("resolves a weapon attack against exactly one selected target", async () => {
    const target1 = { id: "t1", name: "Goblin 1", hp: 10, maxHp: 10, ac: 10, conditions: "[]", isPlayer: false, x: 1, y: 0, size: "Medium" };
    const target2 = { id: "t2", name: "Goblin 2", hp: 10, maxHp: 10, ac: 10, conditions: "[]", isPlayer: false };
    
    const mockContext = {
      character: { name: "Hero", stats: { STR: 10 }, inventory: [] },
      characterStats: { conditions: [] },
      relevantMemories: [],
      recentLogs: [],
      quests: [],
      currentExploration: null,
      activeEncounter: {
        map: { gridType: "SQUARE", width: 8, height: 8, cellSize: 5 },
        id: "enc_123",
        currentTurnIndex: 0,
        round: 1,
        combatants: [
           { id: "p1", name: "Hero", isPlayer: true, hp: 20, maxHp: 20, conditions: "[]", x: 0, y: 0, size: "Medium" },
           target1,
           target2
        ]
      }
    };

    (buildCampaignContext as any).mockResolvedValue(mockContext);
    (prisma.combatant.findMany as any).mockResolvedValue(mockContext.activeEncounter.combatants);

    const req = new NextRequest(`http://localhost/api/campaign/${campaignId}/action`, {
      method: "POST",
      body: JSON.stringify({ action: "Attack", targetIds: ["t1"] }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: campaignId }) });
    
    // Attack macro returns a stream (narrative), but we check the logic triggered before that.
    expect(res.status).toBe(200);
    
    // Verify Prisma mutations
    // Should have 2 target updates and 1 encounter update in the transaction
    expect(prisma.combatant.update).toHaveBeenCalledTimes(1);
    expect(prisma.encounter.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "enc_123" }
    }));
    expect(checkpointAcceptedAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "Attack" }),
      prisma
    );
  });

  it("advances the turn when an item is used during combat", async () => {
    const combatants = [
      { id: "p1", name: "Hero", isPlayer: true, hp: 20, maxHp: 20, conditions: [], concentrationSpellId: null },
      { id: "t1", name: "Goblin", isPlayer: false, hp: 10, maxHp: 10, conditions: [], concentrationSpellId: null },

    ];
    (buildCampaignContext as any).mockResolvedValue({
      character: {
        id: "char-1",
        name: "Hero",
        class: "fighter",
        level: 1,
        stats: { STR: 10 },
        spellSlots: null,
        concentrationSpellId: null,
        inventory: [
          {
            id: "item-1",
            name: "Antitoxin",
            type: "consumable",
            quantity: 1,
            properties: {},
          },
        ],
      },
      characterStats: { conditions: [] },
      relevantMemories: [],
      recentLogs: [],
      quests: [],
      currentExploration: null,
      activeEncounter: {
        id: "enc_123",
        currentTurnIndex: 0,
        round: 1,
        totalDamageDealt: 0,
        combatants,
      },
    });
    (parseIntent as any).mockResolvedValue({
      actionType: "use_item",
      targetName: "Antitoxin",
    });
    (prisma.combatant.findMany as any).mockResolvedValue(combatants);

    const req = new NextRequest(`http://localhost/api/campaign/${campaignId}/action`, {
      method: "POST",
      body: JSON.stringify({ action: "Use Antitoxin" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: campaignId }) });
    const stream = await res.text();

    expect(prisma.inventoryItem.delete).toHaveBeenCalledWith({
      where: { id: "item-1" },
    });
    expect(prisma.encounter.update).toHaveBeenCalledWith({
      where: { id: "enc_123" },
      data: { currentTurnIndex: 1, round: 1 },
    });
    expect(stream).toContain('"type":"TURN_ADVANCE"');
  });

  it("rejects a melee attack beyond its authoritative grid range", async () => {
    const combatants = [
      {
        id: "p1", name: "Hero", isPlayer: true, hp: 20, maxHp: 20,
        ac: 14, conditions: [], x: 0, y: 0, size: "Medium",
      },
      {
        id: "t1", name: "Goblin", isPlayer: false, hp: 10, maxHp: 10,
        ac: 12, conditions: [], x: 3, y: 0, size: "Medium",
      },
    ];
    (buildCampaignContext as any).mockResolvedValue({
      character: { id: "char-1", name: "Hero", stats: { STR: 10 }, inventory: [] },
      characterStats: { conditions: [] },
      relevantMemories: [], recentLogs: [], quests: [], currentExploration: null,
      activeEncounter: {
        id: "enc_123", currentTurnIndex: 0, round: 1, totalDamageDealt: 0,
        map: { gridType: "SQUARE", width: 8, height: 8, cellSize: 5 },
        combatants,
      },
    });

    const response = await POST(new NextRequest(
      `http://localhost/api/campaign/${campaignId}/action`,
      {
        method: "POST",
        body: JSON.stringify({ action: "Attack", targetIds: ["t1"] }),
      }
    ), { params: Promise.resolve({ id: campaignId }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("out of range"),
    });
    expect(prisma.combatant.update).not.toHaveBeenCalled();
  });

  it("accepts a target in a weapon's long range and checkpoints the attack", async () => {
    const combatants = [
      {
        id: "p1", name: "Hero", isPlayer: true, hp: 20, maxHp: 20,
        ac: 14, conditions: [], x: 0, y: 0, size: "Medium",
      },
      {
        id: "t1", name: "Goblin", isPlayer: false, hp: 10, maxHp: 10,
        ac: 12, conditions: [], x: 6, y: 0, size: "Medium",
      },
    ];
    (buildCampaignContext as any).mockResolvedValue({
      character: {
        id: "char-1",
        name: "Hero",
        stats: { STR: 10 },
        inventory: [{
          id: "bow-1",
          name: "Shortbow",
          type: "weapon",
          equippedSlot: "MAIN_HAND",
          properties: {
            damageDice: "1d6",
            damageBonus: 0,
            damageType: "piercing",
            rangeNormal: 20,
            rangeLong: 60,
          },
        }],
      },
      characterStats: { conditions: [] },
      relevantMemories: [], recentLogs: [], quests: [], currentExploration: null,
      activeEncounter: {
        id: "enc_123", currentTurnIndex: 0, round: 1, totalDamageDealt: 0,
        map: { gridType: "SQUARE", width: 12, height: 8, cellSize: 5 },
        combatants,
      },
    });

    const response = await POST(new NextRequest(
      `http://localhost/api/campaign/${campaignId}/action`,
      {
        method: "POST",
        body: JSON.stringify({ action: "Attack", targetIds: ["t1"] }),
      }
    ), { params: Promise.resolve({ id: campaignId }) });

    expect(response.status).toBe(200);
    expect(prisma.combatant.update).toHaveBeenCalled();
    expect(checkpointAcceptedAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "Attack" }),
      prisma
    );
  });

  it("rejects a weapon attack without an explicit target", async () => {
    const target1 = { id: "t1", name: "Goblin 1", hp: 10, maxHp: 10, ac: 10, conditions: "[]", isPlayer: false };
    const mockContext = {
      character: { name: "Hero", stats: { STR: 10 }, inventory: [] },
      characterStats: { conditions: [] },
      relevantMemories: [],
      recentLogs: [],
      quests: [],
      currentExploration: null,
      activeEncounter: {
        id: "enc_123",
        currentTurnIndex: 0,
        round: 1,
        combatants: [
           { id: "p1", name: "Hero", isPlayer: true, hp: 20, maxHp: 20, conditions: "[]" },
           target1
        ]
      }
    };

    (buildCampaignContext as any).mockResolvedValue(mockContext);

    const req = new NextRequest(`http://localhost/api/campaign/${campaignId}/action`, {
      method: "POST",
      body: JSON.stringify({ action: "Attack" }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: campaignId }) });
    expect(res.status).toBe(400);
    expect(prisma.combatant.update).not.toHaveBeenCalled();
  });

  it("validates and persists Move against the encounter map inside a transaction", async () => {
    const combatants = [
      {
        id: "p1", name: "Hero", isPlayer: true, hp: 20, maxHp: 20, ac: 14,
        initiativeTotal: 15, conditions: [], stats: { speed: 30 },
        concentrationSpellId: null, x: 1, y: 1, size: "Medium",
      },
      {
        id: "t1", name: "Goblin", isPlayer: false, hp: 10, maxHp: 10, ac: 12,
        initiativeTotal: 10, conditions: [], stats: {},
        concentrationSpellId: null, x: 4, y: 4, size: "Medium",
      },
    ];
    (buildCampaignContext as any).mockResolvedValue({
      character: { id: "char-1", name: "Hero", stats: { STR: 10 }, inventory: [] },
      relevantMemories: [], recentLogs: [], quests: [], currentExploration: null,
      activeEncounter: {
        id: "enc_123", currentTurnIndex: 0, round: 1, totalDamageDealt: 0,
        map: { gridType: "SQUARE", width: 5, height: 5, cellSize: 5 },
        combatants,
      },
    });
    (prisma.encounter.findUnique as any).mockResolvedValue({
      map: { gridType: "SQUARE", width: 5, height: 5, cellSize: 5 },
      combatants,
    });

    const req = new NextRequest(`http://localhost/api/campaign/${campaignId}/action`, {
      method: "POST",
      body: JSON.stringify({ action: "Move", targetX: 2, targetY: 1 }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: campaignId }) });
    const stream = await res.text();

    expect(res.status).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.combatant.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { x: 2, y: 1 },
    });
    expect(stream).toContain('"type":"MOVE_COMBATANT"');
    expect(stream).toContain('"distanceFt":5');
  });

  it("rejects Move when the destination footprint leaves the persisted map", async () => {
    const player = {
      id: "p1", name: "Hero", isPlayer: true, hp: 20, maxHp: 20, ac: 14,
      initiativeTotal: 15, conditions: [], stats: { speed: 30 },
      concentrationSpellId: null, x: 3, y: 3, size: "Large",
    };
    (buildCampaignContext as any).mockResolvedValue({
      character: { id: "char-1", name: "Hero", stats: { STR: 10 }, inventory: [] },
      relevantMemories: [], recentLogs: [], quests: [], currentExploration: null,
      activeEncounter: {
        id: "enc_123", currentTurnIndex: 0, round: 1, totalDamageDealt: 0,
        map: { gridType: "SQUARE", width: 5, height: 5, cellSize: 5 },
        combatants: [player],
      },
    });
    (prisma.encounter.findUnique as any).mockResolvedValue({
      map: { gridType: "SQUARE", width: 5, height: 5, cellSize: 5 },
      combatants: [player],
    });

    const req = new NextRequest(`http://localhost/api/campaign/${campaignId}/action`, {
      method: "POST",
      body: JSON.stringify({ action: "Move", targetX: 4, targetY: 4 }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: campaignId }) });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "OUT_OF_BOUNDS" });
    expect(prisma.combatant.update).not.toHaveBeenCalled();
  });

  it("derives legacy combatant speed from the character's SRD race", async () => {
    const player = {
      id: "p1", name: "Dwarf Hero", isPlayer: true, hp: 20, maxHp: 20, ac: 14,
      initiativeTotal: 15, conditions: [], stats: {},
      concentrationSpellId: null, x: 0, y: 0, size: "Medium",
    };
    (buildCampaignContext as any).mockResolvedValue({
      character: {
        id: "char-1", name: "Dwarf Hero", race: "dwarf",
        stats: { STR: 10 }, inventory: [],
      },
      relevantMemories: [], recentLogs: [], quests: [], currentExploration: null,
      activeEncounter: {
        id: "enc_123", currentTurnIndex: 0, round: 1, totalDamageDealt: 0,
        map: { gridType: "SQUARE", width: 8, height: 8, cellSize: 5 },
        combatants: [player],
      },
    });
    (prisma.encounter.findUnique as any).mockResolvedValue({
      map: { gridType: "SQUARE", width: 8, height: 8, cellSize: 5 },
      combatants: [player],
    });

    const response = await POST(new NextRequest(
      `http://localhost/api/campaign/${campaignId}/action`,
      {
        method: "POST",
        body: JSON.stringify({ action: "Move", targetX: 6, targetY: 0 }),
      }
    ), { params: Promise.resolve({ id: campaignId }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "SPEED_EXCEEDED" });
    expect(prisma.combatant.update).not.toHaveBeenCalled();
  });

  it("derives area-spell targets from SRD geometry before executing combat", async () => {
    const combatants = [
      {
        id: "p1", name: "Hero", isPlayer: true, hp: 30, maxHp: 30, ac: 14,
        initiativeTotal: 18, conditions: [], stats: { DEX: 12 },
        concentrationSpellId: null, x: 0, y: 0, size: "Medium",
      },
      {
        id: "t1", name: "Goblin One", isPlayer: false, hp: 12, maxHp: 12, ac: 12,
        initiativeTotal: 12, conditions: [], stats: { DEX: 10 },
        concentrationSpellId: null, x: 4, y: 4, size: "Medium",
      },
      {
        id: "t2", name: "Goblin Two", isPlayer: false, hp: 12, maxHp: 12, ac: 12,
        initiativeTotal: 10, conditions: [], stats: { DEX: 10 },
        concentrationSpellId: null, x: 5, y: 4, size: "Medium",
      },
      {
        id: "t3", name: "Goblin Far", isPlayer: false, hp: 12, maxHp: 12, ac: 12,
        initiativeTotal: 8, conditions: [], stats: { DEX: 10 },
        concentrationSpellId: null, x: 8, y: 8, size: "Medium",
      },
    ];
    (buildCampaignContext as any).mockResolvedValue({
      character: {
        id: "char-1", name: "Hero", class: "wizard", level: 5,
        stats: { INT: 16 }, inventory: [],
        spellSlots: { "3": { current: 1, max: 1 } },
        concentrationSpellId: null,
      },
      relevantMemories: [], recentLogs: [], quests: [], currentExploration: null,
      activeEncounter: {
        id: "enc_123", currentTurnIndex: 0, round: 1, totalDamageDealt: 0,
        map: { gridType: "SQUARE", width: 10, height: 10, cellSize: 5 },
        combatants,
      },
    });
    (parseIntent as any).mockResolvedValue({
      actionType: "cast_spell", spellName: "Fireball", spellLevel: 3,
    });
    (resolveCachedSpell as any).mockResolvedValue({
      id: "fireball", name: "Fireball", level: 3, concentration: false,
      sourceEndpoint: "https://www.dnd5eapi.co/api/2014/spells/fireball",
      type: "damage", dice: "1d2", damageType: "fire",
      hasSavingThrow: false, saveAbility: null, saveDamage: "none", condition: null,
      areaOfEffect: { shape: "SPHERE", sizeFt: 5 },
    });
    (prisma.combatant.findMany as any).mockResolvedValue(combatants);

    const req = new NextRequest(`http://localhost/api/campaign/${campaignId}/action`, {
      method: "POST",
      body: JSON.stringify({ action: "Cast Fireball", targetIds: ["t1"] }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: campaignId }) });
    const stream = await res.text();

    expect(res.status).toBe(200);
    const updatedIds = (prisma.combatant.update as any).mock.calls
      .map(([args]: [{ where?: { id?: string } }]) => args.where?.id);
    expect(updatedIds).toEqual(expect.arrayContaining(["t1", "t2"]));
    expect(updatedIds).not.toContain("t3");
    expect(stream).toContain('"targetId":"t1"');
    expect(stream).toContain('"targetId":"t2"');
    expect(stream).not.toContain('"targetId":"t3"');
  });
});
