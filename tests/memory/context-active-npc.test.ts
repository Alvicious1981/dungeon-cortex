/**
 * tests/memory/context-active-npc.test.ts
 *
 * `FormatterContext` declared `activeNPC` and `gold` as optional extensions of
 * `CampaignContext`, and nothing ever supplied them: both call sites
 * (`action/route.ts` and `narrator.ts`) pass the raw `buildCampaignContext`
 * result. So the narrator's whole NPC section never rendered — including the
 * secret disclosure gated at disposition 8 — and party gold always read 0 GP.
 *
 * These cover the producer, which is the half that was missing. What the
 * formatter does with the values is already covered in formatter.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  campaign: { findUnique: vi.fn() },
  encounter: { findFirst: vi.fn() },
  gameLog: { findMany: vi.fn() },
  quest: { findMany: vi.fn() },
  nPC: { findUnique: vi.fn() },
  location: { findUnique: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/memory/search", () => ({ searchMemories: vi.fn() }));

import { buildCampaignContext } from "@/lib/memory/context";

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
};

const PERSONALITY = {
  motivation: "To buy back the family forge.",
  secret: "They sold the deed to pay a debt.",
  distinctiveTrait: "Taps the counter twice before speaking.",
};

function primeCampaign(gold: number) {
  prismaMock.campaign.findUnique.mockResolvedValue({ character: CHARACTER, gold });
  prismaMock.encounter.findFirst.mockResolvedValue(null);
  prismaMock.gameLog.findMany.mockResolvedValue([]);
  prismaMock.quest.findMany.mockResolvedValue([]);
}

describe("buildCampaignContext — party gold", () => {
  beforeEach(() => vi.clearAllMocks());

  it("carries the campaign's gold, so the narrator is not told 0 GP", async () => {
    primeCampaign(137);

    const context = await buildCampaignContext("campaign-1");

    expect(context.gold).toBe(137);
  });

  /**
   * The control: a real balance must survive, and zero must stay zero rather
   * than becoming the value every campaign reports.
   */
  it("reports a genuinely empty purse as 0", async () => {
    primeCampaign(0);

    const context = await buildCampaignContext("campaign-1");

    expect(context.gold).toBe(0);
  });
});

describe("buildCampaignContext — active NPC", () => {
  beforeEach(() => vi.clearAllMocks());

  /**
   * The populated path. Without it the "null" case below passes on a resolver
   * that returns null unconditionally — which is exactly what falsification
   * showed before this test existed.
   */
  it("resolves the NPC named by the node the party is standing in", async () => {
    prismaMock.campaign.findUnique.mockResolvedValue({
      character: CHARACTER,
      gold: 25,
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
          feature: "npc",
          npcSeed: "innkeeper_1",
          x: 0,
          y: 0,
        },
      ],
      edges: [],
    });
    prismaMock.nPC.findUnique.mockResolvedValue({
      name: "Greta",
      disposition: 8,
      personalityTags: PERSONALITY,
      hasMetPlayer: true,
    });

    const context = await buildCampaignContext("campaign-1");

    expect(prismaMock.nPC.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campaignId_seed: { campaignId: "campaign-1", seed: "innkeeper_1" } },
      })
    );
    expect(context.activeNPC).toEqual({
      name: "Greta",
      disposition: 8,
      // The field the whole secret-disclosure path hangs off. Asserting it
      // survives the trip is the point: it was null in production for the
      // want of a producer.
      personalityTags: PERSONALITY,
      hasMetPlayer: true,
    });
  });

  it("is null when the party's node names no NPC", async () => {
    primeCampaign(10);

    const context = await buildCampaignContext("campaign-1");

    expect(context.activeNPC).toBeNull();
    expect(prismaMock.nPC.findUnique).not.toHaveBeenCalled();
  });
});
