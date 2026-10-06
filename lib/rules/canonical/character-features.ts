/**
 * lib/rules/canonical/character-features.ts
 *
 * Módulo de dominio para la resolución y asignación de características de clase
 * (Class Features) y dotes (Feats) en D&D 5e / SRD 5.1.
 *
 * Fuente legal: D&D 5e SRD 5.1 (CC-BY-4.0) / docs/DECISION_5E_SRD_API.md
 */

import {
  DEFAULT_RULESET_ID,
  type CanonicalClassCode,
  type CanonicalFeatureCode,
} from "./constants";
import {
  SRD_2014_FEATURES,
  type CanonicalFeatureDefinition,
} from "./seed-data";
import { normalizeCanonicalClass } from "./character-classes";

/**
 * Obtiene las características de clase otorgadas en un nivel específico.
 */
export function getClassFeaturesForLevel(
  classCode: CanonicalClassCode,
  level: number
): readonly CanonicalFeatureDefinition[] {
  return SRD_2014_FEATURES.filter(
    (f) => f.classCode === classCode && f.requiredLevel === level
  );
}

/**
 * Obtiene todas las características de clase acumuladas desde el nivel 1 hasta el nivel objetivo.
 */
export function getAllClassFeaturesUpToLevel(
  classCode: CanonicalClassCode,
  level: number
): readonly CanonicalFeatureDefinition[] {
  return SRD_2014_FEATURES.filter(
    (f) => f.classCode === classCode && f.requiredLevel <= level
  );
}

export interface BuildCharacterFeaturesParams {
  characterId: string;
  className: string;
  level: number;
  rulesetId?: string;
}

export interface CanonicalCharacterFeaturePayload {
  characterId: string;
  rulesetId: string;
  featureCode: CanonicalFeatureCode;
  source: string;
}

/**
 * Construye los registros de `CharacterFeature` para un personaje a partir de su clase y nivel.
 * Retorna un arreglo vacío si la clase no es reconocible.
 */
export function buildCanonicalCharacterFeatures(
  params: BuildCharacterFeaturesParams
): CanonicalCharacterFeaturePayload[] {
  const classCode = normalizeCanonicalClass(params.className);
  if (!classCode) return [];

  const features = getAllClassFeaturesUpToLevel(classCode, params.level);
  const rulesetId = params.rulesetId ?? DEFAULT_RULESET_ID;

  return features.map((f) => ({
    characterId: params.characterId,
    rulesetId,
    featureCode: f.code,
    source: `class:${classCode}:${f.requiredLevel}`,
  }));
}

/**
 * Construye únicamente las nuevas características que se desbloquean al alcanzar `newLevel`.
 */
export function buildNewLevelCharacterFeatures(
  characterId: string,
  className: string,
  newLevel: number,
  rulesetId: string = DEFAULT_RULESET_ID
): CanonicalCharacterFeaturePayload[] {
  const classCode = normalizeCanonicalClass(className);
  if (!classCode) return [];

  const features = getClassFeaturesForLevel(classCode, newLevel);

  return features.map((f) => ({
    characterId,
    rulesetId,
    featureCode: f.code,
    source: `class:${classCode}:${newLevel}`,
  }));
}
