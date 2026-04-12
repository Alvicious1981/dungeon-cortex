import { describe, it, expect } from "vitest";
import {
  getLevelFromXP,
  canLevelUp,
  xpForLevel,
  computeXPAward,
  MIN_LEVEL,
  MAX_LEVEL,
} from "@/lib/rules/progression";

// ---------------------------------------------------------------------------
// getLevelFromXP — threshold boundary tests (5e 2014 SRD Table p.15)
// ---------------------------------------------------------------------------

describe("getLevelFromXP", () => {
  it("returns level 1 at 0 XP", () => {
    expect(getLevelFromXP(0)).toBe(1);
  });

  it("returns level 1 at 299 XP (just below level 2 threshold)", () => {
    expect(getLevelFromXP(299)).toBe(1);
  });

  it("returns level 2 at exactly 300 XP", () => {
    expect(getLevelFromXP(300)).toBe(2);
  });

  it("returns level 2 at 899 XP (just below level 3 threshold)", () => {
    expect(getLevelFromXP(899)).toBe(2);
  });

  it("returns level 3 at exactly 900 XP", () => {
    expect(getLevelFromXP(900)).toBe(3);
  });

  it("returns level 4 at exactly 2700 XP", () => {
    expect(getLevelFromXP(2_700)).toBe(4);
  });

  it("returns level 5 at exactly 6500 XP", () => {
    expect(getLevelFromXP(6_500)).toBe(5);
  });

  it("returns level 10 at exactly 64000 XP", () => {
    expect(getLevelFromXP(64_000)).toBe(10);
  });

  it("returns level 10 at 84999 XP (just below level 11 threshold)", () => {
    expect(getLevelFromXP(84_999)).toBe(10);
  });

  it("returns level 11 at exactly 85000 XP", () => {
    expect(getLevelFromXP(85_000)).toBe(11);
  });

  it("returns level 20 at exactly 355000 XP", () => {
    expect(getLevelFromXP(355_000)).toBe(20);
  });

  it("returns level 20 for XP well above the cap (no level 21 exists)", () => {
    expect(getLevelFromXP(999_999)).toBe(20);
  });

  it("returns level 19 at 354999 XP (just below level 20 threshold)", () => {
    expect(getLevelFromXP(354_999)).toBe(19);
  });

  it("throws RangeError for negative XP", () => {
    expect(() => getLevelFromXP(-1)).toThrow(RangeError);
    expect(() => getLevelFromXP(-1)).toThrow("XP cannot be negative");
  });
});

// ---------------------------------------------------------------------------
// canLevelUp — level-up eligibility
// ---------------------------------------------------------------------------

describe("canLevelUp", () => {
  it("returns false at level 1 with 0 XP (not enough for level 2)", () => {
    expect(canLevelUp(0, 1)).toBe(false);
  });

  it("returns false at level 1 with 299 XP (one short of level 2)", () => {
    expect(canLevelUp(299, 1)).toBe(false);
  });

  it("returns true at level 1 with exactly 300 XP (level 2 threshold met)", () => {
    expect(canLevelUp(300, 1)).toBe(true);
  });

  it("returns true at level 1 with 500 XP (above level 2 threshold)", () => {
    expect(canLevelUp(500, 1)).toBe(true);
  });

  it("returns false at level 2 with 300 XP (not enough for level 3)", () => {
    expect(canLevelUp(300, 2)).toBe(false);
  });

  it("returns true at level 2 with exactly 900 XP (level 3 threshold met)", () => {
    expect(canLevelUp(900, 2)).toBe(true);
  });

  it("returns false at level 20 regardless of XP (already at cap)", () => {
    expect(canLevelUp(999_999, 20)).toBe(false);
  });

  it("returns false at level 19 with 354999 XP (one short of level 20)", () => {
    expect(canLevelUp(354_999, 19)).toBe(false);
  });

  it("returns true at level 19 with exactly 355000 XP (level 20 threshold met)", () => {
    expect(canLevelUp(355_000, 19)).toBe(true);
  });

  it("throws RangeError for negative XP", () => {
    expect(() => canLevelUp(-1, 1)).toThrow(RangeError);
    expect(() => canLevelUp(-1, 1)).toThrow("XP cannot be negative");
  });

  it("throws RangeError for level 0 (below minimum)", () => {
    expect(() => canLevelUp(0, 0)).toThrow(RangeError);
    expect(() => canLevelUp(0, 0)).toThrow("Level must be between");
  });

  it("throws RangeError for level 21 (above maximum)", () => {
    expect(() => canLevelUp(0, 21)).toThrow(RangeError);
    expect(() => canLevelUp(0, 21)).toThrow("Level must be between");
  });
});

