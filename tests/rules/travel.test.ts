/**
 * tests/rules/travel.test.ts
 *
 * SRD 2014 overland travel. See
 * docs/superpowers/specs/2026-09-03-wilderness-travel-srd-design.md.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  travelDistanceMiles,
  resolveJourney,
  MILES_PER_DAY_NORMAL,
  TRAVEL_HOURS_PER_DAY,
  MAX_EXHAUSTION,
  MIN_JOURNEY_MILES,
  MAX_JOURNEY_MILES,
} from "@/lib/rules/travel";

/** Forces every d20 to `value`, so saving throws are decided by the test. */
function fixD20(value: number): void {
  vi.spyOn(Math, "random").mockImplementation(() => (value - 1) / 20);
}

describe("travelDistanceMiles", () => {
  afterEach(() => vi.restoreAllMocks());

  /**
   * A journey has no direction. If the seeds were concatenated unsorted, the
   * return leg would be a different distance from the outbound one.
   */
  it("is symmetric: the return leg is the same journey", () => {
    expect(travelDistanceMiles("loc_a", "loc_b")).toBe(
      travelDistanceMiles("loc_b", "loc_a")
    );
  });

  it("is deterministic for the same pair", () => {
    expect(travelDistanceMiles("loc_a", "loc_b")).toBe(
      travelDistanceMiles("loc_a", "loc_b")
    );
  });

  /**
   * The control for symmetry: different pairs must not all collapse to one
   * value, or the symmetry test would pass on a constant.
   */
  it("gives different pairs different distances", () => {
    const distances = new Set([
      travelDistanceMiles("loc_a", "loc_b"),
      travelDistanceMiles("loc_a", "loc_c"),
      travelDistanceMiles("loc_b", "loc_c"),
      travelDistanceMiles("loc_d", "loc_e"),
    ]);
    expect(distances.size).toBeGreaterThan(1);
  });

  it("stays within the declared bounds", () => {
    for (let i = 0; i < 200; i++) {
      const miles = travelDistanceMiles(`seed_${i}`, `other_${i}`);
      expect(miles).toBeGreaterThanOrEqual(MIN_JOURNEY_MILES);
      expect(miles).toBeLessThanOrEqual(MAX_JOURNEY_MILES);
    }
  });
});

describe("resolveJourney — normal travel", () => {
  afterEach(() => vi.restoreAllMocks());

  const normal = (distanceMiles: number) =>
    resolveJourney({
      distanceMiles,
      forceMarch: false,
      conModifier: 0,
      currentExhaustion: 0,
    });

  it("covers a day's march in one day", () => {
    expect(normal(MILES_PER_DAY_NORMAL).days).toBe(1);
  });

  it("takes a second day for one mile more", () => {
    expect(normal(MILES_PER_DAY_NORMAL + 1).days).toBe(2);
  });

  it("never costs exhaustion, however long the road", () => {
    const outcome = normal(48);
    expect(outcome.days).toBe(2);
    expect(outcome.exhaustionGained).toBe(0);
    expect(outcome.forcedHours).toBe(0);
    expect(outcome.saves).toEqual([]);
  });
});

describe("resolveJourney — forced march", () => {
  afterEach(() => vi.restoreAllMocks());

  const forced = (distanceMiles: number, conModifier = 0, currentExhaustion = 0) =>
    resolveJourney({ distanceMiles, forceMarch: true, conModifier, currentExhaustion });

  it("takes one day, whatever the distance", () => {
    fixD20(20);
    expect(forced(48).days).toBe(1);
  });

  /**
   * SRD: nothing is forced until the ninth hour. At the normal pace a day's
   * march is exactly eight hours, so a journey of 24 miles or less has nothing
   * to force even when the player asks for it.
   */
  it("forces nothing at or under a full day's march", () => {
    fixD20(1);
    const outcome = forced(MILES_PER_DAY_NORMAL);
    expect(outcome.hours).toBe(TRAVEL_HOURS_PER_DAY);
    expect(outcome.forcedHours).toBe(0);
    expect(outcome.exhaustionGained).toBe(0);
  });

  /**
   * SRD: "The DC is 10 + 1 for each hour past 8 hours." The ninth hour is the
   * first past eight, so DC 11.
   */
  it("raises the DC by one per hour past the eighth", () => {
    fixD20(20);
    const outcome = forced(36); // 36 / 3 mph = 12 hours → 4 forced
    expect(outcome.hours).toBe(12);
    expect(outcome.forcedHours).toBe(4);
    expect(outcome.saves.map((s) => s.dc)).toEqual([11, 12, 13, 14]);
    expect(outcome.saves.map((s) => s.hour)).toEqual([9, 10, 11, 12]);
  });

  it("gains one exhaustion level per failed save", () => {
    fixD20(1); // a natural 1 fails every DC at +0
    const outcome = forced(36);
    expect(outcome.saves.every((s) => !s.success)).toBe(true);
    expect(outcome.exhaustionGained).toBe(4);
  });

  it("gains nothing when every save succeeds", () => {
    fixD20(20);
    const outcome = forced(36);
    expect(outcome.saves.every((s) => s.success)).toBe(true);
    expect(outcome.exhaustionGained).toBe(0);
  });

  /**
   * SRD exhaustion runs to 6 and stops there. What happens AT 6 is death,
   * which this game does not implement — recorded in §7 of the spec, not
   * silently avoided by capping lower.
   */
  it("never carries the character past exhaustion 6", () => {
    fixD20(1);
    const outcome = forced(48, 0, 4); // 16 h → 8 forced hours, all failed
    expect(outcome.exhaustionGained).toBe(MAX_EXHAUSTION - 4);
  });

  it("gains nothing when the character is already at the maximum", () => {
    fixD20(1);
    expect(forced(48, 0, MAX_EXHAUSTION).exhaustionGained).toBe(0);
  });

  /**
   * The modifier must reach the roll. Without this a rule that ignored
   * `conModifier` would pass every other test here.
   */
  it("applies the Constitution modifier to the save", () => {
    fixD20(10);
    const weak = forced(36, 0);
    const hardy = forced(36, +5);
    expect(weak.saves[0]!.total).toBe(10);
    expect(hardy.saves[0]!.total).toBe(15);
    expect(weak.saves[0]!.success).toBe(false); // 10 vs DC 11
    expect(hardy.saves[0]!.success).toBe(true); // 15 vs DC 11
  });
});
