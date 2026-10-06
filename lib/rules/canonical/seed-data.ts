/**
 * lib/rules/canonical/seed-data.ts
 *
 * Datos estáticos autoritativos para el Ruleset D&D 5e 2014 / SRD 5.1.
 * Contiene el catálogo completo de características, habilidades e idiomas
 * listos para poblar la base de datos de manera determinista e idempotente.
 *
 * Fuente legal: D&D 5e SRD 5.1 (CC-BY-4.0)
 */

import {
  RULESET_2014_ID,
  SOURCE_SRD_5_1_ID,
  type CanonicalAbilityCode,
  type CanonicalSkillCode,
  type CanonicalLanguageCode,
  type CanonicalClassCode,
  type CanonicalSubclassCode,
  type CanonicalRaceCode,
  type CanonicalTraitCode,
  type CanonicalBackgroundCode,
} from "./constants";
import { ProficiencyType } from "@prisma/client";

export interface CanonicalAbilityDefinition {
  rulesetId: string;
  code: CanonicalAbilityCode;
  name: string;
  description: string;
  orderIndex: number;
}

export interface CanonicalSkillDefinition {
  rulesetId: string;
  code: CanonicalSkillCode;
  name: string;
  abilityCode: CanonicalAbilityCode;
}

export interface CanonicalLanguageDefinition {
  rulesetId: string;
  code: CanonicalLanguageCode;
  name: string;
  type: "STANDARD" | "EXOTIC";
  script: string;
}

export interface CanonicalProficiencyDefinition {
  rulesetId: string;
  type: ProficiencyType;
  code: string;
  name: string;
  description?: string;
}

export interface CanonicalClassDefinition {
  rulesetId: string;
  code: CanonicalClassCode;
  name: string;
  hitDie: number;
  primaryAbility: string;
  spellcastingAbility?: string | null;
  subclassLevel: number;
}

export interface CanonicalSubclassDefinition {
  rulesetId: string;
  classCode: CanonicalClassCode;
  code: CanonicalSubclassCode;
  name: string;
  description?: string;
}

export interface CanonicalRaceDefinition {
  rulesetId: string;
  code: CanonicalRaceCode;
  name: string;
  speed: number;
  size: string;
  description?: string;
}

export interface CanonicalTraitDefinition {
  rulesetId: string;
  code: CanonicalTraitCode;
  name: string;
  description: string;
}

export interface CanonicalRaceTraitDefinition {
  rulesetId: string;
  raceCode: CanonicalRaceCode;
  traitCode: CanonicalTraitCode;
}

export interface CanonicalBackgroundDefinition {
  rulesetId: string;
  code: CanonicalBackgroundCode;
  name: string;
  description?: string;
  featureName?: string;
}



export const SRD_2014_RULESET = {
  id: RULESET_2014_ID,
  name: "D&D 5e (2014 / SRD 5.1)",
  version: "5.1",
  status: "ACTIVE" as const,
  isDefault: true,
};

export const SRD_5_1_SOURCE = {
  id: SOURCE_SRD_5_1_ID,
  rulesetId: RULESET_2014_ID,
  code: "SRD_5_1",
  title: "System Reference Document 5.1",
  publisher: "Wizards of the Coast",
  url: "https://dnd.wizards.com/resources/systems-reference-document",
  license: "CC-BY-4.0",
};

export const SRD_2014_ABILITIES: readonly CanonicalAbilityDefinition[] = [
  {
    rulesetId: RULESET_2014_ID,
    code: "STR",
    name: "Strength",
    description: "Measures bodily power, athletic training, and the extent to which you can exert raw physical force.",
    orderIndex: 0,
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "DEX",
    name: "Dexterity",
    description: "Measures agility, reflexes, and balance.",
    orderIndex: 1,
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "CON",
    name: "Constitution",
    description: "Measures health, stamina, and vital force.",
    orderIndex: 2,
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "INT",
    name: "Intelligence",
    description: "Measures mental acuity, accuracy of recall, and the ability to reason.",
    orderIndex: 3,
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "WIS",
    name: "Wisdom",
    description: "Reflects how attuned you are to your surroundings and represents perceptiveness and intuition.",
    orderIndex: 4,
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "CHA",
    name: "Charisma",
    description: "Measures your ability to interact effectively with others, confidence, and eloquence.",
    orderIndex: 5,
  },
] as const;

