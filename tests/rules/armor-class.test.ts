import { describe, expect, it } from "vitest";
import {
  armorClassFor,
  readArmorProfile,
  type ArmorInventoryRow,
} from "@/lib/rules/armor-class";
import type { EncounterInventoryItemRecord } from "@/lib/rules/encounter-service";

function equipped(properties: Record<string, unknown>): ArmorInventoryRow {
  return { type: "armor", equippedSlot: "ARMOR", properties };
}

describe("readArmorProfile", () => {
  it("reads a full armour row, lowercasing the category", () => {
    expect(
      readArmorProfile({
        baseAC: 15,
        armorClass: "Medium",
        addDexModifier: true,
        maxDexBonus: 2,
      }),
    ).toEqual({
      category: "medium",
      baseAC: 15,
      declaredAddsDex: true,
      declaredMaxDexBonus: 2,
    });
  });

  it("reports absent fields as null rather than guessing them", () => {
    // The distinction is the whole point: "the row does not say" is not the
    // same as "the row says no", and the two previous implementations
    // disagreed about exactly this.
    expect(readArmorProfile({ baseAC: 11, armorClass: "light" })).toEqual({
      category: "light",
      baseAC: 11,
      declaredAddsDex: null,
      declaredMaxDexBonus: null,
    });
  });

  it("refuses a category string that is not a category", () => {
    expect(readArmorProfile({ baseAC: 12, armorClass: "padded" }).category).toBeNull();
    expect(readArmorProfile({ baseAC: 12, armorClass: 7 }).category).toBeNull();
  });

  it("degrades to nulls instead of throwing on junk", () => {
    for (const junk of [null, undefined, 42, "text", [], {}]) {
      const read = readArmorProfile(junk);
      expect(read.category).toBeNull();
      expect(read.baseAC).toBeNull();
      expect(read.declaredAddsDex).toBeNull();
    }
  });
});

describe("armorClassFor — the row's own data", () => {
  it("is 10 + DEX with nothing equipped", () => {
    const result = armorClassFor({ inventory: [], dexModifier: 3 });
    expect(result.armorClass).toBe(13);
    expect(result.armored).toBe(false);
    expect(result.category).toBeNull();
  });

  it("adds the full modifier for light armour", () => {
    const inventory = [equipped({ baseAC: 12, armorClass: "light", addDexModifier: true })];
    expect(armorClassFor({ inventory, dexModifier: 4 }).armorClass).toBe(16);
  });

  it("caps the modifier at the row's own maximum", () => {
    const inventory = [
      equipped({ baseAC: 14, armorClass: "medium", addDexModifier: true, maxDexBonus: 2 }),
    ];
    expect(armorClassFor({ inventory, dexModifier: 4 }).armorClass).toBe(16);
    expect(armorClassFor({ inventory, dexModifier: 1 }).armorClass).toBe(15);
  });

  it("adds nothing when the row says it adds nothing", () => {
    const inventory = [equipped({ baseAC: 18, armorClass: "heavy", addDexModifier: false })];
    expect(armorClassFor({ inventory, dexModifier: 4 }).armorClass).toBe(18);
    expect(armorClassFor({ inventory, dexModifier: -1 }).armorClass).toBe(18);
  });

  it("reports which category it used", () => {
    const inventory = [equipped({ baseAC: 18, armorClass: "heavy", addDexModifier: false })];
    const result = armorClassFor({ inventory, dexModifier: 0 });
    expect(result.category).toBe("heavy");
    expect(result.armored).toBe(true);
  });
});

describe("armorClassFor — the category decides when the row does not", () => {
  // This is the divergence itself. One previous implementation added the full
  // modifier here and the other added none; neither consulted the category the
  // type has always declared.
  it("gives light armour the full modifier", () => {
    const inventory = [equipped({ baseAC: 11, armorClass: "light" })];
    expect(armorClassFor({ inventory, dexModifier: 3 }).armorClass).toBe(14);
  });

  it("caps medium armour at +2", () => {
    const inventory = [equipped({ baseAC: 15, armorClass: "medium" })];
    expect(armorClassFor({ inventory, dexModifier: 4 }).armorClass).toBe(17);
    expect(armorClassFor({ inventory, dexModifier: 1 }).armorClass).toBe(16);
  });

  it("gives heavy armour none", () => {
    const inventory = [equipped({ baseAC: 16, armorClass: "heavy" })];
    expect(armorClassFor({ inventory, dexModifier: 4 }).armorClass).toBe(16);
  });

  it("treats a row that says nothing at all as no armour", () => {
    // Neither a category nor a dex flag. Inventing a base from a row that
    // cannot say how it behaves would be the one direction that inflates.
    const inventory = [equipped({ baseAC: 20 })];
    const result = armorClassFor({ inventory, dexModifier: 3 });
    expect(result.armorClass).toBe(13);
    expect(result.armored).toBe(false);
  });
});

