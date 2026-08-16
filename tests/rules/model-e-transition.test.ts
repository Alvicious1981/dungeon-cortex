import { describe, expect, it } from "vitest";
import {
  classifyModelETransition,
  type ModelETransitionInput,
  type ModelETransitionResult,
} from "@/lib/rules/model-e-transition";
import { MIN_LEVEL, MAX_LEVEL, getLevelFromXP } from "@/lib/rules/progression";

/**
 * Minimum XP that reaches `level`, found by binary search over getLevelFromXP.
 * Derived from the single mechanical authority rather than restating the SRD
 * threshold table here.
 */
function xpForLevel(level: number): number {
  if (level === MIN_LEVEL) return 0;
  let low = 0;
  let high = 1_000_000;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (getLevelFromXP(mid) >= level) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return low;
}

/** A row at the minimum XP for `targetLevel`, with hit dice at full. */
function row(
  targetLevel: number,
  level: number,
  hitDiceTotal: number
): ModelETransitionInput {
  return {
    xp: xpForLevel(targetLevel),
    level,
    hitDiceTotal,
    hitDiceRemaining: hitDiceTotal,
  };
}

describe("classifyModelETransition — mandatory cases", () => {
  it("1. t1/l1/tot1 -> E_SETTLED", () => {
    const result = classifyModelETransition(row(1, 1, 1));
    expect(result.category).toBe("E_SETTLED");
    expect(result.reason).toBe("SETTLED");
    expect(result.targetLevel).toBe(1);
    expect(result.pendingLevels).toBe(0);
    expect(result.patch).toBeUndefined();
  });

  it("2. t2/l2/tot1 -> AMBIGUOUS (indistinguishable from the column DEFAULT)", () => {
    const result = classifyModelETransition(row(2, 2, 1));
    expect(result.category).toBe("AMBIGUOUS");
    expect(result.reason).toBe("TOTAL_INDISTINGUISHABLE_FROM_DEFAULT");
    expect(result.patch).toBeUndefined();
  });

  it("3. t5/l5/tot5 -> E_SETTLED", () => {
    const result = classifyModelETransition(row(5, 5, 5));
    expect(result.category).toBe("E_SETTLED");
    expect(result.pendingLevels).toBe(0);
    expect(result.patch).toBeUndefined();
  });

  it("4. t5/l5/tot4 -> CONVERTIBLE, level -> 4", () => {
    const result = classifyModelETransition(row(5, 5, 4));
    expect(result.category).toBe("CONVERTIBLE");
    expect(result.reason).toBe("APPLIED_LEVEL_BELOW_XP_LEVEL");
    expect(result.patch).toEqual({ level: 4 });
  });

  it("5. t5/l5/tot3 -> CONVERTIBLE, level -> 3", () => {
    const result = classifyModelETransition(row(5, 5, 3));
    expect(result.category).toBe("CONVERTIBLE");
    expect(result.patch).toEqual({ level: 3 });
  });

  it("6. t5/l5/tot2 -> CONVERTIBLE, level -> 2", () => {
    const result = classifyModelETransition(row(5, 5, 2));
    expect(result.category).toBe("CONVERTIBLE");
    expect(result.patch).toEqual({ level: 2 });
  });

  it("7. t5/l5/tot1 -> AMBIGUOUS", () => {
    const result = classifyModelETransition(row(5, 5, 1));
    expect(result.category).toBe("AMBIGUOUS");
    expect(result.reason).toBe("TOTAL_INDISTINGUISHABLE_FROM_DEFAULT");
    expect(result.patch).toBeUndefined();
  });

  it("8. t5/l4/tot4 -> E_PENDING with pendingLevels = 1", () => {
    const result = classifyModelETransition(row(5, 4, 4));
    expect(result.category).toBe("E_PENDING");
    expect(result.reason).toBe("PENDING_LEVELS");
    expect(result.targetLevel).toBe(5);
    expect(result.pendingLevels).toBe(1);
    expect(result.patch).toBeUndefined();
  });

  it("9. t5/l4/tot3 -> AMBIGUOUS (level ahead of XP with a disagreeing total)", () => {
    const result = classifyModelETransition(row(5, 4, 3));
    expect(result.category).toBe("AMBIGUOUS");
    expect(result.reason).toBe("LEVEL_AHEAD_OF_XP_WITHOUT_AUTHORIZED_PATH");
    expect(result.patch).toBeUndefined();
  });

  it("10. t5/l4/tot1 -> AMBIGUOUS", () => {
    const result = classifyModelETransition(row(5, 4, 1));
    expect(result.category).toBe("AMBIGUOUS");
    expect(result.reason).toBe("LEVEL_AHEAD_OF_XP_WITHOUT_AUTHORIZED_PATH");
    expect(result.patch).toBeUndefined();
  });

  it("11. t5/l1/tot1 -> E_PENDING with pendingLevels = 4", () => {
    const result = classifyModelETransition(row(5, 1, 1));
    expect(result.category).toBe("E_PENDING");
    expect(result.pendingLevels).toBe(4);
    expect(result.patch).toBeUndefined();
  });

  it("12. t1/l5/tot5 -> INVALID_PROGRESSION (XP behind the applied level)", () => {
    const result = classifyModelETransition(row(1, 5, 5));
    expect(result.category).toBe("INVALID_PROGRESSION");
    expect(result.reason).toBe("XP_BELOW_APPLIED_LEVEL");
    expect(result.patch).toBeUndefined();
  });

  it("13. hitDiceTotal > level -> INVALID_HIT_DICE", () => {
    const result = classifyModelETransition({
      xp: xpForLevel(5),
      level: 5,
      hitDiceTotal: 6,
      hitDiceRemaining: 5,
    });
    expect(result.category).toBe("INVALID_HIT_DICE");
    expect(result.reason).toBe("TOTAL_EXCEEDS_LEVEL");
    expect(result.patch).toBeUndefined();
  });

  it("14. hitDiceTotal <= 0 -> INVALID_HIT_DICE", () => {
    for (const hitDiceTotal of [0, -1]) {
      const result = classifyModelETransition({
        xp: xpForLevel(5),
        level: 5,
        hitDiceTotal,
        hitDiceRemaining: 0,
      });
      expect(result.category).toBe("INVALID_HIT_DICE");
      expect(result.reason).toBe("TOTAL_BELOW_MIN");
    }
  });

  it("15. hitDiceRemaining > hitDiceTotal -> INVALID_HIT_DICE", () => {
    const result = classifyModelETransition({
      xp: xpForLevel(5),
      level: 5,
      hitDiceTotal: 5,
      hitDiceRemaining: 6,
    });
    expect(result.category).toBe("INVALID_HIT_DICE");
    expect(result.reason).toBe("REMAINING_EXCEEDS_TOTAL");
  });

  it("16. hitDiceRemaining < 0 -> INVALID_HIT_DICE", () => {
    const result = classifyModelETransition({
      xp: xpForLevel(5),
      level: 5,
      hitDiceTotal: 5,
      hitDiceRemaining: -1,
    });
    expect(result.category).toBe("INVALID_HIT_DICE");
    expect(result.reason).toBe("REMAINING_NEGATIVE");
  });

  it("17. level 0 -> INVALID_PROGRESSION", () => {
    const result = classifyModelETransition({
      xp: 0,
      level: 0,
      hitDiceTotal: 1,
      hitDiceRemaining: 1,
    });
    expect(result.category).toBe("INVALID_PROGRESSION");
    expect(result.reason).toBe("LEVEL_BELOW_MIN");
    expect(result.targetLevel).toBeNull();
    expect(result.pendingLevels).toBeNull();
  });

  it("18. level 21 -> INVALID_PROGRESSION", () => {
    const result = classifyModelETransition({
      xp: xpForLevel(MAX_LEVEL),
      level: 21,
      hitDiceTotal: 20,
      hitDiceRemaining: 20,
    });
    expect(result.category).toBe("INVALID_PROGRESSION");
    expect(result.reason).toBe("LEVEL_ABOVE_MAX");
  });

  it("19. negative xp -> INVALID_PROGRESSION, without calling getLevelFromXP", () => {
    const result = classifyModelETransition({
      xp: -1,
      level: 1,
      hitDiceTotal: 1,
      hitDiceRemaining: 1,
    });
    expect(result.category).toBe("INVALID_PROGRESSION");
    expect(result.reason).toBe("NEGATIVE_XP");
    expect(result.targetLevel).toBeNull();
  });

  it("20. non-integer inputs map to the corresponding invalid category", () => {
    const nonIntegers = [1.5, NaN, Infinity];

    for (const xp of nonIntegers) {
      const result = classifyModelETransition({
        xp,
        level: 5,
        hitDiceTotal: 5,
        hitDiceRemaining: 5,
      });
      expect(result.category).toBe("INVALID_PROGRESSION");
      expect(result.reason).toBe("NON_INTEGER_XP");
    }

    for (const level of nonIntegers) {
      const result = classifyModelETransition({
        xp: xpForLevel(5),
        level,
        hitDiceTotal: 5,
        hitDiceRemaining: 5,
      });
      expect(result.category).toBe("INVALID_PROGRESSION");
      expect(result.reason).toBe("NON_INTEGER_LEVEL");
    }

    for (const hitDiceTotal of nonIntegers) {
      const result = classifyModelETransition({
        xp: xpForLevel(5),
        level: 5,
        hitDiceTotal,
        hitDiceRemaining: 5,
      });
      expect(result.category).toBe("INVALID_HIT_DICE");
      expect(result.reason).toBe("NON_INTEGER_HIT_DICE_TOTAL");
    }

    for (const hitDiceRemaining of nonIntegers) {
      const result = classifyModelETransition({
        xp: xpForLevel(5),
        level: 5,
        hitDiceTotal: 5,
        hitDiceRemaining,
      });
      expect(result.category).toBe("INVALID_HIT_DICE");
      expect(result.reason).toBe("NON_INTEGER_HIT_DICE_REMAINING");
    }
  });
});

