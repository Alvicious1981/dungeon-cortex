import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { POST } from "@/app/api/campaign/[id]/action/route";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { NextRequest } from "next/server";
import { buildCampaignContext } from "@/lib/memory/context";
import { computeConsequences } from "@/lib/rules/combat";
import { parseIntent } from "@/lib/ai/intent";
import { streamNarrative } from "@/lib/ai/narrator";
import { NARRATOR_DATA_LIMITS } from "@/lib/ai/trust-boundary";
import { ACTION_REQUEST_ID_MAX_CHARS } from "@/lib/events/action-transport";
import { Prisma, ActionRequestStatus } from "@prisma/client";
import { fingerprintActionRequest } from "@/lib/actions/request-receipt";

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
    encounter: { update: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
    combatant: { findMany: vi.fn(), update: vi.fn() },
    inventoryItem: {
      // `findUnique` because the pipeline reads the remaining charges
      // inside the transaction instead of trusting the quantity the
      // route read from `buildCampaignContext` before it opened.
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
    character: { findUnique: vi.fn(), update: vi.fn() },
    // DC-AUD-003. `create` is the acquisition itself — a unique-constraint
    // insert, not a read — so simulating a duplicate means rejecting it with a
    // real P2002 rather than returning a row from a find.
    actionRequestReceipt: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    // The route resolves a weapon's category through `getEquipmentInfo`, which
    // reads `srdItem`. Without this delegate the call threw a TypeError that
    // `resolveWeaponProfile`'s `.catch` swallowed, so every attack in this file
    // silently resolved to no category and no proficiency — a crashed lookup
    // masquerading as a resolution.
    srdItem: { findUnique: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(async (cb) => cb(prisma)),
  },
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

vi.mock("@/lib/rules/combat", async (importActual) => {
  const actual = await importActual<any>();
  return {
    ...actual,
    // Delegates to the real implementation: this is a probe on the arguments
    // the route resolved, not a replacement for the rule.
    computeConsequences: vi.fn((input: any) => actual.computeConsequences(input)),
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

/**
 * The four snapshot columns `Combatant` always carries: Prisma declares them
 * `String[] @default([])`, so a real row never omits them. Fixtures spread
 * this so their shape matches the row the route actually reads.
 */
const NO_MODIFIERS = {
  damageImmunities: [] as string[],
  damageResistances: [] as string[],
  damageVulnerabilities: [] as string[],
  conditionImmunities: [] as string[],
};

describe("Action Route - Slice 2 (Multi-Targeting)", () => {
  const campaignId = "camp_123";
  const mockUser = { id: "user_123" };
  const mockCampaign = { id: campaignId, userId: mockUser.id, status: "active" };

  beforeEach(() => {
    vi.clearAllMocks();
    (getAuthUser as any).mockResolvedValue(mockUser);
    (prisma.campaign.findUnique as any).mockResolvedValue(mockCampaign);
    // The seeded SRD row these fixtures' Longsword resolves against. The
    // lookup tries findUnique by id first, then an exact-name findMany.
    (prisma.srdItem.findUnique as any).mockResolvedValue(null);
    (prisma.srdItem.findMany as any).mockResolvedValue([
      {
        id: "longsword",
        name: "Longsword",
        data: {
          weapon_category: "Martial",
          weapon_range: "Melee",
          damage: { damage_dice: "1d8", damage_type: { name: "Slashing" } },
          properties: [{ index: "versatile", name: "Versatile", url: "" }],
        },
      },
    ]);
  });

  describe("request validation", () => {
    it("rejects an oversized action before authentication or state changes", async () => {
      const req = new NextRequest(`http://localhost/api/campaign/${campaignId}/action`, {
        method: "POST",
        body: JSON.stringify({
          action: "x".repeat(NARRATOR_DATA_LIMITS.playerActionChars + 1),
        }),
      });

      const res = await POST(req, { params: Promise.resolve({ id: campaignId }) });

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({
        error: `action must be at most ${NARRATOR_DATA_LIMITS.playerActionChars} characters.`,
      });
      expect(getAuthUser).not.toHaveBeenCalled();
      expect(prisma.campaign.findUnique).not.toHaveBeenCalled();
      expect(prisma.gameLog.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(parseIntent).not.toHaveBeenCalled();
      expect(streamNarrative).not.toHaveBeenCalled();
    });
  });

  describe("free-text attack targeting", () => {
    const hostile = { id: "t1", name: "Goblin", hp: 10, maxHp: 10, ac: 10, conditions: "[]", ...NO_MODIFIERS, isPlayer: false };
    const downed = { id: "t2", name: "Goblin", hp: 0, maxHp: 10, ac: 10, conditions: "[]", ...NO_MODIFIERS, isPlayer: false };
    const hero = { id: "p1", name: "Hero", ...NO_MODIFIERS, isPlayer: true, hp: 20, maxHp: 20, conditions: "[]" };

    const contextWith = (combatants: unknown[]) => ({
      character: {
        id: "char-1",
        name: "Hero",
        class: "fighter",
        level: 1,
        stats: { STR: 14 },
        inventory: [
          { id: "w1", name: "Longsword", type: "weapon", equippedSlot: "MAIN_HAND", properties: {} },
        ],
      },
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

    const attackWith = async (intent: Record<string, unknown>, body: Record<string, unknown> = {}) => {
      (parseIntent as any).mockResolvedValue({ actionType: "attack", ...intent });
      return POST(
        new NextRequest(`http://localhost/api/campaign/${campaignId}/action`, {
          method: "POST",
          body: JSON.stringify({ action: "I swing at it", ...body }),
        }),
        { params: Promise.resolve({ id: campaignId }) }
      );
    };

    it("refuses an attack with no target instead of falling through to narration", async () => {
      (buildCampaignContext as any).mockResolvedValue(contextWith([hero, hostile]));

      const res = await attackWith({});

      expect(res.status).toBe(400);
      expect(streamNarrative).not.toHaveBeenCalled();
      expect(prisma.combatant.update).not.toHaveBeenCalled();
    });

    it("refuses an ambiguous name rather than attacking every match", async () => {
      const second = { ...hostile, id: "t3" };
      (buildCampaignContext as any).mockResolvedValue(contextWith([hero, hostile, second]));

      const res = await attackWith({ targetName: "Goblin" });

      expect(res.status).toBe(400);
      expect(prisma.combatant.update).not.toHaveBeenCalled();
    });

    it("never resolves a free-text attack against the player", async () => {
      (buildCampaignContext as any).mockResolvedValue(contextWith([hero, hostile]));

      const res = await attackWith({ targetName: "Hero" });

      expect(res.status).toBe(400);
      expect(prisma.combatant.update).not.toHaveBeenCalled();
    });

    it("never resolves a free-text attack against a downed combatant", async () => {
      (buildCampaignContext as any).mockResolvedValue(contextWith([hero, downed]));

      const res = await attackWith({ targetName: "Goblin" });

      expect(res.status).toBe(400);
      expect(prisma.combatant.update).not.toHaveBeenCalled();
    });

    it("hands the narrator the facts it resolved, not the raw player text", async () => {
      // The other tests here prove an invalid attack is refused. This proves the
      // valid one: the attack resolves, and what reaches streamNarrative is a
      // narrative context carrying backend-resolved facts. Without that argument
      // the narrator is describing an outcome it was never told, which is the
      // failure this project exists to prevent — and nothing else asserted it.
      (buildCampaignContext as any).mockResolvedValue(contextWith([hero, hostile]));
      (prisma.combatant.findMany as any).mockResolvedValue([hero, hostile]);

      const res = await attackWith({}, { targetIds: ["t1"] });

      expect(res.status).toBe(200);
      expect(prisma.combatant.update).toHaveBeenCalled();

      const call = (streamNarrative as any).mock.calls.at(-1);
      expect(call?.[1]).toBe("I swing at it");
      expect(call?.[2]?.facts.length).toBeGreaterThan(0);
    });

    it("rolls the attack at the proficient modifier the weapon earns", async () => {
      // The fixture's Longsword row carries damage and no category — the legacy
      // shape every existing character has. The route must fill it from the SRD
      // and apply proficiency: fighter level 1, STR 14 (+2), martial (+2) = +4.
      // Nothing here asserted a modifier before, which is why a lookup that
      // threw on every call looked exactly like one that resolved.
      (buildCampaignContext as any).mockResolvedValue(contextWith([hero, hostile]));
      (prisma.combatant.findMany as any).mockResolvedValue([hero, hostile]);

      const res = await attackWith({}, { targetIds: ["t1"] });

      expect(res.status).toBe(200);
      const consequences = (computeConsequences as any).mock.calls.at(-1);
      expect(consequences?.[0]?.attackModifier).toBe(4);
    });

    /**
     * How much damage the target actually took, read off the HP mutation the
     * route wrote. The pipeline now persists damage as an atomic decrement, so
     * this helper accepts both that canonical shape and the legacy absolute
     * numeric shape while older tests are being migrated.
     */
    const damageWrittenFor = (targetId: string, startingHp: number): number => {
      const call = (prisma.combatant.update as any).mock.calls.find(
        ([args]: [{ where: { id: string }; data: { hp?: number | { decrement?: number } } }]) => {
          const hp = args.data.hp;
          return (
            args.where.id === targetId &&
            (typeof hp === "number" ||
              (typeof hp === "object" && hp !== null && typeof hp.decrement === "number"))
          );
        },
      );
      if (!call) throw new Error(`No hp write for ${targetId}`);
      const hp = call[0].data.hp as number | { decrement: number };
      return typeof hp === "number" ? startingHp - hp : hp.decrement;
    };

    it("halves the damage of a mundane weapon against the clause, and says nothing", async () => {
      const clause = "bludgeoning, piercing, and slashing from nonmagical weapons";
      const resistant = { ...hostile, hp: 100, maxHp: 100, damageResistances: [clause] };
      (buildCampaignContext as any).mockResolvedValue(contextWith([hero, resistant]));
      (prisma.combatant.findMany as any).mockResolvedValue([hero, resistant]);
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.45);

      try {
        const res = await attackWith({}, { targetIds: ["t1"] });

        expect(res.status).toBe(200);
        expect(prisma.gameLog.create).not.toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              role: "system",
              content: expect.stringContaining("not applied"),
            }),
          })
        );
        expect(damageWrittenFor("t1", 100)).toBeGreaterThan(0);
      } finally {
        randomSpy.mockRestore();
      }
    });

    it("pays a magic weapon in full against the same clause", async () => {
      const clause = "bludgeoning, piercing, and slashing from nonmagical weapons";

      const damageWith = async (properties: Record<string, unknown>): Promise<number> => {
        vi.clearAllMocks();
        (getAuthUser as any).mockResolvedValue(mockUser);
        (prisma.campaign.findUnique as any).mockResolvedValue(mockCampaign);
        (prisma.srdItem.findUnique as any).mockResolvedValue(null);
        (prisma.srdItem.findMany as any).mockResolvedValue([
          {
            id: "longsword",
            name: "Longsword",
            data: {
              weapon_category: "Martial",
              weapon_range: "Melee",
              damage: { damage_dice: "1d8", damage_type: { name: "Slashing" } },
              properties: [{ index: "versatile", name: "Versatile", url: "" }],
            },
          },
        ]);

        const resistant = { ...hostile, hp: 100, maxHp: 100, damageResistances: [clause] };
        const base = contextWith([hero, resistant]);
        (buildCampaignContext as any).mockResolvedValue({
          ...base,
          character: {
            ...base.character,
            inventory: [
              {
                id: "w1",
                name: "Longsword",
                type: "weapon",
                equippedSlot: "MAIN_HAND",
                properties,
              },
            ],
          },
        });
        (prisma.combatant.findMany as any).mockResolvedValue([hero, resistant]);

        const res = await attackWith({}, { targetIds: ["t1"] });
        expect(res.status).toBe(200);
        return damageWrittenFor("t1", 100);
      };

      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.45);

      try {
        const mundane = await damageWith({});
        const magical = await damageWith({ qualities: ["magical"] });

        expect(mundane).toBeGreaterThan(0);
        expect(magical).toBe(mundane * 2);
      } finally {
        randomSpy.mockRestore();
      }
    });

    it("stays silent about an unresolvable clause when the attack missed", async () => {
      const clause = "bludgeoning, piercing, and slashing from nonmagical weapons";
      const resistant = { ...hostile, damageResistances: [clause] };
      (buildCampaignContext as any).mockResolvedValue(contextWith([hero, resistant]));
      (prisma.combatant.findMany as any).mockResolvedValue([hero, resistant]);
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

      try {
        const res = await attackWith({}, { targetIds: ["t1"] });

        expect(res.status).toBe(200);
        expect(prisma.gameLog.create).not.toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              role: "system",
              content: expect.stringContaining("not applied"),
            }),
          })
        );
      } finally {
        randomSpy.mockRestore();
      }
    });

    const HEAVY_ARMOUR = {
      id: "a1",
      name: "Chain Mail",
      type: "armor",
      equippedSlot: "ARMOR",
      properties: { baseAC: 16, armorClass: "heavy", addDexModifier: false },
    };

    const inHeavyArmour = (characterClass: string) => {
      const base = contextWith([hero, hostile]);
      return {
        ...base,
        character: {
          ...base.character,
          class: characterClass,
          inventory: [...base.character.inventory, HEAVY_ARMOUR],
        },
      };
    };

    const penaltyReachingTheRule = (): boolean => {
      const call = (computeConsequences as any).mock.calls.at(-1);
      if (!call) throw new Error("computeConsequences was never called");
      return call[0].attackerArmorPenalty;
    };

    it("carries the armour penalty to the rule for a wizard in heavy armour", async () => {
      (buildCampaignContext as any).mockResolvedValue(inHeavyArmour("wizard"));
      (prisma.combatant.findMany as any).mockResolvedValue([hero, hostile]);

      const res = await attackWith({}, { targetIds: ["t1"] });

      expect(res.status).toBe(200);
      expect(penaltyReachingTheRule()).toBe(true);
    });

    it("carries no penalty for a fighter in the same heavy armour", async () => {
      (buildCampaignContext as any).mockResolvedValue(inHeavyArmour("fighter"));
      (prisma.combatant.findMany as any).mockResolvedValue([hero, hostile]);

      const res = await attackWith({}, { targetIds: ["t1"] });

      expect(res.status).toBe(200);
      expect(penaltyReachingTheRule()).toBe(false);
    });

    it("rejects a targetIds selection naming more than one creature", async () => {
      (buildCampaignContext as any).mockResolvedValue(contextWith([hero, hostile, { ...hostile, id: "t3" }]));

      const res = await attackWith({}, { targetIds: ["t1", "t3"] });

      expect(res.status).toBe(400);
      expect(prisma.combatant.update).not.toHaveBeenCalled();
    });
  });

  it("settles an improvised action with an ability check, logged before narration", async () => {
    (buildCampaignContext as any).mockResolvedValue({
      character: {
        id: "c1",
        name: "Hero",
        level: 5,
        stats: { STR: 16 },
        skillProficiencies: ["Athletics"],
        inventory: [],
      },
      relevantMemories: [],
      recentLogs: [],
      quests: [],
      currentExploration: null,
      activeEncounter: null,
    });
    (parseIntent as any).mockResolvedValue({
      actionType: "ability_check",
      skill: "Athletics",
    });

    const res = await POST(
      new NextRequest(`http://localhost/api/campaign/${campaignId}/action`, {
        method: "POST",
        body: JSON.stringify({ action: "I try to disarm the goblin" }),
      }),
      { params: Promise.resolve({ id: campaignId }) }
    );

    expect(res.status).toBe(200);

    expect(prisma.gameLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: "system",
          content: expect.stringMatching(/Athletics check \(STR\): rolled \d+ \+3 \+3 prof = \d+ vs DC 15 \(medium\) → (SUCCESS|FAILURE)/),
        }),
      })
    );
  });

  it("rejects an ambiguous mechanical action before narration", async () => {
    (buildCampaignContext as any).mockResolvedValue({
      character: { name: "Hero", stats: { STR: 10 }, inventory: [] },
      relevantMemories: [],
      recentLogs: [],
      quests: [],
      currentExploration: null,
      activeEncounter: null,
    });
    (parseIntent as any).mockResolvedValue({ actionType: "mechanical_ambiguous" });

    const res = await POST(
      new NextRequest(`http://localhost/api/campaign/${campaignId}/action`, {
        method: "POST",
        body: JSON.stringify({ action: "I try to disarm the goblin" }),
      }),
      { params: Promise.resolve({ id: campaignId }) }
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      code: "MECHANICAL_CLARIFICATION_REQUIRED",
    });
    expect(streamNarrative).not.toHaveBeenCalled();
    expect(prisma.combatant.update).not.toHaveBeenCalled();
  });

  it("carries the armour penalty on the macro Attack path too", async () => {
    const target = { id: "t1", name: "Goblin", hp: 10, maxHp: 10, ac: 10, conditions: "[]", ...NO_MODIFIERS, isPlayer: false };
    const player = { id: "p1", name: "Hero", ...NO_MODIFIERS, isPlayer: true, hp: 20, maxHp: 20, conditions: "[]" };
    const combatants = [player, target];

    const mockContext = {
      character: {
        name: "Hero",
        class: "wizard",
        stats: { STR: 10 },
        inventory: [
          {
            id: "a1",
            name: "Chain Mail",
            type: "armor",
            equippedSlot: "ARMOR",
            properties: { baseAC: 16, armorClass: "heavy", addDexModifier: false },
          },
        ],
      },
      relevantMemories: [],
      recentLogs: [],
      quests: [],
      currentExploration: null,
      activeEncounter: { id: "enc_123", currentTurnIndex: 0, round: 1, totalDamageDealt: 0, combatants },
    };

    (buildCampaignContext as any).mockResolvedValue(mockContext);
    (prisma.combatant.findMany as any).mockResolvedValue(combatants);

    const res = await POST(
      new NextRequest(`http://localhost/api/campaign/${campaignId}/action`, {
        method: "POST",
        body: JSON.stringify({ action: "Attack", targetIds: ["t1"] }),
      }),
      { params: Promise.resolve({ id: campaignId }) }
    );

    expect(res.status).toBe(200);
    const call = (computeConsequences as any).mock.calls.at(-1);
    expect(call?.[0].attackerArmorPenalty).toBe(true);
  });

  it("handles multi-target Attack via targetIds", async () => {
    const target1 = { id: "t1", name: "Goblin 1", hp: 10, maxHp: 10, ac: 10, conditions: "[]", ...NO_MODIFIERS, isPlayer: false };
    const target2 = { id: "t2", name: "Goblin 2", hp: 10, maxHp: 10, ac: 10, conditions: "[]", ...NO_MODIFIERS, isPlayer: false };
    
    const mockContext = {
      character: { name: "Hero", class: "fighter", stats: { STR: 10 }, inventory: [] },
      relevantMemories: [],
      recentLogs: [],
      quests: [],
      currentExploration: null,
      activeEncounter: {
        id: "enc_123",
        currentTurnIndex: 0,
        round: 1,
        combatants: [
           { id: "p1", name: "Hero", ...NO_MODIFIERS, isPlayer: true, hp: 20, maxHp: 20, conditions: "[]" },
           target1,
           target2
        ]
      }
    };

    (buildCampaignContext as any).mockResolvedValue(mockContext);
    (prisma.combatant.findMany as any).mockResolvedValue(mockContext.activeEncounter.combatants);

    const req = new NextRequest(`http://localhost/api/campaign/${campaignId}/action`, {
      method: "POST",
      body: JSON.stringify({ action: "Attack", targetIds: ["t1", "t2"] }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: campaignId }) });
    
    expect(res.status).toBe(200);
    expect(prisma.combatant.update).toHaveBeenCalledTimes(2);
    expect(prisma.encounter.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "enc_123" }
    }));
  });

  it("advances the turn when an item is used during combat", async () => {
    const combatants = [
      { id: "p1", name: "Hero", ...NO_MODIFIERS, isPlayer: true, hp: 20, maxHp: 20, conditions: [], concentrationSpellId: null },
      { id: "t1", name: "Goblin", ...NO_MODIFIERS, isPlayer: false, hp: 10, maxHp: 10, conditions: [], concentrationSpellId: null },
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
        exhaustionLevel: 0,
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
    (prisma.inventoryItem.findUnique as any).mockResolvedValue({ quantity: 1 });

    const req = new NextRequest(`http://localhost/api/campaign/${campaignId}/action`, {
      method: "POST",
      body: JSON.stringify({ action: "Use Antitoxin" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: campaignId }) });
    const stream = await res.text();

    expect(prisma.inventoryItem.deleteMany).toHaveBeenCalledWith({
      where: { id: "item-1" },
    });
    expect(prisma.encounter.update).toHaveBeenCalledWith({
      where: { id: "enc_123" },
      data: { currentTurnIndex: 1, round: 1 },
    });
    expect(stream).toContain('"type":"TURN_ADVANCE"');
  });

  it("falls back to auto-targeting if targetIds is missing", async () => {
    const target1 = { id: "t1", name: "Goblin 1", hp: 10, maxHp: 10, ac: 10, conditions: "[]", ...NO_MODIFIERS, isPlayer: false };
    const mockContext = {
      character: { name: "Hero", class: "fighter", stats: { STR: 10 }, inventory: [] },
      relevantMemories: [],
      recentLogs: [],
      quests: [],
      currentExploration: null,
      activeEncounter: {
        id: "enc_123",
        currentTurnIndex: 0,
        round: 1,
        combatants: [
           { id: "p1", name: "Hero", ...NO_MODIFIERS, isPlayer: true, hp: 20, maxHp: 20, conditions: "[]" },
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
    expect(res.status).toBe(200);
    expect(prisma.combatant.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "t1" }
    }));
  });
});

