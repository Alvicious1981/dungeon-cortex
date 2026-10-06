/**
 * lib/rules/canonical/constants.ts
 *
 * Constantes y contratos de tipos para el sistema de reglas canónicas.
 * Define identificadores de Rulesets, Fuentes, Habilidades y Lenguajes
 * asegurando aislamiento estricto entre D&D 5e 2014 y 5e 2024.
 *
 * Fuente legal: D&D 5e SRD 5.1 (CC-BY-4.0) / docs/DECISION_5E_SRD_API.md
 */

export const RULESET_2014_ID = "dnd_5e_2014" as const;
export const RULESET_2024_ID = "dnd_5e_2024" as const;

export const DEFAULT_RULESET_ID = RULESET_2014_ID;

export const SOURCE_SRD_5_1_ID = "srd_5_1" as const;

/** Las 6 puntuaciones de característica oficiales */
export const CANONICAL_ABILITY_CODES = [
  "STR",
  "DEX",
  "CON",
  "INT",
  "WIS",
  "CHA",
] as const;

export type CanonicalAbilityCode = (typeof CANONICAL_ABILITY_CODES)[number];

/** Los códigos slug de las 18 habilidades del SRD 5.1 */
export const CANONICAL_SKILL_CODES = [
  "athletics",
  "acrobatics",
  "sleight-of-hand",
  "stealth",
  "arcana",
  "history",
  "investigation",
  "nature",
  "religion",
  "animal-handling",
  "insight",
  "medicine",
  "perception",
  "survival",
  "deception",
  "intimidation",
  "performance",
  "persuasion",
] as const;

export type CanonicalSkillCode = (typeof CANONICAL_SKILL_CODES)[number];

/** Idiomas estándar del SRD 5.1 */
export const STANDARD_LANGUAGE_CODES = [
  "common",
  "dwarvish",
  "elvish",
  "giant",
  "gnomish",
  "goblin",
  "halfling",
  "orc",
] as const;

/** Idiomas exóticos del SRD 5.1 */
export const EXOTIC_LANGUAGE_CODES = [
  "abyssal",
  "celestial",
  "draconic",
  "deep-speech",
  "infernal",
  "primordial",
  "sylvan",
  "undercommon",
] as const;

export type StandardLanguageCode = (typeof STANDARD_LANGUAGE_CODES)[number];
export type ExoticLanguageCode = (typeof EXOTIC_LANGUAGE_CODES)[number];
export type CanonicalLanguageCode = StandardLanguageCode | ExoticLanguageCode;

/** Categorías canónicas de armadura para competencias */
export const CANONICAL_ARMOR_PROFICIENCY_CODES = [
  "light",
  "medium",
  "heavy",
  "shield",
] as const;

export type CanonicalArmorProficiencyCode =
  (typeof CANONICAL_ARMOR_PROFICIENCY_CODES)[number];

/** Categorías canónicas de armas para competencias */
export const CANONICAL_WEAPON_PROFICIENCY_CODES = [
  "simple",
  "martial",
] as const;

export type CanonicalWeaponProficiencyCode =
  (typeof CANONICAL_WEAPON_PROFICIENCY_CODES)[number];

/** Códigos canónicos de tiradas de salvación */
export const CANONICAL_SAVING_THROW_CODES = [
  "STR",
  "DEX",
  "CON",
  "INT",
  "WIS",
  "CHA",
] as const;

export type CanonicalSavingThrowCode =
  (typeof CANONICAL_SAVING_THROW_CODES)[number];

/** Herramientas comunes estándar del SRD 5.1 */
export const CANONICAL_TOOL_CODES = [
  "thieves-tools",
  "herbalism-kit",
  "poisoner-kit",
  "navigator-tools",
  "disguise-kit",
  "forgery-kit",
] as const;

export type CanonicalToolCode = (typeof CANONICAL_TOOL_CODES)[number];

/** Las 12 clases oficiales del SRD 5.1 */
export const CANONICAL_CLASS_CODES = [
  "barbarian",
  "bard",
  "cleric",
  "druid",
  "fighter",
  "monk",
  "paladin",
  "ranger",
  "rogue",
  "sorcerer",
  "warlock",
  "wizard",
] as const;

export type CanonicalClassCode = (typeof CANONICAL_CLASS_CODES)[number];

/** Las 12 subclases canónicas del SRD 5.1 (una por clase) */
export const CANONICAL_SUBCLASS_CODES = [
  "path-of-the-berserker",
  "college-of-lore",
  "life-domain",
  "circle-of-the-land",
  "champion",
  "way-of-the-open-hand",
  "oath-of-devotion",
  "hunter",
  "thief",
  "draconic-bloodline",
  "the-fiend",
  "school-of-evocation",
] as const;

export type CanonicalSubclassCode = (typeof CANONICAL_SUBCLASS_CODES)[number];

/** Las 9 razas / especies oficiales del SRD 5.1 */
export const CANONICAL_RACE_CODES = [
  "human",
  "dwarf",
  "elf",
  "halfling",
  "dragonborn",
  "gnome",
  "half-elf",
  "half-orc",
  "tiefling",
] as const;

export type CanonicalRaceCode = (typeof CANONICAL_RACE_CODES)[number];

/** Rasgos raciales canónicos clave del SRD 5.1 */
export const CANONICAL_TRAIT_CODES = [
  "darkvision",
  "dwarven-resilience",
  "stonecunning",
  "fey-ancestry",
  "trance",
  "keen-senses",
  "lucky",
  "brave",
  "halfling-nimbleness",
  "draconic-ancestry",
  "breath-weapon",
  "damage-resistance",
  "gnome-cunning",
  "menacing",
  "relentless-endurance",
  "savage-attacks",
  "hellish-resistance",
  "infernal-legacy",
  "skill-versatility",
] as const;

export type CanonicalTraitCode = (typeof CANONICAL_TRAIT_CODES)[number];

/** Trasfondos canónicos del SRD 5.1 */
export const CANONICAL_BACKGROUND_CODES = [
  "acolyte",
] as const;

export type CanonicalBackgroundCode = (typeof CANONICAL_BACKGROUND_CODES)[number];


