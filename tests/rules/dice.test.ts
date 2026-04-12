import { describe, it, expect, vi, afterEach } from "vitest";
import {
  rollDie,
  roll,
  rollN,
  rollMany,
  abilityModifier,
  d20Check,
  attackRoll,
  damageRoll
} from "@/lib/rules/dice";

describe("dice rules", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("rollDie", () => {
    it("throws if faces < 2", () => {
      expect(() => rollDie(1)).toThrow(RangeError);
      expect(() => rollDie(0)).toThrow(RangeError);
    });

    it("returns a number between 1 and faces", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.99);
      expect(rollDie(20)).toBe(20);
      vi.spyOn(Math, "random").mockReturnValue(0.0);
      expect(rollDie(20)).toBe(1);
    });
  });

  describe("roll", () => {
    it("parses and rolls 1d20", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5); // 0.5 * 20 = 10 -> 11
      const result = roll("1d20");
      expect(result.diceTotal).toBe(11);
      expect(result.modifier).toBe(0);
      expect(result.total).toBe(11);
    });

    it("parses and rolls 2d6+3", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5); // 0.5 * 6 = 3 -> 4
      const result = roll("2d6+3");
      expect(result.diceTotal).toBe(8); // 4 + 4
      expect(result.modifier).toBe(3);
      expect(result.total).toBe(11);
    });

    it("parses implicit 1 die (d20)", () => {
      vi.spyOn(Math, "random").mockReturnValue(0); // 1
      const result = roll("d20");
      expect(result.dice.length).toBe(1);
      expect(result.diceTotal).toBe(1);
    });

    it("handles negative modifiers", () => {
      vi.spyOn(Math, "random").mockReturnValue(0); // 1
      const result = roll("1d8-2");
      expect(result.modifier).toBe(-2);
      expect(result.total).toBe(-1); // 1 - 2
    });

    it("throws on invalid notation", () => {
      expect(() => roll("invalid")).toThrow(SyntaxError);
      expect(() => roll("1d")).toThrow(SyntaxError);
    });
  });

  describe("rollN and rollMany", () => {
    it("rollN rolls 1 die with modifier", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.25); // 0.25 * 6 = 1 -> 2
      const result = rollN(6, 2);
      expect(result.notation).toBe("1d6+2");
      expect(result.total).toBe(4);
    });

    it("rollMany rolls multiple dice", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.99); // max
      const result = rollMany(3, 8, -1);
      expect(result.notation).toBe("3d8-1");
      expect(result.total).toBe(23); // (8 * 3) - 1
    });
  });

  describe("abilityModifier", () => {
    it("calculates correct modifier", () => {
      expect(abilityModifier(10)).toBe(0);
      expect(abilityModifier(12)).toBe(1);
      expect(abilityModifier(13)).toBe(1);
      expect(abilityModifier(8)).toBe(-1);
      expect(abilityModifier(3)).toBe(-4);
      expect(abilityModifier(20)).toBe(5);
    });
  });

  describe("d20Check", () => {
    it("detects regular success", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5); // 11
      const result = d20Check(5, 15); // 11 + 5 = 16 vs DC 15
      expect(result.success).toBe(true);
      expect(result.isCriticalSuccess).toBe(false);
      expect(result.isCriticalFailure).toBe(false);
    });

    it("detects critical success on natural 20", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.99); // 20
      const result = d20Check(-5, 20); // 20 - 5 = 15 vs DC 20
      // Even if total < DC, natural 20 succeeds per ability check rules assumed here?
      // "Natural 20 always succeeds; natural 1 always fails" in d20Check comments.
      expect(result.isCriticalSuccess).toBe(true);
      expect(result.success).toBe(true);
    });

    it("detects critical failure on natural 1", () => {
      vi.spyOn(Math, "random").mockReturnValue(0); // 1
      const result = d20Check(20, 10); // 1 + 20 = 21 vs DC 10
      expect(result.isCriticalFailure).toBe(true);
      expect(result.success).toBe(false);
    });
  });

  describe("attackRoll", () => {
    it("hits on meeting AC", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.45); // 0.45 * 20 = 9 -> 10
      const result = attackRoll(6, 16); // 16 target AC
      expect(result.hits).toBe(true);
    });

    it("critical miss on 1", () => {
      vi.spyOn(Math, "random").mockReturnValue(0); // 1
      const result = attackRoll(20, 10);
      expect(result.isCriticalMiss).toBe(true);
      expect(result.hits).toBe(false);
    });
  });

  describe("damageRoll", () => {
    it("does standard roll when not critical", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.99); // max
      const result = damageRoll("2d6+5", false);
      expect(result.notation).toBe("2d6+5");
      expect(result.total).toBe(12 + 5);
      expect(result.dice.length).toBe(2);
    });

    it("doubles dice when critical but keeps modifier", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.99); // max
      const result = damageRoll("2d6+5", true);
      expect(result.notation).toBe("4d6+5");
      expect(result.total).toBe(24 + 5);
      expect(result.dice.length).toBe(4);
    });
  });
});
