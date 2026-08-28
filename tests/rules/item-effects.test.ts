import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  IMPLEMENTED_EFFECTS,
  abilityCheckAdvantageFrom,
  type EffectInventoryRow,
} from "@/lib/rules/item-effects";
import { SKILLS, type Skill } from "@/lib/rules/ability-check";

/**
 * Bound to the real loot file. The `effect` key carries forty distinct strings
 * and no rule read any of them; this module reads two. A hand-written fixture
 * would let the registry drift from the data it exists to interpret, which is
 * the drift that made the key inert in the first place.
 */
const LOOT = JSON.parse(
  readFileSync(join(process.cwd(), "data", "loot-tables.json"), "utf8"),
) as Record<string, Array<Record<string, unknown>>>;

function lootRows(): Array<Record<string, unknown>> {
  return Object.values(LOOT).filter(Array.isArray).flat() as Array<
    Record<string, unknown>
  >;
}

function effectStrings(): string[] {
  return lootRows()
    .map((row) => (row.properties as Record<string, unknown> | undefined)?.effect)
    .filter((value): value is string => typeof value === "string");
}

function rowNamed(name: string): Record<string, unknown> {
  const found = lootRows().find((row) => row.name === name);
  if (!found) throw new Error(`Fixture drift: "${name}" is not in loot-tables.json`);
  return found;
}

function equipped(name: string, slot: string): EffectInventoryRow {
  const row = rowNamed(name);
  return { type: String(row.type), equippedSlot: slot, properties: row.properties };
}

describe("the registry and the data agree", () => {
  it("implements exactly the two effects this increment claims", () => {
    expect([...IMPLEMENTED_EFFECTS].sort()).toEqual([
      "advantage_climb_checks",
      "wisdom_advantage",
    ]);
  });

  it("has no dead entry — every implemented effect exists in the loot file", () => {
    // A typo in the registry would otherwise sit there granting nothing, which
    // is the exact shape of the defect this module was written to close.
    const inData = new Set(effectStrings());
    for (const effect of IMPLEMENTED_EFFECTS) {
      expect(inData.has(effect)).toBe(true);
    }
  });

  it("leaves the rest of the effect strings unimplemented, deliberately", () => {
    // Forty strings, two implemented. The others need systems this codebase
    // does not have — damage resistance, surprise, cover, lighting. This
    // asserts the count so that adding an effect to the data, or to the
    // registry, is a decision somebody makes rather than a number that drifts.
    expect(effectStrings()).toHaveLength(40);
  });
});

describe("abilityCheckAdvantageFrom", () => {
  const GLOVES = "Thornweave Gloves";
  const CROWN = "The Hollow Crown";

  it("gives the gloves advantage on Athletics", () => {
    expect(
      abilityCheckAdvantageFrom({
        inventory: [equipped(GLOVES, "ACCESSORY")],
        skill: "Athletics",
      }),
    ).toBe(true);
  });

  it("gives the gloves nothing on any other skill", () => {
    for (const skill of SKILLS.filter((s) => s !== "Athletics")) {
      expect(
        abilityCheckAdvantageFrom({
          inventory: [equipped(GLOVES, "ACCESSORY")],
          skill,
        }),
      ).toBe(false);
    }
  });

  it("gives the crown advantage on every Wisdom skill and no other", () => {
    // Derived from SKILL_ABILITY rather than listed, so a new skill inherits
    // the right answer instead of being forgotten.
    const wisdomSkills: Skill[] = [
      "Animal Handling",
      "Insight",
      "Medicine",
      "Perception",
      "Survival",
    ];

    for (const skill of SKILLS) {
      expect(
        abilityCheckAdvantageFrom({
          inventory: [equipped(CROWN, "ACCESSORY")],
          skill,
        }),
      ).toBe(wisdomSkills.includes(skill));
    }
  });

  it("grants nothing from an item that is only carried", () => {
    expect(
      abilityCheckAdvantageFrom({
        inventory: [{ ...equipped(GLOVES, "ACCESSORY"), equippedSlot: null }],
        skill: "Athletics",
      }),
    ).toBe(false);
  });

  it("grants nothing from an item in a slot the rule would not choose", () => {
    // The same guarantee the armour-class bonus term makes: a row persisted
    // into the wrong slot by the route that predates `slotFor` does not start
    // granting things retroactively.
    for (const slot of ["ARMOR", "MAIN_HAND", "OFF_HAND", "BACKPACK", ""]) {
      expect(
        abilityCheckAdvantageFrom({
          inventory: [equipped(GLOVES, slot)],
          skill: "Athletics",
        }),
      ).toBe(false);
    }
  });

  it("grants nothing for an effect string outside the registry", () => {
    // Thirty-eight of the forty. An unrecognised effect must be inert, not a
    // guess: this module reads free text written before any engine existed.
    expect(
      abilityCheckAdvantageFrom({
        inventory: [
          {
            type: "misc",
            equippedSlot: "ACCESSORY",
            properties: { effect: "fated_death_determination" },
          },
        ],
        skill: "Perception",
      }),
    ).toBe(false);
  });

  it("never throws on a malformed properties blob", () => {
    for (const properties of [null, undefined, 42, "wisdom_advantage", [], { effect: 7 }]) {
      expect(
        abilityCheckAdvantageFrom({
          inventory: [{ type: "misc", equippedSlot: "ACCESSORY", properties }],
          skill: "Perception",
        }),
      ).toBe(false);
    }
  });

  it("grants advantage when any one equipped row qualifies", () => {
    expect(
      abilityCheckAdvantageFrom({
        inventory: [
          { type: "misc", equippedSlot: null, properties: { effect: "wisdom_advantage" } },
          equipped(CROWN, "ACCESSORY"),
        ],
        skill: "Insight",
      }),
    ).toBe(true);
  });
});
