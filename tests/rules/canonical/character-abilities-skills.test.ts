/**
 * tests/rules/canonical/character-abilities-skills.test.ts
 *
 * Pruebas unitarias de normalización, validación y compatibilidad bidireccional
 * para características y habilidades de personaje.
 */

import { describe, expect, it } from "vitest";
import {
  validateAbilityScore,
  normalizeAbilityScores,
  buildCanonicalCharacterAbilities,
  toLegacyStatsRecord,
  MIN_ABILITY_SCORE,
  MAX_ABILITY_SCORE,
} from "@/lib/rules/canonical/character-abilities";
import {
  skillNameToCanonicalCode,
  canonicalCodeToSkillName,
  buildCanonicalCharacterSkills,
  toLegacySkillProficiencies,
} from "@/lib/rules/canonical/character-skills";
import { SkillProficiencyLevel } from "@prisma/client";

describe("Normalización de Puntuaciones de Característica (CharacterAbility)", () => {
  it("acepta puntuaciones enteras válidas dentro del rango [1, 30]", () => {
    expect(validateAbilityScore(1)).toBe(1);
    expect(validateAbilityScore(10)).toBe(10);
    expect(validateAbilityScore(20)).toBe(20);
    expect(validateAbilityScore(30)).toBe(30);
  });

  it("rechaza puntuaciones fuera de rango o no enteras", () => {
    expect(() => validateAbilityScore(0)).toThrow(RangeError);
    expect(() => validateAbilityScore(31)).toThrow(RangeError);
    expect(() => validateAbilityScore(-5)).toThrow(RangeError);
    expect(() => validateAbilityScore(14.5)).toThrow(TypeError);
    expect(() => validateAbilityScore("18")).toThrow(TypeError);
    expect(() => validateAbilityScore(null)).toThrow(TypeError);
  });

  it("normaliza registros completos de características", () => {
    const raw = { STR: 15, DEX: 14, CON: 13, INT: 12, WIS: 10, CHA: 8 };
    const normalized = normalizeAbilityScores(raw);

    expect(normalized).toEqual({
      STR: 15,
      DEX: 14,
      CON: 13,
      INT: 12,
      WIS: 10,
      CHA: 8,
    });
  });

  it("soporta nombres de características en minúsculas en el input", () => {
    const raw = { str: 10, dex: 12, con: 14, int: 16, wis: 13, cha: 9 };
    const normalized = normalizeAbilityScores(raw);

    expect(normalized.STR).toBe(10);
    expect(normalized.INT).toBe(16);
  });

  it("genera inputs relacionales para CharacterAbility", () => {
    const raw = { STR: 18, DEX: 14, CON: 16, INT: 10, WIS: 12, CHA: 8 };
    const inputs = buildCanonicalCharacterAbilities("char_test_1", raw);

    expect(inputs).toHaveLength(6);
    expect(inputs[0]).toEqual({
      characterId: "char_test_1",
      rulesetId: "dnd_5e_2014",
      abilityCode: "STR",
      baseScore: 18,
    });
  });

  it("reconstruye el record legacy a partir de filas de base de datos", () => {
    const rows = [
      { abilityCode: "STR", baseScore: 16 },
      { abilityCode: "DEX", baseScore: 14 },
      { abilityCode: "CON", baseScore: 15 },
      { abilityCode: "INT", baseScore: 9 },
      { abilityCode: "WIS", baseScore: 13 },
      { abilityCode: "CHA", baseScore: 11 },
    ];
    const legacy = toLegacyStatsRecord(rows);

    expect(legacy).toEqual({
      STR: 16,
      DEX: 14,
      CON: 15,
      INT: 9,
      WIS: 13,
      CHA: 11,
    });
  });
});

describe("Normalización de Competencias en Habilidades (CharacterSkillProficiency)", () => {
  it("mapea nombres comunes a códigos canónicos de forma insensible a mayúsculas", () => {
    expect(skillNameToCanonicalCode("Athletics")).toBe("athletics");
    expect(skillNameToCanonicalCode("sleight of hand")).toBe("sleight-of-hand");
    expect(skillNameToCanonicalCode("Sleight of Hand")).toBe("sleight-of-hand");
    expect(skillNameToCanonicalCode("animal-handling")).toBe("animal-handling");
    expect(skillNameToCanonicalCode("Animal Handling")).toBe("animal-handling");
    expect(skillNameToCanonicalCode("Invalida")).toBeNull();
  });

  it("formatea códigos canónicos a nombres estándar de presentación", () => {
    expect(canonicalCodeToSkillName("athletics")).toBe("Athletics");
    expect(canonicalCodeToSkillName("sleight-of-hand")).toBe("Sleight of Hand");
    expect(canonicalCodeToSkillName("animal-handling")).toBe("Animal Handling");
  });

  it("genera inputs relacionales deduplicando entradas y descartando nombres no válidos", () => {
    const rawSkills = ["Athletics", "Stealth", "Athletics", "HabilidadFalsa", "Perception"];
    const inputs = buildCanonicalCharacterSkills("char_test_2", rawSkills);

    expect(inputs).toHaveLength(3);
    expect(inputs.map((i) => i.skillCode)).toEqual(["athletics", "stealth", "perception"]);
    expect(inputs[0].level).toBe(SkillProficiencyLevel.PROFICIENT);
  });

  it("reconstruye la lista legacy de strings para consumidores antiguos", () => {
    const rows = [
      { skillCode: "athletics" },
      { skillCode: "stealth" },
      { skillCode: "perception" },
    ];
    const legacy = toLegacySkillProficiencies(rows);

    expect(legacy).toEqual(["Athletics", "Stealth", "Perception"]);
  });
});
