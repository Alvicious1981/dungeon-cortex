/**
 * tests/rules/canonical/races-traits-origins.test.ts
 *
 * Pruebas unitarias para la normalización de especies/razas, rasgos raciales
 * y trasfondos del SRD 5.1.
 */

import { describe, expect, it } from "vitest";
import {
  normalizeCanonicalRace,
  normalizeCanonicalBackground,
  getCanonicalRaceSpeed,
  getCanonicalRaceSize,
  getCanonicalRaceTraits,
  getCanonicalBackgroundFeature,
  buildCanonicalCharacterOrigin,
} from "@/lib/rules/canonical/character-origins";
import {
  CANONICAL_RACE_CODES,
  RULESET_2014_ID,
} from "@/lib/rules/canonical/constants";

describe("normalizeCanonicalRace", () => {
  it("normaliza las 9 razas oficiales en inglés estándar", () => {
    for (const code of CANONICAL_RACE_CODES) {
      expect(normalizeCanonicalRace(code)).toBe(code);
    }
  });

  it("normaliza nombres en español con diferentes géneros y variantes", () => {
    expect(normalizeCanonicalRace("Humano")).toBe("human");
    expect(normalizeCanonicalRace("humana")).toBe("human");
    expect(normalizeCanonicalRace("Enano")).toBe("dwarf");
    expect(normalizeCanonicalRace("enana")).toBe("dwarf");
    expect(normalizeCanonicalRace("Elfo")).toBe("elf");
    expect(normalizeCanonicalRace("elfa")).toBe("elf");
    expect(normalizeCanonicalRace("Mediano")).toBe("halfling");
    expect(normalizeCanonicalRace("mediana")).toBe("halfling");
    expect(normalizeCanonicalRace("Dracónido")).toBe("dragonborn");
    expect(normalizeCanonicalRace("draconido")).toBe("dragonborn");
    expect(normalizeCanonicalRace("Gnomo")).toBe("gnome");
    expect(normalizeCanonicalRace("gnoma")).toBe("gnome");
    expect(normalizeCanonicalRace("Semielfo")).toBe("half-elf");
    expect(normalizeCanonicalRace("medio elfo")).toBe("half-elf");
    expect(normalizeCanonicalRace("medio-elfo")).toBe("half-elf");
    expect(normalizeCanonicalRace("Semiorco")).toBe("half-orc");
    expect(normalizeCanonicalRace("medio orco")).toBe("half-orc");
    expect(normalizeCanonicalRace("medio-orco")).toBe("half-orc");
    expect(normalizeCanonicalRace("Tiflin")).toBe("tiefling");
    expect(normalizeCanonicalRace("tielin")).toBe("tiefling");
  });

  it("tolera mayúsculas, espacios y caracteres especiales", () => {
    expect(normalizeCanonicalRace("  HALF-ELF  ")).toBe("half-elf");
    expect(normalizeCanonicalRace("Half Elf")).toBe("half-elf");
    expect(normalizeCanonicalRace("HALF_ORC")).toBe("half-orc");
  });

  it("retorna null ante entradas vacías o razas no oficiales", () => {
    expect(normalizeCanonicalRace("")).toBeNull();
    expect(normalizeCanonicalRace("Klingon")).toBeNull();
    expect(normalizeCanonicalRace("vampire")).toBeNull();
    expect(normalizeCanonicalRace(null as unknown as string)).toBeNull();
  });
});

describe("normalizeCanonicalBackground", () => {
  it("normaliza el trasfondo acolyte en inglés y español", () => {
    expect(normalizeCanonicalBackground("acolyte")).toBe("acolyte");
    expect(normalizeCanonicalBackground("Acolyte")).toBe("acolyte");
    expect(normalizeCanonicalBackground("acólito")).toBe("acolyte");
    expect(normalizeCanonicalBackground("acolito")).toBe("acolyte");
  });

  it("retorna null para trasfondos no soportados en el catálogo base", () => {
    expect(normalizeCanonicalBackground("gladiator")).toBeNull();
    expect(normalizeCanonicalBackground("")).toBeNull();
  });
});

