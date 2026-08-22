import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rules/srd-equipment-lookup");

import { resolveWeaponProfile } from "@/lib/rules/weapon-profile-service";
import { getEquipmentInfo } from "@/lib/rules/srd-equipment-lookup";

/** The shape PR 1's projector returns, with SRD casing preserved. */
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

describe("resolveWeaponProfile", () => {
  it("uses what the row declares, without touching the database", async () => {
    const resolved = await resolveWeaponProfile({
      name: "Longsword",
      properties: {
        weaponCategory: "Martial",
        weaponRange: "Melee",
        weaponProperties: ["Versatile"],
        damageDice: "1d8",
        damageType: "Slashing",
      },
    });

    expect(resolved.category).toBe("martial");
    expect(resolved.traits).toEqual(["versatile"]);
    expect(getEquipmentInfo).not.toHaveBeenCalled();
  });

  it("resolves a legacy row by exact name against the SRD", async () => {
    // The live save's weapon: hand-written with damage fields only.
    getEquipmentInfo.mockResolvedValue(SRD_LONGSWORD);

    const resolved = await resolveWeaponProfile({
      name: "Longsword",
      properties: { damageDice: "1d8", damageBonus: 0, damageType: "slashing" },
    });

    expect(getEquipmentInfo).toHaveBeenCalledWith("Longsword");
    expect(resolved.category).toBe("martial");
    expect(resolved.isRanged).toBe(false);
    expect(resolved.traits).toEqual(["versatile"]);
  });

  it("keeps the row's own category even when the SRD disagrees", async () => {
    // Precedence: the SRD is the fallback, never an arbiter overwriting what
    // was persisted. A magic or modified weapon depends on this.
    getEquipmentInfo.mockResolvedValue({ ...SRD_LONGSWORD, weaponCategory: "Simple" });

    const resolved = await resolveWeaponProfile({
      name: "Longsword",
      properties: { weaponCategory: "Martial" },
    });

    expect(resolved.category).toBe("martial");
    expect(getEquipmentInfo).not.toHaveBeenCalled();
  });

  it("falls to a null category when the SRD has no such weapon", async () => {
    getEquipmentInfo.mockResolvedValue(null);

    const resolved = await resolveWeaponProfile({
      name: "Rusty Shiv",
      properties: { damageDice: "1d4" },
    });

    expect(resolved.category).toBeNull();
    expect(resolved.damageDice).toBe("1d4");
  });

  it("keeps the row's own damage when the SRD supplies a category", async () => {
    // Only the missing half is filled in. A +1 longsword's persisted dice must
    // not be replaced by the mundane SRD entry's.
    getEquipmentInfo.mockResolvedValue(SRD_LONGSWORD);

    const resolved = await resolveWeaponProfile({
      name: "Longsword",
      properties: { damageDice: "2d6", damageType: "Radiant" },
    });

    expect(resolved.category).toBe("martial");
    expect(resolved.damageDice).toBe("2d6");
    expect(resolved.damageType).toBe("Radiant");
  });

  it("returns a null category instead of throwing when the lookup fails", async () => {
    // A database blip must not turn an attack into a 500. Degrade to
    // "no category", which withholds proficiency rather than inflating it.
    getEquipmentInfo.mockRejectedValue(new Error("connection lost"));

    const resolved = await resolveWeaponProfile({
      name: "Longsword",
      properties: { damageDice: "1d8" },
    });

    expect(resolved.category).toBeNull();
    expect(resolved.damageDice).toBe("1d8");
  });
});
