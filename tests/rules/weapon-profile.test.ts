import { describe, expect, it } from "vitest";
import {
  readWeaponProfile,
  weaponAttackBonus,
  type WeaponProfile,
} from "@/lib/rules/weapon-profile";

const STATS = { STR: 16, DEX: 14, CON: 12, INT: 10, WIS: 10, CHA: 8 }; // +3 / +2

function profile(overrides: Partial<WeaponProfile> = {}): WeaponProfile {
  return {
    category: "martial",
    isRanged: false,
    traits: [],
    damageDice: "1d8",
    damageType: "Slashing",
    ...overrides,
  };
}

describe("readWeaponProfile", () => {
  it("reads a hydrated weapon row, lowercasing category and traits", () => {
    expect(
      readWeaponProfile({
        weaponCategory: "Martial",
        weaponRange: "Melee",
        weaponProperties: ["Versatile"],
        damageDice: "1d8",
        damageType: "Slashing",
      }),
    ).toEqual({
      category: "martial",
      isRanged: false,
      traits: ["versatile"],
      damageDice: "1d8",
      damageType: "Slashing",
    });
  });

  it("marks a ranged weapon from its SRD weaponRange", () => {
    expect(readWeaponProfile({ weaponRange: "Ranged" }).isRanged).toBe(true);
  });

  it("yields a null category for a legacy row that declares none", () => {
    // The live save's longsword: hand-written at character creation with only
    // damage fields. Task 2 resolves its category from the SRD by name.
    const legacy = readWeaponProfile({
      damageDice: "1d8",
      damageBonus: 0,
      damageType: "slashing",
    });
    expect(legacy.category).toBeNull();
    expect(legacy.traits).toEqual([]);
    expect(legacy.damageDice).toBe("1d8");
  });

  it("refuses a category string that is not a category", () => {
    expect(readWeaponProfile({ weaponCategory: "Exotic" }).category).toBeNull();
    expect(readWeaponProfile({ weaponCategory: 7 }).category).toBeNull();
  });

  it("degrades to an empty profile instead of throwing on junk", () => {
    for (const junk of [null, undefined, 42, "text", [], {}]) {
      const read = readWeaponProfile(junk);
      expect(read.category).toBeNull();
      expect(read.isRanged).toBe(false);
      expect(read.traits).toEqual([]);
      expect(read.damageDice).toBeNull();
    }
  });
});

describe("weaponAttackBonus — which ability", () => {
  it("uses STR for a plain melee weapon", () => {
    const result = weaponAttackBonus({
      profile: profile(),
      stats: STATS,
      characterClass: "fighter",
      level: 1,
    });
    expect(result.abilityUsed).toBe("STR");
    expect(result.bonus).toBe(5); // +3 STR, +2 proficiency
  });

  it("uses DEX for a ranged weapon", () => {
    const result = weaponAttackBonus({
      profile: profile({ isRanged: true }),
      stats: STATS,
      characterClass: "fighter",
      level: 1,
    });
    expect(result.abilityUsed).toBe("DEX");
    expect(result.bonus).toBe(4); // +2 DEX, +2 proficiency
  });

  it("lets finesse take the greater of STR and DEX", () => {
    const strong = weaponAttackBonus({
      profile: profile({ traits: ["finesse"] }),
      stats: STATS,
      characterClass: "fighter",
      level: 1,
    });
    expect(strong.abilityUsed).toBe("STR"); // STR 16 beats DEX 14

    const nimble = weaponAttackBonus({
      profile: profile({ traits: ["finesse"] }),
      stats: { ...STATS, STR: 8, DEX: 18 },
      characterClass: "fighter",
      level: 1,
    });
    expect(nimble.abilityUsed).toBe("DEX");
  });

  it("checks finesse before ranged, so a Dart still offers the choice", () => {
    // Dart is the only SRD weapon that is both Ranged and Finesse. Testing
    // ranged first would force DEX on a strong character who may legally
    // choose STR. This is the check-order trap, named.
    const dart = weaponAttackBonus({
      profile: profile({ isRanged: true, traits: ["finesse", "thrown"] }),
      stats: STATS,
      characterClass: "fighter",
      level: 1,
    });
    expect(dart.abilityUsed).toBe("STR");
  });
});