describe("classifyModelETransition — boundaries", () => {
  it("MIN_LEVEL settled is E_SETTLED", () => {
    expect(classifyModelETransition(row(MIN_LEVEL, MIN_LEVEL, 1)).category).toBe(
      "E_SETTLED"
    );
  });

  it("MAX_LEVEL settled is E_SETTLED with zero pending levels", () => {
    const result = classifyModelETransition(row(MAX_LEVEL, MAX_LEVEL, MAX_LEVEL));
    expect(result.category).toBe("E_SETTLED");
    expect(result.pendingLevels).toBe(0);
  });

  it("MAX_LEVEL with total one below is CONVERTIBLE", () => {
    const result = classifyModelETransition(row(MAX_LEVEL, MAX_LEVEL, MAX_LEVEL - 1));
    expect(result.category).toBe("CONVERTIBLE");
    expect(result.patch).toEqual({ level: MAX_LEVEL - 1 });
  });

  it("hitDiceTotal above MAX_LEVEL is INVALID_HIT_DICE before the level comparison", () => {
    const result = classifyModelETransition({
      xp: xpForLevel(MAX_LEVEL),
      level: MAX_LEVEL,
      hitDiceTotal: MAX_LEVEL + 1,
      hitDiceRemaining: MAX_LEVEL,
    });
    expect(result.category).toBe("INVALID_HIT_DICE");
    expect(result.reason).toBe("TOTAL_ABOVE_MAX");
  });

  it("xp one below a threshold yields the lower targetLevel", () => {
    const justBelow = xpForLevel(5) - 1;
    expect(getLevelFromXP(justBelow)).toBe(4);

    const result = classifyModelETransition({
      xp: justBelow,
      level: 4,
      hitDiceTotal: 4,
      hitDiceRemaining: 4,
    });
    expect(result.category).toBe("E_SETTLED");
  });

  it("xp exactly at a threshold yields the higher targetLevel", () => {
    const result = classifyModelETransition({
      xp: xpForLevel(5),
      level: 4,
      hitDiceTotal: 4,
      hitDiceRemaining: 4,
    });
    expect(result.category).toBe("E_PENDING");
    expect(result.targetLevel).toBe(5);
  });

  it("hitDiceRemaining of 0 is in range and does not affect the level decision", () => {
    const result = classifyModelETransition({
      xp: xpForLevel(5),
      level: 5,
      hitDiceTotal: 4,
      hitDiceRemaining: 0,
    });
    expect(result.category).toBe("CONVERTIBLE");
    expect(result.patch).toEqual({ level: 4 });
  });
});

