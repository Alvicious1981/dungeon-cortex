/**
 * lib/rules/canonical/character-magic.ts
 *
 * Dominio canónico para espacios de conjuros y conjuros normalizados de personajes.
 * Fase 7 (Magic, Spell Slots & Character Spells Normalization).
 *
 * Mapeo bidireccional puro y sin pérdida entre el formato legacy `Character.spellSlots` (JSON)
 * y la estructura relacional normalizada `CharacterSpellSlot`.
 */

import { spellSlotsFor, type SpellSlots } from "@/lib/rules/magic";

export interface CanonicalSpellSlotData {
  characterId: string;
  rulesetId: string;
  spellLevel: number;
  maxSlots: number;
  usedSlots: number;
}

export interface CanonicalCharacterSpellData {
  characterId: string;
  rulesetId: string;
  spellSlug: string;
  isPrepared: boolean;
  isKnown: boolean;
  source: string;
}

/**
 * Convierte un objeto legacy `SpellSlots` (JSON de Character.spellSlots)
 * a registros relacionales canónicos `CharacterSpellSlot`.
 */
export function legacySpellSlotsToCanonicalRecords(
  characterId: string,
  slots: SpellSlots | null | undefined,
  rulesetId = "srd-5.1"
): CanonicalSpellSlotData[] {
  if (!slots || typeof slots !== "object") return [];

  const records: CanonicalSpellSlotData[] = [];
  for (const [levelKey, entry] of Object.entries(slots)) {
    const spellLevel = parseInt(levelKey, 10);
    if (isNaN(spellLevel) || spellLevel < 1 || spellLevel > 9) continue;
    if (!entry || typeof entry.max !== "number") continue;

    const maxSlots = Math.max(0, entry.max);
    const current = typeof entry.current === "number" ? entry.current : maxSlots;
    const usedSlots = Math.max(0, maxSlots - current);

    records.push({
      characterId,
      rulesetId,
      spellLevel,
      maxSlots,
      usedSlots,
    });
  }

  return records.sort((a, b) => a.spellLevel - b.spellLevel);
}

/**
 * Convierte registros relacionales canónicos `CharacterSpellSlot`
 * al formato legacy `SpellSlots` (objeto JSON con claves "1".."9").
 */
export function canonicalRecordsToLegacySpellSlots(
  records: Array<{ spellLevel: number; maxSlots: number; usedSlots: number }>
): SpellSlots {
  const result: SpellSlots = {};

  for (const record of records) {
    if (record.spellLevel < 1 || record.spellLevel > 9) continue;
    const key = String(record.spellLevel);
    const max = Math.max(0, record.maxSlots);
    const used = Math.max(0, record.usedSlots);
    const current = Math.max(0, max - used);

    result[key] = { current, max };
  }

  return result;
}

/**
 * Genera los registros canónicos de espacios de conjuro para un personaje
 * a partir de su clase y nivel según el SRD 5.1.
 */
export function buildCanonicalCharacterSpellSlots(params: {
  characterId: string;
  className: string;
  level: number;
  rulesetId?: string;
}): CanonicalSpellSlotData[] {
  const slots = spellSlotsFor(params.className, params.level);
  if (!slots) return [];
  return legacySpellSlotsToCanonicalRecords(
    params.characterId,
    slots,
    params.rulesetId ?? "srd-5.1"
  );
}

/**
 * Construye los datos canónicos para un conjuro conocido o preparado por un personaje.
 */
export function buildCanonicalCharacterSpell(params: {
  characterId: string;
  spellSlug: string;
  source: string;
  isPrepared?: boolean;
  isKnown?: boolean;
  rulesetId?: string;
}): CanonicalCharacterSpellData {
  return {
    characterId: params.characterId,
    rulesetId: params.rulesetId ?? "srd-5.1",
    spellSlug: params.spellSlug.toLowerCase().trim(),
    isPrepared: params.isPrepared ?? true,
    isKnown: params.isKnown ?? true,
    source: params.source,
  };
}