describe("getCanonicalRaceSpeed", () => {
  it("devuelve 25 pies para razas pequeñas/enanas (Dwarf, Halfling, Gnome)", () => {
    expect(getCanonicalRaceSpeed("dwarf")).toBe(25);
    expect(getCanonicalRaceSpeed("halfling")).toBe(25);
    expect(getCanonicalRaceSpeed("gnome")).toBe(25);
  });

  it("devuelve 30 pies para el resto de razas del SRD", () => {
    expect(getCanonicalRaceSpeed("human")).toBe(30);
    expect(getCanonicalRaceSpeed("elf")).toBe(30);
    expect(getCanonicalRaceSpeed("dragonborn")).toBe(30);
    expect(getCanonicalRaceSpeed("half-elf")).toBe(30);
    expect(getCanonicalRaceSpeed("half-orc")).toBe(30);
    expect(getCanonicalRaceSpeed("tiefling")).toBe(30);
  });
});

describe("getCanonicalRaceSize", () => {
  it("asigna Small a Halfling y Gnome", () => {
    expect(getCanonicalRaceSize("halfling")).toBe("Small");
    expect(getCanonicalRaceSize("gnome")).toBe("Small");
  });

  it("asigna Medium al resto de razas", () => {
    expect(getCanonicalRaceSize("human")).toBe("Medium");
    expect(getCanonicalRaceSize("dwarf")).toBe("Medium");
    expect(getCanonicalRaceSize("elf")).toBe("Medium");
  });
});

describe("getCanonicalRaceTraits", () => {
  it("otorga los rasgos canónicos de Enano", () => {
    const dwarfTraits = getCanonicalRaceTraits("dwarf");
    expect(dwarfTraits).toContain("darkvision");
    expect(dwarfTraits).toContain("dwarven-resilience");
    expect(dwarfTraits).toContain("stonecunning");
  });

  it("otorga los rasgos canónicos de Elfo", () => {
    const elfTraits = getCanonicalRaceTraits("elf");
    expect(elfTraits).toContain("darkvision");
    expect(elfTraits).toContain("fey-ancestry");
    expect(elfTraits).toContain("trance");
    expect(elfTraits).toContain("keen-senses");
  });

  it("otorga los rasgos canónicos de Mediano", () => {
    const halflingTraits = getCanonicalRaceTraits("halfling");
    expect(halflingTraits).toContain("lucky");
    expect(halflingTraits).toContain("brave");
    expect(halflingTraits).toContain("halfling-nimbleness");
  });
});

describe("getCanonicalBackgroundFeature", () => {
  it("retorna la característica oficial de Acolyte", () => {
    expect(getCanonicalBackgroundFeature("acolyte")).toBe("Shelter of the Faithful");
  });
});

describe("buildCanonicalCharacterOrigin", () => {
  it("construye el origen completo para una raza reconocida", () => {
    const origin = buildCanonicalCharacterOrigin({
      characterId: "char-123",
      rawRace: "Elfo",
      rawBackground: "Acólito",
    });

    expect(origin).toEqual({
      characterId: "char-123",
      rulesetId: RULESET_2014_ID,
      raceCode: "elf",
      backgroundCode: "acolyte",
    });
  });

  it("permite trasfondo opcional/nulo", () => {
    const origin = buildCanonicalCharacterOrigin({
      characterId: "char-456",
      rawRace: "Humano",
    });

    expect(origin).toEqual({
      characterId: "char-456",
      rulesetId: RULESET_2014_ID,
      raceCode: "human",
      backgroundCode: null,
    });
  });

  it("retorna null si la raza no puede normalizarse", () => {
    const origin = buildCanonicalCharacterOrigin({
      characterId: "char-789",
      rawRace: "Desconocido",
    });

    expect(origin).toBeNull();
  });
});
