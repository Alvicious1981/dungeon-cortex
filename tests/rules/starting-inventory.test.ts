import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildStartingInventory } from "@/lib/rules/starting-inventory";

const getEquipmentInfo = vi.hoisted(() => vi.fn());

vi.mock("@/lib/rules/srd-equipment-lookup", () => ({ getEquipmentInfo }));

const SRD_LONGSWORD = {
  name: "Longsword",
  weaponCategory: "Martial",
  weaponRange: "Melee",
  damageDice: "1d8",
  damageType: "Slashing",
  properties: ["Versatile"],
};

beforeEach(() => {
  getEquipmentInfo.mockReset();
  getEquipmentInfo.mockResolvedValue(null);
});

describe("buildStartingInventory", () => {
  it("hydrates the longsword's category and traits from the SRD", async () => {
    getEquipmentInfo.mockResolvedValue(SRD_LONGSWORD);

    const [weapon] = await buildStartingInventory();

    expect(weapon.name).toBe("Longsword");
    expect(weapon.type).toBe("weapon");
    expect(weapon.properties).toEqual({
      damageDice: "1d8",
      damageBonus: 0,
      // Lowercased at the rule boundary: `DamageType` is a lowercase-only
      // union, and an unrecognised type is silently normalised to force damage.
      damageType: "slashing",
      weaponCategory: "Martial",
      weaponRange: "Melee",
      weaponProperties: ["Versatile"],
    });
  });

  it("does not write indexSlug, because nothing reads it", async () => {
    getEquipmentInfo.mockResolvedValue(SRD_LONGSWORD);

    const [weapon] = await buildStartingInventory();

    expect(weapon).not.toHaveProperty("indexSlug");
  });

  it("falls back to the literal when the SRD cache is empty", async () => {
    // A fresh development database has no SrdItem rows. Creating a character
    // must not depend on the cache being seeded.
    getEquipmentInfo.mockResolvedValue(null);

    const [weapon] = await buildStartingInventory();

    expect(weapon.properties).toEqual({
      damageDice: "1d8",
      damageBonus: 0,
      damageType: "slashing",
    });
  });

  it("falls back to the literal when the lookup throws, and says so", async () => {
    // The fallback must leave a trace. This path decides whether the character
    // has proficiency with its starting weapon for the rest of its life.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getEquipmentInfo.mockRejectedValue(new Error("connection lost"));

    const [weapon] = await buildStartingInventory();

    expect(weapon.properties).toEqual({
      damageDice: "1d8",
      damageBonus: 0,
      damageType: "slashing",
    });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("leaves the health potion alone — it is not in the SRD cache", async () => {
    getEquipmentInfo.mockResolvedValue(SRD_LONGSWORD);

    const inventory = await buildStartingInventory();
    const potion = inventory.find((item) => item.name === "Health Potion");

    expect(potion).toEqual({
      name: "Health Potion",
      type: "consumable",
      quantity: 2,
      properties: { healingDice: "2d4", healingBonus: 2 },
    });
    expect(getEquipmentInfo).toHaveBeenCalledTimes(1);
  });
});
