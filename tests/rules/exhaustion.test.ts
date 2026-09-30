/**
 * tests/rules/exhaustion.test.ts
 *
 * The SRD 2014 exhaustion table, level by level. Each effect is asserted at
 * the level it begins and at the level below, so moving any threshold by one
 * fails a test.
 */
import { describe, expect, it } from "vitest";
import {
  describeExhaustion,
  effectiveMaxHp,
  exhaustedSpeedFt,
  exhaustionEffects,
  normalizeExhaustionLevel,
} from "@/lib/rules/exhaustion";

describe("exhaustionEffects", () => {
  it("has no effect at level 0", () => {
    expect(exhaustionEffects(0)).toEqual({
      level: 0,
      abilityCheckDisadvantage: false,
      speedMultiplier: 1,
      attackDisadvantage: false,
      savingThrowDisadvantage: false,
      hitPointMaximumHalved: false,
      dead: false,
    });
  });

  it("level 1: disadvantage on ability checks, nothing else", () => {
    expect(exhaustionEffects(1)).toMatchObject({
      abilityCheckDisadvantage: true,
      speedMultiplier: 1,
      attackDisadvantage: false,
    });
  });

  it("level 2: speed halved", () => {
    expect(exhaustionEffects(1).speedMultiplier).toBe(1);
    expect(exhaustionEffects(2).speedMultiplier).toBe(0.5);
  });

  it("level 3: disadvantage on attack rolls and saving throws", () => {
    expect(exhaustionEffects(2)).toMatchObject({ attackDisadvantage: false, savingThrowDisadvantage: false });
    expect(exhaustionEffects(3)).toMatchObject({ attackDisadvantage: true, savingThrowDisadvantage: true });
  });

  it("level 4: hit point maximum halved", () => {
    expect(exhaustionEffects(3).hitPointMaximumHalved).toBe(false);
    expect(exhaustionEffects(4).hitPointMaximumHalved).toBe(true);
  });

  it("level 5: speed reduced to 0", () => {
    expect(exhaustionEffects(4).speedMultiplier).toBe(0.5);
    expect(exhaustionEffects(5).speedMultiplier).toBe(0);
  });

  it("level 6: death", () => {
    expect(exhaustionEffects(5).dead).toBe(false);
    expect(exhaustionEffects(6).dead).toBe(true);
  });

  it("is cumulative: level 6 carries every lower effect", () => {
    expect(exhaustionEffects(6)).toEqual({
      level: 6,
      abilityCheckDisadvantage: true,
      speedMultiplier: 0,
      attackDisadvantage: true,
      savingThrowDisadvantage: true,
      hitPointMaximumHalved: true,
      dead: true,
    });
  });
});

describe("normalizeExhaustionLevel", () => {
  it.each([
    [null, 0],
    [undefined, 0],
    [Number.NaN, 0],
    [-2, 0],
    [2.7, 2],
    [9, 6],
  ])("reads %s as %s", (input, expected) => {
    expect(normalizeExhaustionLevel(input as number | null | undefined)).toBe(expected);
  });
});

describe("exhaustedSpeedFt", () => {
  it("keeps the base speed below level 2", () => {
    expect(exhaustedSpeedFt(30, 1)).toBe(30);
  });

  it("halves speed at level 2, rounding down to a whole square", () => {
    expect(exhaustedSpeedFt(30, 2)).toBe(15);
    expect(exhaustedSpeedFt(25, 2)).toBe(10);
  });

  it("is 0 at level 5", () => {
    expect(exhaustedSpeedFt(30, 5)).toBe(0);
  });
});

describe("effectiveMaxHp", () => {
  it("is the stored maximum below level 4", () => {
    expect(effectiveMaxHp(21, 3)).toBe(21);
  });

  it("halves the maximum at level 4, rounding down", () => {
    expect(effectiveMaxHp(21, 4)).toBe(10);
  });

  it("never falls below 1", () => {
    expect(effectiveMaxHp(1, 4)).toBe(1);
  });
});

describe("describeExhaustion", () => {
  it("says nothing at level 0", () => {
    expect(describeExhaustion(0)).toBeNull();
  });

  it("names every effect in force, and only those", () => {
    expect(describeExhaustion(3)).toBe(
      "Level 3 — ability checks are at disadvantage; speed is halved; " +
        "attack rolls and saving throws are at disadvantage."
    );
    expect(describeExhaustion(5)).toBe(
      "Level 5 — ability checks are at disadvantage; speed is 0; " +
        "attack rolls and saving throws are at disadvantage; hit point maximum is halved."
    );
  });

  it("reports death at level 6", () => {
    expect(describeExhaustion(6)).toBe("Level 6 — the character has died of exhaustion.");
  });
});
