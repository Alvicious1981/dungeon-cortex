import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  armorClassFor,
  readArmorProfile,
  selectBodyArmor,
  selectShield,
  type ArmorInventoryRow,
} from "@/lib/rules/armor-class";
import type { EncounterInventoryItemRecord } from "@/lib/rules/encounter-service";
import { slotFor } from "@/lib/rules/equipment-slot";

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
      bonusAC: null,
      stealthDisadvantage: null,
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
      bonusAC: null,
      stealthDisadvantage: null,
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

  it("refuses a row whose base is worse than wearing nothing", () => {
    // An accessory stored as `type: "armor"` with a bonus in `baseAC`. The
    // shield skip cannot catch it, because it declares no category at all.
    const inventory = [equipped({ baseAC: 1, addDexModifier: false })];
    const result = armorClassFor({ inventory, dexModifier: 3 });
    expect(result.armorClass).toBe(13);
    expect(result.armored).toBe(false);
  });

  it("never lets a junk negative dex cap subtract from the base", () => {
    const inventory = [
      equipped({ baseAC: 14, armorClass: "medium", addDexModifier: true, maxDexBonus: -1 }),
    ];
    expect(armorClassFor({ inventory, dexModifier: 4 }).armorClass).toBe(14);
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

describe("the shipped loot corpus cannot lower anyone's armour class", () => {
  // Bound to the real file, not a fixture. `data/loot-tables.json` is the other
  // producer of `type: "armor"` rows — the spec surveyed `data/srd-es/equipment.json`
  // and never looked here. Ten rows are typed "armor" and not one declares a
  // category, so they are gauntlets, boots, cloaks and helms wearing armour's
  // type. A hand-written fixture would repeat the omission somewhere new.
  const lootTables = JSON.parse(readFileSync("data/loot-tables.json", "utf8")) as Record<
    string,
    unknown
  >;

  const armorRows = Object.entries(lootTables).flatMap(([table, rows]) =>
    Array.isArray(rows)
      ? rows
          .filter(
            (row): row is { name: string; type: string; properties?: unknown } =>
              typeof row === "object" && row !== null && (row as { type?: unknown }).type === "armor",
          )
          .map((row) => ({ table, row }))
      : [],
  );

  it("finds the armour rows it means to check", () => {
    // If the file is ever restructured and this sweep silently matches nothing,
    // the assertion below would pass vacuously.
    expect(armorRows.length).toBeGreaterThan(0);
  });

  it.each([1, 3, -1])(
    "keeps every row at or above the unarmoured value at DEX %i",
    (dexModifier) => {
      const unarmored = 10 + dexModifier;
      for (const { table, row } of armorRows) {
        const inventory: ArmorInventoryRow[] = [
          { type: "armor", equippedSlot: "ARMOR", properties: row.properties ?? {} },
        ];
        const result = armorClassFor({ inventory, dexModifier });
        expect(
          result.armorClass,
          `${table} / ${row.name} produced ${result.armorClass}, below the unarmoured ${unarmored}`,
        ).toBeGreaterThanOrEqual(unarmored);
      }
    },
  );

  it("gives the Voidclasp Gauntlet no armour class of its own", () => {
    // baseAC 1 with addDexModifier false: it reached the declared-flag branch
    // ahead of every other guard and resolved to an armour class of 1.
    const voidclasp = armorRows.find(({ row }) => row.name === "Voidclasp Gauntlet");
    expect(voidclasp).toBeDefined();

    const inventory: ArmorInventoryRow[] = [
      { type: "armor", equippedSlot: "ARMOR", properties: voidclasp!.row.properties },
    ];
    const result = armorClassFor({ inventory, dexModifier: 3 });
    expect(result.armorClass).toBe(13);
    expect(result.armored).toBe(false);
    expect(result.category).toBeNull();
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

describe("selectBodyArmor", () => {
  // armorClassFor already proves the selection rule through the AC it returns.
  // These pin the selector directly, because Task 2 asks it a different
  // question — "what is being worn" rather than "what is it worth".
  it("returns the equipped body armour's profile", () => {
    const profile = selectBodyArmor([
      equipped({ baseAC: 16, armorClass: "heavy", addDexModifier: false }),
    ]);
    expect(profile?.category).toBe("heavy");
    expect(profile?.baseAC).toBe(16);
  });

  it("returns null when nothing is equipped", () => {
    expect(selectBodyArmor([])).toBeNull();
  });

  it("returns null for armour that is carried but not equipped", () => {
    expect(
      selectBodyArmor([
        { type: "armor", properties: { baseAC: 16, armorClass: "heavy" } },
      ]),
    ).toBeNull();
  });

  it("never returns a shield", () => {
    expect(selectBodyArmor([equipped({ baseAC: 2, armorClass: "shield" })])).toBeNull();
  });

  it("never returns a bonus row below the unarmoured base", () => {
    // The Voidclasp Gauntlet shape: baseAC 1, a declared dex flag, no category.
    expect(
      selectBodyArmor([equipped({ baseAC: 1, addDexModifier: false })]),
    ).toBeNull();
  });

  it("agrees with armorClassFor about what is worn", () => {
    // The two must never disagree about the selection, because the AC and the
    // proficiency penalty would then be judged against different armour.
    const inventory = [
      equipped({ baseAC: 2, armorClass: "shield" }),
      equipped({ baseAC: 15, armorClass: "medium" }),
    ];
    expect(selectBodyArmor(inventory)?.category).toBe(
      armorClassFor({ inventory, dexModifier: 3 }).category,
    );
  });
});

// ─── additive terms: the shield's base and ac_bonus ──────────────────────────

function inSlot(
  slot: string,
  properties: Record<string, unknown>,
): ArmorInventoryRow {
  return { type: "armor", equippedSlot: slot, properties };
}

const CUIRASS = { baseAC: 14, armorClass: "medium", addDexModifier: true, maxDexBonus: 2 };
const SHIELD = { baseAC: 2, armorClass: "shield", addDexModifier: false, maxDexBonus: null };

describe("readArmorProfile — ac_bonus", () => {
  it("reads the bonus a row declares", () => {
    expect(readArmorProfile({ ac_bonus: 2 }).bonusAC).toBe(2);
  });

  it("reports an absent bonus as null, not zero", () => {
    // "The row does not say" and "the row says nothing is added" are the same
    // arithmetic here, but not the same claim; the rest of this module has held
    // that line since it was written and this field does not get to break it.
    expect(readArmorProfile({}).bonusAC).toBeNull();
    expect(readArmorProfile(null).bonusAC).toBeNull();
  });

  it("refuses a bonus that is not a finite number", () => {
    for (const value of ["2", true, null, [], {}, NaN, Infinity]) {
      expect(readArmorProfile({ ac_bonus: value }).bonusAC).toBeNull();
    }
  });
});

describe("selectShield", () => {
  it("finds a shield equipped in the off hand", () => {
    expect(selectShield([inSlot("OFF_HAND", SHIELD)])?.baseAC).toBe(2);
  });

  it("ignores a shield that is only carried", () => {
    expect(selectShield([{ type: "armor", equippedSlot: null, properties: SHIELD }])).toBeNull();
  });

  it("ignores a shield equipped anywhere but the off hand", () => {
    // Rows persisted before the slot rule shipped can still hold a shield in
    // ARMOR. Those must not start granting the bonus retroactively.
    expect(selectShield([inSlot("ARMOR", SHIELD)])).toBeNull();
  });

  it("never returns body armour", () => {
    expect(selectShield([inSlot("OFF_HAND", CUIRASS)])).toBeNull();
  });
});

describe("armorClassFor — additive terms", () => {
  it("adds an equipped shield's base to the body armour", () => {
    // Breastplate 14, DEX +3 capped at +2, shield 2.
    expect(
      armorClassFor({
        inventory: [inSlot("ARMOR", CUIRASS), inSlot("OFF_HAND", SHIELD)],
        dexModifier: 3,
      }).armorClass,
    ).toBe(18);
  });

  it("adds a shield to an unarmoured character", () => {
    expect(
      armorClassFor({ inventory: [inSlot("OFF_HAND", SHIELD)], dexModifier: 1 }).armorClass,
    ).toBe(13);
  });

  it("sums ac_bonus across every equipped slot", () => {
    // The real loot shapes: a +2 breastplate, a +1 buckler, a +1 helm.
    expect(
      armorClassFor({
        inventory: [
          inSlot("ARMOR", { ...CUIRASS, ac_bonus: 2 }),
          inSlot("OFF_HAND", { ...SHIELD, ac_bonus: 1 }),
          inSlot("ACCESSORY", { ac_bonus: 1 }),
        ],
        dexModifier: 3,
      }).armorClass,
    ).toBe(22);
  });

  it("ignores ac_bonus on a row that is not equipped", () => {
    expect(
      armorClassFor({
        inventory: [
          inSlot("ARMOR", CUIRASS),
          { type: "armor", equippedSlot: null, properties: { ac_bonus: 5 } },
        ],
        dexModifier: 0,
      }).armorClass,
    ).toBe(14);
  });

  it("counts an accessory bonus for an otherwise unarmoured character", () => {
    expect(
      armorClassFor({ inventory: [inSlot("ACCESSORY", { ac_bonus: 1 })], dexModifier: 2 })
        .armorClass,
    ).toBe(13);
  });

  it("still reports armored false when only a bonus applies", () => {
    // The flag means "body armour decided this number", and a helm did not.
    const result = armorClassFor({
      inventory: [inSlot("ACCESSORY", { ac_bonus: 1 })],
      dexModifier: 0,
    });
    expect(result.armored).toBe(false);
    expect(result.category).toBeNull();
  });

  it("is unchanged for a character wearing armour and nothing else", () => {
    expect(
      armorClassFor({ inventory: [inSlot("ARMOR", CUIRASS)], dexModifier: 3 }).armorClass,
    ).toBe(16);
  });
});

describe("a bonus is paid only where the slot rule would have put the row", () => {
  it("pays nothing for a shield persisted into the armour slot", () => {
    // The exact legacy shape: the pre-slot-rule route sent every armour-typed
    // row to ARMOR, so an Ironwood Shield Fragment can be sitting there right
    // now. Both selectors skip it — one for its category, one for its slot —
    // and `armorPenaltyFor` therefore never charges proficiency for it. If the
    // bonus term paid out anyway, the row would raise armour class while being
    // invisible to the rule that is supposed to make it cost something.
    expect(
      armorClassFor({
        inventory: [inSlot("ARMOR", { ...SHIELD, ac_bonus: 1 })],
        dexModifier: 1,
      }).armorClass,
    ).toBe(11);
  });

  it("pays nothing for body armour hung in the off hand", () => {
    expect(
      armorClassFor({
        inventory: [inSlot("OFF_HAND", { ...CUIRASS, ac_bonus: 2 })],
        dexModifier: 1,
      }).armorClass,
    ).toBe(11);
  });

  it("pays nothing for a row in a slot the game does not have", () => {
    // `equippedSlot` is an unconstrained String? in the schema.
    for (const slot of ["BACKPACK", "armor", "main_hand", " "]) {
      expect(
        armorClassFor({ inventory: [inSlot(slot, { ac_bonus: 3 })], dexModifier: 0 })
          .armorClass,
      ).toBe(10);
    }
  });

  it("pays nothing for a row that is not armour at all", () => {
    expect(
      armorClassFor({
        inventory: [
          { type: "misc", equippedSlot: "ACCESSORY", properties: { ac_bonus: 3 } },
          { type: "weapon", equippedSlot: "MAIN_HAND", properties: { ac_bonus: 3 } },
        ],
        dexModifier: 0,
      }).armorClass,
    ).toBe(10);
  });

  it("refuses a fractional bonus, which no armour class can be", () => {
    expect(
      armorClassFor({ inventory: [inSlot("ACCESSORY", { ac_bonus: 1.5 })], dexModifier: 0 })
        .armorClass,
    ).toBe(10);
  });

  it("honours a negative bonus, because a cursed item is a real thing", () => {
    expect(
      armorClassFor({ inventory: [inSlot("ACCESSORY", { ac_bonus: -1 })], dexModifier: 0 })
        .armorClass,
    ).toBe(9);
  });

  it("agrees with slotFor about where every shape belongs", () => {
    // `bonusACFrom` mirrors `slotFor`'s armour branch rather than calling it:
    // `equipment-slot.ts` imports `readArmorProfile` from this module, so the
    // call would close a runtime import cycle. A mirror that nothing pins is a
    // mirror that drifts, so this pins it. The test file can import both.
    const shapes: Array<Record<string, unknown>> = [
      { ...CUIRASS, ac_bonus: 2 },
      { ...SHIELD, ac_bonus: 1 },
      { ac_bonus: 1 },
      { baseAC: 11, armorClass: "light", ac_bonus: 1 },
      { armorClass: "heavy", ac_bonus: 1 },
      { ac_bonus: 1, armorClass: "nonsense" },
    ];

    for (const properties of shapes) {
      const belongs = slotFor({ type: "armor", properties }).slot;

      for (const slot of ["ARMOR", "OFF_HAND", "ACCESSORY", "MAIN_HAND"]) {
        const paid =
          armorClassFor({ inventory: [inSlot(slot, properties)], dexModifier: 0 })
            .armorClass -
          armorClassFor({ inventory: [inSlot(slot, { ...properties, ac_bonus: 0 })], dexModifier: 0 })
            .armorClass;

        // The bonus is paid in exactly the slot the rule would have chosen.
        expect(paid === 0).toBe(slot !== belongs);
      }
    }
  });
});