export const SRD_2014_SKILLS: readonly CanonicalSkillDefinition[] = [
  // Strength
  { rulesetId: RULESET_2014_ID, code: "athletics", name: "Athletics", abilityCode: "STR" },

  // Dexterity
  { rulesetId: RULESET_2014_ID, code: "acrobatics", name: "Acrobatics", abilityCode: "DEX" },
  { rulesetId: RULESET_2014_ID, code: "sleight-of-hand", name: "Sleight of Hand", abilityCode: "DEX" },
  { rulesetId: RULESET_2014_ID, code: "stealth", name: "Stealth", abilityCode: "DEX" },

  // Intelligence
  { rulesetId: RULESET_2014_ID, code: "arcana", name: "Arcana", abilityCode: "INT" },
  { rulesetId: RULESET_2014_ID, code: "history", name: "History", abilityCode: "INT" },
  { rulesetId: RULESET_2014_ID, code: "investigation", name: "Investigation", abilityCode: "INT" },
  { rulesetId: RULESET_2014_ID, code: "nature", name: "Nature", abilityCode: "INT" },
  { rulesetId: RULESET_2014_ID, code: "religion", name: "Religion", abilityCode: "INT" },

  // Wisdom
  { rulesetId: RULESET_2014_ID, code: "animal-handling", name: "Animal Handling", abilityCode: "WIS" },
  { rulesetId: RULESET_2014_ID, code: "insight", name: "Insight", abilityCode: "WIS" },
  { rulesetId: RULESET_2014_ID, code: "medicine", name: "Medicine", abilityCode: "WIS" },
  { rulesetId: RULESET_2014_ID, code: "perception", name: "Perception", abilityCode: "WIS" },
  { rulesetId: RULESET_2014_ID, code: "survival", name: "Survival", abilityCode: "WIS" },

  // Charisma
  { rulesetId: RULESET_2014_ID, code: "deception", name: "Deception", abilityCode: "CHA" },
  { rulesetId: RULESET_2014_ID, code: "intimidation", name: "Intimidation", abilityCode: "CHA" },
  { rulesetId: RULESET_2014_ID, code: "performance", name: "Performance", abilityCode: "CHA" },
  { rulesetId: RULESET_2014_ID, code: "persuasion", name: "Persuasion", abilityCode: "CHA" },
] as const;

export const SRD_2014_LANGUAGES: readonly CanonicalLanguageDefinition[] = [
  // Standard Languages
  { rulesetId: RULESET_2014_ID, code: "common", name: "Common", type: "STANDARD", script: "Common" },
  { rulesetId: RULESET_2014_ID, code: "dwarvish", name: "Dwarvish", type: "STANDARD", script: "Dwarvish" },
  { rulesetId: RULESET_2014_ID, code: "elvish", name: "Elvish", type: "STANDARD", script: "Elvish" },
  { rulesetId: RULESET_2014_ID, code: "giant", name: "Giant", type: "STANDARD", script: "Dwarvish" },
  { rulesetId: RULESET_2014_ID, code: "gnomish", name: "Gnomish", type: "STANDARD", script: "Dwarvish" },
  { rulesetId: RULESET_2014_ID, code: "goblin", name: "Goblin", type: "STANDARD", script: "Dwarvish" },
  { rulesetId: RULESET_2014_ID, code: "halfling", name: "Halfling", type: "STANDARD", script: "Common" },
  { rulesetId: RULESET_2014_ID, code: "orc", name: "Orc", type: "STANDARD", script: "Dwarvish" },

  // Exotic Languages
  { rulesetId: RULESET_2014_ID, code: "abyssal", name: "Abyssal", type: "EXOTIC", script: "Infernal" },
  { rulesetId: RULESET_2014_ID, code: "celestial", name: "Celestial", type: "EXOTIC", script: "Celestial" },
  { rulesetId: RULESET_2014_ID, code: "draconic", name: "Draconic", type: "EXOTIC", script: "Draconic" },
  { rulesetId: RULESET_2014_ID, code: "deep-speech", name: "Deep Speech", type: "EXOTIC", script: "None" },
  { rulesetId: RULESET_2014_ID, code: "infernal", name: "Infernal", type: "EXOTIC", script: "Infernal" },
  { rulesetId: RULESET_2014_ID, code: "primordial", name: "Primordial", type: "EXOTIC", script: "Dwarvish" },
  { rulesetId: RULESET_2014_ID, code: "sylvan", name: "Sylvan", type: "EXOTIC", script: "Elvish" },
  { rulesetId: RULESET_2014_ID, code: "undercommon", name: "Undercommon", type: "EXOTIC", script: "Elvish" },
] as const;

