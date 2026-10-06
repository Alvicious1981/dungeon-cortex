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

