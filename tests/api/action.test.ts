import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/campaign/[id]/action/route";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { NextRequest } from "next/server";
import { buildCampaignContext } from "@/lib/memory/context";
import { parseIntent } from "@/lib/ai/intent";
import { streamNarrative } from "@/lib/ai/narrator";

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
    inventoryItem: { delete: vi.fn(), update: vi.fn() },
    character: { findUnique: vi.fn(), update: vi.fn() },
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

  describe("free-text attack targeting", () => {
    const hostile = { id: "t1", name: "Goblin", hp: 10, maxHp: 10, ac: 10, conditions: "[]", isPlayer: false };
    const downed = { id: "t2", name: "Goblin", hp: 0, maxHp: 10, ac: 10, conditions: "[]", isPlayer: false };
    const hero = { id: "p1", name: "Hero", isPlayer: true, hp: 20, maxHp: 20, conditions: "[]" };

    const contextWith = (combatants: unknown[]) => ({
      character: {
        id: "char-1",
        name: "Hero",
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

    // Not refused: the dice settle it and narration proceeds.
    expect(res.status).toBe(200);

    // The resolved result reaches the narrator as an already-decided fact.
    expect(prisma.gameLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: "system",
          // +3 STR and +3 proficiency (level 5), so the stored proficiencies
          // reach the roll rather than being silently dropped.
          // No band on the intent, so the check falls back to "medium" (DC 15)
          // and the line names the band it used.
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

  it("handles multi-target Attack via targetIds", async () => {
    const target1 = { id: "t1", name: "Goblin 1", hp: 10, maxHp: 10, ac: 10, conditions: "[]", isPlayer: false };
    const target2 = { id: "t2", name: "Goblin 2", hp: 10, maxHp: 10, ac: 10, conditions: "[]", isPlayer: false };
    
    const mockContext = {
      character: { name: "Hero", stats: { STR: 10 }, inventory: [] },
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
    
    // Attack macro returns a stream (narrative), but we check the logic triggered before that.
    expect(res.status).toBe(200);
    
    // Verify Prisma mutations
    // Should have 2 target updates and 1 encounter update in the transaction
    expect(prisma.combatant.update).toHaveBeenCalledTimes(2);
    expect(prisma.encounter.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "enc_123" }
    }));
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

  it("falls back to auto-targeting if targetIds is missing", async () => {
    const target1 = { id: "t1", name: "Goblin 1", hp: 10, maxHp: 10, ac: 10, conditions: "[]", isPlayer: false };
    const mockContext = {
      character: { name: "Hero", stats: { STR: 10 }, inventory: [] },
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
    expect(res.status).toBe(200);
    
    // Should have target auto-selected
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

  // Full canonical context so formatSystemPrompt (real, unmocked) can render
  // it. Only `character` fields are varied per test; everything else stays
  // fixed and empty/absent.
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
    // A benign, non-mechanical intent so none of the mechanical gates fire —
    // this test suite is only exercising the presentation frame, not combat,
    // rest, spellcasting, or movement.
    //
    // Must be a value IntentSchema can actually produce. This used to be
    // "look", which the schema rejects: the whole suite was asserting the
    // behaviour of a request that cannot exist. "general" is the real
    // classification for input with no mechanical gate.
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
      xp: 300, // xpForLevel(2) — one ascension earned
      maxHp: 10,
      hitDiceTotal: 1, // settled: hitDiceTotal === level
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
      xp: 6_500, // xpForLevel(5)
      maxHp: 18,
      hitDiceTotal: 2, // settled: hitDiceTotal === level
      stats: { CON: 10 },
    });

    const { frames } = await postAction({ level: 2, xp: 6_500, hitDiceTotal: 2, maxHp: 18 });

    const levelUpFrames = frames.filter((f) => f.t === "level_up_available");
    expect(levelUpFrames).toHaveLength(1);
    expect(levelUpFrames[0].payload).toMatchObject({
      fromLevel: 2,
      toLevel: 3, // never a multi-level jump
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
      hitDiceTotal: 1, // mismatch — old-contract residue, not trustworthy
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
        xp: 250, // xpForLevel(2) = 300 — 50 short of the next ascension
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
          { id: "p1", name: "Hero", isPlayer: true, hp: 20, maxHp: 20, conditions: [], concentrationSpellId: null },
          { id: "t1", name: "Goblin", isPlayer: false, hp: 1, maxHp: 7, conditions: [], concentrationSpellId: null },
        ],
      },
    };

    (buildCampaignContext as any).mockResolvedValue(mockContext);

    // finalizeEncounterTurn re-reads combatants fresh, inside the transaction —
    // this snapshot (not the attack's own damage math) is what drives
    // "all_enemies_dead". The enemy already carries its backend-authorized
    // xpValue snapshot (docs/DECISION_XP_AWARD_AUTHORITY.md §5-§6).
    (prisma.combatant.findMany as any).mockResolvedValue([
      { id: "p1", isPlayer: true, hp: 20 },
      { id: "t1", isPlayer: false, hp: 0, xpValue: 50 },
    ]);
    (prisma.encounter.updateMany as any).mockResolvedValue({ count: 1 });
    // Recipient derived exclusively from persisted state: Encounter → Campaign
    // → characterId (§4) — never from the client, the AI, or a combatant id.
    (prisma.encounter.findUnique as any).mockResolvedValue({
      campaign: { characterId },
    });
    // The fresh, post-transaction read that drives detectPendingLevelUp —
    // reflects Character.xp already incremented by the atomic
    // `xp: { increment: 50 } }` write made inside the transaction (250 + 50 = 300).
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

    // The award itself: derived from Encounter → Campaign → characterId,
    // applied as an atomic increment, never an absolute computed value.
    expect(prisma.encounter.findUnique).toHaveBeenCalledWith({
      where: { id: "enc_1" },
      select: { campaign: { select: { characterId: true } } },
    });
    expect(prisma.character.update).toHaveBeenCalledWith({
      where: { id: characterId },
      data: { xp: { increment: 50 } },
    });

    // Same response, same request cycle: level_up_available appears because
    // the fresh post-transaction read already reflects the incremented XP.
    const levelUpFrames = frames.filter((f: any) => f.t === "level_up_available");
    expect(levelUpFrames).toHaveLength(1);
    expect(levelUpFrames[0].payload).toMatchObject({
      characterId,
      fromLevel: 1,
      toLevel: 2,
    });
  });
});