// ---------------------------------------------------------------------------
// xpForLevel — threshold lookup
// ---------------------------------------------------------------------------

describe("xpForLevel", () => {
  it("returns 0 for level 1", () => {
    expect(xpForLevel(1)).toBe(0);
  });

  it("returns 300 for level 2", () => {
    expect(xpForLevel(2)).toBe(300);
  });

  it("returns 355000 for level 20", () => {
    expect(xpForLevel(20)).toBe(355_000);
  });

  it("throws RangeError for level 0", () => {
    expect(() => xpForLevel(0)).toThrow(RangeError);
  });

  it("throws RangeError for level 21", () => {
    expect(() => xpForLevel(21)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// MIN_LEVEL / MAX_LEVEL exports
// ---------------------------------------------------------------------------

describe("level constants", () => {
  it("MIN_LEVEL is 1", () => {
    expect(MIN_LEVEL).toBe(1);
  });

  it("MAX_LEVEL is 20", () => {
    expect(MAX_LEVEL).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// computeXPAward — pure XP orchestration helper
// ---------------------------------------------------------------------------

describe("computeXPAward", () => {
  it("returns correct newXP as sum of currentXP + amount", () => {
    const result = computeXPAward(0, 1, 300);
    expect(result.newXP).toBe(300);
  });

  it("detects level-up when award crosses a threshold", () => {
    // character at level 1 with 0 xp, award 300 → level 2
    const result = computeXPAward(0, 1, 300);
    expect(result.newLevel).toBe(2);
    expect(result.leveledUp).toBe(true);
  });

  it("no level-up when threshold is not crossed", () => {
    // character at level 1 with 0 xp, award 299 → still level 1
    const result = computeXPAward(0, 1, 299);
    expect(result.newLevel).toBe(1);
    expect(result.leveledUp).toBe(false);
  });

  it("detects level-up from level 4 to level 5 crossing 6500 threshold", () => {
    // character at level 4 with 2700 xp, award 3800 → 6500 xp → level 5
    const result = computeXPAward(2_700, 4, 3_800);
    expect(result.newXP).toBe(6_500);
    expect(result.newLevel).toBe(5);
    expect(result.leveledUp).toBe(true);
  });

  it("detects multi-level jump in a single large award", () => {
    // character at level 1 with 0 xp, award 6500 → level 5 (skips 2, 3, 4)
    const result = computeXPAward(0, 1, 6_500);
    expect(result.newLevel).toBe(5);
    expect(result.leveledUp).toBe(true);
  });

  it("no level-up when character is already at max level (20)", () => {
    const result = computeXPAward(355_000, 20, 10_000);
    expect(result.newLevel).toBe(20);
    expect(result.leveledUp).toBe(false);
  });

  it("accumulates correctly across multiple sequential awards", () => {
    const first  = computeXPAward(0, 1, 150);    // 150 xp, level 1
    const second = computeXPAward(first.newXP, first.newLevel, 150); // 300 xp → level 2
    expect(second.newXP).toBe(300);
    expect(second.leveledUp).toBe(true);
  });

  it("throws RangeError for amount of 0", () => {
    expect(() => computeXPAward(0, 1, 0)).toThrow(RangeError);
    expect(() => computeXPAward(0, 1, 0)).toThrow("positive integer");
  });

  it("throws RangeError for negative amount", () => {
    expect(() => computeXPAward(500, 2, -100)).toThrow(RangeError);
  });

  it("throws RangeError for fractional amount", () => {
    expect(() => computeXPAward(0, 1, 1.5)).toThrow(RangeError);
  });
});
