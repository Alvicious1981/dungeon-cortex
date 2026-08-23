import { describe, expect, it } from "vitest";
import {
  armorPenaltyFor,
  penalisedByArmor,
} from "@/lib/rules/armor-proficiency";
import { SKILL_ABILITY, type Skill } from "@/lib/rules/ability-check";
import type { ArmorInventoryRow } from "@/lib/rules/armor-class";

function wearing(category: string, baseAC = 16): ArmorInventoryRow[] {
  return [
    {
      type: "armor",
      equippedSlot: "ARMOR",
      properties: { baseAC, armorClass: category, addDexModifier: false },
    },
  ];
}

describe("armorPenaltyFor", () => {
  it("penalises a wizard in chain mail", () => {
    // A wizard has no armour proficiency at all.
    const penalty = armorPenaltyFor({ inventory: wearing("heavy"), characterClass: "wizard" });
    expect(penalty.applies).toBe(true);
    expect(penalty.category).toBe("heavy");
  });

  it("does not penalise a fighter in the same armour", () => {
    const penalty = armorPenaltyFor({ inventory: wearing("heavy"), characterClass: "fighter" });
    expect(penalty.applies).toBe(false);
    expect(penalty.category).toBe("heavy");
  });

  it("penalises a barbarian in heavy armour", () => {
    // The live character is a barbarian, and barbarians have light, medium and
    // shield — not heavy. This is the case a real save can reach.
    expect(
      armorPenaltyFor({ inventory: wearing("heavy"), characterClass: "barbarian" }).applies,
    ).toBe(true);
  });

  it("does not penalise that barbarian in medium armour", () => {
    expect(
      armorPenaltyFor({ inventory: wearing("medium", 15), characterClass: "barbarian" }).applies,
    ).toBe(false);
  });

  it("normalises a free-text class the way the column stores it", () => {
    expect(
      armorPenaltyFor({ inventory: wearing("heavy"), characterClass: "  Fighter " }).applies,
    ).toBe(false);
  });

  it("penalises a class outside the twelve", () => {
    // Fail closed. An unrecognised class is proficient with nothing, so it takes
    // the penalty — the opposite sign from the weapon rule's fail-closed, and
    // the same principle: never favour the character on unusable data.
    expect(
      armorPenaltyFor({ inventory: wearing("light", 11), characterClass: "artificer" }).applies,
    ).toBe(true);
  });

  it("does not penalise a character wearing nothing", () => {
    const penalty = armorPenaltyFor({ inventory: [], characterClass: "wizard" });
    expect(penalty.applies).toBe(false);
    expect(penalty.category).toBeNull();
  });

  it("does not penalise a character carrying but not wearing armour", () => {
    const penalty = armorPenaltyFor({
      inventory: [{ type: "armor", properties: { baseAC: 16, armorClass: "heavy" } }],
      characterClass: "wizard",
    });
    expect(penalty.applies).toBe(false);
  });

  it("does not penalise a shield, which is not body armour here", () => {
    const penalty = armorPenaltyFor({
      inventory: wearing("shield", 2),
      characterClass: "wizard",
    });
    expect(penalty.applies).toBe(false);
    expect(penalty.category).toBeNull();
  });

  it("does not penalise armour whose category cannot be resolved", () => {
    // No category means no question to ask isArmorProficient. Penalising on a
    // guess would be the one direction that harms the character on bad data.
    const penalty = armorPenaltyFor({
      inventory: [
        {
          type: "armor",
          equippedSlot: "ARMOR",
          properties: { baseAC: 14, addDexModifier: true },
        },
      ],
      characterClass: "wizard",
    });
    expect(penalty.applies).toBe(false);
    expect(penalty.category).toBeNull();
  });

  it("degrades instead of throwing on junk", () => {
    for (const junk of [null, undefined, 42, "text", []]) {
      const penalty = armorPenaltyFor({
        inventory: [{ type: "armor", equippedSlot: "ARMOR", properties: junk }],
        characterClass: "wizard",
      });
      expect(penalty.applies).toBe(false);
    }
  });
});

describe("penalisedByArmor", () => {
  it("covers exactly the four Strength and Dexterity skills", () => {
    // Pinned as a set rather than case by case: if a skill is ever added to
    // SKILL_ABILITY, this fails and someone decides deliberately.
    const penalised = (Object.keys(SKILL_ABILITY) as Skill[]).filter(penalisedByArmor);
    expect(penalised.sort()).toEqual(
      ["Acrobatics", "Athletics", "Sleight of Hand", "Stealth"].sort(),
    );
  });

  it("does not penalise a Wisdom check made in the same armour", () => {
    expect(penalisedByArmor("Perception")).toBe(false);
    expect(penalisedByArmor("Insight")).toBe(false);
  });

  it("penalises Athletics and Stealth", () => {
    expect(penalisedByArmor("Athletics")).toBe(true);
    expect(penalisedByArmor("Stealth")).toBe(true);
  });
});
