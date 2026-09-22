/**
 * tests/memory/context-scene-presence.test.ts
 *
 * DC-NARR-002B PR 3 — Canonical Scene-Presence Reader Activation
 *
 * Comprehensive regression tests verifying:
 *   - TEST A: Legacy compatibility (scenePresenceVersion = 0 uses currentNode.npcSeed)
 *   - TEST B: Canonical participant wins (scenePresenceVersion >= 1 uses CampaignSceneParticipant)
 *   - TEST C: Canonical empty scene is authoritative (zero participants = no NPC, fail-closed)
 *   - TEST D: Legacy mode ignores staged canonical state (version 0 preserves legacy resolution)
 *   - TEST E: Multiple canonical participants preserved without arbitrary truncation
 *   - TEST F: Cross-campaign tenant isolation
 *   - TEST G: Canonical read failure fails closed (no resurrection of legacy presence)
 *   - TEST H: Independent NPC disclosure rules and secret protection
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  campaign: { findUnique: vi.fn() },
  encounter: { findFirst: vi.fn() },
  gameLog: { findMany: vi.fn() },
  quest: { findMany: vi.fn() },
  nPC: { findUnique: vi.fn() },
  location: { findUnique: vi.fn() },
  campaignSceneParticipant: { findMany: vi.fn() },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/memory/search", () => ({
  searchMemories: vi.fn().mockResolvedValue("No relevant memories found."),
}));

import { buildCampaignContext } from "@/lib/memory/context";
import { formatCanonicalState } from "@/lib/memory/formatter";

const CHARACTER = {
  id: "char-1",
  name: "Thalindra",
  race: "Elf",
  class: "wizard",
  level: 3,
  hp: 18,
  maxHp: 22,
  xp: 900,
  stats: { STR: 8 },
  spellSlots: null,
  skillProficiencies: null,
  concentrationSpellId: null,
  hitDiceTotal: 3,
  hitDiceRemaining: 3,
  exhaustionLevel: 0,
  inventory: [],
  profile: null,
};

const TRAITS_GRETA = {
  personality: "Speaks in short, hammered sentences.",
  ideal: "A debt paid is a debt forgotten.",
  bond: "The forge her father built.",
  flaw: "Will not admit when a piece is beyond saving.",
};

const PERSONALITY_GRETA = {
  motivation: "To buy back the family forge.",
  secret: "They sold the deed to pay a debt.",
  distinctiveTrait: "Taps the counter twice before speaking.",
};

const TRAITS_ELODIE = {
  personality: "Watches the door more than the table.",
  ideal: "Knowledge kept secret is leverage preserved.",
  bond: "A leather-bound ledger with brass corners.",
  flaw: "Cannot resist correcting a misquoted law.",
};

const PERSONALITY_ELODIE = {
  motivation: "To catalog the ancient archives.",
  secret: "She smuggled the royal seals out of the capital.",
  distinctiveTrait: "Rolls a brass signet ring between her fingers.",
};

function primeDatabase(options: {
  scenePresenceVersion?: number;
  hasLegacySeed?: boolean;
  legacySeed?: string;
}) {
  const {
    scenePresenceVersion = 0,
    hasLegacySeed = false,
    legacySeed = "innkeeper_1",
  } = options;

  prismaMock.campaign.findUnique.mockResolvedValue({
    character: CHARACTER,
    gold: 50,
    scenePresenceVersion,
    currentLocationId: "loc-1",
    currentNodeId: "node-1",
  });

  prismaMock.encounter.findFirst.mockResolvedValue(null);
  prismaMock.gameLog.findMany.mockResolvedValue([]);
  prismaMock.quest.findMany.mockResolvedValue([]);

  prismaMock.location.findUnique.mockResolvedValue({
    id: "loc-1",
    name: "The Gilded Boar",
    type: "tavern",
    description: "Smoke and low talk.",
    nodes: [
      {
        id: "node-1",
        index: 0,
        name: "The Taproom",
        description: "Benches, spilled ale.",
        feature: hasLegacySeed ? "npc" : null,
        npcSeed: hasLegacySeed ? legacySeed : null,
        x: 0,
        y: 0,
      },
    ],
    edges: [],
  });

  prismaMock.nPC.findUnique.mockImplementation(
    async (args: { where: { campaignId_seed: { campaignId: string; seed: string } } }) => {
      if (args.where.campaignId_seed.seed === "innkeeper_1") {
        return {
          name: "Greta",
          race: "dwarf",
          profession: "blacksmith",
          alignment: "lawful neutral",
          traits: TRAITS_GRETA,
          disposition: 8,
          personalityTags: PERSONALITY_GRETA,
          hasMetPlayer: true,
        };
      }
      return null;
    }
  );
}

describe("DC-NARR-002B PR 3 — Canonical Scene-Presence Reader Activation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * TEST A — Legacy compatibility
   * Given scenePresenceVersion = 0 and current node has a valid npcSeed matching an NPC,
   * existing legacy NPC context is returned.
   */
  it("TEST A: resolves legacy NPC via currentNode.npcSeed when scenePresenceVersion is 0", async () => {
    primeDatabase({ scenePresenceVersion: 0, hasLegacySeed: true, legacySeed: "innkeeper_1" });

    const context = await buildCampaignContext("campaign-1");

    expect(prismaMock.campaignSceneParticipant.findMany).not.toHaveBeenCalled();
    expect(prismaMock.nPC.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campaignId_seed: { campaignId: "campaign-1", seed: "innkeeper_1" } },
      })
    );
    expect(context.activeNPC).toEqual(
      expect.objectContaining({
        name: "Greta",
        race: "dwarf",
        profession: "blacksmith",
      })
    );
    expect(context.activeNPCs).toHaveLength(1);
    expect(context.activeNPCs[0].name).toBe("Greta");
  });

  /**
   * TEST B — Canonical participant wins
   * Given scenePresenceVersion >= 1 and CampaignSceneParticipant contains a persisted NPC,
   * that participant is returned as scene NPC context, NOT depending on currentNode.npcSeed.
   */
  it("TEST B: resolves canonical participant when scenePresenceVersion >= 1, ignoring legacy npcSeed", async () => {
    primeDatabase({ scenePresenceVersion: 1, hasLegacySeed: true, legacySeed: "innkeeper_1" });

    prismaMock.campaignSceneParticipant.findMany.mockResolvedValue([
      {
        campaignId: "campaign-1",
        npcId: "npc-elodie",
        npc: {
          name: "Elodie",
          race: "human",
          profession: "archivist",
          alignment: "neutral",
          traits: TRAITS_ELODIE,
          disposition: 4,
          personalityTags: PERSONALITY_ELODIE,
          hasMetPlayer: true,
        },
      },
    ]);

    const context = await buildCampaignContext("campaign-1");

    expect(prismaMock.campaignSceneParticipant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campaignId: "campaign-1" },
        orderBy: { npcId: "asc" },
      })
    );
    expect(prismaMock.nPC.findUnique).not.toHaveBeenCalled();
    expect(context.activeNPC).toEqual(
      expect.objectContaining({
        name: "Elodie",
        race: "human",
        profession: "archivist",
      })
    );
    expect(context.activeNPCs).toHaveLength(1);
    expect(context.activeNPCs[0].name).toBe("Elodie");

    const prompt = formatCanonicalState(context);
    expect(prompt).toContain("🎭 NPC: Elodie");
    expect(prompt).not.toContain("innkeeper_1");
    expect(prompt).toContain("NPC: Elodie");
  });

  /**
   * TEST C — Canonical empty scene is authoritative (Critical regression)
   * Given scenePresenceVersion >= 1 and the participant table has zero rows,
   * NPC context is empty/null, even when currentNode.npcSeed points to a legacy NPC.
   */
  it("TEST C: empty participant table in canonical mode returns null/empty with NO legacy fallback", async () => {
    primeDatabase({ scenePresenceVersion: 1, hasLegacySeed: true, legacySeed: "innkeeper_1" });

    prismaMock.campaignSceneParticipant.findMany.mockResolvedValue([]);

    const context = await buildCampaignContext("campaign-1");

    expect(prismaMock.campaignSceneParticipant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campaignId: "campaign-1" },
      })
    );
    expect(prismaMock.nPC.findUnique).not.toHaveBeenCalled();
    expect(context.activeNPC).toBeNull();
    expect(context.activeNPCs).toEqual([]);

    const prompt = formatCanonicalState(context);
    expect(prompt).not.toContain("🎭 NPC");
    expect(prompt).not.toContain("innkeeper_1");
    expect(prompt).toContain("NPC: None");
  });

  /**
   * TEST D — Legacy mode ignores staged canonical state
   * Given scenePresenceVersion = 0, the reader preserves legacy semantics even if
   * participant rows exist in the database.
   */
  it("TEST D: scenePresenceVersion = 0 ignores staged canonical participants", async () => {
    primeDatabase({ scenePresenceVersion: 0, hasLegacySeed: true, legacySeed: "innkeeper_1" });

    prismaMock.campaignSceneParticipant.findMany.mockResolvedValue([
      {
        campaignId: "campaign-1",
        npcId: "npc-elodie",
        npc: {
          name: "Elodie",
          race: "human",
          profession: "archivist",
          alignment: "neutral",
          traits: TRAITS_ELODIE,
          disposition: 4,
          personalityTags: PERSONALITY_ELODIE,
          hasMetPlayer: true,
        },
      },
    ]);

    const context = await buildCampaignContext("campaign-1");

    expect(prismaMock.campaignSceneParticipant.findMany).not.toHaveBeenCalled();
    expect(prismaMock.nPC.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campaignId_seed: { campaignId: "campaign-1", seed: "innkeeper_1" } },
      })
    );
    expect(context.activeNPC?.name).toBe("Greta");
    expect(context.activeNPCs[0].name).toBe("Greta");
  });

  /**
   * TEST E — Multiple canonical participants
   * Given two or more canonical scene participants, the reader preserves all of them
   * without arbitrary truncation or data loss.
   */
  it("TEST E: preserves multiple canonical participants in stable order", async () => {
    primeDatabase({ scenePresenceVersion: 1, hasLegacySeed: false });

    prismaMock.campaignSceneParticipant.findMany.mockResolvedValue([
      {
        campaignId: "campaign-1",
        npcId: "npc-1-elodie",
        npc: {
          name: "Elodie",
          race: "human",
          profession: "archivist",
          alignment: "neutral",
          traits: TRAITS_ELODIE,
          disposition: 4,
          personalityTags: PERSONALITY_ELODIE,
          hasMetPlayer: true,
        },
      },
      {
        campaignId: "campaign-1",
        npcId: "npc-2-greta",
        npc: {
          name: "Greta",
          race: "dwarf",
          profession: "blacksmith",
          alignment: "lawful neutral",
          traits: TRAITS_GRETA,
          disposition: 8,
          personalityTags: PERSONALITY_GRETA,
          hasMetPlayer: true,
        },
      },
    ]);

    const context = await buildCampaignContext("campaign-1");

    expect(prismaMock.campaignSceneParticipant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campaignId: "campaign-1" },
        orderBy: { npcId: "asc" },
      })
    );
    expect(context.activeNPCs).toHaveLength(2);
    expect(context.activeNPCs[0].name).toBe("Elodie");
    expect(context.activeNPCs[1].name).toBe("Greta");
    // Single-NPC compatibility view resolves to null for multi-NPC scenes (DC-NARR-002B-R2)
    expect(context.activeNPC).toBeNull();

    const prompt = formatCanonicalState(context);
    expect(prompt).toContain("🎭 NPC: Elodie");
    expect(prompt).toContain("🎭 NPC: Greta");
  });

  /**
   * TEST 4 — Three or more canonical participants
   * Given three or more canonical scene participants, activeNPC is null
   * and all canonical participants are preserved in deterministic order.
   */
  it("TEST 4: preserves three or more canonical participants in deterministic order with activeNPC null", async () => {
    primeDatabase({ scenePresenceVersion: 1, hasLegacySeed: false });

    prismaMock.campaignSceneParticipant.findMany.mockResolvedValue([
      {
        campaignId: "campaign-1",
        npcId: "npc-1-elodie",
        npc: {
          name: "Elodie",
          race: "human",
          profession: "archivist",
          alignment: "neutral",
          traits: TRAITS_ELODIE,
          disposition: 4,
          personalityTags: PERSONALITY_ELODIE,
          hasMetPlayer: true,
        },
      },
      {
        campaignId: "campaign-1",
        npcId: "npc-2-greta",
        npc: {
          name: "Greta",
          race: "dwarf",
          profession: "blacksmith",
          alignment: "lawful neutral",
          traits: TRAITS_GRETA,
          disposition: 8,
          personalityTags: PERSONALITY_GRETA,
          hasMetPlayer: true,
        },
      },
      {
        campaignId: "campaign-1",
        npcId: "npc-3-milo",
        npc: {
          name: "Milo",
          race: "halfling",
          profession: "scout",
          alignment: "chaotic good",
          traits: null,
          disposition: 5,
          personalityTags: null,
          hasMetPlayer: true,
        },
      },
    ]);

    const context = await buildCampaignContext("campaign-1");

    expect(prismaMock.campaignSceneParticipant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campaignId: "campaign-1" },
        orderBy: { npcId: "asc" },
      })
    );
    expect(context.activeNPCs).toHaveLength(3);
    expect(context.activeNPCs.map((n) => n.name)).toEqual(["Elodie", "Greta", "Milo"]);
    expect(context.activeNPC).toBeNull();

    const prompt = formatCanonicalState(context);
    expect(prompt).toContain("🎭 NPC: Elodie");
    expect(prompt).toContain("🎭 NPC: Greta");
    expect(prompt).toContain("🎭 NPC: Milo");
  });

  /**
   * TEST 5 — Formatter renders all canonical participants when activeNPC is null
   * Given activeNPC = null and activeNPCs = [NPC A, NPC B],
   * the formatter must still emit all canonical participants.
   */
  it("TEST 5: formatter renders all participants from activeNPCs when activeNPC is null", () => {
    const prompt = formatCanonicalState({
      character: CHARACTER,
      activeEncounter: null,
      recentLogs: [],
      relevantMemories: [],
      quests: [],
      currentExploration: null,
      gold: 10,
      activeNPCs: [
        {
          name: "Elodie",
          race: "human",
          profession: "archivist",
          alignment: "neutral",
          traits: TRAITS_ELODIE,
          disposition: 4,
          personalityTags: PERSONALITY_ELODIE,
          hasMetPlayer: true,
        },
        {
          name: "Greta",
          race: "dwarf",
          profession: "blacksmith",
          alignment: "lawful neutral",
          traits: TRAITS_GRETA,
          disposition: 8,
          personalityTags: PERSONALITY_GRETA,
          hasMetPlayer: true,
        },
      ],
      activeNPC: null,
    });

    expect(prompt).toContain("🎭 NPC: Elodie");
    expect(prompt).toContain("🎭 NPC: Greta");
  });

  /**
   * TEST F — Cross-campaign tenant isolation
   * A query for campaign A must strictly filter by campaignId.
   */
  it("TEST F: strictly enforces campaignId scoping for tenant isolation", async () => {
    primeDatabase({ scenePresenceVersion: 1, hasLegacySeed: false });

    prismaMock.campaignSceneParticipant.findMany.mockImplementation(
      async (args: { where: { campaignId: string } }) => {
        if (args.where.campaignId === "campaign-tenant-b") {
          return [
            {
              campaignId: "campaign-tenant-b",
              npcId: "npc-elodie",
              npc: {
                name: "Elodie",
                race: "human",
                profession: "archivist",
                alignment: "neutral",
                traits: TRAITS_ELODIE,
                disposition: 4,
                personalityTags: PERSONALITY_ELODIE,
                hasMetPlayer: true,
              },
            },
          ];
        }
        return [];
      }
    );

    const contextA = await buildCampaignContext("campaign-tenant-a");
    expect(prismaMock.campaignSceneParticipant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campaignId: "campaign-tenant-a" },
      })
    );
    expect(contextA.activeNPCs).toHaveLength(0);
    expect(contextA.activeNPC).toBeNull();

    const contextB = await buildCampaignContext("campaign-tenant-b");
    expect(prismaMock.campaignSceneParticipant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campaignId: "campaign-tenant-b" },
      })
    );
    expect(contextB.activeNPCs).toHaveLength(1);
    expect(contextB.activeNPC?.name).toBe("Elodie");
  });

  /**
   * TEST G — Canonical read failure fails closed
   * If canonical presence is active but its read fails:
   *   - no legacy fallback;
   *   - no stale NPC;
   *   - soft failure with empty NPC context.
   */
  it("TEST G: fails closed when canonical participant query fails, never falling back to legacy npcSeed", async () => {
    primeDatabase({ scenePresenceVersion: 1, hasLegacySeed: true, legacySeed: "innkeeper_1" });

    prismaMock.campaignSceneParticipant.findMany.mockRejectedValue(
      new Error("Database transient network timeout")
    );

    const context = await buildCampaignContext("campaign-1");

    expect(prismaMock.nPC.findUnique).not.toHaveBeenCalled();
    expect(context.activeNPC).toBeNull();
    expect(context.activeNPCs).toEqual([]);

    const prompt = formatCanonicalState(context);
    expect(prompt).not.toContain("🎭 NPC");
  });

  /**
   * TEST H — Disclosure rules & no cross-NPC leakage
   * Secrets are evaluated independently per participant based on disposition.
   */
  it("TEST H: enforces disclosure rules independently per participant without cross-leakage", async () => {
    primeDatabase({ scenePresenceVersion: 1, hasLegacySeed: false });

    prismaMock.campaignSceneParticipant.findMany.mockResolvedValue([
      {
        campaignId: "campaign-1",
        npcId: "npc-1",
        npc: {
          name: "Greta",
          race: "dwarf",
          profession: "blacksmith",
          alignment: "lawful neutral",
          traits: TRAITS_GRETA,
          disposition: 8, // Trusted -> secret disclosed
          personalityTags: PERSONALITY_GRETA,
          hasMetPlayer: true,
        },
      },
      {
        campaignId: "campaign-1",
        npcId: "npc-2",
        npc: {
          name: "Elodie",
          race: "human",
          profession: "archivist",
          alignment: "neutral",
          traits: TRAITS_ELODIE,
          disposition: 2, // Indifferent -> secret withheld
          personalityTags: PERSONALITY_ELODIE,
          hasMetPlayer: true,
        },
      },
    ]);

    const context = await buildCampaignContext("campaign-1");
    const prompt = formatCanonicalState(context);

    // Greta is trusted: her secret is present
    expect(prompt).toContain("🎭 NPC: Greta");
    expect(prompt).toContain(PERSONALITY_GRETA.secret);

    // Elodie is guarded: her secret must NOT leak
    expect(prompt).toContain("🎭 NPC: Elodie");
    expect(prompt).not.toContain(PERSONALITY_ELODIE.secret);
  });

  it("activates canonical mode for versions greater than 1 (scenePresenceVersion >= 1)", async () => {
    primeDatabase({ scenePresenceVersion: 2, hasLegacySeed: false });

    prismaMock.campaignSceneParticipant.findMany.mockResolvedValue([
      {
        campaignId: "campaign-1",
        npcId: "npc-elodie",
        npc: {
          name: "Elodie",
          race: "human",
          profession: "archivist",
          alignment: "neutral",
          traits: TRAITS_ELODIE,
          disposition: 4,
          personalityTags: PERSONALITY_ELODIE,
          hasMetPlayer: true,
        },
      },
    ]);

    const context = await buildCampaignContext("campaign-1");

    expect(prismaMock.campaignSceneParticipant.findMany).toHaveBeenCalled();
    expect(context.activeNPCs).toHaveLength(1);
    expect(context.activeNPC?.name).toBe("Elodie");
  });

  it("skips participant rows with null joined NPC without throwing (fail-closed)", async () => {
    primeDatabase({ scenePresenceVersion: 1, hasLegacySeed: false });

    prismaMock.campaignSceneParticipant.findMany.mockResolvedValue([
      {
        campaignId: "campaign-1",
        npcId: "npc-broken",
        npc: null,
      },
      {
        campaignId: "campaign-1",
        npcId: "npc-elodie",
        npc: {
          name: "Elodie",
          race: "human",
          profession: "archivist",
          alignment: "neutral",
          traits: TRAITS_ELODIE,
          disposition: 4,
          personalityTags: PERSONALITY_ELODIE,
          hasMetPlayer: true,
        },
      },
    ]);

    const context = await buildCampaignContext("campaign-1");

    expect(context.activeNPCs).toHaveLength(1);
    expect(context.activeNPCs[0].name).toBe("Elodie");
    expect(context.activeNPC?.name).toBe("Elodie");
  });

  it("returns empty NPC context when scenePresenceVersion = 0 and node has no npcSeed, ignoring staged participants", async () => {
    primeDatabase({ scenePresenceVersion: 0, hasLegacySeed: false });

    prismaMock.campaignSceneParticipant.findMany.mockResolvedValue([
      {
        campaignId: "campaign-1",
        npcId: "npc-elodie",
        npc: {
          name: "Elodie",
          race: "human",
          profession: "archivist",
          alignment: "neutral",
          traits: TRAITS_ELODIE,
          disposition: 4,
          personalityTags: PERSONALITY_ELODIE,
          hasMetPlayer: true,
        },
      },
    ]);

    const context = await buildCampaignContext("campaign-1");

    expect(prismaMock.campaignSceneParticipant.findMany).not.toHaveBeenCalled();
    expect(context.activeNPCs).toEqual([]);
    expect(context.activeNPC).toBeNull();
  });
});
