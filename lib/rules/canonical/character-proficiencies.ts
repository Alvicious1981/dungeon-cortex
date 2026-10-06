/**
 * lib/rules/canonical/character-proficiencies.ts
 *
 * Mapeo y gestión canónica de competencias genéricas de personaje:
 * - Armaduras (light, medium, heavy, shield)
 * - Armas (simple, martial)
 * - Tiradas de salvación (STR, DEX, CON, INT, WIS, CHA)
 * - Herramientas (thieves-tools, etc.)
 *
 * Actúa como puente entre las entidades relacionales CharacterProficiency
 * y el cálculo determinista de reglas puras de lib/rules/proficiency.ts.
 */

import { ProficiencyType } from "@prisma/client";
import {
  DEFAULT_RULESET_ID,
  CANONICAL_ARMOR_PROFICIENCY_CODES,
  CANONICAL_WEAPON_PROFICIENCY_CODES,
  CANONICAL_SAVING_THROW_CODES,
  type CanonicalArmorProficiencyCode,
  type CanonicalWeaponProficiencyCode,
  type CanonicalSavingThrowCode,
} from "./constants";
import {
  isArmorProficient as pureIsArmorProficient,
  isWeaponProficient as pureIsWeaponProficient,
  type CharacterClass,
  type ArmorCategory,
  type WeaponCategory,
} from "../proficiency";

export const CLASS_SAVING_THROWS: Record<CharacterClass, readonly CanonicalSavingThrowCode[]> = {
  barbarian: ["STR", "CON"],
  bard:      ["DEX", "CHA"],
  cleric:    ["WIS", "CHA"],
  druid:     ["INT", "WIS"],
  fighter:   ["STR", "CON"],
  monk:      ["STR", "DEX"],
  paladin:   ["WIS", "CHA"],
  ranger:    ["STR", "DEX"],
  rogue:     ["DEX", "INT"],
  sorcerer:  ["CON", "CHA"],
  warlock:   ["WIS", "CHA"],
  wizard:    ["INT", "WIS"],
};

export const CLASS_BASELINE_TOOLS: Record<CharacterClass, readonly string[]> = {
  barbarian: [],
  bard:      [],
  cleric:    [],
  druid:     ["herbalism-kit"],
  fighter:   [],
  monk:      [],
  paladin:   [],
  ranger:    [],
  rogue:     ["thieves-tools"],
  sorcerer:  [],
  warlock:   [],
  wizard:    [],
};

export interface CanonicalCharacterProficiencyInput {
  characterId: string;
  rulesetId: string;
  type: ProficiencyType;
  code: string;
}

/**
 * Normaliza un string de clase a CharacterClass reconocida, o null si no es válida.
 */
function normalizeClass(characterClass: string): CharacterClass | null {
  if (typeof characterClass !== "string") return null;
  const c = characterClass.trim().toLowerCase() as CharacterClass;
  return Object.prototype.hasOwnProperty.call(CLASS_SAVING_THROWS, c) ? c : null;
}

/**
 * Genera el conjunto canónico de competencias básicas para una clase de D&D 5e SRD 2014.
 * Incluye armaduras, armas, tiradas de salvación y herramientas de clase.
 */
export function buildBaselineClassProficiencies(
  characterId: string,
  characterClass: string,
  rulesetId: string = DEFAULT_RULESET_ID
): CanonicalCharacterProficiencyInput[] {
  const c = normalizeClass(characterClass);
  if (!c) return [];

  const result: CanonicalCharacterProficiencyInput[] = [];

  // Armaduras
  for (const armor of CANONICAL_ARMOR_PROFICIENCY_CODES) {
    if (pureIsArmorProficient(c, armor as ArmorCategory)) {
      result.push({
        characterId,
        rulesetId,
        type: ProficiencyType.ARMOR,
        code: armor,
      });
    }
  }

  // Armas
  for (const weapon of CANONICAL_WEAPON_PROFICIENCY_CODES) {
    if (pureIsWeaponProficient(c, weapon as WeaponCategory)) {
      result.push({
        characterId,
        rulesetId,
        type: ProficiencyType.WEAPON,
        code: weapon,
      });
    }
  }

  // Tiradas de salvación
  const saves = CLASS_SAVING_THROWS[c] ?? [];
  for (const save of saves) {
    result.push({
      characterId,
      rulesetId,
      type: ProficiencyType.SAVING_THROW,
      code: save,
    });
  }

  // Herramientas de clase
  const tools = CLASS_BASELINE_TOOLS[c] ?? [];
  for (const tool of tools) {
    result.push({
      characterId,
      rulesetId,
      type: ProficiencyType.TOOL,
      code: tool,
    });
  }

  return result;
}

/**
 * Consulta si un personaje es competente con una armadura, evaluando primero
 * sus competencias canónicas registradas, o recurriendo a la clase como fallback defensivo.
 */
export function isCharacterArmorProficient(
  proficiencies: Array<{ type: string; code: string }>,
  armorCategory: string,
  fallbackClass?: string
): boolean {
  const normCat = armorCategory.trim().toLowerCase();
  const found = proficiencies.some(
    (p) => p.type === ProficiencyType.ARMOR && p.code.toLowerCase() === normCat
  );
  if (found) return true;

  if (fallbackClass) {
    const c = normalizeClass(fallbackClass);
    if (c) {
      return pureIsArmorProficient(c, normCat as ArmorCategory);
    }
  }

  return false;
}

/**
 * Consulta si un personaje es competente con una categoría de armas.
 */
export function isCharacterWeaponProficient(
  proficiencies: Array<{ type: string; code: string }>,
  weaponCategory: string,
  fallbackClass?: string
): boolean {
  const normCat = weaponCategory.trim().toLowerCase();
  const found = proficiencies.some(
    (p) => p.type === ProficiencyType.WEAPON && p.code.toLowerCase() === normCat
  );
  if (found) return true;

  if (fallbackClass) {
    const c = normalizeClass(fallbackClass);
    if (c) {
      return pureIsWeaponProficient(c, normCat as WeaponCategory);
    }
  }

  return false;
}

/**
 * Consulta si un personaje es competente en una tirada de salvación dada.
 */
export function isCharacterSavingThrowProficient(
  proficiencies: Array<{ type: string; code: string }>,
  abilityCode: string,
  fallbackClass?: string
): boolean {
  const normAbility = abilityCode.trim().toUpperCase();
  const found = proficiencies.some(
    (p) => p.type === ProficiencyType.SAVING_THROW && p.code.toUpperCase() === normAbility
  );
  if (found) return true;

  if (fallbackClass) {
    const c = normalizeClass(fallbackClass);
    if (c) {
      const saves = CLASS_SAVING_THROWS[c] ?? [];
      return saves.includes(normAbility as CanonicalSavingThrowCode);
    }
  }

  return false;
}
