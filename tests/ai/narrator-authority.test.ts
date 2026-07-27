import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  streamText: vi.fn(),
  buildCampaignContext: vi.fn(),
  formatSystemPrompt: vi.fn(),
}));

vi.mock("ai", () => ({
  streamText: mocks.streamText,
  stepCountIs: vi.fn(() => "step-limit"),
}));
vi.mock("@ai-sdk/openai", () => ({ openai: vi.fn(() => "model") }));
vi.mock("@/lib/memory/context", () => ({
  buildCampaignContext: mocks.buildCampaignContext,
}));
vi.mock("@/lib/memory/formatter", () => ({
  formatSystemPrompt: mocks.formatSystemPrompt,
}));
vi.mock("@/lib/ai/tools/srd-lookup", () => ({
  buildSrdTools: () => ({
    getSpellInfo: { execute: vi.fn() },
    getItemInfo: { execute: vi.fn() },
    getEquipmentInfo: { execute: vi.fn() },
    getMonsterInfo: { execute: vi.fn() },
  }),
}));

import { streamNarrative } from "@/lib/ai/narrator";

describe("narrator authority boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
    mocks.buildCampaignContext.mockResolvedValue({});
    mocks.formatSystemPrompt.mockReturnValue("read-only campaign context");
    mocks.streamText.mockReturnValue({
      textStream: (async function* () { yield "Resolved prose."; })(),
      text: Promise.resolve("Resolved prose."),
    });
  });

  it("registers only read-only SRD lookup tools", async () => {
    const result = await streamNarrative("campaign-1", "I inspect the rune.");
    await result.textPromise;

    const options = mocks.streamText.mock.calls[0]![0];
    expect(Object.keys(options.tools).sort()).toEqual([
      "getEquipmentInfo",
      "getItemInfo",
      "getMonsterInfo",
      "getSpellInfo",
    ]);
    expect(Object.keys(options.tools)).not.toEqual(expect.arrayContaining([
      "awardXP",
      "executeCombatAction",
      "executeExplorationTurn",
      "generateMerchant",
      "manageEquipment",
    ]));
  });
});