describe("weaponAttackBonus — proficiency", () => {
  it("applies proficiency when the class has the category", () => {
    const result = weaponAttackBonus({
      profile: profile({ category: "martial" }),
      stats: STATS,
      characterClass: "barbarian",
      level: 1,
    });
    expect(result.proficiencyApplied).toBe(true);
    expect(result.categoryResolved).toBe(true);
    expect(result.bonus).toBe(5);
  });

  it("withholds proficiency when the class lacks the category", () => {
    // The defect this whole increment exists to close: a wizard swinging a
    // longsword used to roll with a proficiency they do not have.
    const result = weaponAttackBonus({
      profile: profile({ category: "martial" }),
      stats: STATS,
      characterClass: "wizard",
      level: 1,
    });
    expect(result.proficiencyApplied).toBe(false);
    expect(result.bonus).toBe(3); // +3 STR only
  });

  it("normalises a free-text class the way the database stores it", () => {
    const result = weaponAttackBonus({
      profile: profile({ category: "martial" }),
      stats: STATS,
      characterClass: "  Barbarian ",
      level: 1,
    });
    expect(result.proficiencyApplied).toBe(true);
  });

  it("withholds proficiency for a class outside the twelve", () => {
    const result = weaponAttackBonus({
      profile: profile({ category: "martial" }),
      stats: STATS,
      characterClass: "artificer",
      level: 1,
    });
    expect(result.proficiencyApplied).toBe(false);
    expect(result.bonus).toBe(3);
  });

  it("withholds proficiency when the category could not be resolved", () => {
    const result = weaponAttackBonus({
      profile: profile({ category: null }),
      stats: STATS,
      characterClass: "barbarian",
      level: 1,
    });
    expect(result.categoryResolved).toBe(false);
    expect(result.proficiencyApplied).toBe(false);
    expect(result.bonus).toBe(3);
  });

  it("grants proficiency for an unarmed strike, which has no weapon at all", () => {
    // SRD 2014: you are proficient with your unarmed strikes. A null profile
    // means "no weapon", which is NOT the same as a weapon whose category is
    // unknown — the test above. Conflating them would silently drop every
    // unarmed attack by the proficiency bonus.
    const result = weaponAttackBonus({
      profile: null,
      stats: STATS,
      characterClass: "wizard",
      level: 1,
    });
    expect(result.abilityUsed).toBe("STR");
    expect(result.proficiencyApplied).toBe(true);
    expect(result.categoryResolved).toBe(false);
    expect(result.bonus).toBe(5);
  });
});

describe("weaponAttackBonus — level and degenerate input", () => {
  it.each([
    [1, 5],
    [4, 5],
    [5, 6],
    [9, 7],
    [13, 8],
    [20, 9],
  ])("scales the proficiency bonus at level %i to a total of +%i", (level, expected) => {
    expect(
      weaponAttackBonus({
        profile: profile(),
        stats: STATS,
        characterClass: "fighter",
        level,
      }).bonus,
    ).toBe(expected);
  });

  it.each([0, 21, NaN, undefined as unknown as number])(
    "clamps an unusable level (%s) to level 1 rather than throwing",
    (level) => {
      // proficiencyBonus() throws a RangeError outside 1-20, and this input
      // comes straight from a persisted column. Degrade conservatively.
      expect(
        weaponAttackBonus({
          profile: profile(),
          stats: STATS,
          characterClass: "fighter",
          level,
        }).bonus,
      ).toBe(5);
    },
  );

  it("treats a missing ability score as 10", () => {
    const result = weaponAttackBonus({
      profile: profile(),
      stats: {},
      characterClass: "fighter",
      level: 1,
    });
    expect(result.bonus).toBe(2); // +0 ability, +2 proficiency
  });
});
