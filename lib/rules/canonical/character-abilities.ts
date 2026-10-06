/**
 * lib/rules/canonical/character-abilities.ts
 *
 * Utilidades para normalización y gestión canónica de puntuaciones de característica.
 * Asegura rango válido (1–30 per D&D 5e RAW) y mapeo bidireccional entre
 * el blob legacy Character.stats y las entidades relacionales CharacterAbility.
 */

import {
  CANONICAL_ABILITY_CODES,
  DEFAULT_RULESET_ID,
  type CanonicalAbilityCode,
} from "./constants";

export const MIN_ABILITY_SCORE = 1;
export const MAX_ABILITY_SCORE = 30;

/**
 * Valida que una puntuación de característica sea un entero dentro del rango oficial 5e (1 a 30).
 *
 * @throws {RangeError} si el valor está fuera del rango [1, 30] o no es entero.
 */
export function validateAbilityScore(score: unknown): number {
  if (typeof score !== "number" || !Number.isInteger(score)) {
    throw new TypeError(`La puntuación de característica debe ser un número entero; recibido: ${String(score)}`);
  }
  if (score < MIN_ABILITY_SCORE || score > MAX_ABILITY_SCORE) {
    throw new RangeError(
      `Puntuación de característica fuera de rango [${MIN_ABILITY_SCORE}, ${MAX_ABILITY_SCORE}]: ${score}`
    );
  }
  return score;
}

/**
 * Normaliza y valida un registro de características en el formato { STR, DEX, CON, INT, WIS, CHA }.
 */
export function normalizeAbilityScores(
  raw: unknown
): Record<CanonicalAbilityCode, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError("El objeto de características debe ser un registro no nulo.");
  }
  const obj = raw as Record<string, unknown>;
  const result = {} as Record<CanonicalAbilityCode, number>;

  for (const code of CANONICAL_ABILITY_CODES) {
    const val = obj[code] ?? obj[code.toLowerCase()];
    result[code] = validateAbilityScore(val);
  }

  return result;
}

export interface CanonicalCharacterAbilityInput {
  characterId: string;
  rulesetId: string;
  abilityCode: CanonicalAbilityCode;
  baseScore: number;
}

/**
 * Genera el payload de creación para CharacterAbility a partir de un mapa de stats.
 */
export function buildCanonicalCharacterAbilities(
  characterId: string,
  stats: Record<string, number>,
  rulesetId: string = DEFAULT_RULESET_ID
): CanonicalCharacterAbilityInput[] {
  const normalized = normalizeAbilityScores(stats);
  return CANONICAL_ABILITY_CODES.map((code) => ({
    characterId,
    rulesetId,
    abilityCode: code,
    baseScore: normalized[code],
  }));
}

/**
 * Reconstruye el formato legacy Record<CanonicalAbilityCode, number> a partir de filas CharacterAbility.
 */
export function toLegacyStatsRecord(
  abilities: Array<{ abilityCode: string; baseScore: number }>
): Record<CanonicalAbilityCode, number> {
  const stats: Partial<Record<CanonicalAbilityCode, number>> = {};
  for (const a of abilities) {
    if ((CANONICAL_ABILITY_CODES as readonly string[]).includes(a.abilityCode)) {
      stats[a.abilityCode as CanonicalAbilityCode] = a.baseScore;
    }
  }
  return normalizeAbilityScores(stats);
}