describe("Action Route - level_up_available presentation (SEC-AI-001 PR3)", () => {
  const campaignId = "camp_123";
  const mockUser = { id: "user_123" };
  const mockCampaign = { id: campaignId, userId: mockUser.id, status: "active" };
  const characterId = "char-1";

  function buildContext(character: Record<string, unknown>) {
    return {
      character: {
        id: characterId,
        name: "Hero",
        race: "human",
        class: "fighter",
        hp: 10,
        maxHp: 10,
        xp: 0,
        hitDiceRemaining: 1,
        hitDiceTotal: 1,
        stats: { STR: 10, CON: 10 },
        spellSlots: null,
        concentrationSpellId: null,
        exhaustionLevel: 0,
        inventory: [],
        level: 1,
        ...character,
      },
      relevantMemories: [],
      recentLogs: [],
      quests: [],
      currentExploration: null,
      activeEncounter: null,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    (getAuthUser as any).mockResolvedValue(mockUser);
    (prisma.campaign.findUnique as any).mockResolvedValue(mockCampaign);
    (parseIntent as any).mockResolvedValue({ actionType: "general" });
  });

  async function postAction(character: Record<string, unknown>) {
    (buildCampaignContext as any).mockResolvedValue(buildContext(character));

    const req = new NextRequest(`http://localhost/api/campaign/${campaignId}/action`, {
      method: "POST",
      body: JSON.stringify({ action: "Look around the room" }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: campaignId }) });
    const body = await res.text();
    const frames = body
      .split("\n\n")
      .filter((chunk) => chunk.startsWith("data: "))
      .map((chunk) => JSON.parse(chunk.slice(6)));

    return { res, body, frames };
  }

  it("1. pending level-up: emits exactly one level_up_available frame", async () => {
    (prisma.character.findUnique as any).mockResolvedValue({
      id: characterId,
      class: "fighter",
      level: 1,
      xp: 300,
      maxHp: 10,
      hitDiceTotal: 1,
      stats: { CON: 10 },
    });

    const { frames } = await postAction({ level: 1, xp: 300, hitDiceTotal: 1 });

    const levelUpFrames = frames.filter((f) => f.t === "level_up_available");
    expect(levelUpFrames).toHaveLength(1);
    expect(levelUpFrames[0].payload).toMatchObject({
      characterId,
      fromLevel: 1,
      toLevel: 2,
      targetLevel: 2,
      pendingLevels: 1,
      requiresPlayerConfirmation: true,
    });
  });

  it("2. order: level_up_available appears after evt frames and before the first txt frame", async () => {
    (prisma.character.findUnique as any).mockResolvedValue({
      id: characterId,
      class: "fighter",
      level: 1,
      xp: 300,
      maxHp: 10,
      hitDiceTotal: 1,
      stats: { CON: 10 },
    });

    const { frames } = await postAction({ level: 1, xp: 300, hitDiceTotal: 1 });

    const types = frames.map((f) => f.t);
    const luIndex = types.indexOf("level_up_available");
    const firstTxtIndex = types.indexOf("txt");
    const lastEvtIndex = types.lastIndexOf("evt");

    expect(luIndex).toBeGreaterThan(-1);
    expect(luIndex).toBeGreaterThan(lastEvtIndex);
    if (firstTxtIndex !== -1) {
      expect(luIndex).toBeLessThan(firstTxtIndex);
    }
  });

  it("3. settled state (pendingLevels = 0): emits zero level_up_available frames", async () => {
    (prisma.character.findUnique as any).mockResolvedValue({
      id: characterId,
      class: "fighter",
      level: 1,
      xp: 0,
      maxHp: 10,
      hitDiceTotal: 1,
      stats: { CON: 10 },
    });

    const { frames } = await postAction({ level: 1, xp: 0, hitDiceTotal: 1 });

    expect(frames.filter((f) => f.t === "level_up_available")).toHaveLength(0);
  });

  it("4. Model E with a multi-level backlog: reports the single next step and the full target", async () => {
    (prisma.character.findUnique as any).mockResolvedValue({
      id: characterId,
      class: "fighter",
      level: 2,
      xp: 6_500,
      maxHp: 18,
      hitDiceTotal: 2,
      stats: { CON: 10 },
    });

    const { frames } = await postAction({ level: 2, xp: 6_500, hitDiceTotal: 2, maxHp: 18 });

    const levelUpFrames = frames.filter((f) => f.t === "level_up_available");
    expect(levelUpFrames).toHaveLength(1);
    expect(levelUpFrames[0].payload).toMatchObject({
      fromLevel: 2,
      toLevel: 3,
      targetLevel: 5,
      pendingLevels: 3,
    });
  });

  it("5. payload never carries an applied outcome", async () => {
    (prisma.character.findUnique as any).mockResolvedValue({
      id: characterId,
      class: "fighter",
      level: 1,
      xp: 300,
      maxHp: 10,
      hitDiceTotal: 1,
      stats: { CON: 10 },
    });

    const { frames } = await postAction({ level: 1, xp: 300, hitDiceTotal: 1 });

    const payload = frames.find((f) => f.t === "level_up_available")?.payload;
    expect(payload).toBeDefined();
    for (const appliedField of ["hpRoll", "hpGained", "newMaxHp", "newHitDiceTotal"]) {
      expect(payload).not.toHaveProperty(appliedField);
    }
  });

  it("6. invalid state (hitDiceTotal !== level): fails closed with zero frames", async () => {
    (prisma.character.findUnique as any).mockResolvedValue({
      id: characterId,
      class: "fighter",
      level: 2,
      xp: 6_500,
      maxHp: 18,
      hitDiceTotal: 1,
      stats: { CON: 10 },
    });

    const { frames } = await postAction({ level: 2, xp: 6_500, hitDiceTotal: 1, maxHp: 18 });

    expect(frames.filter((f) => f.t === "level_up_available")).toHaveLength(0);
  });

  it("7. detection failure: no frame is emitted, the stream still completes, and nothing mechanical is written", async () => {
    (prisma.character.findUnique as any).mockRejectedValue(new Error("db unavailable"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { res, frames } = await postAction({ level: 1, xp: 300, hitDiceTotal: 1 });

    expect(res.status).toBe(200);
    expect(frames.filter((f) => f.t === "level_up_available")).toHaveLength(0);
    expect(frames.some((f) => f.t === "done")).toBe(true);
    expect(prisma.character.update).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});

describe("Action Route - combat victory grants XP and surfaces level_up_available in the same response (docs/DECISION_XP_AWARD_AUTHORITY.md)", () => {
  const campaignId = "camp_123";
  const mockUser = { id: "user_123" };
  const mockCampaign = { id: campaignId, userId: mockUser.id, status: "active" };
  const characterId = "char-1";

  beforeEach(() => {
    vi.clearAllMocks();
    (getAuthUser as any).mockResolvedValue(mockUser);
    (prisma.campaign.findUnique as any).mockResolvedValue(mockCampaign);
  });

  it("increments Character.xp inside the resolving transaction, and the same response's fresh Character read surfaces level_up_available", async () => {
    const mockContext = {
      character: {
        id: characterId,
        name: "Hero",
        class: "fighter",
        level: 1,
        xp: 250,
        maxHp: 20,
        hp: 20,
        hitDiceTotal: 1,
        hitDiceRemaining: 1,
        stats: { STR: 16, DEX: 10, CON: 10 },
        spellSlots: null,
        concentrationSpellId: null,
        exhaustionLevel: 0,
        inventory: [],
      },
      relevantMemories: [],
      recentLogs: [],
      quests: [],
      currentExploration: null,
      activeEncounter: {
        id: "enc_1",
        currentTurnIndex: 0,
        round: 1,
        totalDamageDealt: 0,
        combatants: [
          { id: "p1", name: "Hero", ...NO_MODIFIERS, isPlayer: true, hp: 20, maxHp: 20, conditions: [], concentrationSpellId: null },
          { id: "t1", name: "Goblin", ...NO_MODIFIERS, isPlayer: false, hp: 1, maxHp: 7, conditions: [], concentrationSpellId: null },
        ],
      },
    };

    (buildCampaignContext as any).mockResolvedValue(mockContext);

    (prisma.combatant.findMany as any).mockResolvedValue([
      { id: "p1", ...NO_MODIFIERS, isPlayer: true, hp: 20 },
      { id: "t1", ...NO_MODIFIERS, isPlayer: false, hp: 0, xpValue: 50 },
    ]);
    (prisma.encounter.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.encounter.findUnique as any).mockResolvedValue({
      campaign: { characterId },
    });
    (prisma.character.findUnique as any).mockResolvedValue({
      id: characterId,
      class: "fighter",
      level: 1,
      xp: 300,
      maxHp: 20,
      hitDiceTotal: 1,
      stats: { CON: 10 },
    });

    const req = new NextRequest(`http://localhost/api/campaign/${campaignId}/action`, {
      method: "POST",
      body: JSON.stringify({ action: "Attack", targetIds: ["t1"] }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: campaignId }) });
    expect(res.status).toBe(200);
    const body = await res.text();
    const frames = body
      .split("\n\n")
      .filter((chunk) => chunk.startsWith("data: "))
      .map((chunk) => JSON.parse(chunk.slice(6)));

    expect(prisma.encounter.findUnique).toHaveBeenCalledWith({
      where: { id: "enc_1" },
      select: { campaign: { select: { characterId: true } } },
    });
    expect(prisma.character.update).toHaveBeenCalledWith({
      where: { id: characterId },
      data: { xp: { increment: 50 } },
    });

    const levelUpFrames = frames.filter((f: any) => f.t === "level_up_available");
    expect(levelUpFrames).toHaveLength(1);
    expect(levelUpFrames[0].payload).toMatchObject({
      characterId,
      fromLevel: 1,
      toLevel: 2,
    });
  });
});

describe("Action Route - rejected actions never enter canonical GameLog (DC-AUD-001)", () => {
  const campaignId = "camp_123";
  const mockUser = { id: "user_123" };
  const mockCampaign = { id: campaignId, userId: mockUser.id, status: "active" };

  const userLogWrites = (): unknown[] =>
    (prisma.gameLog.create as any).mock.calls.filter(
      ([args]: [{ data: { role: string } }]) => args?.data?.role === "user"
    );

  const expectContextBuiltFromCampaignIdAlone = () => {
    const calls = (buildCampaignContext as unknown as Mock).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(1);
    expect(calls[0][0]).toBe(campaignId);
  };

  const hostile = {
    id: "t1", name: "Goblin", hp: 10, maxHp: 10, ac: 10,
    conditions: "[]", ...NO_MODIFIERS, isPlayer: false,
  };
  const hero = {
    id: "p1", name: "Hero", hp: 20, maxHp: 20,
    conditions: "[]", ...NO_MODIFIERS, isPlayer: true,
  };

  const contextWith = (activeEncounter: unknown) => ({
    character: {
      id: "char-1",
      name: "Hero",
      class: "fighter",
      level: 1,
      stats: { STR: 14 },
      skillProficiencies: [],
      exhaustionLevel: 0,
      inventory: [
        { id: "w1", name: "Longsword", type: "weapon", equippedSlot: "MAIN_HAND", properties: {} },
      ],
    },
    relevantMemories: [],
    recentLogs: [],
    quests: [],
    currentExploration: null,
    activeEncounter,
  });

  const post = (body: Record<string, unknown>) =>
    POST(
      new NextRequest(`http://localhost/api/campaign/${campaignId}/action`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: campaignId }) }
    );

  beforeEach(() => {
    vi.clearAllMocks();
    (getAuthUser as any).mockResolvedValue(mockUser);
    (prisma.campaign.findUnique as any).mockResolvedValue(mockCampaign);
    (prisma.srdItem.findUnique as any).mockResolvedValue(null);
    (prisma.srdItem.findMany as any).mockResolvedValue([
      {
        id: "longsword",
        name: "Longsword",
        data: {
          weapon_category: "Martial",
          weapon_range: "Melee",
          damage: { damage_dice: "1d8", damage_type: { name: "Slashing" } },
          properties: [],
        },
      },
    ]);
  });

  it("1. `Attack` with no active encounter is refused and logs nothing", async () => {
    (buildCampaignContext as any).mockResolvedValue(contextWith(null));

    const res = await post({ action: "Attack" });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "No active encounter." });
    expect(userLogWrites()).toHaveLength(0);
    expect(streamNarrative).not.toHaveBeenCalled();
  });

  it("2. an invalid combat target is refused and logs nothing", async () => {
    (buildCampaignContext as any).mockResolvedValue(
      contextWith({
        id: "enc_123", currentTurnIndex: 0, round: 1, totalDamageDealt: 0,
        combatants: [hero, hostile],
      })
    );

    const res = await post({ action: "Attack", targetIds: ["not-in-this-fight"] });

    expect(res.status).toBe(400);
    expect(userLogWrites()).toHaveLength(0);
    expect(prisma.combatant.update).not.toHaveBeenCalled();
    expect(streamNarrative).not.toHaveBeenCalled();
  });

  it("3. an accepted mechanical action is logged exactly once, before narration", async () => {
    const combatants = [hero, hostile];
    (buildCampaignContext as any).mockResolvedValue(
      contextWith({
        id: "enc_123", currentTurnIndex: 0, round: 1, totalDamageDealt: 0, combatants,
      })
    );
    (prisma.combatant.findMany as any).mockResolvedValue(combatants);

    const res = await post({ action: "Attack", targetIds: ["t1"] });

    expect(res.status).toBe(200);
    expect(userLogWrites()).toHaveLength(1);
    expect(prisma.gameLog.create).toHaveBeenCalledWith({
      data: { campaignId, role: "user", content: "Attack" },
    });

    const firstUserWrite = (prisma.gameLog.create as any).mock.calls.findIndex(
      ([args]: [{ data: { role: string } }]) => args?.data?.role === "user"
    );
    const firstAssistantWrite = (prisma.gameLog.create as any).mock.calls.findIndex(
      ([args]: [{ data: { role: string } }]) => args?.data?.role === "assistant"
    );
    expect(firstUserWrite).toBeGreaterThanOrEqual(0);
    expect(firstAssistantWrite).toBeGreaterThan(firstUserWrite);
    expectContextBuiltFromCampaignIdAlone();
  });

  it("4. /roll still persists the player's command and its result", async () => {
    (buildCampaignContext as any).mockResolvedValue(contextWith(null));

    const res = await post({ action: "/roll 1d20+5" });

    expect(res.status).toBe(202);
    expect(userLogWrites()).toHaveLength(1);
    expect(prisma.gameLog.create).toHaveBeenCalledWith({
      data: { campaignId, role: "user", content: "/roll 1d20+5" },
    });
    expect(prisma.gameLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: "system",
          content: expect.stringContaining("🎲 Roll"),
        }),
      })
    );

    const calls = (prisma.gameLog.create as any).mock.calls;
    const userIdx = calls.findIndex(([a]: [{ data: { role: string } }]) => a?.data?.role === "user");
    const systemIdx = calls.findIndex(([a]: [{ data: { role: string } }]) => a?.data?.role === "system");
    expect(userIdx).toBeLessThan(systemIdx);
  });

  it("5. a general narrative action is logged exactly once and reaches narration", async () => {
    (buildCampaignContext as any).mockResolvedValue(contextWith(null));
    (parseIntent as any).mockResolvedValue({ actionType: "general" });

    const res = await post({ action: "I look around the room" });

    expect(res.status).toBe(200);
    expect(userLogWrites()).toHaveLength(1);
    expect(prisma.gameLog.create).toHaveBeenCalledWith({
      data: { campaignId, role: "user", content: "I look around the room" },
    });
    expect(streamNarrative).toHaveBeenCalled();
    expectContextBuiltFromCampaignIdAlone();
  });

  it("6. an ability check writes the player's line before the resolved roll", async () => {
    (buildCampaignContext as any).mockResolvedValue(contextWith(null));
    (parseIntent as any).mockResolvedValue({ actionType: "ability_check", skill: "Athletics" });

    const res = await post({ action: "I shove the door open" });

    expect(res.status).toBe(200);
    expect(userLogWrites()).toHaveLength(1);

    const calls = (prisma.gameLog.create as any).mock.calls;
    const userIdx = calls.findIndex(([a]: [{ data: { role: string } }]) => a?.data?.role === "user");
    const checkIdx = calls.findIndex(
      ([a]: [{ data: { role: string; content: string } }]) =>
        a?.data?.role === "system" && a.data.content.includes("Athletics check")
    );
    expect(checkIdx).toBeGreaterThan(-1);
    expect(userIdx).toBeLessThan(checkIdx);
  });

  it("7. an unclassifiable mechanical action is refused and logs nothing", async () => {
    (buildCampaignContext as any).mockResolvedValue(contextWith(null));
    (parseIntent as any).mockResolvedValue({ actionType: "mechanical_ambiguous" });

    const res = await post({ action: "I do the thing to the guy" });

    expect(res.status).toBe(400);
    expect(userLogWrites()).toHaveLength(0);
    expect(streamNarrative).not.toHaveBeenCalled();
  });

  it("8. an item the character does not own is refused and logs nothing", async () => {
    (buildCampaignContext as any).mockResolvedValue(contextWith(null));
    (parseIntent as any).mockResolvedValue({ actionType: "use_item", targetName: "Elixir of Fictional Health" });

    const res = await post({ action: "I drink the elixir" });

    expect(res.status).toBe(400);
    expect(userLogWrites()).toHaveLength(0);
    expect(streamNarrative).not.toHaveBeenCalled();
  });
});

