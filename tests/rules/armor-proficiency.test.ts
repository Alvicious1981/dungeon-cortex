import { describe, expect, it } from "vitest";
import {
  armorPenaltyFor,
  penalisedByArmor,
} from "@/lib/rules/armor-proficiency";
import { SKILL_ABILITY, type Skill } from "@/lib/rules/ability-check";
import { armorClassFor, type ArmorInventoryRow } from "@/lib/rules/armor-class";

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

describe("the penalty as the ability-check gate applies it", () => {
  // The route ORs the penalty into the disadvantage the condition evaluator
  // already produced. These pin the composition rule the route implements,
  // without standing up the route.
  function gateDisadvantage(input: {
    conditionDisadvantage: boolean;
    skill: Skill;
    characterClass: string;
    inventory: ArmorInventoryRow[];
  }): boolean {
    const penalty = armorPenaltyFor({
      inventory: input.inventory,
      characterClass: input.characterClass,
    });
    return (
      input.conditionDisadvantage || (penalty.applies && penalisedByArmor(input.skill))
    );
  }

  it("adds disadvantage to a Stealth check in unproficient armour", () => {
    expect(
      gateDisadvantage({
        conditionDisadvantage: false,
        skill: "Stealth",
        characterClass: "wizard",
        inventory: wearing("heavy"),
      }),
    ).toBe(true);
  });

  it("leaves a Perception check alone in the same armour", () => {
    expect(
      gateDisadvantage({
        conditionDisadvantage: false,
        skill: "Perception",
        characterClass: "wizard",
        inventory: wearing("heavy"),
      }),
    ).toBe(false);
  });

  it("leaves a Stealth check alone when the wearer is proficient", () => {
    expect(
      gateDisadvantage({
        conditionDisadvantage: false,
        skill: "Stealth",
        characterClass: "fighter",
        inventory: wearing("heavy"),
      }),
    ).toBe(false);
  });

  it("does not stack with disadvantage that was already there", () => {
    // One source is the same as three. The boolean is the point.
    expect(
      gateDisadvantage({
        conditionDisadvantage: true,
        skill: "Stealth",
        characterClass: "wizard",
        inventory: wearing("heavy"),
      }),
    ).toBe(true);
  });
});

/**
 * The module's headline constraint, made falsifiable.
 *
 * "Any change to an AC number from this module would be a bug" holds
 * structurally today — `armorClassFor` takes no class and so cannot read
 * proficiency — but nothing asserted it, which means a later refactor could
 * thread the class in and no test would object. This does object.
 */
describe("armour proficiency never changes armour class", () => {
  /**
   * What a call site does: it decides the penalty from the class, and it asks
   * for the armour class from the inventory. The class is deliberately unused
   * in the second call — that is the constraint, stated as code.
   */
  function sheetFor(characterClass: string) {
    const inventory = wearing("heavy");
    return {
      penalised: armorPenaltyFor({ inventory, characterClass }).applies,
      armorClass: armorClassFor({ inventory, dexModifier: 3 }).armorClass,
    };
  }

  it("gives the same number to a proficient and an unproficient wearer", () => {
    const wizard = sheetFor("wizard");
    const fighter = sheetFor("fighter");

    // The two cases really do differ on the penalty, so the AC assertion below
    // is comparing two different characters and not one case against itself.
    expect(wizard.penalised).toBe(true);
    expect(fighter.penalised).toBe(false);

    expect(wizard.armorClass).toBe(fighter.armorClass);
    expect(wizard.armorClass).toBe(16);
  });
});
