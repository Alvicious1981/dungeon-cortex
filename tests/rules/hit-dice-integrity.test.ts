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

  it("2. level 1 / xp 0 / total 0 / remaining 0 -> REPAIRABLE total->1, remaining stays 0", () => {
    const result = classifyHitDiceIntegrity({
      xp: 0,
      level: 1,
      hitDiceTotal: 0,
      hitDiceRemaining: 0,
    });
    expect(result.status).toBe("REPAIRABLE");
    expect(result.patch).toEqual({ hitDiceTotal: 1 });
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

  it("4. level 5 / xp 6500 / total 4 / remaining 4 -> VALID_PENDING", () => {
    const result = classifyHitDiceIntegrity({
      xp: 6500,
      level: 5,
      hitDiceTotal: 4,
      hitDiceRemaining: 4,
    });
    expect(result.status).toBe("VALID_PENDING");
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

  it("6. level 5 / xp 0 / total 5 -> INVALID_PROGRESSION (xp/level mismatch)", () => {
    const result = classifyHitDiceIntegrity({
      xp: 0,
      level: 5,
      hitDiceTotal: 5,
      hitDiceRemaining: 5,
    });
    expect(result.status).toBe("INVALID_PROGRESSION");
    expect(result.reason).toBe("XP_LEVEL_MISMATCH");
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

  it("10. level 5 / total 7 / remaining 7 -> REPAIRABLE total->5 and remaining->5", () => {
    const result = classifyHitDiceIntegrity({
      xp: 6500,
      level: 5,
      hitDiceTotal: 7,
      hitDiceRemaining: 7,
    });
    expect(result.status).toBe("REPAIRABLE");
    expect(result.patch).toEqual({ hitDiceTotal: 5, hitDiceRemaining: 5 });
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

  it("12. level 2 / total 1 -> VALID_PENDING", () => {
    const result = classifyHitDiceIntegrity({
      xp: 300,
      level: 2,
      hitDiceTotal: 1,
      hitDiceRemaining: 1,
    });
    expect(result.status).toBe("VALID_PENDING");
    expect(result.patch).toBeUndefined();
  });

  it("13. level 1 / total 2 -> REPAIRABLE to total 1", () => {
    const result = classifyHitDiceIntegrity({
      xp: 0,
      level: 1,
      hitDiceTotal: 2,
      hitDiceRemaining: 2,
    });
    expect(result.status).toBe("REPAIRABLE");
    expect(result.patch).toEqual({ hitDiceTotal: 1, hitDiceRemaining: 1 });
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

  it("boundary: level MAX_LEVEL (20) pending is valid", () => {
    const result = classifyHitDiceIntegrity({
      xp: 355_000,
      level: 20,
      hitDiceTotal: 19,
      hitDiceRemaining: 19,
    });
    expect(result.status).toBe("VALID_PENDING");
    expect(result.patch).toBeUndefined();
  });

  it("boundary: xp exactly at level 1 threshold with mismatched level is INVALID_PROGRESSION", () => {
    const result = classifyHitDiceIntegrity({
      xp: 300,
      level: 1,
      hitDiceTotal: 1,
      hitDiceRemaining: 1,
    });
    expect(result.status).toBe("INVALID_PROGRESSION");
    expect(result.reason).toBe("XP_LEVEL_MISMATCH");
  });

  it("patch never contains xp or level fields", () => {
    const result = classifyHitDiceIntegrity({
      xp: 6500,
      level: 5,
      hitDiceTotal: 7,
      hitDiceRemaining: -1,
    });
    expect(result.status).toBe("REPAIRABLE");
    expect(Object.keys(result.patch ?? {}).sort()).toEqual(
      ["hitDiceRemaining", "hitDiceTotal"].sort()
    );
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
