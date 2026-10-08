/**
 * tests/architecture/canonical-languages-proficiencies-contract.test.ts
 *
 * Contrato de arquitectura y seguridad para el modelo canónico de Idiomas y Competencias.
 * Verifica integridad del esquema Prisma, aislamiento de ruleset, cobertura del catálogo SRD
 * y políticas de RLS explícitas.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SRD_2014_PROFICIENCIES,
  SRD_2014_LANGUAGES,
} from "@/lib/rules/canonical/seed-data";
import {
  CANONICAL_ARMOR_PROFICIENCY_CODES,
  CANONICAL_WEAPON_PROFICIENCY_CODES,
  CANONICAL_SAVING_THROW_CODES,
} from "@/lib/rules/canonical/constants";

const ROOT = join(__dirname, "..", "..");
const SCHEMA = readFileSync(join(ROOT, "prisma", "schema.prisma"), "utf8");
const MIGRATION = readFileSync(
  join(
    ROOT,
    "prisma",
    "migrations",
    "20261007140000_add_languages_and_generic_proficiencies",
    "migration.sql"
  ),
  "utf8"
);

describe("Contrato de esquema: Idiomas y Competencias Canónicas", () => {
  it("declara los modelos canónicos en schema.prisma", () => {
    expect(SCHEMA).toContain("model CanonicalProficiency");
    expect(SCHEMA).toContain("model CharacterLanguage");
    expect(SCHEMA).toContain("model CharacterProficiency");
    expect(SCHEMA).toContain("enum ProficiencyType");
  });

  it("CanonicalProficiency define clave primaria compuesta rulesetId_type_code", () => {
    expect(SCHEMA).toMatch(/@@id\(\[rulesetId,\s*type,\s*code\]\)/);
  });

  it("CharacterLanguage define restricción única [characterId, languageCode]", () => {
    expect(SCHEMA).toMatch(/@@unique\(\[characterId,\s*languageCode\]\)/);
  });

  it("CharacterProficiency define restricción única [characterId, type, code]", () => {
    expect(SCHEMA).toMatch(/@@unique\(\[characterId,\s*type,\s*code\]\)/);
  });

  it("Character mantiene relaciones aditivas sin romper compatibilidad", () => {
    expect(SCHEMA).toMatch(/languages\s+CharacterLanguage\[\]/);
    expect(SCHEMA).toMatch(/proficiencies\s+CharacterProficiency\[\]/);
  });
});

describe("Contrato de catálogo: SRD 2014 Proficiencies & Languages", () => {
  it("contiene exactamente las 4 categorías de armadura del SRD 5.1", () => {
    const armors = SRD_2014_PROFICIENCIES.filter((p) => p.type === "ARMOR");
    expect(armors).toHaveLength(4);
    const codes = armors.map((a) => a.code).sort();
    expect(codes).toEqual([...CANONICAL_ARMOR_PROFICIENCY_CODES].sort());
  });

  it("contiene exactamente las 2 categorías de armas del SRD 5.1", () => {
    const weapons = SRD_2014_PROFICIENCIES.filter((p) => p.type === "WEAPON");
    expect(weapons).toHaveLength(2);
    const codes = weapons.map((w) => w.code).sort();
    expect(codes).toEqual([...CANONICAL_WEAPON_PROFICIENCY_CODES].sort());
  });

  it("contiene exactamente las 6 tiradas de salvación del SRD 5.1", () => {
    const saves = SRD_2014_PROFICIENCIES.filter((p) => p.type === "SAVING_THROW");
    expect(saves).toHaveLength(6);
    const codes = saves.map((s) => s.code).sort();
    expect(codes).toEqual([...CANONICAL_SAVING_THROW_CODES].sort());
  });

  it("contiene las 16 lenguas oficiales (8 estándar + 8 exóticas)", () => {
    expect(SRD_2014_LANGUAGES).toHaveLength(16);
    const standard = SRD_2014_LANGUAGES.filter((l) => l.type === "STANDARD");
    const exotic = SRD_2014_LANGUAGES.filter((l) => l.type === "EXOTIC");
    expect(standard).toHaveLength(8);
    expect(exotic).toHaveLength(8);
  });
});

describe("Contrato de seguridad y RLS de migración", () => {
  it("la migración activa ROW LEVEL SECURITY explícito en todas las tablas creadas", () => {
    expect(MIGRATION).toMatch(/ALTER TABLE\s+(?:"?public"?\s*\.\s*)?"CanonicalProficiency"\s+ENABLE ROW LEVEL SECURITY;/);
    expect(MIGRATION).toMatch(/ALTER TABLE\s+(?:"?public"?\s*\.\s*)?"CharacterLanguage"\s+ENABLE ROW LEVEL SECURITY;/);
    expect(MIGRATION).toMatch(/ALTER TABLE\s+(?:"?public"?\s*\.\s*)?"CharacterProficiency"\s+ENABLE ROW LEVEL SECURITY;/);
  });

  it("la migración incluye bloques seguros DO $$ y cláusulas IF NOT EXISTS", () => {
    expect(MIGRATION).toContain("DO $$");
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS\s+(?:"?public"?\s*\.\s*)?"CanonicalProficiency"/);
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS\s+(?:"?public"?\s*\.\s*)?"CharacterLanguage"/);
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS\s+(?:"?public"?\s*\.\s*)?"CharacterProficiency"/);
  });
});
