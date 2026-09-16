/**
 * Saving-throw proficiency by class, D&D 5e SRD 2014
 * (docs/superpowers/specs/2026-09-16-area-save-actions-design.md §4.5).
 *
 * Unlike `class-skills.ts`, this is not an approximation of a player choice:
 * the SRD fixes exactly two saves per class, always the same two.
 *
 * @pure — a static table and a lookup, no I/O.
 */
import type { Ability } from "@/lib/rules/ability-check";
import type { CharacterClass } from "@/lib/rules/proficiency";

export const CLASS_SAVING_THROW_PROFICIENCIES: Record<CharacterClass, readonly [Ability, Ability]> = {
  barbarian: ["STR", "CON"],
  bard: ["DEX", "CHA"],
  cleric: ["WIS", "CHA"],
  druid: ["INT", "WIS"],
  fighter: ["STR", "CON"],
  monk: ["STR", "DEX"],
  paladin: ["WIS", "CHA"],
  ranger: ["STR", "DEX"],
  rogue: ["DEX", "INT"],
  sorcerer: ["CON", "CHA"],
  warlock: ["WIS", "CHA"],
  wizard: ["INT", "WIS"],
};

/**
 * Whether a class is proficient in a given saving throw.
 *
 * Matching is case- and whitespace-insensitive, mirroring
 * `defaultSkillProficiencies`. An unrecognised class is never proficient —
 * an unearned bonus would silently inflate every save that class makes.
 */
export function isProficientInSave(characterClass: string, ability: Ability): boolean {
  const key = characterClass.trim().toLowerCase() as CharacterClass;
  const saves = CLASS_SAVING_THROW_PROFICIENCIES[key];
  return saves !== undefined && saves.includes(ability);
}
