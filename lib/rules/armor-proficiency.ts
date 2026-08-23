/**
 * lib/rules/armor-proficiency.ts
 *
 * What it costs to wear armour you were never trained in.
 *
 * @pure — no database, no I/O, no randomness, and never throws.
 *
 * This module exists because `isArmorProficient` had tests and no consumer, the
 * same shape `isWeaponProficient` had before the previous increment. The rule
 * was stateable and never asked.
 *
 * SRD 2014: "If you wear armor that you lack proficiency with, you have
 * disadvantage on any ability check, saving throw, or attack roll that involves
 * Strength or Dexterity, and you can't cast spells."
 *
 * Note what it does NOT say: nothing about armour class. Wearing plate you
 * cannot use still protects you exactly as well; it is everything else that
 * suffers. Any change to an AC number from this module would be a bug.
 */

import { SKILL_ABILITY, type Skill } from "@/lib/rules/ability-check";
import { selectBodyArmor, type ArmorInventoryRow } from "@/lib/rules/armor-class";
import {
  isArmorProficient,
  type ArmorCategory,
  type CharacterClass,
} from "@/lib/rules/proficiency";

export interface ArmorPenalty {
  /** True when the wearer lacks proficiency with what they are wearing. */
  applies: boolean;
  /** The category worn, or null when nothing qualifying is worn. */
  category: ArmorCategory | null;
}

/**
 * Whether this character takes the unproficient-armour penalty.
 *
 * Fails closed: a class outside the twelve is proficient with nothing, so it
 * takes the penalty. That is the opposite sign from the weapon rule's
 * fail-closed, where an unknown class loses a bonus — and the same principle,
 * because both refuse to favour the character on data they cannot read.
 *
 * An equipped row whose category cannot be resolved yields no penalty: there is
 * no question to put to `isArmorProficient`, and penalising on a guess is the
 * one direction that harms the character over bad data.
 */
export function armorPenaltyFor(input: {
  inventory: readonly ArmorInventoryRow[];
  characterClass: string;
}): ArmorPenalty {
  const profile = selectBodyArmor(input.inventory);
  const category = profile?.category ?? null;

  if (category === null) return { applies: false, category: null };

  const normalisedClass = input.characterClass.trim().toLowerCase() as CharacterClass;

  return {
    applies: !isArmorProficient(normalisedClass, category),
    category,
  };
}

/**
 * Whether a skill's ability is one the penalty touches.
 *
 * Exactly four of the eighteen qualify. Derived from `SKILL_ABILITY` rather than
 * listed, so a new skill inherits the right answer instead of being forgotten.
 */
export function penalisedByArmor(skill: Skill): boolean {
  const ability = SKILL_ABILITY[skill];
  return ability === "STR" || ability === "DEX";
}
