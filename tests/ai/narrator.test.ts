/**
 * tests/ai/narrator.test.ts
 *
 * "Code is Law" enforcement tests for the narrator orchestrator.
 *
 * These tests verify the contract: before the AI returns narrative text
 * involving a spell or item, the deterministic SRD lookup tools MUST be
 * invoked. We mock streamText to simulate an LLM that decides to call
 * a tool, then assert the underlying Prisma-backed lookup ran.
 *
 * Mocking strategy:
 *   - `ai`: spread actual module, override only `streamText`
 *     (keeps `tool()` and `stepCountIs()` real so execute closures are intact)
 *   - All external I/O modules (Prisma, OpenAI, memory) are fully mocked
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CampaignContext } from "@/lib/memory/context";

// ---------------------------------------------------------------------------
// Module mocks — declared before any imports that trigger module resolution
// ---------------------------------------------------------------------------

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText: vi.fn() };
});

vi.mock("@ai-sdk/openai", () => ({
  openai: vi.fn().mockReturnValue({ id: "gpt-4o-mini" }),
}));

vi.mock("@/lib/memory/context", () => ({
  buildCampaignContext: vi.fn(),
}));

vi.mock("@/lib/memory/formatter", () => ({
  formatSystemPrompt: vi.fn().mockReturnValue("## Iron Laws\n..."),
}));

vi.mock("@/lib/ai/tools/srd-lookup", () => ({
  getSpellInfo: vi.fn(),
  getItemInfo: vi.fn(),
  getMonsterInfo: vi.fn(),
}));

vi.mock("@/lib/memory/search", () => ({
  searchMemories: vi.fn(),
}));

vi.mock("@/lib/rules/generators", () => ({
  generateTavernName: vi.fn(),
  generateMundaneLoot: vi.fn(),
}));

vi.mock("@/lib/rules/npc", () => ({
  generateNPC: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports — after mocks are set up
// ---------------------------------------------------------------------------

import { streamText } from "ai";
import { buildCampaignContext } from "@/lib/memory/context";
import { getSpellInfo, getItemInfo } from "@/lib/ai/tools/srd-lookup";
import { streamNarrative } from "@/lib/ai/narrator";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const CAMPAIGN_ID = "campaign-test-001";

const minimalContext: CampaignContext = {
  character: {
    id: "char-1",
    name: "Thalindra",
    race: "Elf",
    class: "Wizard",
    level: 5,
    hp: 28,
    maxHp: 32,
    stats: { STR: 8, DEX: 14, CON: 12, INT: 18, WIS: 14, CHA: 10 },
    spellSlots: { 1: { current: 2, max: 4 }, 2: { current: 1, max: 3 }, 3: { current: 0, max: 2 } },
    inventory: [],
  },
  activeEncounter: null,
  recentLogs: [],
  relevantMemories: [],
  quests: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockStreamText = vi.mocked(streamText);
const mockBuildContext = vi.mocked(buildCampaignContext);
const mockGetSpellInfo = vi.mocked(getSpellInfo);
const mockGetItemInfo = vi.mocked(getItemInfo);

beforeEach(() => {
  vi.clearAllMocks();
  mockBuildContext.mockResolvedValue(minimalContext);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("streamNarrative — Code is Law tool-call enforcement", () => {

  it("calls getSpellInfo when the LLM chooses to look up a spell", async () => {
    // Arrange: mock spell lookup returning real-looking SRD data
    mockGetSpellInfo.mockResolvedValue(
      JSON.stringify({ name: "Fireball", level: 3, range: "150 feet", damage: "8d6 fire" })
    );

    // Arrange: simulate an LLM response that invokes getSpellInfo then returns text
    mockStreamText.mockImplementationOnce(((params: any) => {
      const execP = params.tools.getSpellInfo.execute(
        { query: "fireball" },
        { messages: [], toolCallId: "tc-spell-01", toolName: "getSpellInfo" }
      );
      return { 
        textStream: (async function* () {})(), 
        text: execP.then((spellResult: any) => `A bead of fire streaks outward. ${spellResult}`) 
      } as any;
    }) as any);

    // Act
    const { textPromise } = await streamNarrative(CAMPAIGN_ID, "I cast Fireball at the goblin cluster.");
    const narrative = await textPromise;

    // Assert: the lookup ran before the narrative was returned
    expect(mockGetSpellInfo).toHaveBeenCalledOnce();
    expect(mockGetSpellInfo).toHaveBeenCalledWith("fireball");
    expect(narrative).toContain("bead of fire");
  });

  it("calls getItemInfo when the LLM chooses to look up an item", async () => {
    // Arrange: mock item lookup returning real-looking SRD data
    mockGetItemInfo.mockResolvedValue(
      JSON.stringify({ name: "Cloak of Protection", rarity: "uncommon", bonus: "+1 AC and saving throws" })
    );

    // Arrange: simulate an LLM response that invokes getItemInfo then returns text
    mockStreamText.mockImplementationOnce(((params: any) => {
      const execP = params.tools.getItemInfo.execute(
        { query: "cloak of protection" },
        { messages: [], toolCallId: "tc-item-01", toolName: "getItemInfo" }
      );
      return { 
        textStream: (async function* () {})(), 
        text: execP.then((itemResult: any) => `The cloak hums with faint enchantment. ${itemResult}`) 
      } as any;
    }) as any);

    // Act
    const { textPromise } = await streamNarrative(CAMPAIGN_ID, "I examine the Cloak of Protection.");
    const narrative = await textPromise;

    // Assert: the lookup ran before the narrative was returned
    expect(mockGetItemInfo).toHaveBeenCalledOnce();
    expect(mockGetItemInfo).toHaveBeenCalledWith("cloak of protection");
    expect(narrative).toContain("hums with faint enchantment");
  });

  it("returns narrative without lookup tools when no spell or item is involved", async () => {
    // Arrange: the LLM returns narrative directly, no tool calls
    mockStreamText.mockReturnValueOnce({ 
      textStream: (async function* () {})(), 
      text: Promise.resolve("You walk down the dusty road.") 
    } as any);

    // Act
    const { textPromise } = await streamNarrative(CAMPAIGN_ID, "I walk north along the road.");
    const narrative = await textPromise;

    // Assert: no lookups triggered
    expect(mockGetSpellInfo).not.toHaveBeenCalled();
    expect(mockGetItemInfo).not.toHaveBeenCalled();
    expect(narrative).toBe("You walk down the dusty road.");
  });

  it("both getSpellInfo and getItemInfo tools are registered and callable via the orchestrator", async () => {
    // Arrange: both lookups return data
    mockGetSpellInfo.mockResolvedValue(JSON.stringify({ name: "Magic Missile", level: 1 }));
    mockGetItemInfo.mockResolvedValue(JSON.stringify({ name: "Wand of Magic Missiles", charges: 7 }));

    // Arrange: LLM calls both tools in sequence
    mockStreamText.mockImplementationOnce(((params: any) => {
      const execP = Promise.all([
        params.tools.getSpellInfo.execute({ query: "magic missile" }, { messages: [], toolCallId: "tc-s", toolName: "getSpellInfo" }),
        params.tools.getItemInfo.execute({ query: "wand of magic missiles" }, { messages: [], toolCallId: "tc-i", toolName: "getItemInfo" }),
      ]);
      return { 
        textStream: (async function* () {})(), 
        text: execP.then(([spellResult, itemResult]: any[]) => `You fire the wand. ${spellResult} ${itemResult}`) 
      } as any;
    }) as any);

    // Act
    const { textPromise } = await streamNarrative(CAMPAIGN_ID, "I fire the wand at the orc.");
    const narrative = await textPromise;

    // Assert: both lookups ran
    expect(mockGetSpellInfo).toHaveBeenCalledWith("magic missile");
    expect(mockGetItemInfo).toHaveBeenCalledWith("wand of magic missiles");
    expect(narrative).toContain("fire the wand");
  });

});
