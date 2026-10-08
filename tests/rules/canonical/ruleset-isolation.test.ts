/**
 * tests/rules/canonical/ruleset-isolation.test.ts
 *
 * Pruebas unitarias de aislamiento de Ruleset y coherencia del catálogo canónico.
 * Demuestra:
 * 1. Aislamiento estricto: Entidades 2014 y 2024 comparten el mismo código sin colisión.
 * 2. Integridad de los datos de semilla SRD 5.1 (6 características, 18 habilidades, 16 idiomas).
 * 3. Integridad referencial interna (todas las habilidades apuntan a una característica válida).
 */

import { describe, expect, it } from "vitest";
import {
  RULESET_2014_ID,
  RULESET_2024_ID,
  CANONICAL_ABILITY_CODES,
  CANONICAL_SKILL_CODES,
  STANDARD_LANGUAGE_CODES,
  EXOTIC_LANGUAGE_CODES,
} from "@/lib/rules/canonical/constants";
import {
  SRD_2014_RULESET,
  SRD_5_1_SOURCE,
  SRD_2014_ABILITIES,
  SRD_2014_SKILLS,
  SRD_2014_LANGUAGES,
} from "@/lib/rules/canonical/seed-data";

describe("Canonical Ruleset Foundation — Aislamiento y Contratos", () => {
  it("define identificadores inmutables distintos para 2014 y 2024", () => {
    expect(RULESET_2014_ID).toBe("dnd_5e_2014");
    expect(RULESET_2024_ID).toBe("dnd_5e_2024");
    expect(RULESET_2014_ID).not.toBe(RULESET_2024_ID);
  });

  it("garantiza que entidades con claves idénticas coexisten si pertenecen a rulesets distintos", () => {
    // Simulación del comportamiento de la clave primaria compuesta (rulesetId, code)
    interface CompositeEntity {
      rulesetId: string;
      code: string;
      name: string;
    }

    const store = new Map<string, CompositeEntity>();
    const compositeKey = (e: CompositeEntity) => `${e.rulesetId}:${e.code}`;

    const skill2014: CompositeEntity = {
      rulesetId: RULESET_2014_ID,
      code: "stealth",
      name: "Stealth (2014)",
    };

    const skill2024: CompositeEntity = {
      rulesetId: RULESET_2024_ID,
      code: "stealth",
      name: "Stealth (2024)",
    };

    store.set(compositeKey(skill2014), skill2014);
    store.set(compositeKey(skill2024), skill2024);

    expect(store.size).toBe(2);
    expect(store.get(`${RULESET_2014_ID}:stealth`)?.name).toBe("Stealth (2014)");
    expect(store.get(`${RULESET_2024_ID}:stealth`)?.name).toBe("Stealth (2024)");
  });

  describe("Catálogo de Características SRD 5.1 (CanonicalAbility)", () => {
    it("contiene exactamente las 6 características oficiales de D&D", () => {
      expect(SRD_2014_ABILITIES).toHaveLength(6);
      const codes = SRD_2014_ABILITIES.map((a) => a.code);
      expect(codes).toEqual(CANONICAL_ABILITY_CODES);
    });

    it("asigna todas las características al ruleset 2014 con índices de orden correlativos", () => {
      for (const [idx, ability] of SRD_2014_ABILITIES.entries()) {
        expect(ability.rulesetId).toBe(RULESET_2014_ID);
        expect(ability.orderIndex).toBe(idx);
        expect(ability.name.length).toBeGreaterThan(0);
        expect(ability.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Catálogo de Habilidades SRD 5.1 (CanonicalSkill)", () => {
    it("contiene exactamente las 18 habilidades oficiales del SRD 5.1", () => {
      expect(SRD_2014_SKILLS).toHaveLength(18);
      const codes = SRD_2014_SKILLS.map((s) => s.code);
      expect(codes).toEqual(CANONICAL_SKILL_CODES);
    });

    it("vincula cada habilidad a una característica válida en su mismo ruleset", () => {
      const validAbilities = new Set(CANONICAL_ABILITY_CODES);
      for (const skill of SRD_2014_SKILLS) {
        expect(skill.rulesetId).toBe(RULESET_2014_ID);
        expect(validAbilities.has(skill.abilityCode)).toBe(true);
      }
    });

    it("asocia correctamente habilidades críticas a sus atributos RAW", () => {
      const byCode = new Map(SRD_2014_SKILLS.map((s) => [s.code, s]));
      expect(byCode.get("athletics")?.abilityCode).toBe("STR");
      expect(byCode.get("acrobatics")?.abilityCode).toBe("DEX");
      expect(byCode.get("stealth")?.abilityCode).toBe("DEX");
      expect(byCode.get("arcana")?.abilityCode).toBe("INT");
      expect(byCode.get("investigation")?.abilityCode).toBe("INT");
      expect(byCode.get("perception")?.abilityCode).toBe("WIS");
      expect(byCode.get("insight")?.abilityCode).toBe("WIS");
      expect(byCode.get("persuasion")?.abilityCode).toBe("CHA");
      expect(byCode.get("deception")?.abilityCode).toBe("CHA");
    });
  });

  describe("Catálogo de Idiomas SRD 5.1 (CanonicalLanguage)", () => {
    it("contiene los 8 idiomas estándar y 8 exóticos oficiales", () => {
      expect(SRD_2014_LANGUAGES).toHaveLength(16);
      const standard = SRD_2014_LANGUAGES.filter((l) => l.type === "STANDARD");
      const exotic = SRD_2014_LANGUAGES.filter((l) => l.type === "EXOTIC");

      expect(standard).toHaveLength(8);
      expect(exotic).toHaveLength(8);

      expect(standard.map((s) => s.code)).toEqual(STANDARD_LANGUAGE_CODES);
      expect(exotic.map((e) => e.code)).toEqual(EXOTIC_LANGUAGE_CODES);
    });

    it("asocia todos los idiomas al ruleset 2014 y provee escritura/alfabeto", () => {
      for (const lang of SRD_2014_LANGUAGES) {
        expect(lang.rulesetId).toBe(RULESET_2014_ID);
        expect(lang.name.length).toBeGreaterThan(0);
        expect(lang.script.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Metadatos de Fuente SRD 5.1 (RuleSource)", () => {
    it("identifica adecuadamente la licencia CC-BY-4.0 y atribución oficial", () => {
      expect(SRD_2014_RULESET.id).toBe(RULESET_2014_ID);
      expect(SRD_2014_RULESET.isDefault).toBe(true);
      expect(SRD_5_1_SOURCE.rulesetId).toBe(RULESET_2014_ID);
      expect(SRD_5_1_SOURCE.license).toBe("CC-BY-4.0");
      expect(SRD_5_1_SOURCE.publisher).toBe("Wizards of the Coast");
    });
  });
});
