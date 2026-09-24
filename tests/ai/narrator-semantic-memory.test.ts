/**
 * tests/ai/narrator-semantic-memory.test.ts
 *
 * DC-NARR-001 regression tests:
 * Verifies that streamNarrative() propagates the validated player input to
 * buildCampaignContext(), activating semantic memory retrieval (searchMemories)
 * and populating GAME_DATA.memory in the narrator request without violating
 * the trust boundary or failing when memory retrieval fails.
 *
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Boundary mocks (external network / DB boundaries only; real context/narrator/trust logic)
// ---------------------------------------------------------------------------

const { capturedStreamTextCalls, mockGenerateEmbedding, mockPrisma } = vi.hoisted(() => {
  const capturedCalls: any[] = [];
  const mockEmbedding = vi.fn();
  const prismaMock = {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    campaign: { findUnique: vi.fn() },
    encounter: { findFirst: vi.fn() },
    gameLog: { findMany: vi.fn() },
    quest: { findMany: vi.fn() },
    location: { findUnique: vi.fn() },
    nPC: { findUnique: vi.fn() },
    srdSpell: { findUnique: vi.fn() },
    srdMonster: { findUnique: vi.fn() },
    srdItem: { findUnique: vi.fn() },
  };
  return {
    capturedStreamTextCalls: capturedCalls,
    mockGenerateEmbedding: mockEmbedding,
    mockPrisma: prismaMock,
  };
});

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn().mockImplementation((params: any) => {
      capturedStreamTextCalls.push(params);
      return {
        textStream: (async function* () {
          yield "El héroe investiga con cautela.";
        })(),
        text: Promise.resolve("El héroe investiga con cautela."),
      };
    }),
  };
});

vi.mock("@ai-sdk/openai", () => ({
  openai: vi.fn().mockReturnValue({ id: "gpt-4o-mini" }),
}));

vi.mock("@/lib/memory/embeddings", () => ({
  generateEmbedding: (...args: unknown[]) => mockGenerateEmbedding(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: mockPrisma,
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { streamNarrative } from "@/lib/ai/narrator";

const CAMPAIGN_ID = "campaign-narr-001";
const FAKE_VECTOR = Array.from({ length: 1536 }, (_, i) => (i + 1) * 0.0001);

const characterFixture = {
  id: "char-1",
  name: "Alanna",
  race: "Elf",
  class: "Wizard",
  level: 3,
  hp: 20,
  maxHp: 20,
  xp: 900,
  stats: { STR: 10, DEX: 14, CON: 12, INT: 16, WIS: 12, CHA: 10 },
  spellSlots: { "1": 4, "2": 2 },
  skillProficiencies: ["Arcana", "History"],
  concentrationSpellId: null,
  hitDiceTotal: 3,
  hitDiceRemaining: 3,
  exhaustionLevel: 0,
  inventory: [],
};

function setupDefaultDatabaseFixtures() {
  mockPrisma.campaign.findUnique.mockResolvedValue({
    id: CAMPAIGN_ID,
    gold: 150,
    character: characterFixture,
    currentLocationId: null,
    currentNodeId: null,
  });
  mockPrisma.encounter.findFirst.mockResolvedValue(null);
  mockPrisma.gameLog.findMany.mockResolvedValue([]);
  mockPrisma.quest.findMany.mockResolvedValue([]);
  mockGenerateEmbedding.mockResolvedValue(FAKE_VECTOR);
}

function parseGameDataFromMessage(messageContent: string) {
  const jsonStart = messageContent.indexOf("{");
  return JSON.parse(messageContent.slice(jsonStart));
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedStreamTextCalls.length = 0;
  setupDefaultDatabaseFixtures();
});

describe("DC-NARR-001: semantic narrative memory retrieval in production narrator", () => {
  it("propagates validated player action to semantic memory retrieval and populates GAME_DATA.memory", async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { content: "The party discovered the secret sigil of the Silver Order on the altar." },
    ]);

    const result = await streamNarrative(
      CAMPAIGN_ID,
      "   I examine the runes carved into the altar   "
    );

    await result.textPromise;

    // 1. Validated and trimmed player input must be passed to the embedding/retrieval path
    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(1);
    expect(mockGenerateEmbedding).toHaveBeenCalledWith("I examine the runes carved into the altar");

    // 2. pgvector query must have executed
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);

    // 3. streamText must have received the retrieved memory in the untrusted GAME_DATA payload
    expect(capturedStreamTextCalls).toHaveLength(1);
    const lastCall = capturedStreamTextCalls[0];
    const dataMessage = lastCall.messages.find((m: any) => m.role === "user");
    expect(dataMessage).toBeDefined();

    const gameData = parseGameDataFromMessage(dataMessage.content);
    expect(gameData.memory).toEqual([
      "The party discovered the secret sigil of the Silver Order on the altar.",
    ]);
    expect(gameData.playerAction).toBe("I examine the runes carved into the altar");

    // 4. Memory must NOT be placed into system prompt (trust boundary intact)
    expect(lastCall.system).not.toContain("secret sigil of the Silver Order");
  });

  it("handles empty memory recall gracefully when no memories match", async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([]);

    const result = await streamNarrative(
      CAMPAIGN_ID,
      "I look around at the empty corridor."
    );

    await result.textPromise;

    expect(mockGenerateEmbedding).toHaveBeenCalledWith("I look around at the empty corridor.");
    expect(capturedStreamTextCalls).toHaveLength(1);
    const gameData = parseGameDataFromMessage(capturedStreamTextCalls[0].messages[0].content);
    expect(gameData.memory).toEqual([]);
  });

  it("fails open/soft when embedding generation fails, without blocking narration", async () => {
    mockGenerateEmbedding.mockRejectedValueOnce(new Error("Embedding provider rate limit"));

    const result = await streamNarrative(
      CAMPAIGN_ID,
      "I search for hidden traps."
    );

    // Narration must resolve successfully despite embedding failure
    const fullText = await result.textPromise;
    expect(fullText).toBe("El héroe investiga con cautela.");

    // Embedding was attempted with the validated input
    expect(mockGenerateEmbedding).toHaveBeenCalledWith("I search for hidden traps.");

    // Narration proceeded and memory defaulted to empty array
    expect(capturedStreamTextCalls).toHaveLength(1);
    const gameData = parseGameDataFromMessage(capturedStreamTextCalls[0].messages[0].content);
    expect(gameData.memory).toEqual([]);
  });
});