export const SRD_2014_PROFICIENCIES: readonly CanonicalProficiencyDefinition[] = [
  // Armor Categories
  { rulesetId: RULESET_2014_ID, type: "ARMOR", code: "light", name: "Light Armor", description: "Padded, leather, and studded leather armor." },
  { rulesetId: RULESET_2014_ID, type: "ARMOR", code: "medium", name: "Medium Armor", description: "Hide, chain shirt, scale mail, breastplate, and half plate armor." },
  { rulesetId: RULESET_2014_ID, type: "ARMOR", code: "heavy", name: "Heavy Armor", description: "Ring mail, chain mail, splint, and plate armor." },
  { rulesetId: RULESET_2014_ID, type: "ARMOR", code: "shield", name: "Shield", description: "Shields carried in one hand to increase Armor Class." },

  // Weapon Categories
  { rulesetId: RULESET_2014_ID, type: "WEAPON", code: "simple", name: "Simple Weapons", description: "Clubs, maces, daggers, spears, shortbows, and basic armaments." },
  { rulesetId: RULESET_2014_ID, type: "WEAPON", code: "martial", name: "Martial Weapons", description: "Swords, axes, polearms, longbows, and specialized martial weapons." },

  // Saving Throws
  { rulesetId: RULESET_2014_ID, type: "SAVING_THROW", code: "STR", name: "Strength Saving Throw", description: "Resisting physical force, grapples, and knockdowns." },
  { rulesetId: RULESET_2014_ID, type: "SAVING_THROW", code: "DEX", name: "Dexterity Saving Throw", description: "Dodging area hazards, breath weapons, and traps." },
  { rulesetId: RULESET_2014_ID, type: "SAVING_THROW", code: "CON", name: "Constitution Saving Throw", description: "Withstanding poisons, diseases, and exhaustion." },
  { rulesetId: RULESET_2014_ID, type: "SAVING_THROW", code: "INT", name: "Intelligence Saving Throw", description: "Resisting mental illusions and psychic intrusions." },
  { rulesetId: RULESET_2014_ID, type: "SAVING_THROW", code: "WIS", name: "Wisdom Saving Throw", description: "Resisting charms, fear, and mental coercion." },
  { rulesetId: RULESET_2014_ID, type: "SAVING_THROW", code: "CHA", name: "Charisma Saving Throw", description: "Resisting planar banishment and personality control." },

  // Core Tools
  { rulesetId: RULESET_2014_ID, type: "TOOL", code: "thieves-tools", name: "Thieves' Tools", description: "Tools for picking locks and disabling traps." },
  { rulesetId: RULESET_2014_ID, type: "TOOL", code: "herbalism-kit", name: "Herbalism Kit", description: "Instruments for creating antitoxins and remedies." },
  { rulesetId: RULESET_2014_ID, type: "TOOL", code: "poisoner-kit", name: "Poisoner's Kit", description: "Instruments for creating and harvesting poisons." },
  { rulesetId: RULESET_2014_ID, type: "TOOL", code: "navigator-tools", name: "Navigator's Tools", description: "Sextants, charts, and compasses for navigation." },
  { rulesetId: RULESET_2014_ID, type: "TOOL", code: "disguise-kit", name: "Disguise Kit", description: "Cosmetics and props for creating illusions of appearance." },
  { rulesetId: RULESET_2014_ID, type: "TOOL", code: "forgery-kit", name: "Forgery Kit", description: "Tools and inks for falsifying documents and seals." },
] as const;

