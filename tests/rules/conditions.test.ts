import { describe, it, expect, vi, afterEach } from "vitest";
import { evaluateAdvantage } from "@/lib/rules/conditions";
import { resolveAttackRoll } from "@/lib/rules/combat";

describe("conditions and advantage logic", () => {
  describe("evaluateAdvantage (5e RAW)", () => {
    it("returns neutral (false, false) for no conditions", () => {
      expect(evaluateAdvantage([], [], true)).toEqual({
        advantage: false,
        disadvantage: false,
      });
    });

    it("grants advantage for melee vs Prone", () => {
      expect(evaluateAdvantage([], ["prone"], true)).toEqual({
        advantage: true,
        disadvantage: false,
      });
    });

    it("grants disadvantage for ranged vs Prone", () => {
      expect(evaluateAdvantage([], ["prone"], false)).toEqual({
        advantage: false,
        disadvantage: true,
      });
    });

    it("grants advantage for attacker vs Blinded defender", () => {
      expect(evaluateAdvantage([], ["blinded"], true)).toEqual({
        advantage: true,
        disadvantage: false,
      });
    });

    it("grants disadvantage for Blinded attacker", () => {
      expect(evaluateAdvantage(["blinded"], [], true)).toEqual({
        advantage: false,
        disadvantage: true,
      });
    });

    it("implements RAW neutralization (Adv + Dis = Normal)", () => {
      // Blinded attacker vs Prone defender (melee)
      // Blinded -> Disadvantage
      // Prone (Melee) -> Advantage
      expect(evaluateAdvantage(["blinded"], ["prone"], true)).toEqual({
        advantage: false,
        disadvantage: false,
      });
    });

    it("neutralizes multiple sources (2 Adv + 1 Dis = Normal)", () => {
      // Attacker: Invisible (Adv), Prone (Dis)
      // Defender: Paralyzed (Adv)
      expect(evaluateAdvantage(["invisible", "prone"], ["paralyzed"], true)).toEqual({
        advantage: false,
        disadvantage: false,
      });
    });

    it("handles Invisible attacker advantage", () => {
      expect(evaluateAdvantage(["invisible"], [], true)).toEqual({
        advantage: true,
        disadvantage: false,
      });
    });

    it("handles Invisible defender disadvantage", () => {
      expect(evaluateAdvantage([], ["invisible"], true)).toEqual({
        advantage: false,
        disadvantage: true,
      });
    });
  });

  describe("resolveAttackRoll integration", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("uses both rolls for advantage and takes highest", () => {
      // Mock Math.random to return 0.2 (roll 5) then 0.7 (roll 15)
      let i = 0;
      const values = [0.2, 0.7];
      vi.spyOn(Math, "random").mockImplementation(() => values[i++]);

      const result = resolveAttackRoll(0, 10, ["invisible"], [], true);
      
      expect(result.advantage).toBe(true);
      expect(result.roll).toBe(15); // max(5, 15)
      expect(result.dice).toEqual([5, 15]);
      expect(result.hit).toBe(true);
    });

    it("uses both rolls for disadvantage and takes lowest", () => {
      // Mock Math.random to return 0.2 (roll 5) then 0.7 (roll 15)
      let i = 0;
      const values = [0.2, 0.7];
      vi.spyOn(Math, "random").mockImplementation(() => values[i++]);

      const result = resolveAttackRoll(0, 10, ["blinded"], [], true);
      
      expect(result.disadvantage).toBe(true);
      expect(result.roll).toBe(5); // min(5, 15)
      expect(result.dice).toEqual([5, 15]);
      expect(result.hit).toBe(false);
    });

    it("supports neutralization in resolveAttackRoll", () => {
      // Blinded attacker vs Paralyzed defender
      vi.spyOn(Math, "random").mockReturnValue(0.45); // roll 10
      
      const result = resolveAttackRoll(0, 10, ["blinded"], ["paralyzed"], true);
      
      expect(result.advantage).toBe(false);
      expect(result.disadvantage).toBe(false);
      expect(result.roll).toBe(10);
      expect(result.dice).toEqual([10]);
    });
  });
});
