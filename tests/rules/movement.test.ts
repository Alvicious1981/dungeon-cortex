import { describe, expect, it } from "vitest";
import { getSrdRaceWalkingSpeedFt } from "@/lib/rules/movement";

describe("SRD 2014 walking speed", () => {
  it.each([
    ["human", 30],
    ["Hill Dwarf", 25],
    ["wood_elf", 35],
    ["lightfoot-halfling", 25],
  ])("derives %s speed from the authoritative race", (race, expected) => {
    expect(getSrdRaceWalkingSpeedFt(race)).toBe(expected);
  });

  it("does not invent a universal speed for unknown races", () => {
    expect(getSrdRaceWalkingSpeedFt("custom-lineage")).toBeNull();
  });
});