export const SRD_2014_CLASSES: readonly CanonicalClassDefinition[] = [
  {
    rulesetId: RULESET_2014_ID,
    code: "barbarian",
    name: "Barbarian",
    hitDie: 12,
    primaryAbility: "STR",
    spellcastingAbility: null,
    subclassLevel: 3,
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "bard",
    name: "Bard",
    hitDie: 8,
    primaryAbility: "CHA",
    spellcastingAbility: "CHA",
    subclassLevel: 3,
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "cleric",
    name: "Cleric",
    hitDie: 8,
    primaryAbility: "WIS",
    spellcastingAbility: "WIS",
    subclassLevel: 1,
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "druid",
    name: "Druid",
    hitDie: 8,
    primaryAbility: "WIS",
    spellcastingAbility: "WIS",
    subclassLevel: 2,
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "fighter",
    name: "Fighter",
    hitDie: 10,
    primaryAbility: "STR",
    spellcastingAbility: null,
    subclassLevel: 3,
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "monk",
    name: "Monk",
    hitDie: 8,
    primaryAbility: "DEX",
    spellcastingAbility: null,
    subclassLevel: 3,
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "paladin",
    name: "Paladin",
    hitDie: 10,
    primaryAbility: "STR",
    spellcastingAbility: "CHA",
    subclassLevel: 3,
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "ranger",
    name: "Ranger",
    hitDie: 10,
    primaryAbility: "DEX",
    spellcastingAbility: "WIS",
    subclassLevel: 3,
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "rogue",
    name: "Rogue",
    hitDie: 8,
    primaryAbility: "DEX",
    spellcastingAbility: null,
    subclassLevel: 3,
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "sorcerer",
    name: "Sorcerer",
    hitDie: 6,
    primaryAbility: "CHA",
    spellcastingAbility: "CHA",
    subclassLevel: 1,
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "warlock",
    name: "Warlock",
    hitDie: 8,
    primaryAbility: "CHA",
    spellcastingAbility: "CHA",
    subclassLevel: 1,
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "wizard",
    name: "Wizard",
    hitDie: 6,
    primaryAbility: "INT",
    spellcastingAbility: "INT",
    subclassLevel: 2,
  },
] as const;

export const SRD_2014_SUBCLASSES: readonly CanonicalSubclassDefinition[] = [
  {
    rulesetId: RULESET_2014_ID,
    classCode: "barbarian",
    code: "path-of-the-berserker",
    name: "Path of the Berserker",
    description: "For some barbarians, rage is a means to an end - that end being violence.",
  },
  {
    rulesetId: RULESET_2014_ID,
    classCode: "bard",
    code: "college-of-lore",
    name: "College of Lore",
    description: "Bards of the College of Lore know something about most things, collecting bits of knowledge.",
  },
  {
    rulesetId: RULESET_2014_ID,
    classCode: "cleric",
    code: "life-domain",
    name: "Life Domain",
    description: "The Life domain focuses on the vibrant positive energy - one of the fundamental forces of the multiverse.",
  },
  {
    rulesetId: RULESET_2014_ID,
    classCode: "druid",
    code: "circle-of-the-land",
    name: "Circle of the Land",
    description: "The Circle of the Land is made up of mystics and sages who safeguard ancient knowledge and rites.",
  },
  {
    rulesetId: RULESET_2014_ID,
    classCode: "fighter",
    code: "champion",
    name: "Champion",
    description: "The archetypal Champion focuses on the development of raw physical power honed to deadly perfection.",
  },
  {
    rulesetId: RULESET_2014_ID,
    classCode: "monk",
    code: "way-of-the-open-hand",
    name: "Way of the Open Hand",
    description: "Monks of the Way of the Open Hand are the masters of martial arts combat, whether armed or unarmed.",
  },
  {
    rulesetId: RULESET_2014_ID,
    classCode: "paladin",
    code: "oath-of-devotion",
    name: "Oath of Devotion",
    description: "The Oath of Devotion binds a paladin to the loftiest ideals of justice, virtue, and order.",
  },
  {
    rulesetId: RULESET_2014_ID,
    classCode: "ranger",
    code: "hunter",
    name: "Hunter",
    description: "Emulating the Hunter archetype means accepting your place as a bulwark between civilization and the terrors of the wilderness.",
  },
  {
    rulesetId: RULESET_2014_ID,
    classCode: "rogue",
    code: "thief",
    name: "Thief",
    description: "You hone your skills in the larcenous arts. Burglars, bandits, cutpurses, and other criminals typically follow this archetype.",
  },
  {
    rulesetId: RULESET_2014_ID,
    classCode: "sorcerer",
    code: "draconic-bloodline",
    name: "Draconic Bloodline",
    description: "Your innate magic comes from draconic magic that was mingled with your blood or that of your ancestors.",
  },
  {
    rulesetId: RULESET_2014_ID,
    classCode: "warlock",
    code: "the-fiend",
    name: "The Fiend",
    description: "You have made a pact with a fiend from the lower planes of existence.",
  },
  {
    rulesetId: RULESET_2014_ID,
    classCode: "wizard",
    code: "school-of-evocation",
    name: "School of Evocation",
    description: "You focus your study on magic that creates powerful elemental effects such as bitter cold, searing flame, rolling thunder, and crackling lightning.",
  },
] as const;

