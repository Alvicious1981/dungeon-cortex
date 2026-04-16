/**
 * tests/rules/social-logic.test.ts
 *
 * 100% branch coverage for Social Interaction Engine (Milestone N Slice 2).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as dice from "@/lib/rules/dice";
import {
  generateNPCPersonality,
  rollReaction,
  computeSocialDC,
  resolveSocialCheck,
  getRumorsPayload,
  getDispositionBand
} from "@/lib/rules/social-logic";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/rules/dice", async () => {
  const actual = await vi.importActual<typeof dice>("@/lib/rules/dice");
  return {
    ...actual,
    rollDie: vi.fn(),
    d20Check: vi.fn(),
  };
});

const mockedRollDie = vi.mocked(dice.rollDie);
const mockedD20Check = vi.mocked(dice.d20Check);

describe("Social Logic Engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // generateNPCPersonality
  // ---------------------------------------------------------------------------

  describe("generateNPCPersonality", () => {
    it("is deterministic based on seed", () => {
      const p1 = generateNPCPersonality("merchant-001");
      const p2 = generateNPCPersonality("merchant-001");
      expect(p1).toEqual(p2);
      expect(p1.motivation).toBeDefined();
      expect(p1.secret).toBeDefined();
      expect(p1.distinctiveTrait).toBeDefined();
    });

    it("gives different results for different seeds", () => {
      const p1 = generateNPCPersonality("seed-a");
      const p2 = generateNPCPersonality("seed-b");
      // Statistically high chance to differ
      expect(p1.motivation !== p2.motivation || p1.secret !== p2.secret || p1.distinctiveTrait !== p2.distinctiveTrait).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // rollReaction
  // ---------------------------------------------------------------------------

  describe("rollReaction", () => {
    it("maps 2d6 to correct disposition bands (Hostile boundary)", () => {
      mockedRollDie.mockReturnValueOnce(1).mockReturnValueOnce(1); // Total 2
      const res = rollReaction({ npcSeed: "test", npcRole: "guard", charismaModifier: 0 });
      expect(res.dispositionBand).toBe("Hostile");
      expect(res.initialDisposition).toBe(-8);
    });

    it("maps 2d6 to correct disposition bands (Helpful boundary)", () => {
      mockedRollDie.mockReturnValueOnce(6).mockReturnValueOnce(6); // Total 12
      const res = rollReaction({ npcSeed: "test", npcRole: "guard", charismaModifier: 0 });
      expect(res.dispositionBand).toBe("Helpful");
      expect(res.initialDisposition).toBe(8);
    });

    it("applies charisma modifier and clamps result", () => {
      mockedRollDie.mockReturnValueOnce(1).mockReturnValueOnce(1); // Base 2
      // 2 + 5 = 7 (Indifferent)
      const res = rollReaction({ npcSeed: "test", npcRole: "guard", charismaModifier: 5 });
      expect(res.modifiedTotal).toBe(7);
      expect(res.dispositionBand).toBe("Indifferent");
    });
    
    it("clamps very high rolls to 14", () => {
       mockedRollDie.mockReturnValueOnce(6).mockReturnValueOnce(6); // Base 12
       const res = rollReaction({ npcSeed: "test", npcRole: "guard", charismaModifier: 5 });
       expect(res.modifiedTotal).toBe(14);
    });

    it("clamps very low rolls to 2", () => {
       mockedRollDie.mockReturnValueOnce(1).mockReturnValueOnce(1); // Base 2
       const res = rollReaction({ npcSeed: "test", npcRole: "guard", charismaModifier: -5 });
       expect(res.modifiedTotal).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // computeSocialDC
  // ---------------------------------------------------------------------------

  describe("computeSocialDC", () => {
    it("calculates base DC 10 for indifferent NPC", () => {
      expect(computeSocialDC(0, 1, "persuade")).toBe(10);
    });

    it("adds penalty for negative disposition", () => {
      expect(computeSocialDC(-5, 1, "persuade")).toBe(15);
    });

    it("does not give bonus for positive disposition in this version", () => {
      expect(computeSocialDC(5, 1, "persuade")).toBe(10);
    });

    it("adds penalty for ambitious attempts (dispositionDelta)", () => {
      // (2 - 1) * 3 = 3 penalty
      expect(computeSocialDC(0, 2, "persuade")).toBe(13);
    });

    it("applies intimidation bonus to efficacy (-2 DC)", () => {
      expect(computeSocialDC(0, 1, "intimidate")).toBe(8);
    });
  });

  // ---------------------------------------------------------------------------
  // resolveSocialCheck
  // ---------------------------------------------------------------------------

  describe("resolveSocialCheck", () => {
    const input = { npcSeed: "test", characterId: "player", approach: "persuade" as const, dispositionDelta: 2, intent: "test" };

    it("handles success", () => {
      mockedD20Check.mockReturnValue({ success: true, isCriticalSuccess: false, isCriticalFailure: false, roll: { total: 15, notation: "1d20+0", dice: [{faces:20, result: 15}], diceTotal: 15, modifier: 0 }, abilityModifier: 0, dc: 10 });
      const res = resolveSocialCheck(input, 0, 0);
      expect(res.success).toBe(true);
      expect(res.dispositionAfter).toBe(2);
    });

    it("handles critical success (+1 bonus shift)", () => {
      mockedD20Check.mockReturnValue({ success: true, isCriticalSuccess: true, isCriticalFailure: false, roll: { total: 20, notation: "1d20+0", dice: [{faces:20, result: 20}], diceTotal: 20, modifier: 0 }, abilityModifier: 0, dc: 10 });
      const res = resolveSocialCheck(input, 0, 0);
      expect(res.isCriticalSuccess).toBe(true);
      expect(res.dispositionAfter).toBe(3); // 2 + 1
    });

    it("handles failure (persuade)", () => {
      mockedD20Check.mockReturnValue({ success: false, isCriticalSuccess: false, isCriticalFailure: false, roll: { total: 5, notation: "1d20+0", dice: [{faces:20, result: 5}], diceTotal: 5, modifier: 0 }, abilityModifier: 0, dc: 10 });
      const res = resolveSocialCheck(input, 0, 0);
      expect(res.success).toBe(false);
      expect(res.dispositionAfter).toBe(0); // No change
    });

    it("handles failure (intimidate) — minimal loss", () => {
      const intInput = { ...input, approach: "intimidate" as const };
      mockedD20Check.mockReturnValue({ success: false, isCriticalSuccess: false, isCriticalFailure: false, roll: { total: 5, notation: "1d20+0", dice: [{faces:20, result: 5}], diceTotal: 5, modifier: 0 }, abilityModifier: 0, dc: 10 });
      const res = resolveSocialCheck(intInput, 0, 0);
      expect(res.success).toBe(false);
      expect(res.dispositionAfter).toBe(-1); 
      expect(res.backfire).toBe(true);
    });

    it("handles critical failure (intimidate) — heavier loss", () => {
      const intInput = { ...input, approach: "intimidate" as const };
      mockedD20Check.mockReturnValue({ success: false, isCriticalSuccess: false, isCriticalFailure: true, roll: { total: 1, notation: "1d20+0", dice: [{faces:20, result: 1}], diceTotal: 1, modifier: 0 }, abilityModifier: 0, dc: 10 });
      const res = resolveSocialCheck(intInput, 0, 0);
      expect(res.isCriticalFailure).toBe(true);
      expect(res.dispositionAfter).toBe(-2);
    });
    
    it("handles critical failure (persuade) — no loss", () => {
      mockedD20Check.mockReturnValue({ success: false, isCriticalSuccess: false, isCriticalFailure: true, roll: { total: 1, notation: "1d20+0", dice: [{faces:20, result: 1}], diceTotal: 1, modifier: 0 }, abilityModifier: 0, dc: 10 });
      const res = resolveSocialCheck(input, 0, 0);
      expect(res.dispositionAfter).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // getRumorsPayload
  // ---------------------------------------------------------------------------

  describe("getRumorsPayload", () => {
    const nodes = [{ id: "n1", name: "Cave", feature: "treasure", description: "Shining gold." }];

    it("refuses if disposition < 3 (Indifferent/Unfriendly)", () => {
      const res = getRumorsPayload("seed", "Bert", 0, nodes);
      expect(res.rumors).toHaveLength(0);
      expect(res.refusalReason).toContain("indifferent");
    });

    it("refuses if disposition < -2 (Hostile)", () => {
      const res = getRumorsPayload("seed", "Bert", -5, nodes);
      expect(res.rumors).toHaveLength(0);
      expect(res.refusalReason).toContain("hostile");
    });

    it("returns rumors if friendly", () => {
      const res = getRumorsPayload("seed", "Bert", 5, nodes);
      expect(res.rumors).toHaveLength(1);
      expect(res.rumors[0].nodeName).toBe("Cave");
      expect(res.rumors[0].rumor).toContain("worth finding");
    });

    it("filters out 'empty' features", () => {
      const nodesWithEmpty = [...nodes, { id: "n2", name: "Hall", feature: "empty", description: "Nothing." }];
      const res = getRumorsPayload("seed", "Bert", 5, nodesWithEmpty);
      expect(res.rumors).toHaveLength(1);
    });

    it("includes personal rumors", () => {
      const res = getRumorsPayload("seed", "Bert", 5, nodes, ["I heard a dragon died."]);
      expect(res.rumors).toHaveLength(2);
      expect(res.rumors[1].source).toBe("personal");
    });
  });

  // ---------------------------------------------------------------------------
  // getDispositionBand
  // ---------------------------------------------------------------------------

  describe("getDispositionBand", () => {
    it("maps values correctly", () => {
      expect(getDispositionBand(-10)).toBe("Hostile");
      expect(getDispositionBand(-7)).toBe("Hostile");
      expect(getDispositionBand(-6)).toBe("Unfriendly");
      expect(getDispositionBand(-2)).toBe("Unfriendly");
      expect(getDispositionBand(-1)).toBe("Indifferent");
      expect(getDispositionBand(2)).toBe("Indifferent");
      expect(getDispositionBand(3)).toBe("Friendly");
      expect(getDispositionBand(7)).toBe("Friendly");
      expect(getDispositionBand(8)).toBe("Helpful");
      expect(getDispositionBand(10)).toBe("Helpful");
    });
  });
});