describe("Action Route - requestId transport (DC-AUD-002)", () => {
  const campaignId = "camp_123";
  const mockUser = { id: "user_123" };
  const mockCampaign = { id: campaignId, userId: mockUser.id, status: "active" };

  const context = {
    character: {
      id: "char-1",
      name: "Hero",
      class: "fighter",
      level: 1,
      stats: { STR: 14 },
      skillProficiencies: [],
      exhaustionLevel: 0,
      inventory: [],
    },
    relevantMemories: [],
    recentLogs: [],
    quests: [],
    currentExploration: null,
    activeEncounter: null,
  };

  const post = (body: Record<string, unknown>) =>
    POST(
      new NextRequest(`http://localhost/api/campaign/${campaignId}/action`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: campaignId }) }
    );

  beforeEach(() => {
    vi.clearAllMocks();
    (getAuthUser as any).mockResolvedValue(mockUser);
    (prisma.campaign.findUnique as any).mockResolvedValue(mockCampaign);
    (buildCampaignContext as any).mockResolvedValue(context);
    (parseIntent as any).mockResolvedValue({ actionType: "general" });
    (prisma.actionRequestReceipt.create as any).mockResolvedValue({ id: "receipt_transport" });
    (prisma.actionRequestReceipt.updateMany as any).mockResolvedValue({ count: 1 });
  });

  it("accepts a body carrying requestId and resolves the action unchanged", async () => {
    const res = await post({
      requestId: "dungeon-action-test-123",
      action: "I look around the room",
    });

    expect(res.status).toBe(200);
    expect(streamNarrative).toHaveBeenCalled();
    expect((streamNarrative as any).mock.calls.at(-1)?.[1]).toBe("I look around the room");
    expect(prisma.gameLog.create).toHaveBeenCalledWith({
      data: { campaignId, role: "user", content: "I look around the room" },
    });
  });

  it("still accepts a legacy body with no requestId", async () => {
    const res = await post({ action: "I look around the room" });

    expect(res.status).toBe(200);
    expect(streamNarrative).toHaveBeenCalled();
  });

  it("refuses a requestId that is present but not a string", async () => {
    const res = await post({ requestId: 42, action: "I look around the room" });

    expect(res.status).toBe(400);
    expect(streamNarrative).not.toHaveBeenCalled();
    expect(prisma.gameLog.create).not.toHaveBeenCalled();
  });

  it("refuses an empty requestId rather than treating it as absent", async () => {
    const res = await post({ requestId: "   ", action: "I look around the room" });

    expect(res.status).toBe(400);
    expect(streamNarrative).not.toHaveBeenCalled();
  });

  it("refuses an oversized requestId", async () => {
    const res = await post({
      requestId: "x".repeat(ACTION_REQUEST_ID_MAX_CHARS + 1),
      action: "I look around the room",
    });

    expect(res.status).toBe(400);
    expect(streamNarrative).not.toHaveBeenCalled();
  });
});

