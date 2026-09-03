/**
 * tests/ai/tools/tool-result-contract.test.ts
 *
 * SEC-AI-001 PR2 — every tool in the catalogue below must satisfy the common
 * result contract on both success and failure, and must never leak an
 * exception message, stack, detail, query or any other internal information.
 *
 * The count is asserted, not stated: this header used to claim "28 narrator
 * tools" while the catalogue held 19, so the figure now lives only in the
 * assertion that can fail.
 *
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

/** Anything a leaking tool would carry out of the backend. */
const SECRET = "SECRET_INTERNAL_DETAIL postgres://user:pw@10.0.0.4/db";

class FakeSocialServiceError extends Error {
  constructor(public readonly code: string) {
    super(SECRET);
    this.name = "SocialServiceError";
  }
}

// ─── Service mocks ────────────────────────────────────────────────────────────

const services = vi.hoisted(() => ({
  spawnCombatEncounter: vi.fn(),
  grantLoot: vi.fn(),
  applyLevelUp: vi.fn(),
  createTrackedQuest: vi.fn(),
  generateNPC: vi.fn(),
  initialAttitudeFor: vi.fn(),
  resolveRumors: vi.fn(),
  resolveSocialCheck: vi.fn(),
  buildMerchantPayload: vi.fn(),
  getCampaignCharacterIdForTrade: vi.fn(),
  resolveTradeTransaction: vi.fn(),
  establishInitialNpcDisposition: vi.fn(),
  trackNpcState: vi.fn(),
  upsertGeneratedNpc: vi.fn(),
  generateExplorationLocation: vi.fn(),
  resolveExplorationTurn: vi.fn(),
  moveCampaignToNode: vi.fn(),
  resolveTravelWatch: vi.fn(),
  srdFindUnique: vi.fn(),
  srdFindMany: vi.fn(),
}));

vi.mock("@/lib/rules/encounter-service", () => ({
  spawnCombatEncounter: services.spawnCombatEncounter,
}));
vi.mock("@/lib/rules/loot-service", () => ({ grantLoot: services.grantLoot }));
vi.mock("@/lib/rules/level-up-service", () => ({ applyLevelUp: services.applyLevelUp }));
vi.mock("@/lib/rules/quest-service", () => ({
  createTrackedQuest: services.createTrackedQuest,
}));
vi.mock("@/lib/rules/npc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rules/npc")>()),
  generateNPC: services.generateNPC,
}));
vi.mock("@/lib/rules/social-logic", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rules/social-logic")>()),
  initialAttitudeFor: services.initialAttitudeFor,
}));
vi.mock("@/lib/rules/social-service", () => ({
  resolveRumors: services.resolveRumors,
  resolveSocialCheck: services.resolveSocialCheck,
}));
vi.mock("@/lib/rules/trade", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rules/trade")>()),
  buildMerchantPayload: services.buildMerchantPayload,
}));
vi.mock("@/lib/rules/trade-service", () => ({
  getCampaignCharacterIdForTrade: services.getCampaignCharacterIdForTrade,
  resolveTradeTransaction: services.resolveTradeTransaction,
}));
vi.mock("@/lib/rules/npc-service", () => ({
  establishInitialNpcDisposition: services.establishInitialNpcDisposition,
  trackNpcState: services.trackNpcState,
  upsertGeneratedNpc: services.upsertGeneratedNpc,
}));
vi.mock("@/lib/rules/exploration-service", () => ({
  generateExplorationLocation: services.generateExplorationLocation,
}));
vi.mock("@/lib/rules/exploration-turn-service", () => ({
  resolveExplorationTurn: services.resolveExplorationTurn,
}));
vi.mock("@/lib/rules/navigation-service", () => ({
  moveCampaignToNode: services.moveCampaignToNode,
}));
vi.mock("@/lib/rules/wilderness-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rules/wilderness-service")>()),
  resolveTravelWatch: services.resolveTravelWatch,
}));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    srdSpell: { findUnique: services.srdFindUnique, findMany: services.srdFindMany },
    srdMonster: { findUnique: services.srdFindUnique, findMany: services.srdFindMany },
    srdItem: { findUnique: services.srdFindUnique, findMany: services.srdFindMany },
  },
}));

import { buildSocialTools } from "@/lib/ai/tools/social";
import { buildExplorationTools } from "@/lib/ai/tools/exploration";
import { buildWildernessTool } from "@/lib/ai/tools/wilderness";
import { buildSrdTools } from "@/lib/ai/tools/srd-lookup";
import { isToolResult } from "@/lib/ai/tool-result";
import {
  EquipmentInfoOutputSchema,
  MonsterInfoOutputSchema,
  NpcDetailsOutputSchema,
  SpellInfoOutputSchema,
} from "@/lib/ai/read-only-projections";

