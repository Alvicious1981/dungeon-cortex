import { beforeEach, describe, expect, it, vi } from "vitest";

const getEquipmentInfo = vi.hoisted(() => vi.fn());

vi.mock("@/lib/rules/srd-equipment-lookup", () => ({ getEquipmentInfo }));

import { resolveWeaponAttack, unresolvedCategoryLog } from "@/lib/rules/weapon-attack";

const STATS = { STR: 16, DEX: 14, CON: 12, INT: 10, WIS: 10, CHA: 8 }; // +3 / +2

const HYDRATED_LONGSWORD = {
  name: "Longsword",
  properties: {
    damageDice: "1d8",
    damageBonus: 0,
    damageType: "Slashing",
    weaponCategory: "Martial",
    weaponRange: "Melee",
    weaponProperties: ["Versatile"],
  },
};

const HYDRATED_LONGBOW = {
  name: "Longbow",
  properties: {
    damageDice: "1d8",
    damageBonus: 0,
    damageType: "Piercing",
    weaponCategory: "Martial",
    weaponRange: "Ranged",
    weaponProperties: [],
  },
};

beforeEach(() => {
  getEquipmentInfo.mockReset();
  getEquipmentInfo.mockResolvedValue(null);
});

describe("resolveWeaponAttack", () => {
  it("resolves a melee weapon against a proficient class", async () => {
    const attack = await resolveWeaponAttack({
      weapon: HYDRATED_LONGSWORD,
      stats: STATS,
      characterClass: "barbarian",
      level: 1,
      fallbackDamageType: "slashing",
    });

    expect(attack.attackModifier).toBe(5); // +3 STR, +2 proficiency
    expect(attack.flatDamageBonus).toBe(3); // +3 STR, +0 weapon
    expect(attack.abilityUsed).toBe("STR");
    expect(attack.weaponDice).toBe("1d8");
    expect(attack.damageType).toBe("Slashing");
  });

  it("makes damage follow the attack's ability for a ranged weapon", async () => {
    // The rule that would contradict itself if only the attack moved to DEX.
    const attack = await resolveWeaponAttack({
      weapon: HYDRATED_LONGBOW,
      stats: STATS,
      characterClass: "ranger",
      level: 1,
      fallbackDamageType: "slashing",
    });

    expect(attack.abilityUsed).toBe("DEX");
    expect(attack.attackModifier).toBe(4); // +2 DEX, +2 proficiency
    expect(attack.flatDamageBonus).toBe(2); // +2 DEX, not +3 STR
  });

  it("withholds proficiency from a class that lacks the category", async () => {
    const attack = await resolveWeaponAttack({
      weapon: HYDRATED_LONGSWORD,
      stats: STATS,
      characterClass: "wizard",
      level: 1,
      fallbackDamageType: "slashing",
    });

    expect(attack.proficiencyApplied).toBe(false);
    expect(attack.attackModifier).toBe(3);
    expect(attack.flatDamageBonus).toBe(3); // damage keeps the ability modifier
  });

  it("adds the weapon's own damage bonus on top of the ability", async () => {
    const attack = await resolveWeaponAttack({
      weapon: {
        name: "Longsword +1",
        properties: { ...HYDRATED_LONGSWORD.properties, damageBonus: 1 },
      },
      stats: STATS,
      characterClass: "barbarian",
      level: 1,
      fallbackDamageType: "slashing",
    });

    expect(attack.flatDamageBonus).toBe(4); // +3 STR, +1 weapon
  });

  it("treats a missing weapon as a proficient unarmed strike", async () => {
    // Site 1 permits this. SRD 2014 grants proficiency with unarmed strikes,
    // so the bonus must not silently drop by the proficiency bonus.
    const attack = await resolveWeaponAttack({
      weapon: null,
      stats: STATS,
      characterClass: "wizard",
      level: 1,
      fallbackDamageType: "bludgeoning",
    });

    expect(attack.weaponDice).toBe("1d4");
    expect(attack.damageType).toBe("bludgeoning");
    expect(attack.proficiencyApplied).toBe(true);
    expect(attack.attackModifier).toBe(5);
  });

  it("resolves a legacy row's category from the SRD", async () => {
    getEquipmentInfo.mockResolvedValue({
      name: "Longsword",
      weaponCategory: "Martial",
      weaponRange: "Melee",
      damageDice: "1d8",
      damageType: "Slashing",
      properties: ["Versatile"],
    });

    const attack = await resolveWeaponAttack({
      weapon: {
        name: "Longsword",
        properties: { damageDice: "1d8", damageBonus: 0, damageType: "slashing" },
      },
      stats: STATS,
      characterClass: "wizard",
      level: 1,
      fallbackDamageType: "slashing",
    });

    expect(attack.categoryResolved).toBe(true);
    expect(attack.proficiencyApplied).toBe(false); // resolved, and still not proficient
  });

  it("reports an unresolved category so the gap can be declared", async () => {
    getEquipmentInfo.mockResolvedValue(null);

    const attack = await resolveWeaponAttack({
      weapon: { name: "Rusty Shiv", properties: { damageDice: "1d4" } },
      stats: STATS,
      characterClass: "fighter",
      level: 1,
      fallbackDamageType: "slashing",
    });

    expect(attack.categoryResolved).toBe(false);
    expect(attack.proficiencyApplied).toBe(false);
  });

  it("uses the caller's damage-type fallback when the weapon declares none", async () => {
    // The two attack sites default differently — "bludgeoning" and "slashing" —
    // and both defaults are pre-existing behaviour worth keeping.
    const attack = await resolveWeaponAttack({
      weapon: { name: "Odd Thing", properties: { damageDice: "1d6" } },
      stats: STATS,
      characterClass: "fighter",
      level: 1,
      fallbackDamageType: "bludgeoning",
    });

    expect(attack.damageType).toBe("bludgeoning");
  });
});

