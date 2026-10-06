/**
 * tests/rules/canonical/languages-proficiencies.test.ts
 *
 * Pruebas unitarias para los módulos de dominio canónico:
 * - lib/rules/canonical/character-languages.ts
 * - lib/rules/canonical/character-proficiencies.ts
 */

import { describe, expect, it } from "vitest";
import { ProficiencyType } from "@prisma/client";
import {
  languageNameToCanonicalCode,
  canonicalCodeToLanguageName,
  getDefaultLanguagesForRace,
  buildCanonicalCharacterLanguages,
  toLanguageNames,
} from "@/lib/rules/canonical/character-languages";
import {
  buildBaselineClassProficiencies,
  isCharacterArmorProficient,
  isCharacterWeaponProficient,
  isCharacterSavingThrowProficient,
  CLASS_SAVING_THROWS,
  CLASS_BASELINE_TOOLS,
} from "@/lib/rules/canonical/character-proficiencies";
import {
  SRD_2014_PROFICIENCIES,
  SRD_2014_LANGUAGES,
} from "@/lib/rules/canonical/seed-data";

describe("lib/rules/canonical/character-languages", () => {
  it("reconoce nombres de idiomas en inglés y español", () => {
    expect(languageNameToCanonicalCode("Common")).toBe("common");
    expect(languageNameToCanonicalCode("común")).toBe("common");
    expect(languageNameToCanonicalCode("comun")).toBe("common");
    expect(languageNameToCanonicalCode("Elvish")).toBe("elvish");
    expect(languageNameToCanonicalCode("élfico")).toBe("elvish");
    expect(languageNameToCanonicalCode("Dwarvish")).toBe("dwarvish");
    expect(languageNameToCanonicalCode("enano")).toBe("dwarvish");
    expect(languageNameToCanonicalCode("Deep Speech")).toBe("deep-speech");
    expect(languageNameToCanonicalCode("habla profunda")).toBe("deep-speech");
    expect(languageNameToCanonicalCode("undercommon")).toBe("undercommon");
    expect(languageNameToCanonicalCode("infracomún")).toBe("undercommon");
  });

  it("devuelve null ante entradas no reconocidas o tipos inválidos", () => {
    expect(languageNameToCanonicalCode("klingon")).toBeNull();
    expect(languageNameToCanonicalCode("")).toBeNull();
    expect(languageNameToCanonicalCode(null as unknown as string)).toBeNull();
  });

  it("canonicalCodeToLanguageName formatea el nombre con mayúsculas estándar", () => {
    expect(canonicalCodeToLanguageName("common")).toBe("Common");
    expect(canonicalCodeToLanguageName("deep-speech")).toBe("Deep Speech");
    expect(canonicalCodeToLanguageName("undercommon")).toBe("Undercommon");
  });

  it("asigna los idiomas raciales por defecto según el SRD 2014", () => {
    expect(getDefaultLanguagesForRace("human")).toEqual(["common"]);
    expect(getDefaultLanguagesForRace("humano")).toEqual(["common"]);
    expect(getDefaultLanguagesForRace("elf")).toEqual(["common", "elvish"]);
    expect(getDefaultLanguagesForRace("elfo")).toEqual(["common", "elvish"]);
    expect(getDefaultLanguagesForRace("dwarf")).toEqual(["common", "dwarvish"]);
    expect(getDefaultLanguagesForRace("halfling")).toEqual(["common", "halfling"]);
    expect(getDefaultLanguagesForRace("dragonborn")).toEqual(["common", "draconic"]);
    expect(getDefaultLanguagesForRace("tiefling")).toEqual(["common", "infernal"]);
    // Raza desconocida recurre a Common
    expect(getDefaultLanguagesForRace("alien")).toEqual(["common"]);
  });

  it("buildCanonicalCharacterLanguages construye el payload deduplicado", () => {
    const payload = buildCanonicalCharacterLanguages("char-1", [
      "Common",
      "común",
      "Elvish",
      "desconocido",
    ]);

    expect(payload).toEqual([
      { characterId: "char-1", rulesetId: "dnd_5e_2014", languageCode: "common" },
      { characterId: "char-1", rulesetId: "dnd_5e_2014", languageCode: "elvish" },
    ]);
  });

  it("toLanguageNames convierte registros canónicos a nombres legibles", () => {
    const names = toLanguageNames([
      { languageCode: "common" },
      { languageCode: "elvish" },
    ]);
    expect(names).toEqual(["Common", "Elvish"]);
  });
});

