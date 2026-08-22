/**
 * tests/rules/inventory-add-item.test.ts
 *
 * `addItem` used to throw on every call because `getEquipmentInfo` always
 * returned null (the SrdEquipment defect). This branch fixed the lookup, so
 * `addItem` now succeeds and builds mechanical properties from the projected
 * row. It has no callers anywhere in the codebase yet, so this flip changes
 * no roll — but the first caller (PR 2) will exercise a path nobody has ever
 * run. This file pins the shape it produces.
 *
 * The Prisma client itself is not mocked here — only the lookup boundary,
 * `getEquipmentInfo`, is. `addItem` does not know or care where that answer
 * came from.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { addItem, type InventoryItem } from "@/lib/rules/inventory";
import type { EquipmentInfo } from "@/lib/rules/srd-equipment-lookup";

const getEquipmentInfoMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/rules/srd-equipment-lookup", () => ({
  getEquipmentInfo: getEquipmentInfoMock,
}));

function equipmentInfo(overrides: Partial<EquipmentInfo>): EquipmentInfo {
  return {
    name: "Longsword",
    equipmentCategory: "Weapon",
    weaponCategory: null,
    weaponRange: null,
    categoryRange: null,
    costQuantity: null,
    costUnit: null,
    weight: null,
    damageDice: null,
    damageType: null,
    twoHandedDamageDice: null,
    twoHandedDamageType: null,
    rangeNormal: null,
    rangeLong: null,
    armorCategory: null,
    armorClassBase: null,
    armorClassDexBonus: null,
    armorClassMaxBonus: null,
    strMinimum: null,
    stealthDisadvantage: null,
    desc: null,
    properties: [],
    ...overrides,
  };
}

beforeEach(() => {
  getEquipmentInfoMock.mockReset();
});

describe("addItem", () => {
  it("adds a weapon with mechanical properties from the SRD projection", async () => {
    getEquipmentInfoMock.mockResolvedValue(
      equipmentInfo({
        name: "Longsword",
        weaponCategory: "Martial",
        weaponRange: "Melee",
        damageDice: "1d8",
        damageType: "Slashing",
        properties: ["Versatile"],
      }),
    );

    const inventory: InventoryItem[] = [];
    const result = await addItem(inventory, "longsword", 1, "char-1");

    expect(result).toHaveLength(1);
    const item = result[0];
    expect(item.type).toBe("weapon");
    expect(item.name).toBe("Longsword");
    expect(item.indexSlug).toBe("longsword");
    expect(item.quantity).toBe(1);
    expect(item.properties).toEqual({
      damageDice: "1d8",
      damageBonus: 0,
      // The SRD row above carries "Slashing"; the rule layer lowercases it,
      // because DamageType is a lowercase union and normalizeDamageType turns
      // anything it does not recognise into force damage. Asserting the
      // lowercase value is what makes this test prove the conversion rather
      // than pin the raw SRD casing.
      damageType: "slashing",
      rangeNormal: null,
      rangeLong: null,
      // The keys every attack now reads. `addItem` had both values in scope and
      // wrote neither, so a weapon added this way was born needing the SRD
      // fallback that exists only for rows written before the keys did.
      weaponCategory: "Martial",
      weaponRange: "Melee",
      weaponProperties: ["Versatile"],
    });
  });

  it("adds armor with mechanical properties from the SRD projection", async () => {
    getEquipmentInfoMock.mockResolvedValue(
      equipmentInfo({
        name: "Half Plate Armor",
        armorCategory: "Heavy",
        armorClassBase: 15,
        armorClassDexBonus: true,
        armorClassMaxBonus: 2,
        strMinimum: 13,
        stealthDisadvantage: true,
      }),
    );

    const inventory: InventoryItem[] = [];
    const result = await addItem(inventory, "half-plate-armor", 1, "char-1");

    expect(result).toHaveLength(1);
    const item = result[0];
    expect(item.type).toBe("armor");
    expect(item.name).toBe("Half Plate Armor");
    expect(item.properties).toEqual({
      baseAC: 15,
      armorClass: "heavy",
      addDexModifier: true,
      maxDexBonus: 2,
      strengthRequirement: 13,
      stealthDisadvantage: true,
    });
  });

  it("throws when the SRD lookup finds nothing", async () => {
    getEquipmentInfoMock.mockResolvedValue(null);

    await expect(addItem([], "not-a-real-item", 1, "char-1")).rejects.toThrow(
      "Item not-a-real-item not found in SRD.",
    );
  });
});
