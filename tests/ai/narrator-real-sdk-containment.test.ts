/**
 * A real AI SDK stream must reject an excluded tool call before any excluded
 * tool executor, service, or mutation callback can run.
 *
 * @vitest-environment node
 */

import { describe, expect, it, vi } from "vitest";
import { stepCountIs, streamText } from "ai";
import { MockLanguageModelV3 } from "ai/test";

const services = vi.hoisted(() => ({
  getCampaignCharacterIdForTrade: vi.fn(),
  resolveTradeTransaction: vi.fn(),
  equipCharacterItem: vi.fn(),
  resolveSocialCheck: vi.fn(),
  resolveRumors: vi.fn(),
}));

vi.mock("@/lib/rules/trade-service", () => ({
  getCampaignCharacterIdForTrade: services.getCampaignCharacterIdForTrade,
  resolveTradeTransaction: services.resolveTradeTransaction,
}));

vi.mock("@/lib/rules/equipment-service", () => ({
  equipCharacterItem: services.equipCharacterItem,
}));

vi.mock("@/lib/rules/social-service", () => ({
  resolveSocialCheck: services.resolveSocialCheck,
  resolveRumors: services.resolveRumors,
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    srdSpell: { findUnique: vi.fn(), findMany: vi.fn() },
    srdMonster: { findUnique: vi.fn(), findMany: vi.fn() },
    srdItem: { findUnique: vi.fn(), findMany: vi.fn() },
    srdEquipment: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}));

import { buildNarratorTools } from "@/lib/ai/narrator";

function adversarialToolCallStream(): ReadableStream<any> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({
        type: "tool-call",
        toolCallId: "call-execute-trade",
        toolName: "executeTrade",
        input: JSON.stringify({
          action: "buy",
          itemIndex: 0,
          quantity: 1,
          npcSeed: "merchant-1",
          archetype: "general",
        }),
      });
      controller.enqueue({
        type: "finish",
        finishReason: { unified: "tool-calls", raw: "tool-calls" },
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      });
      controller.close();
    },
  });
}

describe("narrator containment with the real AI SDK", () => {
  it("does not execute an excluded executeTrade call or any excluded service", async () => {
    const model = new MockLanguageModelV3({
      doStream: { stream: adversarialToolCallStream() },
    });

    const result = streamText({
      model,
      prompt: "Attempt the requested trade.",
      tools: buildNarratorTools("campaign-real-sdk-001"),
      stopWhen: stepCountIs(1),
    });

    const parts: Array<{ type: string; toolName?: string; invalid?: boolean }> = [];
    for await (const part of result.fullStream) {
      parts.push(part as { type: string; toolName?: string; invalid?: boolean });
    }

    expect(model.doStreamCalls).toHaveLength(1);
    expect(model.doStreamCalls[0]?.tools?.map((tool) => tool.name).sort()).toEqual([
      "getEquipmentInfo",
      "getItemInfo",
      "getMonsterInfo",
      "getNPCDetails",
      "getSpellInfo",
      "getTavernName",
    ]);
    expect(parts).toContainEqual(expect.objectContaining({
      type: "tool-call",
      toolName: "executeTrade",
      invalid: true,
    }));

    expect(services.getCampaignCharacterIdForTrade).not.toHaveBeenCalled();
    expect(services.resolveTradeTransaction).not.toHaveBeenCalled();
    expect(services.equipCharacterItem).not.toHaveBeenCalled();
    expect(services.resolveSocialCheck).not.toHaveBeenCalled();
    expect(services.resolveRumors).not.toHaveBeenCalled();
  });
});