describe("armorClassFor — what does not count", () => {
  it("never treats a shield as body armour", () => {
    // The SRD stores a shield as base 2 — an additive bonus, not a total.
    // Selecting it as armour would make this character's AC 5 instead of 13.
    const inventory = [equipped({ baseAC: 2, armorClass: "shield" })];
    const result = armorClassFor({ inventory, dexModifier: 3 });
    expect(result.armorClass).toBe(13);
    expect(result.armored).toBe(false);
  });

  it("ignores armour that is carried but not equipped", () => {
    // The behaviour the removed acFromInventory got wrong: it took the first
    // row typed "armor" with no regard for the slot, so a breastplate in a
    // backpack granted its full armour class.
    const inventory: ArmorInventoryRow[] = [
      { type: "armor", properties: { baseAC: 18, armorClass: "heavy" } },
    ];
    expect(armorClassFor({ inventory, dexModifier: 3 }).armorClass).toBe(13);
  });

  it("ignores armour equipped to another slot", () => {
    const inventory: ArmorInventoryRow[] = [
      { type: "armor", equippedSlot: "OFF_HAND", properties: { baseAC: 18, armorClass: "heavy" } },
    ];
    expect(armorClassFor({ inventory, dexModifier: 3 }).armorClass).toBe(13);
  });

  it("ignores rows that are not armour", () => {
    const inventory: ArmorInventoryRow[] = [
      { type: "weapon", equippedSlot: "ARMOR", properties: { baseAC: 18, armorClass: "heavy" } },
    ];
    expect(armorClassFor({ inventory, dexModifier: 3 }).armorClass).toBe(13);
  });

  it("skips a shield to find the body armour behind it", () => {
    const inventory = [
      equipped({ baseAC: 2, armorClass: "shield" }),
      equipped({ baseAC: 16, armorClass: "heavy" }),
    ];
    expect(armorClassFor({ inventory, dexModifier: 3 }).armorClass).toBe(16);
  });
});

describe("armorClassFor — cases migrated from acFromInventory", () => {
  // These arrived from tests/rules/combat.test.ts. Each fixture gains an
  // equippedSlot and a category: the originals had neither, because the
  // implementation they covered read neither.
  it("calculates unarmored correctly", () => {
    expect(armorClassFor({ inventory: [], dexModifier: 3 }).armorClass).toBe(13);
  });

  it("calculates with full dex bonus (light armor)", () => {
    const inventory = [equipped({ baseAC: 12, armorClass: "light" })];
    expect(armorClassFor({ inventory, dexModifier: 4 }).armorClass).toBe(16);
  });

  it("calculates with capped dex bonus (medium armor)", () => {
    const inventory = [
      equipped({ baseAC: 14, armorClass: "medium", maxDexBonus: 2, addDexModifier: true }),
    ];
    expect(armorClassFor({ inventory, dexModifier: 4 }).armorClass).toBe(16);
    expect(armorClassFor({ inventory, dexModifier: 1 }).armorClass).toBe(15);
  });

  it("calculates with no dex bonus (heavy armor)", () => {
    const inventory = [equipped({ baseAC: 18, armorClass: "heavy", addDexModifier: false })];
    expect(armorClassFor({ inventory, dexModifier: 4 }).armorClass).toBe(18);
    // A negative modifier is not subtracted either: addDexModifier false means
    // exactly zero Dexterity, not "apply it anyway".
    expect(armorClassFor({ inventory, dexModifier: -1 }).armorClass).toBe(18);
  });
});

describe("the encounter service's inventory record reaches the rule intact", () => {
  it("carries equippedSlot through to the rule", () => {
    // EncounterInventoryItemRecord declared only { type, properties }. Because
    // ArmorInventoryRow makes equippedSlot optional, passing that record would
    // type-check and silently compute every player as unarmoured. This test
    // builds the row through the service's OWN record type, so it stops
    // compiling if the field is ever dropped again — a runtime assertion alone
    // could not catch it.
    const row: EncounterInventoryItemRecord = {
      type: "armor",
      equippedSlot: "ARMOR",
      properties: { baseAC: 16, armorClass: "heavy" },
    };
    expect(armorClassFor({ inventory: [row], dexModifier: 3 }).armorClass).toBe(16);
  });
});
