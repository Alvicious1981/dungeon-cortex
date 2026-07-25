/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  nPC: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
  campaign: { findUnique: vi.fn() },
  character: { findUnique: vi.fn() },
  locationNode: { findMany: vi.fn() },
  $transaction: vi.fn(async (callback: any) => callback(prismaMock)),
}));

vi.mock("ai", () => ({
  tool: vi.fn((config) => config),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: prismaMock,
}));

vi.mock("@/lib/rules/dice", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rules/dice")>();
  return {
    ...actual,
    rollDie: vi.fn(() => 20),
    d20Check: vi.fn(() => ({
      success: true,
      isCriticalSuccess: false,
      isCriticalFailure: false,
      roll: { total: 15, notation: "1d20", dice: [{ faces: 20, result: 15 }], diceTotal: 15, modifier: 0 },
      abilityModifier: 0,
      dc: 10,
    })),
  };
});

import { buildSocialTools } from "@/lib/ai/tools/social";

describe("social AI tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock));
  });

  it("establishInitialDisposition persists disposition, personalityTags, and hasMetPlayer", async () => {
    prismaMock.nPC.findUnique.mockResolvedValueOnce(null);
    prismaMock.nPC.upsert.mockResolvedValueOnce({});

    const tools = buildSocialTools("campaign-1") as any;
    const raw = await tools.establishInitialDisposition.execute({
      npcSeed: "gate_guard",
      npcRole: "guard",
      charismaModifier: 0,
    });
    const result = JSON.parse(raw);

    expect(result.roll).toBe(20);
    expect(result.dispositionBand).toBe("Helpful");
    expect(prismaMock.nPC.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        disposition: 8,
        personalityTags: expect.objectContaining({
          motivation: expect.any(String),
          secret: expect.any(String),
          distinctiveTrait: expect.any(String),
        }),
        hasMetPlayer: true,
      }),
      update: expect.objectContaining({
        disposition: 8,
        personalityTags: expect.any(Object),
        hasMetPlayer: true,
      }),
    }));
  });

  it("does not repeat first interaction when hasMetPlayer is true", async () => {
    prismaMock.nPC.findUnique.mockResolvedValueOnce({ hasMetPlayer: true, disposition: 4 });

    const tools = buildSocialTools("campaign-1") as any;
    const raw = await tools.establishInitialDisposition.execute({
      npcSeed: "gate_guard",
      npcRole: "guard",
      charismaModifier: 0,
    });
    const result = JSON.parse(raw);

    expect(result.error).toContain("already established");
    expect(prismaMock.nPC.upsert).not.toHaveBeenCalled();
  });

  it("socialCheck uses persisted disposition and persists the resolved update", async () => {
    prismaMock.nPC.findUnique.mockResolvedValueOnce({ hasMetPlayer: true, disposition: 4 });
    prismaMock.campaign.findUnique.mockResolvedValueOnce({ characterId: "char-1" });
    prismaMock.character.findUnique.mockResolvedValueOnce({ stats: { CHA: 10 } });
    prismaMock.nPC.update.mockResolvedValueOnce({});

    const tools = buildSocialTools("campaign-1") as any;
    const raw = await tools.socialCheck.execute({
      npcSeed: "gate_guard",
      approach: "persuade",
      dispositionDelta: 2,
      intent: "Ask for directions.",
    });
    const result = JSON.parse(raw);

    expect(result.dispositionBefore).toBe(4);
    expect(result.dispositionAfter).toBe(6);
    expect(prismaMock.nPC.update).toHaveBeenCalledWith({
      where: { campaignId_seed: { campaignId: "campaign-1", seed: "gate_guard" } },
      data: { disposition: 6 },
    });
  });
  it("getRumors resolves persisted social context outside the AI tool", async () => {
    prismaMock.nPC.findUnique.mockResolvedValueOnce({
      id: "npc-1",
      name: "Bert",
      disposition: 5,
    });
    prismaMock.campaign.findUnique.mockResolvedValueOnce({
      id: "campaign-1",
      currentLocationId: "location-1",
    });
    prismaMock.locationNode.findMany.mockResolvedValueOnce([
      {
        id: "node-1",
        name: "Old Shrine",
        feature: "treasure",
        description: "A sealed shrine stands beyond the road.",
      },
    ]);

    const tools = buildSocialTools("campaign-1") as any;
    const raw = await tools.getRumors.execute({ npcSeed: "bert" });
    const result = JSON.parse(raw);

    expect(result.npcName).toBe("Bert");
    expect(result.rumors).toHaveLength(1);
    expect(prismaMock.locationNode.findMany).toHaveBeenCalledWith({
      where: { locationId: "location-1" },
      select: { id: true, name: true, feature: true, description: true },
    });
  });
});
