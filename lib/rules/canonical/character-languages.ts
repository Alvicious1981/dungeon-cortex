/**
 * lib/rules/canonical/character-languages.ts
 *
 * Mapeo y gestión canónica de idiomas de personaje según D&D 5e SRD 5.1.
 * Asocia nombres/etiquetas en texto libre (español e inglés) con los
 * identificadores canónicos normalizados de CanonicalLanguage.
 */

import {
  DEFAULT_RULESET_ID,
  STANDARD_LANGUAGE_CODES,
  EXOTIC_LANGUAGE_CODES,
  type CanonicalLanguageCode,
} from "./constants";

const ALL_LANGUAGE_CODES = [
  ...STANDARD_LANGUAGE_CODES,
  ...EXOTIC_LANGUAGE_CODES,
] as const;

const LANGUAGE_NAME_TO_CODE: Record<string, CanonicalLanguageCode> = {
  common: "common",
  comun: "common",
  "común": "common",
  dwarvish: "dwarvish",
  dwarf: "dwarvish",
  enano: "dwarvish",
  elvish: "elvish",
  elf: "elvish",
  "élfico": "elvish",
  elfico: "elvish",
  giant: "giant",
  gigante: "giant",
  gnomish: "gnomish",
  gnome: "gnomish",
  gnomo: "gnomish",
  goblin: "goblin",
  trasgo: "goblin",
  halfling: "halfling",
  mediano: "halfling",
  orc: "orc",
  orco: "orc",
  abyssal: "abyssal",
  abisal: "abyssal",
  celestial: "celestial",
  draconic: "draconic",
  "dracónico": "draconic",
  draconico: "draconic",
  "deep speech": "deep-speech",
  "deep-speech": "deep-speech",
  "habla profunda": "deep-speech",
  infernal: "infernal",
  primordial: "primordial",
  sylvan: "sylvan",
  silvano: "sylvan",
  undercommon: "undercommon",
  "infracomún": "undercommon",
  infracomun: "undercommon",
};

const CODE_TO_CANONICAL_NAME: Record<CanonicalLanguageCode, string> = {
  common: "Common",
  dwarvish: "Dwarvish",
  elvish: "Elvish",
  giant: "Giant",
  gnomish: "Gnomish",
  goblin: "Goblin",
  halfling: "Halfling",
  orc: "Orc",
  abyssal: "Abyssal",
  celestial: "Celestial",
  draconic: "Draconic",
  "deep-speech": "Deep Speech",
  infernal: "Infernal",
  primordial: "Primordial",
  sylvan: "Sylvan",
  undercommon: "Undercommon",
};

const RACE_DEFAULT_LANGUAGES: Record<string, readonly CanonicalLanguageCode[]> = {
  human: ["common"],
  humano: ["common"],
  elf: ["common", "elvish"],
  elfo: ["common", "elvish"],
  dwarf: ["common", "dwarvish"],
  enano: ["common", "dwarvish"],
  halfling: ["common", "halfling"],
  mediano: ["common", "halfling"],
  dragonborn: ["common", "draconic"],
  "dracónico": ["common", "draconic"],
  draconido: ["common", "draconic"],
  gnome: ["common", "gnomish"],
  gnomo: ["common", "gnomish"],
  "half-elf": ["common", "elvish"],
  semielfo: ["common", "elvish"],
  "half-orc": ["common", "orc"],
  semiorco: ["common", "orc"],
  tiefling: ["common", "infernal"],
  tiflin: ["common", "infernal"],
};

/**
 * Traduce un nombre de idioma (en español o inglés) al CanonicalLanguageCode.
 * Retorna null si no es un idioma reconocido.
 */
export function languageNameToCanonicalCode(name: string): CanonicalLanguageCode | null {
  if (typeof name !== "string") return null;
  const normalized = name.trim().toLowerCase();
  return LANGUAGE_NAME_TO_CODE[normalized] ?? null;
}

/**
 * Devuelve el nombre estándar en inglés del SRD para un código de idioma.
 */
export function canonicalCodeToLanguageName(code: CanonicalLanguageCode): string {
  return CODE_TO_CANONICAL_NAME[code] ?? code;
}

/**
 * Retorna la lista de idiomas automáticos por defecto según la raza 5e SRD 2014.
 */
export function getDefaultLanguagesForRace(race: string): CanonicalLanguageCode[] {
  if (typeof race !== "string") return ["common"];
  const normalized = race.trim().toLowerCase();
  const defaults = RACE_DEFAULT_LANGUAGES[normalized];
  return defaults ? [...defaults] : ["common"];
}

export interface CanonicalCharacterLanguageInput {
  characterId: string;
  rulesetId: string;
  languageCode: CanonicalLanguageCode;
}

/**
 * Genera el payload de creación para CharacterLanguage a partir de una lista de nombres de idioma.
 * Descarta duplicados e identificadores desconocidos.
 */
export function buildCanonicalCharacterLanguages(
  characterId: string,
  languageNames: readonly string[],
  rulesetId: string = DEFAULT_RULESET_ID
): CanonicalCharacterLanguageInput[] {
  const seen = new Set<CanonicalLanguageCode>();
  const result: CanonicalCharacterLanguageInput[] = [];

  for (const name of languageNames) {
    const code = languageNameToCanonicalCode(name);
    if (code && !seen.has(code)) {
      seen.add(code);
      result.push({
        characterId,
        rulesetId,
        languageCode: code,
      });
    }
  }

  return result;
}

/**
 * Convierte registros CharacterLanguage a nombres legibles estándar.
 */
export function toLanguageNames(
  languages: Array<{ languageCode: string }>
): string[] {
  return languages
    .map((l) => l.languageCode as CanonicalLanguageCode)
    .filter((code) => (ALL_LANGUAGE_CODES as readonly string[]).includes(code))
    .map((code) => canonicalCodeToLanguageName(code));
}
