import { describe, it, expect } from "vitest";
import {
  proficiencyBonus,
  isWeaponProficient,
  isArmorProficient,
} from "@/lib/rules/proficiency";

// ─── proficiencyBonus ────────────────────────────────────────────────────────

describe("proficiencyBonus", () => {
  // 5e SRD table: +2 at 1-4, +3 at 5-8, +4 at 9-12, +5 at 13-16, +6 at 17-20
  const TABLE: [level: number, bonus: number][] = [
    [1,  2],
    [4,  2],
    [5,  3],
    [8,  3],
    [9,  4],
    [12, 4],
    [13, 5],
    [16, 5],
    [17, 6],
    [20, 6],
  ];

  for (const [level, bonus] of TABLE) {
    it(`level ${level} → +${bonus}`, () => {
      expect(proficiencyBonus(level)).toBe(bonus);
    });
  }

  it("throws RangeError for level 0", () => {
    expect(() => proficiencyBonus(0)).toThrow(RangeError);
  });

  it("throws RangeError for negative level", () => {
    expect(() => proficiencyBonus(-1)).toThrow(RangeError);
  });

  it("throws RangeError for level above 20", () => {
    expect(() => proficiencyBonus(21)).toThrow(RangeError);
  });
});

// ─── isWeaponProficient ───────────────────────────────────────────────────────

describe("isWeaponProficient", () => {
  // Classes with simple + martial
  it("fighter is proficient with simple weapons", () => {
    expect(isWeaponProficient("fighter", "simple")).toBe(true);
  });

  it("fighter is proficient with martial weapons", () => {
    expect(isWeaponProficient("fighter", "martial")).toBe(true);
  });

  it("barbarian is proficient with martial weapons", () => {
    expect(isWeaponProficient("barbarian", "martial")).toBe(true);
  });

  it("paladin is proficient with martial weapons", () => {
    expect(isWeaponProficient("paladin", "martial")).toBe(true);
  });

  it("ranger is proficient with martial weapons", () => {
    expect(isWeaponProficient("ranger", "martial")).toBe(true);
  });

  // Classes with simple only
  it("cleric is proficient with simple weapons", () => {
    expect(isWeaponProficient("cleric", "simple")).toBe(true);
  });

  it("cleric is NOT proficient with martial weapons", () => {
    expect(isWeaponProficient("cleric", "martial")).toBe(false);
  });

  it("rogue is proficient with simple weapons", () => {
    expect(isWeaponProficient("rogue", "simple")).toBe(true);
  });

  it("rogue is NOT proficient with martial weapons", () => {
    expect(isWeaponProficient("rogue", "martial")).toBe(false);
  });

  it("warlock is proficient with simple weapons", () => {
    expect(isWeaponProficient("warlock", "simple")).toBe(true);
  });

  // Classes with no category proficiency
  it("wizard is NOT proficient with simple weapons", () => {
    expect(isWeaponProficient("wizard", "simple")).toBe(false);
  });

  it("wizard is NOT proficient with martial weapons", () => {
    expect(isWeaponProficient("wizard", "martial")).toBe(false);
  });

  it("sorcerer is NOT proficient with simple weapons", () => {
    expect(isWeaponProficient("sorcerer", "simple")).toBe(false);
  });

  it("sorcerer is NOT proficient with martial weapons", () => {
    expect(isWeaponProficient("sorcerer", "martial")).toBe(false);
  });
});

// ─── isArmorProficient ────────────────────────────────────────────────────────

describe("isArmorProficient", () => {
  // Full armor access
  it("fighter is proficient with light armor", () => {
    expect(isArmorProficient("fighter", "light")).toBe(true);
  });

  it("fighter is proficient with medium armor", () => {
    expect(isArmorProficient("fighter", "medium")).toBe(true);
  });

  it("fighter is proficient with heavy armor", () => {
    expect(isArmorProficient("fighter", "heavy")).toBe(true);
  });

  it("fighter is proficient with shields", () => {
    expect(isArmorProficient("fighter", "shield")).toBe(true);
  });

  it("paladin is proficient with all armor categories and shields", () => {
    expect(isArmorProficient("paladin", "light")).toBe(true);
    expect(isArmorProficient("paladin", "medium")).toBe(true);
    expect(isArmorProficient("paladin", "heavy")).toBe(true);
    expect(isArmorProficient("paladin", "shield")).toBe(true);
  });

  // Medium + light but NOT heavy
  it("barbarian is proficient with light armor", () => {
    expect(isArmorProficient("barbarian", "light")).toBe(true);
  });

  it("barbarian is proficient with medium armor", () => {
    expect(isArmorProficient("barbarian", "medium")).toBe(true);
  });

  it("barbarian is NOT proficient with heavy armor", () => {
    expect(isArmorProficient("barbarian", "heavy")).toBe(false);
  });

  it("barbarian is proficient with shields", () => {
    expect(isArmorProficient("barbarian", "shield")).toBe(true);
  });

  it("ranger is proficient with light and medium but NOT heavy armor", () => {
    expect(isArmorProficient("ranger", "light")).toBe(true);
    expect(isArmorProficient("ranger", "medium")).toBe(true);
    expect(isArmorProficient("ranger", "heavy")).toBe(false);
  });

  // Light only
  it("rogue is proficient with light armor only", () => {
    expect(isArmorProficient("rogue", "light")).toBe(true);
    expect(isArmorProficient("rogue", "medium")).toBe(false);
    expect(isArmorProficient("rogue", "heavy")).toBe(false);
    expect(isArmorProficient("rogue", "shield")).toBe(false);
  });

  it("bard is proficient with light armor only", () => {
    expect(isArmorProficient("bard", "light")).toBe(true);
    expect(isArmorProficient("bard", "medium")).toBe(false);
    expect(isArmorProficient("bard", "heavy")).toBe(false);
  });

  // No armor
  it("wizard is NOT proficient with any armor", () => {
    expect(isArmorProficient("wizard", "light")).toBe(false);
    expect(isArmorProficient("wizard", "medium")).toBe(false);
    expect(isArmorProficient("wizard", "heavy")).toBe(false);
    expect(isArmorProficient("wizard", "shield")).toBe(false);
  });

  it("monk is NOT proficient with any armor", () => {
    expect(isArmorProficient("monk", "light")).toBe(false);
    expect(isArmorProficient("monk", "medium")).toBe(false);
    expect(isArmorProficient("monk", "heavy")).toBe(false);
    expect(isArmorProficient("monk", "shield")).toBe(false);
  });

  it("sorcerer is NOT proficient with any armor", () => {
    expect(isArmorProficient("sorcerer", "light")).toBe(false);
    expect(isArmorProficient("sorcerer", "medium")).toBe(false);
    expect(isArmorProficient("sorcerer", "heavy")).toBe(false);
  });
});