describe("lib/rules/canonical/character-proficiencies", () => {
  it("construye competencias de clase completas para Fighter", () => {
    const profs = buildBaselineClassProficiencies("char-1", "fighter");
    
    // Armaduras: light, medium, heavy, shield
    const armors = profs.filter((p) => p.type === ProficiencyType.ARMOR).map((p) => p.code);
    expect(armors).toEqual(["light", "medium", "heavy", "shield"]);

    // Armas: simple, martial
    const weapons = profs.filter((p) => p.type === ProficiencyType.WEAPON).map((p) => p.code);
    expect(weapons).toEqual(["simple", "martial"]);

    // Salvaciones: STR, CON
    const saves = profs.filter((p) => p.type === ProficiencyType.SAVING_THROW).map((p) => p.code);
    expect(saves).toEqual(["STR", "CON"]);
  });

  it("construye competencias de clase para Wizard (sin armaduras ni categorías de armas, INT + WIS saves)", () => {
    const profs = buildBaselineClassProficiencies("char-1", "wizard");
    
    const armors = profs.filter((p) => p.type === ProficiencyType.ARMOR);
    expect(armors).toHaveLength(0);

    const weapons = profs.filter((p) => p.type === ProficiencyType.WEAPON);
    expect(weapons).toHaveLength(0);

    const saves = profs.filter((p) => p.type === ProficiencyType.SAVING_THROW).map((p) => p.code);
    expect(saves).toEqual(["INT", "WIS"]);
  });

  it("construye competencias de clase para Rogue (light armor, simple weapons, DEX + INT saves, thieves-tools)", () => {
    const profs = buildBaselineClassProficiencies("char-1", "rogue");
    
    const armors = profs.filter((p) => p.type === ProficiencyType.ARMOR).map((p) => p.code);
    expect(armors).toEqual(["light"]);

    const weapons = profs.filter((p) => p.type === ProficiencyType.WEAPON).map((p) => p.code);
    expect(weapons).toEqual(["simple"]);

    const saves = profs.filter((p) => p.type === ProficiencyType.SAVING_THROW).map((p) => p.code);
    expect(saves).toEqual(["DEX", "INT"]);

    const tools = profs.filter((p) => p.type === ProficiencyType.TOOL).map((p) => p.code);
    expect(tools).toEqual(["thieves-tools"]);
  });

  it("devuelve array vacío ante una clase desconocida o input no-string", () => {
    expect(buildBaselineClassProficiencies("char-1", "peasant")).toEqual([]);
    expect(buildBaselineClassProficiencies("char-1", null as unknown as string)).toEqual([]);
  });

  it("todas las 12 clases del SRD 2014 tienen exactamente 2 tiradas de salvación", () => {
    const classes = Object.keys(CLASS_SAVING_THROWS);
    expect(classes).toHaveLength(12);

    for (const c of classes) {
      const profs = buildBaselineClassProficiencies("char-1", c);
      const saves = profs.filter((p) => p.type === ProficiencyType.SAVING_THROW);
      expect(saves).toHaveLength(2);
    }
  });

  it("isCharacterArmorProficient evalúa competencias registradas con fallback seguro", () => {
    const fighterProfs = [
      { type: "ARMOR", code: "heavy" },
      { type: "ARMOR", code: "shield" },
    ];

    expect(isCharacterArmorProficient(fighterProfs, "heavy")).toBe(true);
    expect(isCharacterArmorProficient(fighterProfs, "shield")).toBe(true);
    // No en la lista, pero sí por fallback a clase si se proporciona
    expect(isCharacterArmorProficient(fighterProfs, "light")).toBe(false);
    expect(isCharacterArmorProficient(fighterProfs, "light", "fighter")).toBe(true);
    expect(isCharacterArmorProficient(fighterProfs, "light", "wizard")).toBe(false);
  });

  it("isCharacterWeaponProficient evalúa categorías registradas y fallback", () => {
    const profs = [{ type: "WEAPON", code: "simple" }];

    expect(isCharacterWeaponProficient(profs, "simple")).toBe(true);
    expect(isCharacterWeaponProficient(profs, "martial")).toBe(false);
    expect(isCharacterWeaponProficient(profs, "martial", "fighter")).toBe(true);
  });

  it("isCharacterSavingThrowProficient evalúa salvaciones registradas y fallback", () => {
    const profs = [{ type: "SAVING_THROW", code: "DEX" }];

    expect(isCharacterSavingThrowProficient(profs, "DEX")).toBe(true);
    expect(isCharacterSavingThrowProficient(profs, "CON")).toBe(false);
    expect(isCharacterSavingThrowProficient(profs, "CON", "fighter")).toBe(true);
    expect(isCharacterSavingThrowProficient(profs, "CON", "rogue")).toBe(false);
  });
});
