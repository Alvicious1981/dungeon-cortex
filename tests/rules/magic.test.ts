import { describe, it, expect } from "vitest";
import {
  isSpellSlots,
  hasAvailableSlot,
  consumeSlot,
  restoreAllSlots,
  spellcastingAbility,
  resolveSpellEffect,
  spellSlotsForLevel,
  breakConcentration,
  beginConcentration,
  SpellSlots,
} from "@/lib/rules/magic";

describe("magic rules", () => {
  describe("isSpellSlots", () => {
    it("returns true for valid SpellSlots object", () => {
      const valid: SpellSlots = {
        "1": { current: 2, max: 4 },
        "2": { current: 1, max: 3 }
      };
      expect(isSpellSlots(valid)).toBe(true);
    });

    it("returns false for invalid structures", () => {
      expect(isSpellSlots(null)).toBe(false);
      expect(isSpellSlots(undefined)).toBe(false);
      expect(isSpellSlots([])).toBe(false);
      expect(isSpellSlots("string")).toBe(false);
      expect(isSpellSlots({ "1": 5 })).toBe(false);
      expect(isSpellSlots({ "1": { current: 2 } })).toBe(false); // missing max
      expect(isSpellSlots({ "cantrip": { current: 2, max: 4 } })).toBe(false); // invalid key
    });
  });

  describe("hasAvailableSlot", () => {
    it("returns true if > 0", () => {
      const slots: SpellSlots = { "1": { current: 1, max: 2 } };
      expect(hasAvailableSlot(slots, 1)).toBe(true);
    });

    it("returns false if 0", () => {
      const slots: SpellSlots = { "1": { current: 0, max: 2 } };
      expect(hasAvailableSlot(slots, 1)).toBe(false);
    });

    it("returns false if level missing", () => {
      const slots: SpellSlots = { "1": { current: 1, max: 2 } };
      expect(hasAvailableSlot(slots, 2)).toBe(false);
    });

    it("returns false for null/undefined", () => {
      expect(hasAvailableSlot(null, 1)).toBe(false);
      expect(hasAvailableSlot(undefined, 1)).toBe(false);
    });
  });

  describe("consumeSlot", () => {
    it("decrements current slot correctly", () => {
      const slots: SpellSlots = { "1": { current: 2, max: 4 } };
      const updated = consumeSlot(slots, 1);
      expect(updated["1"].current).toBe(1);
      expect(updated["1"].max).toBe(4);
      // Ensure immutability
      expect(slots["1"].current).toBe(2);
    });

    it("throws if no entry exists", () => {
      const slots: SpellSlots = { "1": { current: 2, max: 4 } };
      expect(() => consumeSlot(slots, 2)).toThrow();
    });

    it("throws if current is 0", () => {
      const slots: SpellSlots = { "1": { current: 0, max: 4 } };
      expect(() => consumeSlot(slots, 1)).toThrow();
    });
  });

  describe("restoreAllSlots", () => {
    it("resets all current to max", () => {
      const slots: SpellSlots = {
        "1": { current: 0, max: 4 },
        "2": { current: 1, max: 3 }
      };
      const restored = restoreAllSlots(slots);
      expect(restored["1"].current).toBe(4);
      expect(restored["2"].current).toBe(3);
      // Immutability
      expect(slots["1"].current).toBe(0);
    });
  });

  describe("spellcastingAbility", () => {
    it("returns correct ability for classes", () => {
      expect(spellcastingAbility("wizard")).toBe("INT");
      expect(spellcastingAbility("artificer")).toBe("INT");
      expect(spellcastingAbility("cleric")).toBe("WIS");
      expect(spellcastingAbility("druid")).toBe("WIS");
      expect(spellcastingAbility("ranger")).toBe("WIS");
      expect(spellcastingAbility("bard")).toBe("CHA");
      expect(spellcastingAbility("sorcerer")).toBe("CHA");
      expect(spellcastingAbility("warlock")).toBe("CHA");
      expect(spellcastingAbility("paladin")).toBe("CHA");
      expect(spellcastingAbility("unknown")).toBe("CHA"); // default
    });
  });

  describe("resolveSpellEffect", () => {
    it("resolves damage spells", () => {
      const spellData = {
        damage: {
          damage_at_slot_level: { "1": "2d8", "2": "3d8" },
          damage_type: { index: "radiant" }
        },
        dc: {
          dc_type: { index: "dex" },
          dc_success: "mitad"
        }
      };

      const effect = resolveSpellEffect(spellData, 2, 3);
      expect(effect.type).toBe("damage");
      expect(effect.dice).toBe("3d8");
      expect(effect.damageType).toBe("radiant");
      expect(effect.hasSavingThrow).toBe(true);
      expect(effect.saveAbility).toBe("dex");
    });

    it("falls back to lower tier damage if exact slot missing", () => {
      const spellData = {
        damage: {
          damage_at_slot_level: { "2": "3d8" }, // 3rd level uses 2nd level dice as fallback mechanism
          damage_type: { index: "fire" }
        }
      };
      // Slot level 4 but only 2 is provided
      const effect = resolveSpellEffect(spellData, 4, 3);
      expect(effect.dice).toBe("3d8");
    });

    it("resolves healing spells with APT replacement", () => {
      const spellData = {
        heal_at_slot_level: { "1": "1d8 + APT", "2": "2d8+APT" }
      };

      const effectPositive = resolveSpellEffect(spellData, 1, 4);
      expect(effectPositive.type).toBe("healing");
      expect(effectPositive.dice).toBe("1d8+4");

      const effectNegative = resolveSpellEffect(spellData, 2, -1);
      expect(effectNegative.type).toBe("healing");
      expect(effectNegative.dice).toBe("2d8-1");
    });

    it("resolves utility spells when neither damage nor healing", () => {
      const spellData = {
        name: "Mage Armor"
      };

      const effect = resolveSpellEffect(spellData, 1, 3);
      expect(effect.type).toBe("utility");
      expect(effect.dice).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// spellSlotsForLevel — slot matrix tests
// ---------------------------------------------------------------------------

describe("spellSlotsForLevel", () => {
  // --- Full casters ---
  it("wizard level 1 has 2 first-level slots only", () => {
    expect(spellSlotsForLevel("wizard", 1)).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("wizard level 3 has 4/2 slots (1st/2nd)", () => {
    expect(spellSlotsForLevel("wizard", 3)).toEqual([4, 2, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("wizard level 5 has 4/3/2 slots (1st/2nd/3rd)", () => {
    expect(spellSlotsForLevel("wizard", 5)).toEqual([4, 3, 2, 0, 0, 0, 0, 0, 0]);
  });

  it("wizard level 20 has full slot array", () => {
    expect(spellSlotsForLevel("wizard", 20)).toEqual([4, 3, 3, 3, 3, 2, 2, 1, 1]);
  });

  it("cleric uses the same full-caster table as wizard", () => {
    expect(spellSlotsForLevel("cleric", 11)).toEqual(spellSlotsForLevel("wizard", 11));
  });

  it("druid level 9 has 4/3/3/3/1 slots", () => {
    expect(spellSlotsForLevel("druid", 9)).toEqual([4, 3, 3, 3, 1, 0, 0, 0, 0]);
  });

  it("bard level 17 gains 9th-level slot", () => {
    expect(spellSlotsForLevel("bard", 17)[8]).toBe(1);
  });

  it("sorcerer level 18 has 3 fifth-level slots", () => {
    expect(spellSlotsForLevel("sorcerer", 18)[4]).toBe(3);
  });

  // --- Half casters ---
  it("paladin level 1 has no spell slots (half caster starts at level 2)", () => {
    expect(spellSlotsForLevel("paladin", 1)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("paladin level 2 has 2 first-level slots", () => {
    expect(spellSlotsForLevel("paladin", 2)).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("paladin level 5 has 4/2 slots (1st/2nd)", () => {
    expect(spellSlotsForLevel("paladin", 5)).toEqual([4, 2, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("ranger level 17 has 4/3/3/3/1 slots (half caster caps at 5th level)", () => {
    expect(spellSlotsForLevel("ranger", 17)).toEqual([4, 3, 3, 3, 1, 0, 0, 0, 0]);
  });

  it("paladin level 20 has 4/3/3/3/2 (no 6th+ slots)", () => {
    expect(spellSlotsForLevel("paladin", 20)).toEqual([4, 3, 3, 3, 2, 0, 0, 0, 0]);
  });

  // --- Warlock (Pact Magic) ---
  it("warlock level 1 has 1 first-level pact slot", () => {
    expect(spellSlotsForLevel("warlock", 1)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("warlock level 3 has 2 second-level pact slots", () => {
    expect(spellSlotsForLevel("warlock", 3)).toEqual([0, 2, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("warlock level 5 has 2 third-level pact slots", () => {
    expect(spellSlotsForLevel("warlock", 5)).toEqual([0, 0, 2, 0, 0, 0, 0, 0, 0]);
  });

  it("warlock level 11 has 3 fifth-level pact slots", () => {
    expect(spellSlotsForLevel("warlock", 11)).toEqual([0, 0, 0, 0, 3, 0, 0, 0, 0]);
  });

  it("warlock level 20 has 4 fifth-level pact slots", () => {
    expect(spellSlotsForLevel("warlock", 20)).toEqual([0, 0, 0, 0, 4, 0, 0, 0, 0]);
  });

  // --- Non-casters ---
  it("barbarian at any level returns all zeros", () => {
    expect(spellSlotsForLevel("barbarian", 10)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("fighter returns all zeros", () => {
    expect(spellSlotsForLevel("fighter", 5)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("unknown class returns all zeros", () => {
    expect(spellSlotsForLevel("archaeologist", 12)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  // --- Guards ---
  it("throws RangeError for level 0", () => {
    expect(() => spellSlotsForLevel("wizard", 0)).toThrow(RangeError);
  });

  it("throws RangeError for level 21", () => {
    expect(() => spellSlotsForLevel("wizard", 21)).toThrow(RangeError);
  });

  it("returns a new array each call (no shared reference)", () => {
    const a = spellSlotsForLevel("cleric", 5);
    const b = spellSlotsForLevel("cleric", 5);
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// breakConcentration / beginConcentration
// ---------------------------------------------------------------------------

describe("breakConcentration", () => {
  it("clears concentrationSpellId to null", () => {
    const char = { concentrationSpellId: "spell-fireball", hp: 30 };
    const result = breakConcentration(char);
    expect(result.concentrationSpellId).toBeNull();
  });

  it("preserves all other character fields", () => {
    const char = { concentrationSpellId: "spell-fog", hp: 42, name: "Aldric" };
    const result = breakConcentration(char);
    expect(result.hp).toBe(42);
    expect(result.name).toBe("Aldric");
  });

  it("does not mutate the original object", () => {
    const char = { concentrationSpellId: "spell-web" };
    breakConcentration(char);
    expect(char.concentrationSpellId).toBe("spell-web");
  });

  it("is idempotent when concentration is already null", () => {
    const char = { concentrationSpellId: null };
    const result = breakConcentration(char);
    expect(result.concentrationSpellId).toBeNull();
  });
});

describe("beginConcentration", () => {
  it("sets concentrationSpellId to the given spell ID", () => {
    const char = { concentrationSpellId: null };
    const result = beginConcentration(char, "spell-hold-person");
    expect(result.concentrationSpellId).toBe("spell-hold-person");
  });

  it("replaces an existing concentration spell", () => {
    const char = { concentrationSpellId: "spell-fly" };
    const result = beginConcentration(char, "spell-haste");
    expect(result.concentrationSpellId).toBe("spell-haste");
  });

  it("does not mutate the original object", () => {
    const char = { concentrationSpellId: null };
    beginConcentration(char, "spell-bless");
    expect(char.concentrationSpellId).toBeNull();
  });

  it("preserves all other fields", () => {
    const char = { concentrationSpellId: null, hp: 20, level: 5 };
    const result = beginConcentration(char, "spell-bless");
    expect(result.hp).toBe(20);
    expect(result.level).toBe(5);
  });
});