// ---------------------------------------------------------------------------
// Structural protections. These do not test a case — they test that no case
// can ever produce a forbidden shape.
// ---------------------------------------------------------------------------

/** Every (targetLevel, level, hitDiceTotal) triple within the legal ranges. */
function sweep(): Array<{ input: ModelETransitionInput; result: ModelETransitionResult }> {
  const all: Array<{ input: ModelETransitionInput; result: ModelETransitionResult }> = [];
  for (let targetLevel = MIN_LEVEL; targetLevel <= MAX_LEVEL; targetLevel++) {
    for (let level = MIN_LEVEL; level <= MAX_LEVEL; level++) {
      for (let hitDiceTotal = 1; hitDiceTotal <= MAX_LEVEL; hitDiceTotal++) {
        const input: ModelETransitionInput = {
          xp: xpForLevel(targetLevel),
          level,
          hitDiceTotal,
          hitDiceRemaining: hitDiceTotal,
        };
        all.push({ input, result: classifyModelETransition(input) });
      }
    }
  }
  return all;
}

describe("classifyModelETransition — structural protections", () => {
  const corpus = sweep();

  it("the sweep is non-trivial and reaches every category that can occur", () => {
    const categories = new Set(corpus.map((entry) => entry.result.category));
    expect(corpus.length).toBe(MAX_LEVEL * MAX_LEVEL * MAX_LEVEL);
    expect(categories).toEqual(
      new Set([
        "E_SETTLED",
        "E_PENDING",
        "CONVERTIBLE",
        "AMBIGUOUS",
        "INVALID_PROGRESSION",
        "INVALID_HIT_DICE",
      ])
    );
  });

  it("only CONVERTIBLE ever carries a patch", () => {
    for (const { result } of corpus) {
      if (result.category === "CONVERTIBLE") {
        expect(result.patch).toBeDefined();
      } else {
        expect(result.patch).toBeUndefined();
      }
    }
  });

  it("a patch can only contain the key `level`", () => {
    for (const { result } of corpus) {
      if (!result.patch) continue;
      expect(Object.keys(result.patch)).toEqual(["level"]);
      expect(result.patch).not.toHaveProperty("xp");
      expect(result.patch).not.toHaveProperty("hitDiceTotal");
      expect(result.patch).not.toHaveProperty("hitDiceRemaining");
      expect(result.patch).not.toHaveProperty("hp");
      expect(result.patch).not.toHaveProperty("maxHp");
    }
  });

  it("a patch never raises the level and always sets it to hitDiceTotal", () => {
    for (const { input, result } of corpus) {
      if (!result.patch) continue;
      expect(result.patch.level).toBe(input.hitDiceTotal);
      expect(result.patch.level).toBeLessThan(input.level);
      expect(result.patch.level).toBeGreaterThan(1);
    }
  });

  it("t2/l2/tot1 is never CONVERTIBLE", () => {
    const result = classifyModelETransition(row(2, 2, 1));
    expect(result.category).not.toBe("CONVERTIBLE");
    expect(result.patch).toBeUndefined();
  });

  it("hitDiceTotal === 1 with level >= 2 is never CONVERTIBLE", () => {
    for (const { input, result } of corpus) {
      if (input.hitDiceTotal === 1 && input.level >= 2) {
        expect(result.category).not.toBe("CONVERTIBLE");
      }
    }
  });

  it("targetLevel > level with hitDiceTotal < level is never CONVERTIBLE", () => {
    let seen = 0;
    for (const { input, result } of corpus) {
      if (result.targetLevel === null) continue;
      if (result.targetLevel > input.level && input.hitDiceTotal < input.level) {
        seen += 1;
        expect(result.category).toBe("AMBIGUOUS");
        expect(result.patch).toBeUndefined();
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("E_PENDING never carries a patch", () => {
    let seen = 0;
    for (const { input, result } of corpus) {
      if (result.category !== "E_PENDING") continue;
      seen += 1;
      expect(result.patch).toBeUndefined();
      expect(input.hitDiceTotal).toBe(input.level);
      expect(result.pendingLevels).toBeGreaterThan(0);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("targetLevel < level is never repaired", () => {
    let seen = 0;
    for (const { input, result } of corpus) {
      if (result.targetLevel === null || result.targetLevel >= input.level) continue;
      seen += 1;
      expect(result.patch).toBeUndefined();
      expect(["INVALID_PROGRESSION", "INVALID_HIT_DICE"]).toContain(result.category);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("CONVERTIBLE only ever occurs with targetLevel === level and 1 < total < level", () => {
    let seen = 0;
    for (const { input, result } of corpus) {
      if (result.category !== "CONVERTIBLE") continue;
      seen += 1;
      expect(result.targetLevel).toBe(input.level);
      expect(input.hitDiceTotal).toBeGreaterThan(1);
      expect(input.hitDiceTotal).toBeLessThan(input.level);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("the input is never mutated and is echoed back verbatim", () => {
    const input: ModelETransitionInput = {
      xp: xpForLevel(5),
      level: 5,
      hitDiceTotal: 3,
      hitDiceRemaining: 2,
    };
    const snapshot = { ...input };
    const result = classifyModelETransition(input);

    expect(input).toEqual(snapshot);
    expect(result.current).toEqual(snapshot);
  });
});