describe("Action Route - persistent idempotency (DC-AUD-003)", () => {
  const campaignId = "camp_123";
  const mockUser = { id: "user_123" };
  const mockCampaign = { id: campaignId, userId: mockUser.id, status: "active" };
  const REQUEST_ID = "dungeon-action-test-idem";

  const NO_MODS = {
    damageImmunities: [] as string[],
    damageResistances: [] as string[],
    damageVulnerabilities: [] as string[],
    conditionImmunities: [] as string[],
  };
  const hostile = {
    id: "t1", name: "Goblin", hp: 10, maxHp: 10, ac: 10,
    conditions: "[]", ...NO_MODS, isPlayer: false,
  };
  const hero = {
    id: "p1", name: "Hero", hp: 20, maxHp: 20,
    conditions: "[]", ...NO_MODS, isPlayer: true,
  };

  const contextWith = (activeEncounter: unknown) => ({
    character: {
      id: "char-1", name: "Hero", class: "fighter", level: 1,
      stats: { STR: 14 }, skillProficiencies: [], exhaustionLevel: 0,
      inventory: [
        { id: "w1", name: "Longsword", type: "weapon", equippedSlot: "MAIN_HAND", properties: {} },
      ],
    },
    relevantMemories: [],
    recentLogs: [],
    quests: [],
    currentExploration: null,
    activeEncounter,
  });

  const post = (body: Record<string, unknown>) =>
    POST(
      new NextRequest(`http://localhost/api/campaign/${campaignId}/action`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: campaignId }) }
    );

  const uniqueViolation = (target: unknown) =>
    new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "6.19.2",
      meta: { target },
    });

  const userLogWrites = () =>
    (prisma.gameLog.create as any).mock.calls.filter(
      ([args]: [{ data: { role: string } }]) => args?.data?.role === "user"
    );

  const receiptAlreadyExists = (row: Record<string, unknown>) => {
    (prisma.actionRequestReceipt.create as any).mockRejectedValue(
      uniqueViolation(["actorUserId", "requestId"])
    );
    (prisma.actionRequestReceipt.findUnique as any).mockResolvedValue({
      campaignId,
      requestHash: fingerprintActionRequest({ action: "I look around the room" }),
      responseStatus: null,
      responseBody: null,
      ...row,
    });
  };

  const frames = async (res: Response) =>
    (await res.text())
      .split("\n\n")
      .filter((chunk) => chunk.startsWith("data: "))
      .map((chunk) => JSON.parse(chunk.slice(6)));

  beforeEach(() => {
    vi.clearAllMocks();
    (getAuthUser as any).mockResolvedValue(mockUser);
    (prisma.campaign.findUnique as any).mockResolvedValue(mockCampaign);
    (prisma.srdItem.findUnique as any).mockResolvedValue(null);
    (prisma.srdItem.findMany as any).mockResolvedValue([]);
    (prisma.actionRequestReceipt.create as any).mockResolvedValue({ id: "receipt_1" });
    (prisma.actionRequestReceipt.updateMany as any).mockResolvedValue({ count: 1 });
    (buildCampaignContext as any).mockResolvedValue(contextWith(null));
    (parseIntent as any).mockResolvedValue({ actionType: "general" });
  });

  it("1. acquires a receipt for a keyed action and completes it before narration", async () => {
    const res = await post({ requestId: REQUEST_ID, action: "I look around the room" });

    expect(res.status).toBe(200);
    expect(prisma.actionRequestReceipt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: mockUser.id,
          campaignId,
          requestId: REQUEST_ID,
          requestHash: fingerprintActionRequest({ action: "I look around the room" }),
          status: ActionRequestStatus.PROCESSING,
        }),
      })
    );
    expect(prisma.actionRequestReceipt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "receipt_1", status: ActionRequestStatus.PROCESSING },
        data: expect.objectContaining({ status: ActionRequestStatus.COMPLETED }),
      })
    );
    expect(streamNarrative).toHaveBeenCalled();
  });

  it("2. a completed retry re-executes no mechanics and writes no history", async () => {
    receiptAlreadyExists({ status: ActionRequestStatus.COMPLETED });

    const res = await post({ requestId: REQUEST_ID, action: "I look around the room" });

    expect(res.status).toBe(200);
    expect(streamNarrative).not.toHaveBeenCalled();
    expect(prisma.gameLog.create).not.toHaveBeenCalled();
    expect(prisma.combatant.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("3. the same id with a different payload is refused as reuse", async () => {
    receiptAlreadyExists({
      status: ActionRequestStatus.COMPLETED,
      requestHash: fingerprintActionRequest({ action: "a completely different action" }),
    });

    const res = await post({ requestId: REQUEST_ID, action: "I look around the room" });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: "REQUEST_ID_REUSED" });
    expect(streamNarrative).not.toHaveBeenCalled();
    expect(prisma.gameLog.create).not.toHaveBeenCalled();
    expect(prisma.actionRequestReceipt.updateMany).not.toHaveBeenCalled();
  });

  it("3b. an id belonging to another campaign is refused as reuse", async () => {
    receiptAlreadyExists({
      status: ActionRequestStatus.COMPLETED,
      campaignId: "some_other_campaign",
    });

    const res = await post({ requestId: REQUEST_ID, action: "I look around the room" });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: "REQUEST_ID_REUSED" });
    expect(streamNarrative).not.toHaveBeenCalled();
    expect(prisma.actionRequestReceipt.updateMany).not.toHaveBeenCalled();
  });

  it("4. an unsettled receipt is refused as in-flight and executes nothing", async () => {
    receiptAlreadyExists({ status: ActionRequestStatus.PROCESSING });

    const res = await post({ requestId: REQUEST_ID, action: "I look around the room" });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: "ACTION_IN_FLIGHT" });
    expect(streamNarrative).not.toHaveBeenCalled();
    expect(prisma.gameLog.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.actionRequestReceipt.updateMany).not.toHaveBeenCalled();
  });

  it("5. a mechanical refusal is recorded, and its retry replays without touching history", async () => {
    const refusal = await post({ requestId: REQUEST_ID, action: "Attack" });

    expect(refusal.status).toBe(400);
    expect(prisma.actionRequestReceipt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "receipt_1", status: ActionRequestStatus.PROCESSING },
        data: expect.objectContaining({
          status: ActionRequestStatus.REJECTED,
          responseStatus: 400,
        }),
      })
    );
    expect(userLogWrites()).toHaveLength(0);

    vi.clearAllMocks();
    (getAuthUser as any).mockResolvedValue(mockUser);
    (prisma.campaign.findUnique as any).mockResolvedValue(mockCampaign);
    (buildCampaignContext as any).mockResolvedValue(contextWith(null));
    receiptAlreadyExists({
      status: ActionRequestStatus.REJECTED,
      requestHash: fingerprintActionRequest({ action: "Attack" }),
      responseStatus: 400,
      responseBody: { error: "No active encounter." },
    });

    const replayed = await post({ requestId: REQUEST_ID, action: "Attack" });

    expect(replayed.status).toBe(400);
    await expect(replayed.json()).resolves.toEqual({ error: "No active encounter." });
    expect(userLogWrites()).toHaveLength(0);
    expect(prisma.gameLog.create).not.toHaveBeenCalled();
    expect(streamNarrative).not.toHaveBeenCalled();
    expect(prisma.actionRequestReceipt.updateMany).not.toHaveBeenCalled();
  });

  it("6. a legacy request without a requestId creates no receipt at all", async () => {
    const res = await post({ action: "I look around the room" });

    expect(res.status).toBe(200);
    expect(prisma.actionRequestReceipt.create).not.toHaveBeenCalled();
    expect(prisma.actionRequestReceipt.updateMany).not.toHaveBeenCalled();
    expect(streamNarrative).toHaveBeenCalled();
  });

  it("7. /roll stores its 202 and a retry replays it instead of rolling again", async () => {
    const rolled = await post({ requestId: REQUEST_ID, action: "/roll 1d20" });

    expect(rolled.status).toBe(202);
    expect(prisma.actionRequestReceipt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ActionRequestStatus.COMPLETED,
          responseStatus: 202,
          responseBody: { ok: true },
        }),
      })
    );

    vi.clearAllMocks();
    (getAuthUser as any).mockResolvedValue(mockUser);
    (prisma.campaign.findUnique as any).mockResolvedValue(mockCampaign);
    receiptAlreadyExists({
      status: ActionRequestStatus.COMPLETED,
      requestHash: fingerprintActionRequest({ action: "/roll 1d20" }),
      responseStatus: 202,
      responseBody: { ok: true },
    });

    const replayed = await post({ requestId: REQUEST_ID, action: "/roll 1d20" });

    expect(replayed.status).toBe(202);
    await expect(replayed.json()).resolves.toEqual({ ok: true });
    expect(prisma.gameLog.create).not.toHaveBeenCalled();
  });

  it("8. a completed streaming retry answers with a duplicate frame and no narrator call", async () => {
    receiptAlreadyExists({ status: ActionRequestStatus.COMPLETED });

    const res = await post({ requestId: REQUEST_ID, action: "I look around the room" });
    const parsed = await frames(res);

    expect(res.status).toBe(200);
    expect(parsed.map((f) => f.t)).toEqual(["duplicate", "done"]);
    expect(parsed[0]).toMatchObject({ requestId: REQUEST_ID });
    expect(streamNarrative).not.toHaveBeenCalled();
  });

  it("9. an unrelated unique violation is never read as an idempotency hit", async () => {
    (prisma.actionRequestReceipt.create as any).mockRejectedValue(
      uniqueViolation(["some_other_unique_column"])
    );

    await expect(post({ requestId: REQUEST_ID, action: "I look around the room" })).rejects.toThrow();
    expect(prisma.actionRequestReceipt.findUnique).not.toHaveBeenCalled();
    expect(streamNarrative).not.toHaveBeenCalled();
  });

  it("A. a completed streaming retry replays the stored events between duplicate and done", async () => {
    const stored = [
      { type: "TURN_ADVANCE", payload: { nextTurnIndex: 1, nextRound: 1 } },
      { type: "COMBAT_CONSEQUENCE", payload: { attackerName: "Hero", targets: [] } },
      { type: "ROUND_ADVANCE", payload: { nextTurnIndex: 0, nextRound: 2 } },
    ];
    receiptAlreadyExists({ status: ActionRequestStatus.COMPLETED, replayEvents: stored });

    const res = await post({ requestId: REQUEST_ID, action: "I look around the room" });
    const parsed = await frames(res);

    expect(res.status).toBe(200);
    expect(parsed.map((f) => f.t)).toEqual(["duplicate", "evt", "evt", "evt", "done"]);
    expect(parsed.slice(1, 4).map((f) => f.e)).toEqual(stored);
    expect(streamNarrative).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.combatant.update).not.toHaveBeenCalled();
    expect(prisma.gameLog.create).not.toHaveBeenCalled();
    expect(prisma.actionRequestReceipt.updateMany).not.toHaveBeenCalled();
  });

  it("B. a receipt written before replayEvents existed still answers duplicate then done", async () => {
    receiptAlreadyExists({ status: ActionRequestStatus.COMPLETED, replayEvents: null });

    const res = await post({ requestId: REQUEST_ID, action: "I look around the room" });
    const parsed = await frames(res);

    expect(parsed.map((f) => f.t)).toEqual(["duplicate", "done"]);
    expect(streamNarrative).not.toHaveBeenCalled();
  });

  it("C. /roll still replays its stored JSON and never treats replayEvents as a body", async () => {
    receiptAlreadyExists({
      status: ActionRequestStatus.COMPLETED,
      requestHash: fingerprintActionRequest({ action: "/roll 1d20" }),
      responseStatus: 202,
      responseBody: { ok: true },
      replayEvents: [{ type: "TURN_ADVANCE", payload: { nextTurnIndex: 1, nextRound: 1 } }],
    });

    const res = await post({ requestId: REQUEST_ID, action: "/roll 1d20" });

    expect(res.status).toBe(202);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(prisma.gameLog.create).not.toHaveBeenCalled();
  });

  it("D. a successful action stores the events it emitted", async () => {
    const combatants = [hero, hostile];
    (buildCampaignContext as any).mockResolvedValue(
      contextWith({ id: "enc_1", currentTurnIndex: 0, round: 1, totalDamageDealt: 0, combatants })
    );
    (prisma.combatant.findMany as any).mockResolvedValue(combatants);

    const res = await post({ requestId: REQUEST_ID, action: "End Turn" });

    expect(res.status).toBe(200);
    const completion = (prisma.actionRequestReceipt.updateMany as any).mock.calls.find(
      ([args]: [{ data: { status: string } }]) =>
        args?.data?.status === ActionRequestStatus.COMPLETED
    );
    expect(completion).toBeDefined();
    expect(completion![0].data.replayEvents).toEqual([
      expect.objectContaining({ type: expect.stringMatching(/^(TURN|ROUND)_ADVANCE$/) }),
    ]);
  });

  it("10. an encounter action completes its receipt exactly once", async () => {
    const combatants = [hero, hostile];
    (buildCampaignContext as any).mockResolvedValue(
      contextWith({ id: "enc_1", currentTurnIndex: 0, round: 1, totalDamageDealt: 0, combatants })
    );
    (prisma.combatant.findMany as any).mockResolvedValue(combatants);

    const res = await post({ requestId: REQUEST_ID, action: "End Turn" });

    expect(res.status).toBe(200);
    const completions = (prisma.actionRequestReceipt.updateMany as any).mock.calls.filter(
      ([args]: [{ data: { status: string } }]) =>
        args?.data?.status === ActionRequestStatus.COMPLETED
    );
    expect(completions).toHaveLength(1);
  });
});