describe("unresolvedCategoryLog", () => {
  const RESOLVED = {
    attackModifier: 5,
    flatDamageBonus: 3,
    weaponDice: "1d8",
    damageType: "Slashing",
    abilityUsed: "STR" as const,
    proficiencyApplied: true,
    categoryResolved: true,
    qualities: [],
  };

  it("says nothing when the category resolved", () => {
    expect(
      unresolvedCategoryLog({ weaponName: "Longsword", attack: RESOLVED }),
    ).toBeNull();
  });

  it("declares the gap when the category could not be resolved", () => {
    // A rule that did not apply and left no trace is how a gap survives
    // unnoticed. The previous increment declares an unenforceable spell range
    // the same way rather than implying it held.
    const line = unresolvedCategoryLog({
      weaponName: "Rusty Shiv",
      attack: { ...RESOLVED, categoryResolved: false, proficiencyApplied: false },
    });

    expect(line).toContain("Rusty Shiv");
    expect(line).toContain("proficiency");
  });

  it("says nothing for an unarmed strike, which has no category to resolve", () => {
    // Unarmed is proficient by SRD rule and has no weapon. A line on every
    // punch would be noise rather than signal.
    expect(
      unresolvedCategoryLog({
        weaponName: "Unarmed",
        attack: { ...RESOLVED, categoryResolved: false, proficiencyApplied: true },
      }),
    ).toBeNull();
  });
});

describe("resolveWeaponAttack — qualities", () => {
  const CHARACTER = {
    stats: STATS,
    characterClass: "fighter",
    level: 3,
    fallbackDamageType: "bludgeoning",
  };

  it("carries the quality declared on the weapon row", async () => {
    const attack = await resolveWeaponAttack({
      weapon: { name: "Silvered Longsword", properties: { qualities: ["silvered"] } },
      ...CHARACTER,
    });

    expect(attack.qualities).toEqual(["silvered"]);
  });

  it("derives magical from the weapon's damage bonus", async () => {
    const attack = await resolveWeaponAttack({
      weapon: { name: "Blade of Bitter Resolve", properties: { damageBonus: 1 } },
      ...CHARACTER,
    });

    expect(attack.qualities).toEqual(["magical"]);
  });

  it("gives an unarmed strike no qualities", async () => {
    const attack = await resolveWeaponAttack({ weapon: null, ...CHARACTER });

    expect(attack.qualities).toEqual([]);
  });
});