const CAMPAIGN_ID = "campaign-contract-001";

function buildCatalogue(): Record<string, { execute: (...args: unknown[]) => unknown }> {
  return {
    ...buildSocialTools(CAMPAIGN_ID),
    ...buildExplorationTools(CAMPAIGN_ID),
    executeTravelWatch: buildWildernessTool(CAMPAIGN_ID),
    ...buildSrdTools(),
  } as never;
}

/** One valid input per catalogue tool. */
const TOOL_INPUTS: Record<string, Record<string, unknown>> = {
  getNPCDetails: { seed: "gate_guard", role: "guard" },
  trackNPC: { seed: "gate_guard", role: "guard", notes: "Gruff.", hp: 10 },
  generateAndTrackNPC: { seed: "gate_guard", role: "guard", notes: "Gruff." },
  establishInitialDisposition: { npcSeed: "gate_guard", npcRole: "guard" },
  socialCheck: {
    npcSeed: "gate_guard",
    approach: "persuade",
    intent: "Ask for directions.",
  },
  getRumors: { npcSeed: "gate_guard" },
  generateMerchant: { archetype: "general", npcSeed: "merchant_1" },
  executeTrade: {
    action: "buy",
    itemIndex: 0,
    quantity: 1,
    npcSeed: "merchant_1",
    archetype: "general",
  },
  generateLocation: { locationType: "dungeon", seed: "seed-1", parentLocationId: null },
  moveToNode: { targetNodeIndex: 2 },
  executeExplorationTurn: { action: "search", turnsToAdvance: 1 },
  executeTravelWatch: { action: "travel", direction: "north", pace: "normal" },
  getSpellInfo: { query: "fireball" },
  getItemInfo: { query: "cloak of protection" },
  getEquipmentInfo: { query: "longsword" },
  getMonsterInfo: { query: "goblin" },
};

const NPC_STATBLOCK = {
  name: "Aldric Fenwick",
  role: "guard",
  hp: 14,
  maxHp: 14,
  ac: 16,
  attackString: "1d6+2",
  race: "human",
  profession: "soldier",
  alignment: "lawful neutral",
  abilityScores: { STR: 15, DEX: 12, CON: 14, INT: 10, WIS: 13, CHA: 8 },
  traits: { personality: "p", ideal: "i", bond: "b", flaw: "f" },
};

function primeSuccess(): void {
  services.spawnCombatEncounter.mockResolvedValue({ encounterId: "enc-1", enemies: [] });
  services.generateNPC.mockReturnValue(NPC_STATBLOCK);
  services.initialAttitudeFor.mockReturnValue("Friendly");
  services.resolveRumors.mockResolvedValue({ npcName: "Bert", rumors: [] });
  services.resolveSocialCheck.mockResolvedValue({ dispositionBefore: 4, dispositionAfter: 6 });
  services.buildMerchantPayload.mockReturnValue({
    inventory: [{ name: "Rope", type: "gear", properties: {}, buyPriceGP: 1 }],
    sellModifier: 0.5,
  });
  services.getCampaignCharacterIdForTrade.mockResolvedValue("char-1");
  services.resolveTradeTransaction.mockResolvedValue({ goldAfter: 40, itemName: "Rope" });
  services.establishInitialNpcDisposition.mockResolvedValue(undefined);
  services.trackNpcState.mockResolvedValue({ seed: "gate_guard", name: "Aldric Fenwick" });
  services.upsertGeneratedNpc.mockResolvedValue({
    ok: true,
    seed: "gate_guard",
    name: "Aldric Fenwick",
    race: "human",
    profession: "soldier",
    alignment: "lawful neutral",
    traits: NPC_STATBLOCK.traits,
    facts: {},
  });
  services.generateExplorationLocation.mockResolvedValue({ locationId: "loc-1", nodes: [] });
  services.resolveExplorationTurn.mockResolvedValue({ turnsAdvanced: 1, warnings: [] });
  services.moveCampaignToNode.mockResolvedValue({
    targetNode: { index: 2 },
    adjacentNodes: [],
    passageType: "door",
    explorationXPHints: [],
    facts: {},
  });
  services.resolveTravelWatch.mockResolvedValue({ watch: "Dawn", discovered: true });
  services.srdFindUnique.mockResolvedValue({
    id: "fireball",
    name: "Fireball",
    data: { name: "Fireball" },
    hasHealing: false,
    damageType: "fire",
    saveAbility: "DEX",
    concentration: false,
    ritual: false,
    hasAreaOfEffect: true,
    school: "evocation",
    level: 3,
    indexSlug: "fireball",
    hitPoints: 7,
    armorClass: 15,
    properties: [],
    equipmentCategory: null,
    weaponCategory: null,
    weaponRange: null,
    categoryRange: null,
    costQuantity: null,
    costUnit: null,
    weight: null,
    damageDice: null,
    twoHandedDamageDice: null,
    twoHandedDamageType: null,
    rangeNormal: null,
    rangeLong: null,
    armorCategory: null,
    armorClassBase: null,
    armorClassDexBonus: null,
    armorClassMaxBonus: null,
    strMinimum: null,
    stealthDisadvantage: null,
    desc: null,
  });
  services.srdFindMany.mockResolvedValue([]);
}