export const SRD_2014_RACES: readonly CanonicalRaceDefinition[] = [
  {
    rulesetId: RULESET_2014_ID,
    code: "human",
    name: "Human",
    speed: 30,
    size: "Medium",
    description: "Humans are the most adaptable and ambitious people among the common races.",
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "dwarf",
    name: "Dwarf",
    speed: 25,
    size: "Medium",
    description: "Bold and hardy, dwarves are known as skilled warriors, miners, and workers of stone and metal.",
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "elf",
    name: "Elf",
    speed: 30,
    size: "Medium",
    description: "Elves are a magical people of otherworldly grace, living in the world but not entirely part of it.",
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "halfling",
    name: "Halfling",
    speed: 25,
    size: "Small",
    description: "The diminutive halflings survive in a world of larger creatures by avoiding notice or, barring that, avoiding offense.",
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "dragonborn",
    name: "Dragonborn",
    speed: 30,
    size: "Medium",
    description: "Born of dragons, as their name proclaims, the dragonborn walk proudly through a world that greets them with fearful incomprehension.",
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "gnome",
    name: "Gnome",
    speed: 25,
    size: "Small",
    description: "A gnome's energy and enthusiasm for living shines through every inch of his or her tiny body.",
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "half-elf",
    name: "Half-Elf",
    speed: 30,
    size: "Medium",
    description: "Walking in two worlds but truly belonging to neither, half-elves combine what some say are the best qualities of their elf and human parents.",
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "half-orc",
    name: "Half-Orc",
    speed: 30,
    size: "Medium",
    description: "Half-orcs' grayish pigmentation, sloping brows, jutting jaws, prominent teeth, and towering builds make their orcish heritage plain for all to see.",
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "tiefling",
    name: "Tiefling",
    speed: 30,
    size: "Medium",
    description: "To be greeted with stares and whispers, to suffer violence and insult on the street, to see mistrust and fear in every eye: this is the lot of the tiefling.",
  },
] as const;

export const SRD_2014_TRAITS: readonly CanonicalTraitDefinition[] = [
  {
    rulesetId: RULESET_2014_ID,
    code: "darkvision",
    name: "Darkvision",
    description: "You can see in dim light within 60 feet of you as if it were bright light, and in darkness as if it were dim light.",
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "dwarven-resilience",
    name: "Dwarven Resilience",
    description: "You have advantage on saving throws against poison, and you have resistance against poison damage.",
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "stonecunning",
    name: "Stonecunning",
    description: "Whenever you make an Intelligence (History) check related to the origin of stonework, you add double your proficiency bonus to the check.",
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "fey-ancestry",
    name: "Fey Ancestry",
    description: "You have advantage on saving throws against being charmed, and magic can't put you to sleep.",
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "trance",
    name: "Trance",
    description: "Elves don't need to sleep. Instead, they meditate deeply for 4 hours a day.",
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "keen-senses",
    name: "Keen Senses",
    description: "You have proficiency in the Perception skill.",
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "lucky",
    name: "Lucky",
    description: "When you roll a 1 on the d20 for an attack roll, ability check, or saving throw, you can reroll the die and must use the new roll.",
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "brave",
    name: "Brave",
    description: "You have advantage on saving throws against being frightened.",
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "halfling-nimbleness",
    name: "Halfling Nimbleness",
    description: "You can move through the space of any creature that is of a size larger than yours.",
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "draconic-ancestry",
    name: "Draconic Ancestry",
    description: "You have draconic ancestry with a dragon type granting a breath weapon and damage resistance.",
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "breath-weapon",
    name: "Breath Weapon",
    description: "You can use your action to exhale destructive energy determined by your draconic ancestry.",
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "damage-resistance",
    name: "Damage Resistance",
    description: "You have resistance to the damage type associated with your draconic ancestry.",
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "gnome-cunning",
    name: "Gnome Cunning",
    description: "You have advantage on all Intelligence, Wisdom, and Charisma saving throws against magic.",
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "menacing",
    name: "Menacing",
    description: "You gain proficiency in the Intimidation skill.",
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "relentless-endurance",
    name: "Relentless Endurance",
    description: "When you are reduced to 0 hit points but not killed outright, you can drop to 1 hit point instead once per long rest.",
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "savage-attacks",
    name: "Savage Attacks",
    description: "When you score a critical hit with a melee weapon attack, you can roll one of the weapon's damage dice one additional time and add it to the extra damage.",
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "hellish-resistance",
    name: "Hellish Resistance",
    description: "You have resistance to fire damage.",
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "infernal-legacy",
    name: "Infernal Legacy",
    description: "You know the thaumaturgy cantrip and gain hellish rebuke and darkness as you advance in level.",
  },
  {
    rulesetId: RULESET_2014_ID,
    code: "skill-versatility",
    name: "Skill Versatility",
    description: "You gain proficiency in two skills of your choice.",
  },
] as const;

