/**
 * Narrator integration tests for the physically contained tool surface.
 *
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText: vi.fn() };
});

vi.mock("@ai-sdk/openai", () => ({
  openai: vi.fn().mockReturnValue({ id: "gpt-4o-mini" }),
}));

vi.mock("@/lib/memory/context", () => ({ buildCampaignContext: vi.fn() }));
vi.mock("@/lib/memory/formatter", () => ({
  formatIronLaws: vi.fn().mockReturnValue("## Iron Laws"),
  formatCanonicalState: vi.fn().mockReturnValue("# Current Game State"),
}));
vi.mock("@/lib/memory/search", () => ({ searchMemories: vi.fn() }));

const prisma = vi.hoisted(() => ({
  srdSpell: { findUnique: vi.fn(), findMany: vi.fn() },
  srdMonster: { findUnique: vi.fn(), findMany: vi.fn() },
  srdItem: { findUnique: vi.fn(), findMany: vi.fn() },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma }));

import { streamText } from "ai";
import { streamNarrative } from "@/lib/ai/narrator";
import { buildCampaignContext } from "@/lib/memory/context";

const CAMPAIGN_ID = "campaign-narrator-001";
const mockStreamText = vi.mocked(streamText);
const mockBuildCampaignContext = vi.mocked(buildCampaignContext);

function context(): any {
  return {
    character: { id: "char-1", name: "Thalindra", inventory: [] },
    activeEncounter: null,
    recentLogs: [],
    relevantMemories: [],
    quests: [],
    currentExploration: null,
  };
}

function capture(execute: (tools: any) => Promise<unknown> | unknown): void {
  mockStreamText.mockImplementationOnce(((params: any) => ({
    textStream: (async function* () {})(),
    text: Promise.resolve(execute(params.tools)).then(() => "Narration."),
  })) as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBuildCampaignContext.mockResolvedValue(context());
});

describe("streamNarrative contained tool surface", () => {
  it("does not expose legacy downtime or state-changing tools", async () => {
    capture((tools) => {
      expect(Object.keys(tools).sort()).toEqual([
        "getEquipmentInfo",
        "getItemInfo",
        "getMonsterInfo",
        "getSpellInfo",
      ]);
      expect(tools).not.toHaveProperty("executeTrade");
      expect(tools).not.toHaveProperty("generateLoot");
      expect(tools).not.toHaveProperty("resolveAttack");
      expect(tools).not.toHaveProperty("awardXP");
      expect(tools).not.toHaveProperty("triggerLevelUp");
      expect(tools).not.toHaveProperty("downtime");
    });

    const result = await streamNarrative(CAMPAIGN_ID, "I wait.");
    await expect(result.textPromise).resolves.toBe("Narration.");
  });

  it("does not execute lookups unless the model issues a tool call", async () => {
    mockStreamText.mockReturnValueOnce({
      textStream: (async function* () {})(),
      text: Promise.resolve("Narration without a lookup."),
    } as any);

    const result = await streamNarrative(CAMPAIGN_ID, "I wait.");
    await expect(result.textPromise).resolves.toBe("Narration without a lookup.");
    expect(prisma.srdSpell.findUnique).not.toHaveBeenCalled();
    expect(prisma.srdItem.findUnique).not.toHaveBeenCalled();
    expect(prisma.srdMonster.findUnique).not.toHaveBeenCalled();
  });

  it("keeps safe qualitative prose when no combat facts exist", async () => {
    const qualitativeText = "The experience leaves you shaken, but no one dies.";
    mockStreamText.mockReturnValueOnce({
      textStream: (async function* () {})(),
      text: Promise.resolve(qualitativeText),
    } as any);

    const result = await streamNarrative(CAMPAIGN_ID, "I speak with the witness.");

    await expect(result.textPromise).resolves.toBe(qualitativeText);
  });

  it("executes an allowed spell lookup", async () => {
    prisma.srdSpell.findUnique.mockResolvedValue({
      id: "fireball", name: "Fireball", hasHealing: false, damageType: "fire",
      saveAbility: "DEX", concentration: false, ritual: false, hasAreaOfEffect: true,
      school: "evocation", level: 3,
    });
    capture((tools) => tools.getSpellInfo.execute(
      { query: "fireball" },
      { messages: [], toolCallId: "spell-1", toolName: "getSpellInfo" },
    ));

    const result = await streamNarrative(CAMPAIGN_ID, "I cast fireball.");
    await result.textPromise;
    expect(prisma.srdSpell.findUnique).toHaveBeenCalledWith({ where: { id: "fireball" } });
  });

  it("executes an allowed monster lookup", async () => {
    prisma.srdMonster.findUnique.mockResolvedValue({
      id: "goblin", indexSlug: "goblin", name: "Goblin", hitPoints: 7,
    });
    capture((tools) => tools.getMonsterInfo.execute(
      { query: "goblin" },
      { messages: [], toolCallId: "monster-1", toolName: "getMonsterInfo" },
    ));

    const result = await streamNarrative(CAMPAIGN_ID, "What do I know about goblins?");
    await expect(result.textPromise).resolves.toBe("Narration.");
    expect(prisma.srdMonster.findUnique).toHaveBeenCalledWith({ where: { id: "goblin" } });
  });
});
