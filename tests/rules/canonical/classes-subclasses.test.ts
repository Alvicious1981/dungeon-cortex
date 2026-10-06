/**
 * tests/rules/canonical/classes-subclasses.test.ts
 *
 * Pruebas unitarias para el módulo de dominio canónico:
 * - lib/rules/canonical/character-classes.ts
 */

import { describe, expect, it } from "vitest";
import {
  classNameToCanonicalCode,
  canonicalCodeToClassName,
  getHitDieForCanonicalClass,
  getSubclassLevelForClass,
  subclassNameToCanonicalCode,
  buildCanonicalCharacterClassLevel,
} from "@/lib/rules/canonical/character-classes";
import {
  CANONICAL_CLASS_CODES,
  RULESET_2014_ID,
  RULESET_2024_ID,
} from "@/lib/rules/canonical/constants";
import {
  SRD_2014_CLASSES,
  SRD_2014_SUBCLASSES,
} from "@/lib/rules/canonical/seed-data";

describe("lib/rules/canonical/character-classes", () => {
  it("normaliza nombres de clases en inglés y español", () => {
    // English
    expect(classNameToCanonicalCode("Fighter")).toBe("fighter");
    expect(classNameToCanonicalCode("wizard")).toBe("wizard");
    expect(classNameToCanonicalCode("Rogue")).toBe("rogue");

    // Spanish
    expect(classNameToCanonicalCode("guerrero")).toBe("fighter");
    expect(classNameToCanonicalCode("mago")).toBe("wizard");
    expect(classNameToCanonicalCode("pícaro")).toBe("rogue");
    expect(classNameToCanonicalCode("picaro")).toBe("rogue");
    expect(classNameToCanonicalCode("clérigo")).toBe("cleric");
    expect(classNameToCanonicalCode("clerigo")).toBe("cleric");
    expect(classNameToCanonicalCode("bárbaro")).toBe("barbarian");
    expect(classNameToCanonicalCode("barbaro")).toBe("barbarian");
    expect(classNameToCanonicalCode("hechicero")).toBe("sorcerer");
    expect(classNameToCanonicalCode("brujo")).toBe("warlock");
  });

  it("devuelve null ante clases desconocidas o inputs no válidos", () => {
    expect(classNameToCanonicalCode("jedi")).toBeNull();
    expect(classNameToCanonicalCode("")).toBeNull();
    expect(classNameToCanonicalCode(null as unknown as string)).toBeNull();
  });

  it("canonicalCodeToClassName formatea el nombre oficial en mayúsculas", () => {
    expect(canonicalCodeToClassName("fighter")).toBe("Fighter");
    expect(canonicalCodeToClassName("wizard")).toBe("Wizard");
    expect(canonicalCodeToClassName("barbarian")).toBe("Barbarian");
  });

  it("devuelve los dados de golpe exactos del SRD 5.1", () => {
    expect(getHitDieForCanonicalClass("barbarian")).toBe(12);
    expect(getHitDieForCanonicalClass("fighter")).toBe(10);
    expect(getHitDieForCanonicalClass("paladin")).toBe(10);
    expect(getHitDieForCanonicalClass("ranger")).toBe(10);
    expect(getHitDieForCanonicalClass("bard")).toBe(8);
    expect(getHitDieForCanonicalClass("cleric")).toBe(8);
    expect(getHitDieForCanonicalClass("druid")).toBe(8);
    expect(getHitDieForCanonicalClass("monk")).toBe(8);
    expect(getHitDieForCanonicalClass("rogue")).toBe(8);
    expect(getHitDieForCanonicalClass("warlock")).toBe(8);
    expect(getHitDieForCanonicalClass("sorcerer")).toBe(6);
    expect(getHitDieForCanonicalClass("wizard")).toBe(6);
  });

  it("calcula el nivel de elección de subclase según el ruleset", () => {
    // 2014 Ruleset
    expect(getSubclassLevelForClass("cleric", RULESET_2014_ID)).toBe(1);
    expect(getSubclassLevelForClass("sorcerer", RULESET_2014_ID)).toBe(1);
    expect(getSubclassLevelForClass("warlock", RULESET_2014_ID)).toBe(1);
    expect(getSubclassLevelForClass("druid", RULESET_2014_ID)).toBe(2);
    expect(getSubclassLevelForClass("wizard", RULESET_2014_ID)).toBe(2);
    expect(getSubclassLevelForClass("fighter", RULESET_2014_ID)).toBe(3);
    expect(getSubclassLevelForClass("rogue", RULESET_2014_ID)).toBe(3);
    expect(getSubclassLevelForClass("barbarian", RULESET_2014_ID)).toBe(3);

    // 2024 Ruleset: todas eligen en nivel 3
    for (const code of CANONICAL_CLASS_CODES) {
      expect(getSubclassLevelForClass(code, RULESET_2024_ID)).toBe(3);
    }
  });

  it("resuelve nombres de subclases canónicas en inglés y español", () => {
    expect(subclassNameToCanonicalCode("fighter", "champion")).toBe("champion");
    expect(subclassNameToCanonicalCode("fighter", "campeón")).toBe("champion");
    expect(subclassNameToCanonicalCode("wizard", "school-of-evocation")).toBe("school-of-evocation");
    expect(subclassNameToCanonicalCode("wizard", "evocación")).toBe("school-of-evocation");
    expect(subclassNameToCanonicalCode("rogue", "thief")).toBe("thief");
    expect(subclassNameToCanonicalCode("rogue", "ladrón")).toBe("thief");
    expect(subclassNameToCanonicalCode("cleric", "life-domain")).toBe("life-domain");
    expect(subclassNameToCanonicalCode("cleric", "dominio de la vida")).toBe("life-domain");

    // Subclase incompatible o desconocida
    expect(subclassNameToCanonicalCode("fighter", "evocation")).toBeNull();
    expect(subclassNameToCanonicalCode("wizard", "unknown")).toBeNull();
  });

  it("buildCanonicalCharacterClassLevel construye el payload validado", () => {
    const payload = buildCanonicalCharacterClassLevel({
      characterId: "char-1",
      className: "guerrero",
      level: 5,
      subclassCode: "campeón",
      isPrimary: true,
    });

    expect(payload).toEqual({
      characterId: "char-1",
      rulesetId: "dnd_5e_2014",
      classCode: "fighter",
      subclassCode: "champion",
      level: 5,
      isPrimary: true,
    });
  });

  it("buildCanonicalCharacterClassLevel limita el nivel a [1, 20] y rechaza clases inválidas", () => {
    const clamped = buildCanonicalCharacterClassLevel({
      characterId: "char-1",
      className: "wizard",
      level: 99,
    });
    expect(clamped?.level).toBe(20);

    const zeroLevel = buildCanonicalCharacterClassLevel({
      characterId: "char-1",
      className: "wizard",
      level: -5,
    });
    expect(zeroLevel?.level).toBe(1);

    const invalid = buildCanonicalCharacterClassLevel({
      characterId: "char-1",
      className: "invalid-class",
    });
    expect(invalid).toBeNull();
  });
});