/** Every backend dependency throws an error carrying internal detail. */
function primeFailure(): void {
  const boom = () => {
    throw new Error(SECRET);
  };
  const rejects = () => Promise.reject(new Error(SECRET));

  for (const [name, mock] of Object.entries(services)) {
    // Synchronous generators must throw; async services must reject.
    if (
      name === "generateNPC" ||
      name === "initialAttitudeFor" ||
      name === "buildMerchantPayload"
    ) {
      mock.mockImplementation(boom);
    } else {
      mock.mockImplementation(rejects);
    }
  }
}

/** SRD lookups answer "no match" rather than throwing. */
function primeNotFound(): void {
  services.srdFindUnique.mockResolvedValue(null);
  services.srdFindMany.mockResolvedValue([]);
}

function assertNoLeak(result: unknown): void {
  const serialised = JSON.stringify(result) ?? "";
  expect(serialised).not.toContain("SECRET_INTERNAL_DETAIL");
  expect(serialised).not.toContain("postgres://");
  expect(serialised).not.toContain("Error");
  expect(serialised).not.toContain("stack");
  expect(serialised).not.toContain("detail");
}

const CATALOGUE_NAMES = Object.keys(TOOL_INPUTS);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("narrator tool catalogue", () => {
  it("contains exactly the 16 known tools", () => {
    const catalogue = Object.keys(buildCatalogue());

    expect(catalogue).toHaveLength(16);
    expect(catalogue.sort()).toEqual([...CATALOGUE_NAMES].sort());
  });
});

describe("common result contract — success", () => {
  it.each(CATALOGUE_NAMES)("%s returns a validated success envelope", async (name) => {
    primeSuccess();
    const result = await buildCatalogue()[name]!.execute(TOOL_INPUTS[name], {
      messages: [],
      toolCallId: `tc-${name}`,
      toolName: name,
    });

    expect(isToolResult(result)).toBe(true);
    expect((result as { status: string }).status).toBe("ok");
    expect(result).toHaveProperty("data");
    expect(typeof result).toBe("object");
    // Never a hand-serialised JSON string.
    expect(typeof result).not.toBe("string");
  });
});

describe("common result contract — failure", () => {
  it.each(CATALOGUE_NAMES)("%s converts a thrown error into a safe failure", async (name) => {
    primeFailure();
    const result = await buildCatalogue()[name]!.execute(TOOL_INPUTS[name], {
      messages: [],
      toolCallId: `tc-${name}`,
      toolName: name,
    });

    expect(isToolResult(result)).toBe(true);
    expect((result as { status: string }).status).toBe("error");
    expect(result).not.toHaveProperty("data");
    assertNoLeak(result);
  });

  it.each(CATALOGUE_NAMES)("%s never rejects", async (name) => {
    primeFailure();

    await expect(
      buildCatalogue()[name]!.execute(TOOL_INPUTS[name], {
        messages: [],
        toolCallId: `tc-${name}`,
        toolName: name,
      }),
    ).resolves.toBeDefined();
  });
});

describe("SRD lookups — not_found", () => {
  it.each(["getSpellInfo", "getItemInfo", "getEquipmentInfo", "getMonsterInfo"])(
    "%s reports not_found instead of an error message",
    async (name) => {
      primeNotFound();
      const result = await buildCatalogue()[name]!.execute(TOOL_INPUTS[name], {
        messages: [],
        toolCallId: `tc-${name}`,
        toolName: name,
      });

      expect(result).toEqual({ status: "error", reason: "not_found" });
    },
  );
});

