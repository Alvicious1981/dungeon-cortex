import { describe, expect, it } from "vitest";
import { buildSheetViewModel } from "@/lib/character-sheet/view-model";
import { armorClassFor, type ArmorInventoryRow } from "@/lib/rules/armor-class";

/**
 * The armour class the sheet shows must equal the one combat resolves.
 *
 * They were computed in two places that disagreed twice over: which armour
 * counted, and what an absent addDexModifier meant. One decided what the player
 * was attacked against and the other decided what the player was shown.
 */

function sheetAC(stats: Record<string, number>, properties: Record<string, unknown>): number {
  const sheet = buildSheetViewModel({
    character: {
      id: "c1",
      name: "Test",
      race: "human",
      class: "fighter",
      level: 1,
      hp: 10,
      maxHp: 10,
      xp: 0,
      stats,
    },
    inventory: [
      { id: "a1", name: "Armour", type: "armor", quantity: 1, equippedSlot: "ARMOR", properties },
    ],
  });
  return sheet.core.armorClass;
}

function backendAC(stats: Record<string, number>, properties: Record<string, unknown>): number {
  const inventory: ArmorInventoryRow[] = [
    { type: "armor", equippedSlot: "ARMOR", properties },
  ];
  return armorClassFor({
    inventory,
    dexModifier: Math.floor((stats.DEX - 10) / 2),
  }).armorClass;
}

const DEXTEROUS = { STR: 10, DEX: 18, CON: 10, INT: 10, WIS: 10, CHA: 10 }; // +4

describe("the sheet's armour class equals the backend's", () => {
  it.each([
    ["light armour stating its dex flag", { baseAC: 11, armorClass: "light", addDexModifier: true }],
    ["medium armour with its own cap", { baseAC: 15, armorClass: "medium", addDexModifier: true, maxDexBonus: 2 }],
    ["heavy armour refusing dex", { baseAC: 18, armorClass: "heavy", addDexModifier: false }],
    ["light armour that does not state the flag", { baseAC: 11, armorClass: "light" }],
    ["medium armour that does not state the flag", { baseAC: 15, armorClass: "medium" }],
    ["heavy armour that does not state the flag", { baseAC: 18, armorClass: "heavy" }],
    ["a shield in the armour slot", { baseAC: 2, armorClass: "shield" }],
    ["a row stating nothing but a base", { baseAC: 20 }],
  ])("agrees for %s", (_label, properties) => {
    expect(sheetAC(DEXTEROUS, properties)).toBe(backendAC(DEXTEROUS, properties));
  });

  it("pins the direction for armour that does not state its dex flag", () => {
    // Equality alone would pass if both ends regressed together. Medium armour
    // with no flag must be 15 + 2, not 15 + 4 (the old combat answer) and not
    // 15 (the old sheet answer).
    expect(sheetAC(DEXTEROUS, { baseAC: 15, armorClass: "medium" })).toBe(17);
  });

  it("pins the direction for a shield", () => {
    // 10 + 4 unarmoured, never 2 + 4.
    expect(sheetAC(DEXTEROUS, { baseAC: 2, armorClass: "shield" })).toBe(14);
  });
});
