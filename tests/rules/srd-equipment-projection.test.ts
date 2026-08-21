import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { projectSrdItem } from "@/lib/rules/srd-equipment-projection";

/**
 * The projector is tested against the real file the seeder reads, not against
 * hand-written objects. Five test files mock `srdEquipment` and hand back
 * fabricated rows; that is how an empty table stayed invisible to 2995 tests.
 * A fixture written by hand would repeat the mistake in a new place.
 */
const RAW = JSON.parse(
  readFileSync(join(process.cwd(), "data", "srd-es", "equipment.json"), "utf8"),
) as Array<Record<string, unknown>>;

function entry(name: string): Record<string, unknown> {
  const found = RAW.find((item) => item.name === name);
  if (!found) throw new Error(`Fixture drift: "${name}" is not in equipment.json`);
  return found;
}

describe("projectSrdItem", () => {
  it("projects a martial melee weapon in full", () => {
    expect(projectSrdItem("Longsword", entry("Longsword"))).toEqual({
      name: "Longsword",
      equipmentCategory: "Weapon",
      weaponCategory: "Martial",
      weaponRange: "Melee",
      categoryRange: "Martial Melee",
      costQuantity: 15,
      costUnit: "gp",
      weight: 3,
      damageDice: "1d8",
      damageType: "Slashing",
      twoHandedDamageDice: "1d10",
      twoHandedDamageType: "Slashing",
      rangeNormal: 5,
      rangeLong: null,
      armorCategory: null,
      armorClassBase: null,
      armorClassDexBonus: null,
      armorClassMaxBonus: null,
      strMinimum: null,
      stealthDisadvantage: null,
      desc: null,
      properties: ["Versatile"],
    });
  });

  it("projects the one weapon that has no damage object", () => {
    const net = projectSrdItem("Net", entry("Net"));
    expect(net.damageDice).toBeNull();
    expect(net.damageType).toBeNull();
    expect(net.weaponCategory).toBe("Martial");
    expect(net.weaponRange).toBe("Ranged");
    expect(net.rangeNormal).toBe(5);
    expect(net.rangeLong).toBe(15);
    expect(net.properties).toEqual(["Thrown", "Special"]);
  });

  it("projects armour", () => {
    const armour = projectSrdItem("Half Plate Armor", entry("Half Plate Armor"));
    expect(armour.equipmentCategory).toBe("Armor");
    expect(armour.armorCategory).toBe("Medium");
    expect(armour.armorClassBase).toBe(15);
    expect(armour.armorClassDexBonus).toBe(true);
    expect(armour.armorClassMaxBonus).toBe(2);
    expect(armour.strMinimum).toBe(0);
    expect(armour.stealthDisadvantage).toBe(true);
    expect(armour.weaponCategory).toBeNull();
    expect(armour.properties).toEqual([]);
  });

  it("preserves SRD casing rather than normalising it", () => {
    // Lowercasing here would change what the narrator's equipment tool returns.
    // Normalisation belongs to the rule layer in PR 2.
    expect(projectSrdItem("Longsword", entry("Longsword")).weaponCategory).toBe("Martial");
    expect(projectSrdItem("Rapier", entry("Rapier")).properties).toContain("Finesse");
  });

  it("degrades to nulls instead of throwing on an unexpected shape", () => {
    for (const bad of [null, undefined, 42, "text", [], {}]) {
      const projected = projectSrdItem("Fireball", bad);
      expect(projected.name).toBe("Fireball");
      expect(projected.weaponCategory).toBeNull();
      expect(projected.damageDice).toBeNull();
      expect(projected.properties).toEqual([]);
    }
  });

  // ─── Whole-file sweep ──────────────────────────────────────────────────────
  // A named case proves that one row projects. Only the sweep can say the other
  // 236 do. Absence is proved by construction here, never by sampling.
  describe("across every row in equipment.json", () => {
    it("projects all 237 rows without throwing", () => {
      expect(RAW.length).toBe(237);
      for (const item of RAW) {
        expect(() => projectSrdItem(String(item.name), item)).not.toThrow();
      }
    });

    it("resolves a category for every weapon and only for weapons", () => {
      const weapons = RAW.filter((item) => item.weapon_category !== undefined);
      expect(weapons.length).toBe(37);

      for (const item of RAW) {
        const projected = projectSrdItem(String(item.name), item);
        if (item.weapon_category === undefined) {
          expect(projected.weaponCategory).toBeNull();
        } else {
          expect(["Simple", "Martial"]).toContain(projected.weaponCategory);
        }
      }
    });

    it("finds exactly one weapon with no damage dice, and it is the Net", () => {
      const undamaged = RAW
        .filter((item) => item.weapon_category !== undefined)
        .map((item) => projectSrdItem(String(item.name), item))
        .filter((projected) => projected.damageDice === null);

      expect(undamaged.map((projected) => projected.name)).toEqual(["Net"]);
    });
  });
});
