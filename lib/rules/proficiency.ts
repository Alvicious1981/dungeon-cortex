/**
 * lib/rules/proficiency.ts
 *
 * Deterministic proficiency lookups per D&D 5e 2014 SRD.
 * All functions are pure — no I/O, no side effects.
 *
 * "Code is Law": callers must use these functions to gate proficiency
 * bonuses and equipment legality; the AI narrator must never invent
 * or override these results.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type CharacterClass =
  | "barbarian"
  | "bard"
  | "cleric"
  | "druid"
  | "fighter"
  | "monk"
  | "paladin"
  | "ranger"
  | "rogue"
  | "sorcerer"
  | "warlock"
  | "wizard";

/** Broad weapon categories used for proficiency gating. */
export type WeaponCategory = "simple" | "martial";

/** Armor categories used for proficiency gating. */
export type ArmorCategory = "light" | "medium" | "heavy" | "shield";

// ─── Proficiency bonus ────────────────────────────────────────────────────────

/**
 * Returns the proficiency bonus for a given character level (1–20).
 *
 * 5e SRD table:
 *   Levels  1– 4  → +2
 *   Levels  5– 8  → +3
 *   Levels  9–12  → +4
 *   Levels 13–16  → +5
 *   Levels 17–20  → +6
 *
 * Derivation: Math.ceil(level / 4) + 1
 *
 * @throws {RangeError} if level is outside [1, 20].
 */
export function proficiencyBonus(level: number): number {
  if (level < 1 || level > 20) {
    throw new RangeError(
      `Character level must be between 1 and 20 (got ${level}).`,
    );
  }
  return Math.ceil(level / 4) + 1;
}

// ─── Proficiency tables ───────────────────────────────────────────────────────

/**
 * Weapon category proficiencies per 5e SRD class description.
 *
 * Notes on design choices:
 * - Wizard / Sorcerer receive no category proficiency (they have specific
 *   individual weapons — daggers, darts, etc. — handled elsewhere).
 * - Druid receives "simple" at the category level; individual metal-weapon
 *   restrictions are an equipment-equip concern, not a category-proficiency concern.
 * - Monk receives "simple" (quarterstaff, shortsword are covered here).
 * - Bard receives "simple" (SRD lists hand crossbow, longsword, rapier,
 *   shortsword as individual additions; the simple category covers the rest).
 */
const WEAPON_PROF: Record<CharacterClass, ReadonlySet<WeaponCategory>> = {
  barbarian: new Set(["simple", "martial"]),
  bard:      new Set(["simple"]),
  cleric:    new Set(["simple"]),
  druid:     new Set(["simple"]),
  fighter:   new Set(["simple", "martial"]),
  monk:      new Set(["simple"]),
  paladin:   new Set(["simple", "martial"]),
  ranger:    new Set(["simple", "martial"]),
  rogue:     new Set(["simple"]),
  sorcerer:  new Set(),
  warlock:   new Set(["simple"]),
  wizard:    new Set(),
};

/**
 * Armor category proficiencies per 5e SRD class description.
 *
 * Notes on design choices:
 * - Cleric and Druid receive light + medium + shield; domain/subclass Heavy
 *   armor is a character-level feature, not a class-baseline concern here.
 * - Monk and Wizard/Sorcerer receive no armor proficiency.
 */
const ARMOR_PROF: Record<CharacterClass, ReadonlySet<ArmorCategory>> = {
  barbarian: new Set(["light", "medium", "shield"]),
  bard:      new Set(["light"]),
  cleric:    new Set(["light", "medium", "shield"]),
  druid:     new Set(["light", "medium", "shield"]),
  fighter:   new Set(["light", "medium", "heavy", "shield"]),
  monk:      new Set(),
  paladin:   new Set(["light", "medium", "heavy", "shield"]),
  ranger:    new Set(["light", "medium", "shield"]),
  rogue:     new Set(["light"]),
  sorcerer:  new Set(),
  warlock:   new Set(["light"]),
  wizard:    new Set(),
};

// ─── Public query functions ───────────────────────────────────────────────────

/**
 * Returns true if `characterClass` has proficiency with the given
 * `weaponCategory` per the 5e SRD baseline class description.
 */
export function isWeaponProficient(
  characterClass: CharacterClass,
  weaponCategory: WeaponCategory,
): boolean {
  return WEAPON_PROF[characterClass]?.has(weaponCategory) ?? false;
}

/**
 * Returns true if `characterClass` has proficiency with the given
 * `armorCategory` per the 5e SRD baseline class description.
 */
export function isArmorProficient(
  characterClass: CharacterClass,
  armorCategory: ArmorCategory,
): boolean {
  return ARMOR_PROF[characterClass]?.has(armorCategory) ?? false;
}
