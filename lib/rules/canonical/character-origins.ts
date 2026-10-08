/**
 * lib/rules/canonical/character-origins.ts
 *
 * Módulo de dominio para la resolución y normalización de especies/razas,
 * rasgos canónicos y trasfondos (backgrounds) en D&D 5e / SRD 5.1.
 *
 * Soporta normalización bilingüe (español e inglés) tolerante a mayúsculas,
 * tildes y variantes comunes usadas en la creación de personajes.
 *
 * Fuente legal: D&D 5e SRD 5.1 (CC-BY-4.0) / docs/DECISION_5E_SRD_API.md
 */

import {
  DEFAULT_RULESET_ID,
  CANONICAL_RACE_CODES,
  CANONICAL_BACKGROUND_CODES,
  type CanonicalRaceCode,
  type CanonicalTraitCode,
  type CanonicalBackgroundCode,
} from "./constants";
import {
  SRD_2014_RACES,
  SRD_2014_RACE_TRAITS,
  SRD_2014_BACKGROUNDS,
} from "./seed-data";

/**
 * Mapa de normalización bilingüe para razas oficiales del SRD 5.1.
 */
const RACE_SYNONYMS: Record<string, CanonicalRaceCode> = {
  // Human
  human: "human",
  humano: "human",
  humana: "human",

  // Dwarf
  dwarf: "dwarf",
  enano: "dwarf",
  enana: "dwarf",

  // Elf
  elf: "elf",
  elfo: "elf",
  elfa: "elf",

  // Halfling
  halfling: "halfling",
  mediano: "halfling",
  mediana: "halfling",

  // Dragonborn
  dragonborn: "dragonborn",
  dracónido: "dragonborn",
  draconido: "dragonborn",
  dracónida: "dragonborn",

  // Gnome
  gnome: "gnome",
  gnomo: "gnome",
  gnoma: "gnome",

  // Half-Elf
  "half-elf": "half-elf",
  "half elf": "half-elf",
  halfelf: "half-elf",
  semielfo: "half-elf",
  semielfa: "half-elf",
  "medio elfo": "half-elf",
  "medio-elfo": "half-elf",

  // Half-Orc
  "half-orc": "half-orc",
  "half orc": "half-orc",
  halforc: "half-orc",
  semiorco: "half-orc",
  semiorca: "half-orc",
  "medio orco": "half-orc",
  "medio-orco": "half-orc",

  // Tiefling
  tiefling: "tiefling",
  tiflin: "tiefling",
  tielin: "tiefling",
};

/**
 * Mapa de normalización bilingüe para trasfondos canónicos del SRD 5.1.
 */
const BACKGROUND_SYNONYMS: Record<string, CanonicalBackgroundCode> = {
  acolyte: "acolyte",
  acólito: "acolyte",
  acolito: "acolyte",
  acólita: "acolyte",
  acolita: "acolyte",
};

/**
 * Normaliza cualquier denominación textual de raza/especie a su código canónico.
 * Retorna null si no coincide con ninguna raza oficial del SRD.
 */
export function normalizeCanonicalRace(raw: string): CanonicalRaceCode | null {
  if (!raw || typeof raw !== "string") return null;

  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, " ");

  // 1. Coincidencia directa en sinónimos
  if (RACE_SYNONYMS[cleaned]) {
    return RACE_SYNONYMS[cleaned];
  }

  // 2. Variante con guiones
  const withHyphen = cleaned.replace(/\s+/g, "-");
  if (RACE_SYNONYMS[withHyphen]) {
    return RACE_SYNONYMS[withHyphen];
  }

  // 3. Verificación contra los códigos canónicos
  for (const code of CANONICAL_RACE_CODES) {
    if (cleaned === code) return code;
  }

  return null;
}

/**
 * Normaliza cualquier denominación textual de trasfondo a su código canónico.
 * Retorna null si no coincide con ningún trasfondo oficial del SRD.
 */
export function normalizeCanonicalBackground(raw: string): CanonicalBackgroundCode | null {
  if (!raw || typeof raw !== "string") return null;

  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, " ");

  if (BACKGROUND_SYNONYMS[cleaned]) {
    return BACKGROUND_SYNONYMS[cleaned];
  }

  for (const code of CANONICAL_BACKGROUND_CODES) {
    if (cleaned === code) return code;
  }

  return null;
}

/**
 * Obtiene la velocidad base de movimiento en pies para una raza canónica.
 * (Humano/Elfo/Dragonborn/Semielfo/Semiorco/Tiefling: 30 ft; Enano/Mediano/Gnomo: 25 ft).
 */
export function getCanonicalRaceSpeed(raceCode: CanonicalRaceCode): number {
  const race = SRD_2014_RACES.find((r) => r.code === raceCode);
  return race?.speed ?? 30;
}

/**
 * Obtiene el tamaño canónico de la criatura para una raza del SRD ("Medium" o "Small").
 */
export function getCanonicalRaceSize(raceCode: CanonicalRaceCode): string {
  const race = SRD_2014_RACES.find((r) => r.code === raceCode);
  return race?.size ?? "Medium";
}

/**
 * Obtiene la lista de rasgos canónicos concedidos por una raza según el SRD 5.1.
 */
export function getCanonicalRaceTraits(raceCode: CanonicalRaceCode): readonly CanonicalTraitCode[] {
  return SRD_2014_RACE_TRAITS.filter((rt) => rt.raceCode === raceCode).map(
    (rt) => rt.traitCode
  );
}

/**
 * Obtiene la característica principal otorgada por un trasfondo canónico.
 */
export function getCanonicalBackgroundFeature(backgroundCode: CanonicalBackgroundCode): string | null {
  const bg = SRD_2014_BACKGROUNDS.find((b) => b.code === backgroundCode);
  return bg?.featureName ?? null;
}

export interface BuildCanonicalCharacterOriginParams {
  characterId: string;
  rawRace: string;
  rawBackground?: string | null;
  rulesetId?: string;
}

export interface CanonicalCharacterOriginData {
  characterId: string;
  rulesetId: string;
  raceCode: CanonicalRaceCode;
  backgroundCode: CanonicalBackgroundCode | null;
}

/**
 * Construye los datos normalizados para persistir un `CharacterOrigin`.
 * Retorna null si la raza no es reconocible en el catálogo canónico.
 */
export function buildCanonicalCharacterOrigin(
  params: BuildCanonicalCharacterOriginParams
): CanonicalCharacterOriginData | null {
  const raceCode = normalizeCanonicalRace(params.rawRace);
  if (!raceCode) return null;

  const backgroundCode = params.rawBackground
    ? normalizeCanonicalBackground(params.rawBackground)
    : null;

  return {
    characterId: params.characterId,
    rulesetId: params.rulesetId ?? DEFAULT_RULESET_ID,
    raceCode,
    backgroundCode,
  };
}
