/**
 * lib/rules/canonical/character-skills.ts
 *
 * Mapeo y gestión canónica de competencias en habilidades de personaje.
 * Conecta los nombres del SRD (ej. "Athletics", "Sleight of Hand") con los
 * identificadores canónicos normalizados ("athletics", "sleight-of-hand").
 */

import {
  CANONICAL_SKILL_CODES,
  DEFAULT_RULESET_ID,
  type CanonicalSkillCode,
} from "./constants";
import { SkillProficiencyLevel } from "@prisma/client";

const SKILL_NAME_TO_CODE: Record<string, CanonicalSkillCode> = {
  athletics: "athletics",
  acrobatics: "acrobatics",
  "sleight of hand": "sleight-of-hand",
  "sleight-of-hand": "sleight-of-hand",
  stealth: "stealth",
  arcana: "arcana",
  history: "history",
  investigation: "investigation",
  nature: "nature",
  religion: "religion",
  "animal handling": "animal-handling",
  "animal-handling": "animal-handling",
  insight: "insight",
  medicine: "medicine",
  perception: "perception",
  survival: "survival",
  deception: "deception",
  intimidation: "intimidation",
  performance: "performance",
  persuasion: "persuasion",
};

const CODE_TO_CANONICAL_NAME: Record<CanonicalSkillCode, string> = {
  athletics: "Athletics",
  acrobatics: "Acrobatics",
  "sleight-of-hand": "Sleight of Hand",
  stealth: "Stealth",
  arcana: "Arcana",
  history: "History",
  investigation: "Investigation",
  nature: "Nature",
  religion: "Religion",
  "animal-handling": "Animal Handling",
  insight: "Insight",
  medicine: "Medicine",
  perception: "Perception",
  survival: "Survival",
  deception: "Deception",
  intimidation: "Intimidation",
  performance: "Performance",
  persuasion: "Persuasion",
};

/**
 * Traduce un nombre o slug de habilidad a su CanonicalSkillCode formal.
 * Retorna null si no es una habilidad reconocida del SRD 5.1.
 */
export function skillNameToCanonicalCode(name: string): CanonicalSkillCode | null {
  if (typeof name !== "string") return null;
  const normalized = name.trim().toLowerCase();
  return SKILL_NAME_TO_CODE[normalized] ?? null;
}

/**
 * Retorna el nombre estándar con mayúsculas del SRD (ej. "Sleight of Hand").
 */
export function canonicalCodeToSkillName(code: CanonicalSkillCode): string {
  return CODE_TO_CANONICAL_NAME[code] ?? code;
}

export interface CanonicalCharacterSkillInput {
  characterId: string;
  rulesetId: string;
  skillCode: CanonicalSkillCode;
  level: SkillProficiencyLevel;
}

/**
 * Genera el payload de creación para CharacterSkillProficiency a partir de una lista
 * de nombres de habilidades en texto libre. Descarta entradas no reconocidas.
 */
export function buildCanonicalCharacterSkills(
  characterId: string,
  skillNames: readonly string[],
  rulesetId: string = DEFAULT_RULESET_ID,
  level: SkillProficiencyLevel = SkillProficiencyLevel.PROFICIENT
): CanonicalCharacterSkillInput[] {
  const seen = new Set<CanonicalSkillCode>();
  const result: CanonicalCharacterSkillInput[] = [];

  for (const name of skillNames) {
    const code = skillNameToCanonicalCode(name);
    if (code && !seen.has(code)) {
      seen.add(code);
      result.push({
        characterId,
        rulesetId,
        skillCode: code,
        level,
      });
    }
  }

  return result;
}

/**
 * Convierte una lista de registros CharacterSkillProficiency al array legacy de nombres (string[]).
 */
export function toLegacySkillProficiencies(
  skills: Array<{ skillCode: string }>
): string[] {
  return skills
    .map((s) => s.skillCode as CanonicalSkillCode)
    .filter((code) => (CANONICAL_SKILL_CODES as readonly string[]).includes(code))
    .map((code) => canonicalCodeToSkillName(code));
}
