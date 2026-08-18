/**
 * lib/rules/class-skills.ts
 *
 * Default skill proficiencies granted by class.
 *
 * SRD 5e has the player choose their skills from a per-class list (two for most
 * classes, three for Bard and Ranger, four for Rogue). Character creation here
 * does not yet offer that choice, so each class is given a representative
 * selection from its own list, of the size the class is entitled to.
 *
 * These are defaults, not a rule: the character's stored proficiencies are the
 * authority, and replacing this with a player choice at creation needs no data
 * migration — only a different value written to the same column.
 */

import { SKILL_ABILITY, type Skill } from "./ability-check";

/**
 * Class name (lowercased) → the skills that class starts proficient in.
 * Every entry is drawn from that class's own SRD skill list.
 */
export const CLASS_SKILL_PROFICIENCIES = {
  barbarian: ["Athletics", "Survival"],
  bard: ["Persuasion", "Performance", "Deception"],
  cleric: ["Religion", "Insight"],
  druid: ["Nature", "Perception"],
  fighter: ["Athletics", "Perception"],
  monk: ["Acrobatics", "Stealth"],
  paladin: ["Athletics", "Persuasion"],
  ranger: ["Survival", "Perception", "Stealth"],
  rogue: ["Stealth", "Sleight of Hand", "Perception", "Deception"],
  sorcerer: ["Arcana", "Persuasion"],
  warlock: ["Arcana", "Deception"],
  wizard: ["Arcana", "Investigation"],
} as const satisfies Record<string, readonly Skill[]>;

export type KnownClass = keyof typeof CLASS_SKILL_PROFICIENCIES;

/**
 * Default skill proficiencies for a class name.
 *
 * Matching is case- and whitespace-insensitive. An unrecognised class yields no
 * proficiencies rather than a guess: an unearned bonus would silently inflate
 * every check the character makes.
 */
export function defaultSkillProficiencies(characterClass: string): Skill[] {
  const key = characterClass.trim().toLowerCase();
  const skills = CLASS_SKILL_PROFICIENCIES[key as KnownClass];
  return skills ? [...skills] : [];
}

/**
 * Reads a persisted skillProficiencies value back into a typed list.
 *
 * The column is JSON and therefore unvalidated at the database level, so entries
 * that are not SRD skills are dropped rather than trusted. Anything unusable
 * degrades to "no proficiency", never to a bonus.
 */
export function parseSkillProficiencies(raw: unknown): Skill[] {
  if (!Array.isArray(raw)) return [];
  const valid = raw.filter(
    (entry): entry is Skill => typeof entry === "string" && entry in SKILL_ABILITY
  );
  return [...new Set(valid)];
}