describe("envelope top-level keys", () => {
  it.each(CATALOGUE_NAMES)("%s emits only status and data on success", async (name) => {
    primeSuccess();
    const result = (await buildCatalogue()[name]!.execute(TOOL_INPUTS[name], {
      messages: [],
      toolCallId: `tc-${name}`,
      toolName: name,
    })) as object;

    expect(Object.keys(result).sort()).toEqual(["data", "status"]);
  });

  it.each(CATALOGUE_NAMES)("%s emits no key beyond the failure contract", async (name) => {
    primeFailure();
    const result = (await buildCatalogue()[name]!.execute(TOOL_INPUTS[name], {
      messages: [],
      toolCallId: `tc-${name}`,
      toolName: name,
    })) as object;

    const keys = Object.keys(result).sort();
    expect([["reason", "status"], ["code", "reason", "status"]]).toContainEqual(keys);
  });
});

describe("DTOs with undefined optional properties", () => {
  it("getMonsterInfo stays a success when SRD columns are null", async () => {
    primeSuccess();
    // A sparse SrdMonster row: every optional column is null, so the mapped DTO
    // carries undefined optional properties.
    services.srdFindUnique.mockResolvedValue({
      id: "goblin",
      indexSlug: "goblin",
      name: "Goblin",
      hitPoints: 7,
      armorClass: null,
      size: null,
      type: null,
      alignment: null,
      cr: null,
      xp: null,
      hitDice: null,
      speed: null,
      strength: null,
      dexterity: null,
      constitution: null,
      intelligence: null,
      wisdom: null,
      charisma: null,
    });

    const result = await buildCatalogue().getMonsterInfo!.execute(TOOL_INPUTS.getMonsterInfo, {
      messages: [],
      toolCallId: "tc-monster-sparse",
      toolName: "getMonsterInfo",
    });

    expect(isToolResult(result)).toBe(true);
    expect(result).toMatchObject({ status: "ok", data: { name: "Goblin", hit_points: 7 } });
    expect(Object.keys(result as object).sort()).toEqual(["data", "status"]);
  });
});

describe("socialCheck error classification", () => {
  it("keeps the stable domain code of a SocialServiceError", async () => {
    primeSuccess();
    services.resolveSocialCheck.mockRejectedValue(
      new FakeSocialServiceError("NPC_NOT_MET"),
    );

    const result = await buildCatalogue().socialCheck!.execute(TOOL_INPUTS.socialCheck, {
      messages: [],
      toolCallId: "tc-social",
      toolName: "socialCheck",
    });

    expect(result).toEqual({
      status: "error",
      reason: "rejected",
      code: "NPC_NOT_MET",
    });
    assertNoLeak(result);
  });

  it("converts an unknown error into a safe internal error", async () => {
    primeSuccess();
    services.resolveSocialCheck.mockRejectedValue(new Error(SECRET));

    const result = await buildCatalogue().socialCheck!.execute(TOOL_INPUTS.socialCheck, {
      messages: [],
      toolCallId: "tc-social",
      toolName: "socialCheck",
    });

    expect(result).toEqual({ status: "error", reason: "internal_error" });
    assertNoLeak(result);
  });

  it("converts a non-Error throw into a safe internal error", async () => {
    primeSuccess();
    services.resolveSocialCheck.mockRejectedValue(SECRET);

    const result = await buildCatalogue().socialCheck!.execute(TOOL_INPUTS.socialCheck, {
      messages: [],
      toolCallId: "tc-social",
      toolName: "socialCheck",
    });

    expect(result).toEqual({ status: "error", reason: "internal_error" });
    assertNoLeak(result);
  });
});

describe("active read-only tool projections", () => {
  const ACTIVE_PROJECTIONS = [
    ["getNPCDetails", NpcDetailsOutputSchema],
    ["getSpellInfo", SpellInfoOutputSchema],
    ["getEquipmentInfo", EquipmentInfoOutputSchema],
    ["getMonsterInfo", MonsterInfoOutputSchema],
  ] as const;

  it.each(ACTIVE_PROJECTIONS)("%s executes its real tool and returns only its closed projection", async (name, schema) => {
    primeSuccess();

    const result = await buildCatalogue()[name]!.execute(TOOL_INPUTS[name], {
      messages: [],
      toolCallId: `projection-${name}`,
      toolName: name,
    }) as { status: string; data?: unknown };

    expect(result.status).toBe("ok");
    expect(schema.safeParse(result.data).success).toBe(true);
    expect(Object.keys(result.data as object).sort()).toEqual(Object.keys(schema.shape).sort());
  });
});