export const SRD_2014_RACE_TRAITS: readonly CanonicalRaceTraitDefinition[] = [
  // Dwarf
  { rulesetId: RULESET_2014_ID, raceCode: "dwarf", traitCode: "darkvision" },
  { rulesetId: RULESET_2014_ID, raceCode: "dwarf", traitCode: "dwarven-resilience" },
  { rulesetId: RULESET_2014_ID, raceCode: "dwarf", traitCode: "stonecunning" },

  // Elf
  { rulesetId: RULESET_2014_ID, raceCode: "elf", traitCode: "darkvision" },
  { rulesetId: RULESET_2014_ID, raceCode: "elf", traitCode: "fey-ancestry" },
  { rulesetId: RULESET_2014_ID, raceCode: "elf", traitCode: "trance" },
  { rulesetId: RULESET_2014_ID, raceCode: "elf", traitCode: "keen-senses" },

  // Halfling
  { rulesetId: RULESET_2014_ID, raceCode: "halfling", traitCode: "lucky" },
  { rulesetId: RULESET_2014_ID, raceCode: "halfling", traitCode: "brave" },
  { rulesetId: RULESET_2014_ID, raceCode: "halfling", traitCode: "halfling-nimbleness" },

  // Dragonborn
  { rulesetId: RULESET_2014_ID, raceCode: "dragonborn", traitCode: "draconic-ancestry" },
  { rulesetId: RULESET_2014_ID, raceCode: "dragonborn", traitCode: "breath-weapon" },
  { rulesetId: RULESET_2014_ID, raceCode: "dragonborn", traitCode: "damage-resistance" },

  // Gnome
  { rulesetId: RULESET_2014_ID, raceCode: "gnome", traitCode: "darkvision" },
  { rulesetId: RULESET_2014_ID, raceCode: "gnome", traitCode: "gnome-cunning" },

  // Half-Elf
  { rulesetId: RULESET_2014_ID, raceCode: "half-elf", traitCode: "darkvision" },
  { rulesetId: RULESET_2014_ID, raceCode: "half-elf", traitCode: "fey-ancestry" },
  { rulesetId: RULESET_2014_ID, raceCode: "half-elf", traitCode: "skill-versatility" },

  // Half-Orc
  { rulesetId: RULESET_2014_ID, raceCode: "half-orc", traitCode: "darkvision" },
  { rulesetId: RULESET_2014_ID, raceCode: "half-orc", traitCode: "menacing" },
  { rulesetId: RULESET_2014_ID, raceCode: "half-orc", traitCode: "relentless-endurance" },
  { rulesetId: RULESET_2014_ID, raceCode: "half-orc", traitCode: "savage-attacks" },

  // Tiefling
  { rulesetId: RULESET_2014_ID, raceCode: "tiefling", traitCode: "darkvision" },
  { rulesetId: RULESET_2014_ID, raceCode: "tiefling", traitCode: "hellish-resistance" },
  { rulesetId: RULESET_2014_ID, raceCode: "tiefling", traitCode: "infernal-legacy" },
] as const;

export const SRD_2014_BACKGROUNDS: readonly CanonicalBackgroundDefinition[] = [
  {
    rulesetId: RULESET_2014_ID,
    code: "acolyte",
    name: "Acolyte",
    description: "You have spent your life in the service of a temple to a specific god or pantheon.",
    featureName: "Shelter of the Faithful",
  },
] as const;


