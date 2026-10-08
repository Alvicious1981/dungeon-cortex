/**
 * tests/rules/canonical/features-and-feats.test.ts
 *
 * Pruebas unitarias para la resolución de características de clase (features)
 * y dotes (feats) oficiales del SRD 5.1.
 */

import { describe, expect, it } from "vitest";
import {
  getClassFeaturesForLevel,
  getAllClassFeaturesUpToLevel,
  buildCanonicalCharacterFeatures,
  buildNewLevelCharacterFeatures,
} from "@/lib/rules/canonical/character-features";
import {
  SRD_2014_FEATURES,
  SRD_2014_FEATS,
} from "@/lib/rules/canonical/seed-data";
import {
  CANONICAL_CLASS_CODES,
  RULESET_2014_ID,
} from "@/lib/rules/canonical/constants";

describe("getClassFeaturesForLevel", () => {
  it("otorga las características exactas de Fighter por nivel", () => {
    const lvl1 = getClassFeaturesForLevel("fighter", 1);
    expect(lvl1.map((f) => f.code)).toEqual(["fighting-style", "second-wind"]);

    const lvl2 = getClassFeaturesForLevel("fighter", 2);
    expect(lvl2.map((f) => f.code)).toEqual(["action-surge"]);

    const lvl3 = getClassFeaturesForLevel("fighter", 3);
    expect(lvl3.map((f) => f.code)).toEqual(["martial-archetype"]);
  });

  it("otorga las características exactas de Barbarian por nivel", () => {
    const lvl1 = getClassFeaturesForLevel("barbarian", 1);
    expect(lvl1.map((f) => f.code)).toEqual(["rage", "unarmored-defense-barbarian"]);

    const lvl2 = getClassFeaturesForLevel("barbarian", 2);
    expect(lvl2.map((f) => f.code)).toEqual(["reckless-attack", "danger-sense"]);

    const lvl3 = getClassFeaturesForLevel("barbarian", 3);
    expect(lvl3.map((f) => f.code)).toEqual(["primal-path"]);
  });

  it("retorna un arreglo vacío para niveles sin características registradas", () => {
    const lvl10 = getClassFeaturesForLevel("fighter", 10);
    expect(lvl10).toEqual([]);
  });
});

describe("getAllClassFeaturesUpToLevel", () => {
  it("acumula todos los rasgos desde nivel 1 hasta nivel 3 para Rogue", () => {
    const allRogue = getAllClassFeaturesUpToLevel("rogue", 3);
    const codes = allRogue.map((f) => f.code);

    expect(codes).toContain("expertise-rogue");
    expect(codes).toContain("sneak-attack");
    expect(codes).toContain("thieves-cant");
    expect(codes).toContain("cunning-action");
    expect(codes).toContain("roguish-archetype");
    expect(allRogue).toHaveLength(5);
  });

  it("todas las 12 clases oficiales tienen al menos una característica en nivel 1", () => {
    for (const classCode of CANONICAL_CLASS_CODES) {
      const lvl1 = getClassFeaturesForLevel(classCode, 1);
      expect(lvl1.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("buildCanonicalCharacterFeatures", () => {
  it("construye el payload de CharacterFeature con source formateado", () => {
    const result = buildCanonicalCharacterFeatures({
      characterId: "char-feature-test",
      className: "paladin",
      level: 2,
    });

    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result[0]).toEqual({
      characterId: "char-feature-test",
      rulesetId: RULESET_2014_ID,
      featureCode: "divine-sense",
      source: "class:paladin:1",
    });

    const smite = result.find((f) => f.featureCode === "divine-smite");
    expect(smite).toBeDefined();
    expect(smite?.source).toBe("class:paladin:2");
  });

  it("retorna arreglo vacío si la clase no es reconocible", () => {
    const result = buildCanonicalCharacterFeatures({
      characterId: "char-test",
      className: "unknown-class",
      level: 1,
    });
    expect(result).toEqual([]);
  });
});

describe("buildNewLevelCharacterFeatures", () => {
  it("genera únicamente los rasgos que se adquieren en el nuevo nivel", () => {
    const newFeatures = buildNewLevelCharacterFeatures("char-123", "wizard", 2);
    expect(newFeatures).toHaveLength(1);
    expect(newFeatures[0]).toEqual({
      characterId: "char-123",
      rulesetId: RULESET_2014_ID,
      featureCode: "arcane-tradition",
      source: "class:wizard:2",
    });
  });
});

describe("Catálogo de Dotes SRD 5.1", () => {
  it("contiene la dote oficial Grappler con su prerrequisito", () => {
    const grappler = SRD_2014_FEATS.find((f) => f.code === "grappler");
    expect(grappler).toBeDefined();
    expect(grappler?.name).toBe("Grappler");
    expect(grappler?.prerequisite).toBe("Strength 13 or higher");
  });
});
