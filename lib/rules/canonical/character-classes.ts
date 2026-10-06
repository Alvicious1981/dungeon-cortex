/**
 * lib/rules/canonical/character-classes.ts
 *
 * Mapeo y gestión canónica de clases, subclases y niveles de personaje según D&D 5e SRD 5.1.
 * Maneja normalización bilingüe (español e inglés), consulta determinista de dados de golpe,
 * niveles de desbloqueo de subclase y construcción de registros para CharacterClassLevel.
 */

import { hitDieForClass } from "@/lib/rules/progression";
import {
  DEFAULT_RULESET_ID,
  RULESET_2024_ID,
  type CanonicalClassCode,
  type CanonicalSubclassCode,
} from "./constants";

const CLASS_NAME_TO_CODE: Record<string, CanonicalClassCode> = {
  // English
  barbarian: "barbarian",
  bard: "bard",
  cleric: "cleric",
  druid: "druid",
  fighter: "fighter",
  monk: "monk",
  paladin: "paladin",
  ranger: "ranger",
  rogue: "rogue",
  sorcerer: "sorcerer",
  warlock: "warlock",
  wizard: "wizard",

  // Spanish
  "bárbaro": "barbarian",
  barbaro: "barbarian",
  bardo: "bard",
  "clérigo": "cleric",
  clerigo: "cleric",
  druida: "druid",
  guerrero: "fighter",
  monje: "monk",
  "paladín": "paladin",
  explorador: "ranger",
  "pícaro": "rogue",
  picaro: "rogue",
  hechicero: "sorcerer",
  brujo: "warlock",
  mago: "wizard",
};

const CODE_TO_CLASS_NAME: Record<CanonicalClassCode, string> = {
  barbarian: "Barbarian",
  bard: "Bard",
  cleric: "Cleric",
  druid: "Druid",
  fighter: "Fighter",
  monk: "Monk",
  paladin: "Paladin",
  ranger: "Ranger",
  rogue: "Rogue",
  sorcerer: "Sorcerer",
  warlock: "Warlock",
  wizard: "Wizard",
};

const CLASS_SUBCLASS_LEVEL_2014: Record<CanonicalClassCode, number> = {
  cleric:    1,
  sorcerer:  1,
  warlock:   1,
  druid:     2,
  wizard:    2,
  barbarian: 3,
  bard:      3,
  fighter:   3,
  monk:      3,
  paladin:   3,
  ranger:    3,
  rogue:     3,
};

const SUBCLASS_MAP: Record<CanonicalClassCode, Record<string, CanonicalSubclassCode>> = {
  barbarian: {
    "path-of-the-berserker": "path-of-the-berserker",
    berserker: "path-of-the-berserker",
  },
  bard: {
    "college-of-lore": "college-of-lore",
    lore: "college-of-lore",
    conocimiento: "college-of-lore",
  },
  cleric: {
    "life-domain": "life-domain",
    life: "life-domain",
    vida: "life-domain",
    "dominio de la vida": "life-domain",
  },
  druid: {
    "circle-of-the-land": "circle-of-the-land",
    land: "circle-of-the-land",
    tierra: "circle-of-the-land",
    "círculo de la tierra": "circle-of-the-land",
  },
  fighter: {
    champion: "champion",
    "campeón": "champion",
    campeon: "champion",
  },
  monk: {
    "way-of-the-open-hand": "way-of-the-open-hand",
    "open hand": "way-of-the-open-hand",
    "mano abierta": "way-of-the-open-hand",
  },
  paladin: {
    "oath-of-devotion": "oath-of-devotion",
    devotion: "oath-of-devotion",
    "devoción": "oath-of-devotion",
  },
  ranger: {
    hunter: "hunter",
    cazador: "hunter",
  },
  rogue: {
    thief: "thief",
    "ladrón": "thief",
    ladron: "thief",
  },
  sorcerer: {
    "draconic-bloodline": "draconic-bloodline",
    draconic: "draconic-bloodline",
    "linaje dracónico": "draconic-bloodline",
  },
  warlock: {
    "the-fiend": "the-fiend",
    fiend: "the-fiend",
    infernal: "the-fiend",
  },
  wizard: {
    "school-of-evocation": "school-of-evocation",
    evocation: "school-of-evocation",
    "evocación": "school-of-evocation",
  },
};

/**
 * Traduce un nombre de clase (en español o inglés) al CanonicalClassCode formal.
 * Retorna null si la clase no es reconocida.
 */
export function classNameToCanonicalCode(name: string): CanonicalClassCode | null {
  if (typeof name !== "string") return null;
  const normalized = name.trim().toLowerCase();
  return CLASS_NAME_TO_CODE[normalized] ?? null;
}

export const normalizeCanonicalClass = classNameToCanonicalCode;

/**
 * Retorna el nombre estándar en inglés con mayúsculas del SRD (ej. "Fighter").
 */
export function canonicalCodeToClassName(code: CanonicalClassCode): string {
  return CODE_TO_CLASS_NAME[code] ?? code;
}

/**
 * Retorna el dado de golpe oficial de una clase canónica (d6, d8, d10, d12).
 */
export function getHitDieForCanonicalClass(code: CanonicalClassCode): number {
  return hitDieForClass(code);
}

/**
 * Retorna el nivel en el que una clase elige su subclase según el ruleset.
 * En 5e 2014 varía según la clase (nivel 1, 2 o 3). En 2024 todas son en nivel 3.
 */
export function getSubclassLevelForClass(
  code: CanonicalClassCode,
  rulesetId: string = DEFAULT_RULESET_ID
): number {
  if (rulesetId === RULESET_2024_ID) {
    return 3;
  }
  return CLASS_SUBCLASS_LEVEL_2014[code] ?? 3;
}

/**
 * Traduce un nombre o slug de subclase a su código canónico para la clase dada.
 */
export function subclassNameToCanonicalCode(
  classCode: CanonicalClassCode,
  name: string
): CanonicalSubclassCode | null {
  if (typeof name !== "string") return null;
  const normalized = name.trim().toLowerCase();
  const classSubclasses = SUBCLASS_MAP[classCode];
  return classSubclasses?.[normalized] ?? null;
}

export interface CanonicalCharacterClassLevelInput {
  characterId: string;
  rulesetId: string;
  classCode: CanonicalClassCode;
  subclassCode?: string | null;
  level: number;
  isPrimary: boolean;
}

/**
 * Construye el payload para CharacterClassLevel a partir de los datos del personaje.
 * Valida la clase y asegura nivel entre 1 y 20. Retorna null si la clase no es válida.
 */
export function buildCanonicalCharacterClassLevel(input: {
  characterId: string;
  className: string;
  level?: number;
  subclassCode?: string | null;
  isPrimary?: boolean;
  rulesetId?: string;
}): CanonicalCharacterClassLevelInput | null {
  const code = classNameToCanonicalCode(input.className);
  if (!code) return null;

  const rawLevel = typeof input.level === "number" && Number.isInteger(input.level)
    ? input.level
    : 1;
  const level = Math.max(1, Math.min(20, rawLevel));

  let resolvedSubclass: string | null = null;
  if (input.subclassCode) {
    const subCode = subclassNameToCanonicalCode(code, input.subclassCode);
    resolvedSubclass = subCode ?? null;
  }

  return {
    characterId: input.characterId,
    rulesetId: input.rulesetId ?? DEFAULT_RULESET_ID,
    classCode: code,
    subclassCode: resolvedSubclass,
    level,
    isPrimary: input.isPrimary ?? true,
  };
}
