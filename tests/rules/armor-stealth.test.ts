import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stealthDisadvantageFor } from "@/lib/rules/armor-stealth";

/**
 * `stealthDisadvantage` was written by two producers and read by no rule.
 * `projectSrdItem` carries it off the SRD's `stealth_disadvantage`, seven
 * armours declare it, `addItemToInventory` persists it onto the row, and the
 * only consumer was a narration projection — so the heaviest plate in the game
 * rolled Stealth exactly like a rogue in nothing.
 *
 * The loot assertion reads the real file: it fails if the flag is ever dropped
 * from the data, which is the only way this rule goes dormant again.
 */
const LOOT = JSON.parse(
  readFileSync(join(process.cwd(), "data", "loot-tables.json"), "utf8"),
) as Record<string, Array<Record<string, unknown>>>;

function lootRow(name: string): Record<string, unknown> {
  const found = Object.values(LOOT)
    .filter(Array.isArray)
    .flat()
    .find((item) => (item as Record<string, unknown>).name === name) as
    | Record<string, unknown>
    | undefined;
  if (!found) throw new Error(`Fixture drift: "${name}" is not in loot-tables.json`);
  return found;
}

/** Chain Mail as `addItemToInventory` writes it. */
const CHAIN_MAIL = {
  type: "armor",
  equippedSlot: "ARMOR",
  properties: {
    baseAC: 16,
    armorClass: "heavy",
    addDexModifier: false,
    maxDexBonus: null,
    strengthRequirement: 13,
    stealthDisadvantage: true,
  },
};

/** Leather: the same shape, declaring the flag false. */
const LEATHER = {
  type: "armor",
  equippedSlot: "ARMOR",
  properties: {
    baseAC: 11,
    armorClass: "light",
    addDexModifier: true,
    maxDexBonus: null,
    stealthDisadvantage: false,
  },
};

describe("stealthDisadvantageFor", () => {
  it("penalises a Stealth check made in armour that declares the flag", () => {
    expect(stealthDisadvantageFor({ inventory: [CHAIN_MAIL], skill: "Stealth" })).toBe(true);
  });

  it("leaves every other skill alone", () => {
    for (const skill of ["Athletics", "Acrobatics", "Perception", "Investigation"] as const) {
      expect(stealthDisadvantageFor({ inventory: [CHAIN_MAIL], skill })).toBe(false);
    }
  });

  it("ignores the armour while it is in the pack", () => {
    expect(
      stealthDisadvantageFor({
        inventory: [{ ...CHAIN_MAIL, equippedSlot: null }],
        skill: "Stealth",
      }),
    ).toBe(false);
  });

  it("does not penalise armour that declares the flag false", () => {
    expect(stealthDisadvantageFor({ inventory: [LEATHER], skill: "Stealth" })).toBe(false);
  });

  it("does not penalise a row that says nothing about stealth", () => {
    const silent = { ...LEATHER, properties: { baseAC: 11, armorClass: "light", addDexModifier: true } };
    expect(stealthDisadvantageFor({ inventory: [silent], skill: "Stealth" })).toBe(false);
  });

  it("penalises nothing when the character is unarmoured", () => {
    expect(stealthDisadvantageFor({ inventory: [], skill: "Stealth" })).toBe(false);
  });

  it("reads the flag off the real Tomb Warden's Cuirass row", () => {
    const cuirass = lootRow("Tomb Warden's Cuirass");
    expect(
      stealthDisadvantageFor({
        inventory: [{ type: String(cuirass.type), equippedSlot: "ARMOR", properties: cuirass.properties }],
        skill: "Stealth",
      }),
    ).toBe(true);
  });
});
