import { describe, expect, it } from "vitest";
import { buildSheetViewModel } from "@/lib/character-sheet/view-model";
import { armorClassFor, type ArmorInventoryRow } from "@/lib/rules/armor-class";
import type { EncounterInventoryItemRecord } from "@/lib/rules/encounter-service";

/**
 * The armour class the sheet shows must equal the one combat resolves.
 *
 * They were computed in two places that disagreed twice over: which armour
 * counted, and what an absent addDexModifier meant. One decided what the player
 * was attacked against and the other decided what the player was shown.
 *
 * What this file is and is not. Since the unification, buildSheetViewModel does
 * nothing but call armorClassFor, so the equality rows below compare that
 * function to itself and cannot fail for any input. That is deliberate, not
 * coverage: the rows exist to fail the day someone re-inlines an armour-class
 * calculation into the view-model, which is exactly how the divergence arose the
 * first time. They prove no number is correct.
 *
 * The numbers are carried by the pinned-direction tests at the bottom of this
 * file and by tests/rules/armor-class.test.ts. Do not read a green run here as
 * evidence that the arithmetic is right.
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

  it("pins the direction on the service end for a category-only row", () => {
    // The other end needs a number of its own, and the category fallback is the
    // path only the flag-declaring fixture covered. This builds the row through
    // the encounter service's own record type and calls armorClassFor exactly as
    // spawnEncounter does: medium armour, no declared flag, DEX +4 → 15 + 2.
    const row: EncounterInventoryItemRecord = {
      type: "armor",
      equippedSlot: "ARMOR",
      properties: { baseAC: 15, armorClass: "medium" },
    };
    const result = armorClassFor({ inventory: [row], dexModifier: 4 });
    expect(result.armorClass).toBe(17);
    expect(result.category).toBe("medium");
    expect(result.armored).toBe(true);
  });
});
