import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { slotAccepts, slotFor } from "@/lib/rules/equipment-slot";
import { EQUIPMENT_SLOTS } from "@/lib/rules/inventory";

/**
 * Bound to the real loot file, not to hand-written objects. Four test files
 * once mocked `srdEquipment` and handed back fabricated rows; that is how an
 * empty table stayed invisible to 2995 tests. A fixture written by hand would
 * repeat the mistake in a new place.
 */
const LOOT = JSON.parse(
  readFileSync(join(process.cwd(), "data", "loot-tables.json"), "utf8"),
) as Record<string, Array<Record<string, unknown>>>;

function lootRows(): Array<Record<string, unknown>> {
  return Object.values(LOOT)
    .filter(Array.isArray)
    .flat() as Array<Record<string, unknown>>;
}

describe("slotFor", () => {
  it("sends a weapon to the main hand", () => {
    expect(slotFor({ type: "weapon", properties: { damageDice: "1d8" } })).toEqual({
      slot: "MAIN_HAND",
    });
  });

  it("sends each body-armour category to the armour slot", () => {
    for (const category of ["light", "medium", "heavy"] as const) {
      expect(
        slotFor({ type: "armor", properties: { baseAC: 14, armorClass: category } }),
      ).toEqual({ slot: "ARMOR" });
    }
  });

  it("sends a shield to the off hand", () => {
    expect(
      slotFor({ type: "armor", properties: { baseAC: 2, armorClass: "shield" } }),
    ).toEqual({ slot: "OFF_HAND" });
  });

  it("sends an armour-typed row with no category to the accessory slot", () => {
    expect(slotFor({ type: "armor", properties: { ac_bonus: 1 } })).toEqual({
      slot: "ACCESSORY",
    });
  });

  it("sends every other type to the accessory slot", () => {
    for (const type of ["consumable", "spell", "misc", "", "ARMOR"]) {
      expect(slotFor({ type, properties: {} }).slot).toBe("ACCESSORY");
    }
  });

  it("never throws on a malformed properties blob", () => {
    for (const properties of [null, undefined, 42, "heavy", [], { armorClass: 7 }]) {
      expect(slotFor({ type: "armor", properties }).slot).toBe("ACCESSORY");
    }
  });
});

describe("slotAccepts", () => {
  it("accepts exactly the slot the rule would choose", () => {
    const item = { type: "armor", properties: { baseAC: 14, armorClass: "medium" } };
    expect(slotAccepts(item, "ARMOR")).toBe(true);
    for (const slot of EQUIPMENT_SLOTS.filter((s) => s !== "ARMOR")) {
      expect(slotAccepts(item, slot)).toBe(false);
    }
  });

  it("rejects a slot that is not a slot at all", () => {
    expect(slotAccepts({ type: "weapon", properties: {} }, "HEAD")).toBe(false);
    expect(slotAccepts({ type: "weapon", properties: {} }, "")).toBe(false);
    expect(slotAccepts({ type: "weapon", properties: {} }, "main_hand")).toBe(false);
  });

  it("agrees with slotFor for every real loot row", () => {
    for (const row of lootRows()) {
      const item = { type: String(row.type), properties: row.properties };
      expect(slotAccepts(item, slotFor(item).slot)).toBe(true);
    }
  });
});

describe("the real loot file", () => {
  it("has ten armour-typed rows", () => {
    expect(lootRows().filter((row) => row.type === "armor")).toHaveLength(10);
  });

  it("routes exactly the two authored armour rows out of ACCESSORY", () => {
    const armour = lootRows().filter((row) => row.type === "armor");
    const byName = (slot: string) =>
      armour
        .filter(
          (row) => slotFor({ type: "armor", properties: row.properties }).slot === slot,
        )
        .map((row) => row.name)
        .sort();

    expect(byName("ARMOR")).toEqual(["Tomb Warden's Cuirass"]);
    expect(byName("OFF_HAND")).toEqual(["Ironwood Shield Fragment"]);
    expect(byName("ACCESSORY")).toHaveLength(8);
  });
});
