import { describe, expect, it } from "vitest";
import { classifyHitDiceIntegrity } from "@/lib/rules/hit-dice-integrity";

describe("classifyHitDiceIntegrity", () => {
  it("1. level 1 / xp 0 / total 1 / remaining 1 -> VALID_SETTLED, no patch", () => {
    const result = classifyHitDiceIntegrity({
      xp: 0,
      level: 1,
      hitDiceTotal: 1,
      hitDiceRemaining: 1,
    });
    expect(result.status).toBe("VALID_SETTLED");
    expect(result.patch).toBeUndefined();
  });

  it("2. level 1 / xp 0 / total 0 / remaining 0 -> AMBIGUOUS (total below level, never auto-repaired)", () => {
    const result = classifyHitDiceIntegrity({
      xp: 0,
      level: 1,
      hitDiceTotal: 0,
      hitDiceRemaining: 0,
    });
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.reason).toBe("TOTAL_BELOW_LEVEL");
    expect(result.patch).toBeUndefined();
  });

  it("3. level 5 / xp 6500 / total 5 / remaining 5 -> VALID_SETTLED", () => {
    const result = classifyHitDiceIntegrity({
      xp: 6500,
      level: 5,
      hitDiceTotal: 5,
      hitDiceRemaining: 5,
    });
    expect(result.status).toBe("VALID_SETTLED");
    expect(result.patch).toBeUndefined();
  });

  it("4. level 5 / xp 6500 / total 4 / remaining 4 -> AMBIGUOUS (old-contract residue)", () => {
    const result = classifyHitDiceIntegrity({
      xp: 6500,
      level: 5,
      hitDiceTotal: 4,
      hitDiceRemaining: 4,
    });
    // Under Model E level and hitDiceTotal advance together, so a lagging
    // total is never a legitimate persisted state.
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.reason).toBe("TOTAL_BELOW_LEVEL");
    expect(result.patch).toBeUndefined();
  });

  it("5. level 5 / xp 6500 / total 1 / remaining 1 -> AMBIGUOUS", () => {
    const result = classifyHitDiceIntegrity({
      xp: 6500,
      level: 5,
      hitDiceTotal: 1,
      hitDiceRemaining: 1,
    });
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.patch).toBeUndefined();
  });

  it("6. level 5 / xp 0 / total 5 -> INVALID_PROGRESSION (XP behind the applied level)", () => {
    const result = classifyHitDiceIntegrity({
      xp: 0,
      level: 5,
      hitDiceTotal: 5,
      hitDiceRemaining: 5,
    });
    expect(result.status).toBe("INVALID_PROGRESSION");
    expect(result.reason).toBe("XP_BELOW_APPLIED_LEVEL");
    expect(result.patch).toBeUndefined();
  });

  it("6b. XP ahead of the applied level is valid Model E progression", () => {
    const result = classifyHitDiceIntegrity({
      xp: 6500,
      level: 3,
      hitDiceTotal: 3,
      hitDiceRemaining: 3,
    });
    expect(result.status).toBe("VALID_SETTLED");
    expect(result.patch).toBeUndefined();
  });

  it("7. level 21 -> INVALID_PROGRESSION (level above max)", () => {
    const result = classifyHitDiceIntegrity({
      xp: 355_000,
      level: 21,
      hitDiceTotal: 20,
      hitDiceRemaining: 20,
    });
    expect(result.status).toBe("INVALID_PROGRESSION");
    expect(result.reason).toBe("LEVEL_ABOVE_MAX");
  });

  it("8. remaining > total -> REPAIRABLE, clamped down", () => {
    const result = classifyHitDiceIntegrity({
      xp: 6500,
      level: 5,
      hitDiceTotal: 5,
      hitDiceRemaining: 9,
    });
    expect(result.status).toBe("REPAIRABLE");
    expect(result.patch).toEqual({ hitDiceRemaining: 5 });
  });

  it("9. remaining < 0 -> REPAIRABLE, clamped to 0", () => {
    const result = classifyHitDiceIntegrity({
      xp: 6500,
      level: 5,
      hitDiceTotal: 5,
      hitDiceRemaining: -1,
    });
    expect(result.status).toBe("REPAIRABLE");
    expect(result.patch).toEqual({ hitDiceRemaining: 0 });
  });

  it("10. level 5 / total 7 / remaining 7 -> AMBIGUOUS (total above level, never auto-repaired)", () => {
    const result = classifyHitDiceIntegrity({
      xp: 6500,
      level: 5,
      hitDiceTotal: 7,
      hitDiceRemaining: 7,
    });
    // Lowering the total to match `level` would assert a settled level this
    // classifier cannot verify — that decision belongs to the Model E
    // transition tool, not to an automatic repair.
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.reason).toBe("TOTAL_ABOVE_LEVEL");
    expect(result.patch).toBeUndefined();
  });

  it("11. level 5 / total 1 / remaining -3 -> AMBIGUOUS, no partial repair", () => {
    const result = classifyHitDiceIntegrity({
      xp: 6500,
      level: 5,
      hitDiceTotal: 1,
      hitDiceRemaining: -3,
    });
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.patch).toBeUndefined();
  });

  it("12. level 2 / total 1 -> AMBIGUOUS", () => {
    const result = classifyHitDiceIntegrity({
      xp: 300,
      level: 2,
      hitDiceTotal: 1,
      hitDiceRemaining: 1,
    });
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.reason).toBe("TOTAL_BELOW_LEVEL");
    expect(result.patch).toBeUndefined();
  });

  it("13. level 1 / total 2 -> AMBIGUOUS (total above level, never auto-repaired)", () => {
    const result = classifyHitDiceIntegrity({
      xp: 0,
      level: 1,
      hitDiceTotal: 2,
      hitDiceRemaining: 2,
    });
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.reason).toBe("TOTAL_ABOVE_LEVEL");
    expect(result.patch).toBeUndefined();
  });

  it("14a. non-integer xp -> INVALID_PROGRESSION", () => {
    const result = classifyHitDiceIntegrity({
      xp: 6500.5,
      level: 5,
      hitDiceTotal: 5,
      hitDiceRemaining: 5,
    });
    expect(result.status).toBe("INVALID_PROGRESSION");
    expect(result.reason).toBe("NON_INTEGER_XP");
  });

  it("14b. negative xp -> INVALID_PROGRESSION", () => {
    const result = classifyHitDiceIntegrity({
      xp: -1,
      level: 1,
      hitDiceTotal: 1,
      hitDiceRemaining: 1,
    });
    expect(result.status).toBe("INVALID_PROGRESSION");
    expect(result.reason).toBe("NEGATIVE_XP");
  });

  it("14c. non-integer level -> INVALID_PROGRESSION", () => {
    const result = classifyHitDiceIntegrity({
      xp: 0,
      level: 1.5,
      hitDiceTotal: 1,
      hitDiceRemaining: 1,
    });
    expect(result.status).toBe("INVALID_PROGRESSION");
    expect(result.reason).toBe("NON_INTEGER_LEVEL");
  });

  it("14d. level below MIN_LEVEL -> INVALID_PROGRESSION", () => {
    const result = classifyHitDiceIntegrity({
      xp: 0,
      level: 0,
      hitDiceTotal: 1,
      hitDiceRemaining: 1,
    });
    expect(result.status).toBe("INVALID_PROGRESSION");
    expect(result.reason).toBe("LEVEL_BELOW_MIN");
  });

  it("14e. non-integer hitDiceTotal -> INVALID_PROGRESSION", () => {
    const result = classifyHitDiceIntegrity({
      xp: 0,
      level: 1,
      hitDiceTotal: 1.2,
      hitDiceRemaining: 1,
    });
    expect(result.status).toBe("INVALID_PROGRESSION");
    expect(result.reason).toBe("NON_INTEGER_HIT_DICE_TOTAL");
  });

  it("14f. non-integer hitDiceRemaining -> INVALID_PROGRESSION", () => {
    const result = classifyHitDiceIntegrity({
      xp: 0,
      level: 1,
      hitDiceTotal: 1,
      hitDiceRemaining: 0.9,
    });
    expect(result.status).toBe("INVALID_PROGRESSION");
    expect(result.reason).toBe("NON_INTEGER_HIT_DICE_REMAINING");
  });

  it("boundary: level MAX_LEVEL (20) settled is valid", () => {
    const result = classifyHitDiceIntegrity({
      xp: 355_000,
      level: 20,
      hitDiceTotal: 20,
      hitDiceRemaining: 20,
    });
    expect(result.status).toBe("VALID_SETTLED");
    expect(result.patch).toBeUndefined();
  });

  it("boundary: level MAX_LEVEL (20) with a lagging total is AMBIGUOUS", () => {
    const result = classifyHitDiceIntegrity({
      xp: 355_000,
      level: 20,
      hitDiceTotal: 19,
      hitDiceRemaining: 19,
    });
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.reason).toBe("TOTAL_BELOW_LEVEL");
    expect(result.patch).toBeUndefined();
  });

  it("boundary: xp past the level-2 threshold at applied level 1 is valid and pending", () => {
    const result = classifyHitDiceIntegrity({
      xp: 300,
      level: 1,
      hitDiceTotal: 1,
      hitDiceRemaining: 1,
    });
    expect(result.status).toBe("VALID_SETTLED");
    expect(result.patch).toBeUndefined();
  });

  it("patch never contains xp, level, or hitDiceTotal fields", () => {
    const result = classifyHitDiceIntegrity({
      xp: 6500,
      level: 5,
      hitDiceTotal: 5,
      hitDiceRemaining: -1,
    });
    expect(result.status).toBe("REPAIRABLE");
    expect(Object.keys(result.patch ?? {})).toEqual(["hitDiceRemaining"]);
  });

  it("a lagging total with an out-of-range remaining is AMBIGUOUS, not a partial repair", () => {
    const result = classifyHitDiceIntegrity({
      xp: 6500,
      level: 5,
      hitDiceTotal: 7,
      hitDiceRemaining: -1,
    });
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.reason).toBe("TOTAL_ABOVE_LEVEL");
    expect(result.patch).toBeUndefined();
  });

  it("AMBIGUOUS never carries a patch even with an out-of-range remaining", () => {
    const result = classifyHitDiceIntegrity({
      xp: 14_000,
      level: 6,
      hitDiceTotal: 2,
      hitDiceRemaining: 99,
    });
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.patch).toBeUndefined();
  });
});
