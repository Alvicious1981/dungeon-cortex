import { describe, expect, it } from "vitest";
import { ABILITIES } from "@/lib/rules/ability-check";
import type { CharacterClass } from "@/lib/rules/proficiency";
import {
  CLASS_SAVING_THROW_PROFICIENCIES,
  isProficientInSave,
} from "@/lib/rules/saving-throw-proficiency";

const CLASSES: CharacterClass[] = [
  "barbarian", "bard", "cleric", "druid", "fighter", "monk",
  "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard",
];

describe("CLASS_SAVING_THROW_PROFICIENCIES (SRD 2014, fixed per class)", () => {
  it("covers every class with exactly two distinct, real abilities", () => {
    for (const cls of CLASSES) {
      const saves = CLASS_SAVING_THROW_PROFICIENCIES[cls];
      expect(saves).toHaveLength(2);
      expect(new Set(saves).size).toBe(2);
      for (const ability of saves) expect(ABILITIES).toContain(ability);
    }
  });

  it.each([
    ["fighter", "STR", true], ["fighter", "CON", true], ["fighter", "WIS", false],
    ["wizard", "INT", true], ["wizard", "WIS", true], ["wizard", "STR", false],
    ["rogue", "DEX", true], ["rogue", "INT", true], ["rogue", "CHA", false],
  ] as const)("%s is proficient in %s: %s", (cls, ability, expected) => {
    expect(isProficientInSave(cls, ability)).toBe(expected);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(isProficientInSave("  Fighter ", "STR")).toBe(true);
  });

  it("never grants an unearned bonus for an unknown class", () => {
    expect(isProficientInSave("necromancer", "INT")).toBe(false);
    expect(isProficientInSave("", "STR")).toBe(false);
  });
});
