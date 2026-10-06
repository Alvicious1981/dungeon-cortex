/**
 * tests/rules/canonical/magic-and-spell-slots.test.ts
 *
 * Pruebas unitarias para el dominio canónico de magia, espacios de conjuro
 * y normalización de conjuros (Fase 7).
 */

import { describe, expect, it } from "vitest";
import {
  legacySpellSlotsToCanonicalRecords,
  canonicalRecordsToLegacySpellSlots,
  buildCanonicalCharacterSpellSlots,
  buildCanonicalCharacterSpell,
} from "@/lib/rules/canonical/character-magic";
import type { SpellSlots } from "@/lib/rules/magic";

describe("legacySpellSlotsToCanonicalRecords", () => {
  it("convierte SpellSlots JSON a registros canónicos ordenados", () => {
    const legacy: SpellSlots = {
      "2": { current: 2, max: 3 },
      "1": { current: 4, max: 4 },
    };

    const records = legacySpellSlotsToCanonicalRecords("char-1", legacy, "srd-5.1");

    expect(records).toEqual([
      {
        characterId: "char-1",
        rulesetId: "srd-5.1",
        spellLevel: 1,
        maxSlots: 4,
        usedSlots: 0,
      },
      {
        characterId: "char-1",
        rulesetId: "srd-5.1",
        spellLevel: 2,
        maxSlots: 3,
        usedSlots: 1, // 3 max - 2 current = 1 used
      },
    ]);
  });

  it("calcula correctamente usedSlots cuando todos los espacios han sido gastados", () => {
    const legacy: SpellSlots = {
      "1": { current: 0, max: 2 },
    };

    const records = legacySpellSlotsToCanonicalRecords("char-2", legacy);
    expect(records).toHaveLength(1);
    expect(records[0].usedSlots).toBe(2);
    expect(records[0].maxSlots).toBe(2);
  });

  it("retorna arreglo vacío ante null, undefined o tipos inválidos", () => {
    expect(legacySpellSlotsToCanonicalRecords("char-3", null)).toEqual([]);
    expect(legacySpellSlotsToCanonicalRecords("char-3", undefined)).toEqual([]);
    expect(legacySpellSlotsToCanonicalRecords("char-3", {} as SpellSlots)).toEqual([]);
  });

  it("ignora claves no numéricas o fuera del rango 1-9", () => {
    const invalid = {
      "0": { current: 1, max: 1 },
      "cantrips": { current: 1, max: 1 },
      "10": { current: 1, max: 1 },
      "1": { current: 2, max: 2 },
    } as unknown as SpellSlots;

    const records = legacySpellSlotsToCanonicalRecords("char-4", invalid);
    expect(records).toHaveLength(1);
    expect(records[0].spellLevel).toBe(1);
  });
});

describe("canonicalRecordsToLegacySpellSlots", () => {
  it("convierte registros relacionales al formato SpellSlots legacy", () => {
    const records = [
      { spellLevel: 1, maxSlots: 4, usedSlots: 1 },
      { spellLevel: 2, maxSlots: 2, usedSlots: 0 },
    ];

    const legacy = canonicalRecordsToLegacySpellSlots(records);
    expect(legacy).toEqual({
      "1": { current: 3, max: 4 },
      "2": { current: 2, max: 2 },
    });
  });

  it("preserva la integridad en viaje de ida y vuelta (roundtrip)", () => {
    const original: SpellSlots = {
      "1": { current: 2, max: 4 },
      "2": { current: 1, max: 3 },
      "3": { current: 0, max: 2 },
    };

    const records = legacySpellSlotsToCanonicalRecords("char-roundtrip", original);
    const reconstructed = canonicalRecordsToLegacySpellSlots(records);

    expect(reconstructed).toEqual(original);
  });
});

describe("buildCanonicalCharacterSpellSlots", () => {
  it("genera los espacios de nivel 1 para Wizard de nivel 1", () => {
    const slots = buildCanonicalCharacterSpellSlots({
      characterId: "wiz-1",
      className: "wizard",
      level: 1,
    });

    expect(slots).toEqual([
      {
        characterId: "wiz-1",
        rulesetId: "srd-5.1",
        spellLevel: 1,
        maxSlots: 2,
        usedSlots: 0,
      },
    ]);
  });

  it("genera espacios multicanal para Cleric de nivel 3", () => {
    const slots = buildCanonicalCharacterSpellSlots({
      characterId: "cleric-3",
      className: "cleric",
      level: 3,
    });

    expect(slots).toEqual([
      {
        characterId: "cleric-3",
        rulesetId: "srd-5.1",
        spellLevel: 1,
        maxSlots: 4,
        usedSlots: 0,
      },
      {
        characterId: "cleric-3",
        rulesetId: "srd-5.1",
        spellLevel: 2,
        maxSlots: 2,
        usedSlots: 0,
      },
    ]);
  });

  it("respeta la progresión de medio conjurador (Paladin nivel 1 vs nivel 2)", () => {
    const paladin1 = buildCanonicalCharacterSpellSlots({
      characterId: "pal-1",
      className: "paladin",
      level: 1,
    });
    expect(paladin1).toEqual([]);

    const paladin2 = buildCanonicalCharacterSpellSlots({
      characterId: "pal-2",
      className: "paladin",
      level: 2,
    });
    expect(paladin2).toEqual([
      {
        characterId: "pal-2",
        rulesetId: "srd-5.1",
        spellLevel: 1,
        maxSlots: 2,
        usedSlots: 0,
      },
    ]);
  });

  it("retorna arreglo vacío para clases sin conjuros (Fighter)", () => {
    const fighter = buildCanonicalCharacterSpellSlots({
      characterId: "fight-1",
      className: "fighter",
      level: 5,
    });
    expect(fighter).toEqual([]);
  });

  it("genera espacios correctos de Pact Magic para Warlock nivel 3", () => {
    const warlock = buildCanonicalCharacterSpellSlots({
      characterId: "war-3",
      className: "warlock",
      level: 3,
    });

    expect(warlock).toEqual([
      {
        characterId: "war-3",
        rulesetId: "srd-5.1",
        spellLevel: 2,
        maxSlots: 2,
        usedSlots: 0,
      },
    ]);
  });
});

describe("buildCanonicalCharacterSpell", () => {
  it("construye un registro de conjuro con slug normalizado y flags por defecto", () => {
    const spell = buildCanonicalCharacterSpell({
      characterId: "char-spell-1",
      spellSlug: "Magic-Missile ",
      source: "class:wizard:1",
    });

    expect(spell).toEqual({
      characterId: "char-spell-1",
      rulesetId: "srd-5.1",
      spellSlug: "magic-missile",
      isPrepared: true,
      isKnown: true,
      source: "class:wizard:1",
    });
  });

  it("permite especificar flags explícitos de preparación y aprendizaje", () => {
    const spell = buildCanonicalCharacterSpell({
      characterId: "char-spell-2",
      spellSlug: "fireball",
      source: "spellbook",
      isPrepared: false,
      isKnown: true,
      rulesetId: "dnd_5e_2014",
    });

    expect(spell).toEqual({
      characterId: "char-spell-2",
      rulesetId: "dnd_5e_2014",
      spellSlug: "fireball",
      isPrepared: false,
      isKnown: true,
      source: "spellbook",
    });
  });
});
