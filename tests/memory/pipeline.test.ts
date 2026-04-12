/**
 * tests/memory/pipeline.test.ts
 *
 * Unit tests for the semantic memory pipeline (Milestone D).
 *
 * Covers five contracts:
 *   1. saveMemory  — embeds content and persists via $executeRaw
 *   2. searchMemories (results) — embeds query and calls $queryRaw, formats output
 *   3. searchMemories (empty)  — returns fallback string when no rows exist
 *   4. summarizeAndStore       — calls generateText then delegates to saveMemory
 *   5. buildCampaignContext    — includes quests + relevantMemories in context snapshot
 *
 * Mocking strategy:
 *   - @/lib/db/prisma       — mock prisma singleton (all raw + CRUD methods)
 *   - @/lib/memory/embeddings — mock generateEmbedding (controls vector output)
 *   - ai                    — spread real module, override only generateText
 *   - @ai-sdk/openai        — stub to prevent real client instantiation at import time
 *
 * No production code is touched; all I/O is intercepted at the module boundary.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any subject imports
// ---------------------------------------------------------------------------

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    campaign: { findUnique: vi.fn() },
    encounter: { findFirst: vi.fn() },
    gameLog: { findMany: vi.fn() },
    quest: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/memory/embeddings", () => ({
  generateEmbedding: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: vi.fn() };
});

// Stub out the openai client constructor so module-level constants in
// consolidator.ts and embeddings.ts don't hit the real SDK.
vi.mock("@ai-sdk/openai", () => ({
  openai: Object.assign(
    vi.fn().mockReturnValue({ id: "gpt-4o-mini" }),
    { embedding: vi.fn().mockReturnValue({ id: "text-embedding-3-small" }) }
  ),
}));

// ---------------------------------------------------------------------------
// Subject imports — after mocks are registered
// ---------------------------------------------------------------------------

import { saveMemory } from "@/lib/memory/store";
import { searchMemories } from "@/lib/memory/search";
import { summarizeAndStore } from "@/lib/memory/consolidator";
import { buildCampaignContext } from "@/lib/memory/context";
import { generateEmbedding } from "@/lib/memory/embeddings";
import { generateText } from "ai";
import { prisma } from "@/lib/db/prisma";
import type { GameLog } from "@/app/generated/prisma/client";

// ---------------------------------------------------------------------------
// Typed mock helpers
// ---------------------------------------------------------------------------

const mockGenerateEmbedding = vi.mocked(generateEmbedding);
const mockGenerateText = vi.mocked(generateText);
const mockExecuteRaw = vi.mocked(prisma.$executeRaw);
const mockQueryRaw = vi.mocked(prisma.$queryRaw);
const mockCampaignFindUnique = vi.mocked(prisma.campaign.findUnique);
const mockEncounterFindFirst = vi.mocked(prisma.encounter.findFirst);
const mockGameLogFindMany = vi.mocked(prisma.gameLog.findMany);
const mockQuestFindMany = vi.mocked(prisma.quest.findMany);

// Minimal 1536-dim vector — all tests that need a fake embedding use this.
const FAKE_VECTOR: number[] = Array.from({ length: 1536 }, (_, i) => (i + 1) * 0.0001);

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. saveMemory — persistence via $executeRaw
// ---------------------------------------------------------------------------

describe("saveMemory", () => {
  it("embeds the content and inserts a row via $executeRaw", async () => {
    mockGenerateEmbedding.mockResolvedValueOnce(FAKE_VECTOR);
    mockExecuteRaw.mockResolvedValueOnce(1);

    await saveMemory("campaign-abc", "The party crossed the Thornwood Bridge.", 1.5);

    // Embedding was requested for the exact content string
    expect(mockGenerateEmbedding).toHaveBeenCalledOnce();
    expect(mockGenerateEmbedding).toHaveBeenCalledWith(
      "The party crossed the Thornwood Bridge."
    );

    // A single raw INSERT was issued (no typed Prisma accessor for vector columns)
    expect(mockExecuteRaw).toHaveBeenCalledOnce();
  });

  it("swallows errors silently — a failed write must not throw to the caller", async () => {
    mockGenerateEmbedding.mockRejectedValueOnce(new Error("OpenAI timeout"));

    // saveMemory catches all errors internally; caller must not see an exception
    await expect(
      saveMemory("campaign-abc", "The dragon breathed fire.")
    ).resolves.toBeUndefined();

    // $executeRaw was never reached because the embedding step failed first
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2 & 3. searchMemories — pgvector query + empty-result fallback
// ---------------------------------------------------------------------------

describe("searchMemories", () => {
  it("returns concatenated content when $queryRaw yields results", async () => {
    mockGenerateEmbedding.mockResolvedValueOnce(FAKE_VECTOR);
    mockQueryRaw.mockResolvedValueOnce([
      { content: "The party defeated the goblin chief in the tavern cellar." },
      { content: "They found a hidden cache of healing potions nearby." },
    ]);

    const result = await searchMemories("campaign-abc", "goblin fight", 2);

    // $queryRaw was called once (cosine ORDER BY is pgvector-specific raw SQL)
    expect(mockQueryRaw).toHaveBeenCalledOnce();

    // Results are joined with the canonical separator used downstream by context.ts
    expect(result).toBe(
      "The party defeated the goblin chief in the tavern cellar.\n---\nThey found a hidden cache of healing potions nearby."
    );
  });

  it("returns the fallback sentinel when $queryRaw returns no rows", async () => {
    mockGenerateEmbedding.mockResolvedValueOnce(FAKE_VECTOR);
    mockQueryRaw.mockResolvedValueOnce([]);

    const result = await searchMemories("campaign-abc", "forgotten ruins");

    expect(result).toBe("No relevant memories found.");
  });
});

// ---------------------------------------------------------------------------
// 4. summarizeAndStore — consolidator delegates to LLM then to saveMemory
// ---------------------------------------------------------------------------

describe("summarizeAndStore", () => {
  const CAMPAIGN_ID = "campaign-consolidate-001";

  const sampleLogs: GameLog[] = [
    {
      id: "log-1",
      campaignId: CAMPAIGN_ID,
      role: "user",
      content: "I cast Fireball at the cluster of goblins.",
      createdAt: new Date("2026-04-11T10:00:00Z"),
    },
    {
      id: "log-2",
      campaignId: CAMPAIGN_ID,
      role: "assistant",
      content:
        "The bead of fire detonates at the centre of the group. All three goblins are slain instantly.",
      createdAt: new Date("2026-04-11T10:00:05Z"),
    },
  ];

  it("calls generateText with a clinical summarisation prompt then persists the result", async () => {
    const SUMMARY = "The wizard cast Fireball, killing three goblins in the cellar.";

    // generateText mock returns the LLM-produced summary
    mockGenerateText.mockResolvedValueOnce({ text: SUMMARY } as Awaited<ReturnType<typeof generateText>>);

    // saveMemory will internally call generateEmbedding + $executeRaw
    mockGenerateEmbedding.mockResolvedValueOnce(FAKE_VECTOR);
    mockExecuteRaw.mockResolvedValueOnce(1);

    await summarizeAndStore(CAMPAIGN_ID, sampleLogs);

    // LLM was asked to summarise exactly once
    expect(mockGenerateText).toHaveBeenCalledOnce();

    // The system prompt must reference its RPG record-keeping purpose
    const callArgs = mockGenerateText.mock.calls[0][0] as { system?: string };
    expect(callArgs.system).toContain("tabletop RPG");

    // The summary was then persisted via the store layer
    expect(mockExecuteRaw).toHaveBeenCalledOnce();
  });

  it("exits early without calling generateText when the log slice is empty", async () => {
    await summarizeAndStore(CAMPAIGN_ID, []);

    expect(mockGenerateText).not.toHaveBeenCalled();
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5. buildCampaignContext — quests + relevantMemories inclusion
// ---------------------------------------------------------------------------

describe("buildCampaignContext", () => {
  const CAMPAIGN_ID = "campaign-context-001";

  const characterFixture = {
    id: "char-1",
    name: "Aelindra",
    race: "Half-Elf",
    class: "Ranger",
    level: 4,
    hp: 30,
    maxHp: 36,
    stats: { STR: 14, DEX: 16, CON: 13, INT: 10, WIS: 14, CHA: 11 },
    spellSlots: null,
    inventory: [],
  };

  const questsFixture = [
    {
      id: "quest-1",
      title: "Retrieve the Moonstone Relic",
      description: "Locate the relic stolen from the temple of Selûne.",
      status: "active",
      createdAt: new Date("2026-04-10T08:00:00Z"),
    },
    {
      id: "quest-2",
      title: "Clear the Undermountain Passage",
      description: "Goblins have blocked the trade route through Undermountain.",
      status: "completed",
      createdAt: new Date("2026-04-09T12:00:00Z"),
    },
  ];

  it("includes quests and populates relevantMemories when playerInput is provided", async () => {
    // Prisma pillars
    mockCampaignFindUnique.mockResolvedValueOnce({ character: characterFixture } as never);
    mockEncounterFindFirst.mockResolvedValueOnce(null);
    mockGameLogFindMany.mockResolvedValueOnce([]);
    mockQuestFindMany.mockResolvedValueOnce(questsFixture as never);

    // Semantic memory: embedding + raw query returning one match
    mockGenerateEmbedding.mockResolvedValueOnce(FAKE_VECTOR);
    mockQueryRaw.mockResolvedValueOnce([
      { content: "The party previously investigated the temple and met Priestess Mira." },
    ]);

    const ctx = await buildCampaignContext(CAMPAIGN_ID, "Where is the Moonstone Relic?");

    // Quest data is canonical state — must appear in context
    expect(ctx.quests).toHaveLength(2);
    expect(ctx.quests[0].title).toBe("Retrieve the Moonstone Relic");
    expect(ctx.quests[0].status).toBe("active");
    expect(ctx.quests[1].status).toBe("completed");

    // Relevant memories were fetched and split correctly from the raw search result
    expect(ctx.relevantMemories).toEqual([
      "The party previously investigated the temple and met Priestess Mira.",
    ]);
  });

  it("returns empty relevantMemories when playerInput is omitted", async () => {
    mockCampaignFindUnique.mockResolvedValueOnce({ character: characterFixture } as never);
    mockEncounterFindFirst.mockResolvedValueOnce(null);
    mockGameLogFindMany.mockResolvedValueOnce([]);
    mockQuestFindMany.mockResolvedValueOnce([]);

    const ctx = await buildCampaignContext(CAMPAIGN_ID);

    // No player input → no embedding call, no semantic search
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
    expect(ctx.relevantMemories).toEqual([]);
  });

  it("throws when the campaign does not exist", async () => {
    mockCampaignFindUnique.mockResolvedValueOnce(null);
    mockEncounterFindFirst.mockResolvedValueOnce(null);
    mockGameLogFindMany.mockResolvedValueOnce([]);
    mockQuestFindMany.mockResolvedValueOnce([]);

    await expect(buildCampaignContext("nonexistent-id")).rejects.toThrow(
      "Campaign not found: nonexistent-id"
    );
  });
});
