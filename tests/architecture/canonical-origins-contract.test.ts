/**
 * tests/architecture/canonical-origins-contract.test.ts
 *
 * Contrato de arquitectura y seguridad para el modelo canónico de Razas/Especies,
 * Rasgos raciales, Trasfondos y Orígenes de Personajes.
 * Verifica integridad del esquema Prisma, aislamiento de ruleset, catálogo SRD 5.1 completo
 * y políticas de RLS explícitas.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SRD_2014_RACES,
  SRD_2014_TRAITS,
  SRD_2014_RACE_TRAITS,
  SRD_2014_BACKGROUNDS,
} from "@/lib/rules/canonical/seed-data";
import {
  CANONICAL_RACE_CODES,
  CANONICAL_BACKGROUND_CODES,
} from "@/lib/rules/canonical/constants";

const ROOT = join(__dirname, "..", "..");
const SCHEMA = readFileSync(join(ROOT, "prisma", "schema.prisma"), "utf8");
const MIGRATION = readFileSync(
  join(
    ROOT,
    "prisma",
    "migrations",
    "20261007160000_add_species_traits_and_origins",
    "migration.sql"
  ),
  "utf8"
);

describe("Contrato de esquema: Especies, Rasgos y Orígenes Canónicos", () => {
  it("declara los 5 modelos canónicos en schema.prisma", () => {
    expect(SCHEMA).toContain("model CanonicalRace");
    expect(SCHEMA).toContain("model CanonicalTrait");
    expect(SCHEMA).toContain("model CanonicalRaceTrait");
    expect(SCHEMA).toContain("model CanonicalBackground");
    expect(SCHEMA).toContain("model CharacterOrigin");
  });

  it("CanonicalRace define clave primaria compuesta rulesetId_code", () => {
    expect(SCHEMA).toMatch(/model CanonicalRace[\s\S]*?@@id\(\[rulesetId,\s*code\]\)/);
  });

  it("CanonicalTrait define clave primaria compuesta rulesetId_code", () => {
    expect(SCHEMA).toMatch(/model CanonicalTrait[\s\S]*?@@id\(\[rulesetId,\s*code\]\)/);
  });

  it("CanonicalRaceTrait define clave primaria compuesta rulesetId_raceCode_traitCode", () => {
    expect(SCHEMA).toMatch(/model CanonicalRaceTrait[\s\S]*?@@id\(\[rulesetId,\s*raceCode,\s*traitCode\]\)/);
  });

  it("CanonicalBackground define clave primaria compuesta rulesetId_code", () => {
    expect(SCHEMA).toMatch(/model CanonicalBackground[\s\S]*?@@id\(\[rulesetId,\s*code\]\)/);
  });

  it("CharacterOrigin define unicidad 1:1 con Character (characterId @unique)", () => {
    expect(SCHEMA).toMatch(/model CharacterOrigin[\s\S]*?characterId\s+String\s+@unique/);
  });

  it("Character mantiene relación origin sin romper compatibilidad", () => {
    expect(SCHEMA).toMatch(/origin\s+CharacterOrigin\?/);
  });

  it("Ruleset mantiene relaciones races, traits, backgrounds", () => {
    expect(SCHEMA).toMatch(/races\s+CanonicalRace\[\]/);
    expect(SCHEMA).toMatch(/traits\s+CanonicalTrait\[\]/);
    expect(SCHEMA).toMatch(/backgrounds\s+CanonicalBackground\[\]/);
  });
});

describe("Contrato de catálogo: SRD 2014 Races, Traits & Backgrounds", () => {
  it("contiene exactamente las 9 razas oficiales del SRD 5.1", () => {
    expect(SRD_2014_RACES).toHaveLength(9);
    const codes = SRD_2014_RACES.map((r) => r.code).sort();
    expect(codes).toEqual([...CANONICAL_RACE_CODES].sort());
  });

  it("todas las razas tienen velocidades canónicas (25 o 30 pies)", () => {
    const validSpeeds = new Set([25, 30]);
    for (const r of SRD_2014_RACES) {
      expect(validSpeeds.has(r.speed)).toBe(true);
    }
  });

  it("todos los rasgos en SRD_2014_RACE_TRAITS pertenecen a razas y rasgos válidos", () => {
    const raceCodes = new Set(SRD_2014_RACES.map((r) => r.code));
    const traitCodes = new Set(SRD_2014_TRAITS.map((t) => t.code));

    for (const rt of SRD_2014_RACE_TRAITS) {
      expect(raceCodes.has(rt.raceCode)).toBe(true);
      expect(traitCodes.has(rt.traitCode)).toBe(true);
    }
  });

  it("contiene los trasfondos oficiales del SRD 5.1", () => {
    expect(SRD_2014_BACKGROUNDS.length).toBeGreaterThanOrEqual(1);
    const codes = SRD_2014_BACKGROUNDS.map((b) => b.code);
    for (const c of CANONICAL_BACKGROUND_CODES) {
      expect(codes).toContain(c);
    }
  });
});

describe("Contrato de migración y seguridad: 20261007160000_add_species_traits_and_origins", () => {
  it("es aditiva y contiene CREATE TABLE IF NOT EXISTS para las 5 tablas", () => {
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS "CanonicalRace"');
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS "CanonicalTrait"');
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS "CanonicalRaceTrait"');
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS "CanonicalBackground"');
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS "CharacterOrigin"');
  });

  it("habilita ROW LEVEL SECURITY explícitamente en todas las nuevas tablas", () => {
    expect(MIGRATION).toContain('ALTER TABLE "CanonicalRace" ENABLE ROW LEVEL SECURITY;');
    expect(MIGRATION).toContain('ALTER TABLE "CanonicalTrait" ENABLE ROW LEVEL SECURITY;');
    expect(MIGRATION).toContain('ALTER TABLE "CanonicalRaceTrait" ENABLE ROW LEVEL SECURITY;');
    expect(MIGRATION).toContain('ALTER TABLE "CanonicalBackground" ENABLE ROW LEVEL SECURITY;');
    expect(MIGRATION).toContain('ALTER TABLE "CharacterOrigin" ENABLE ROW LEVEL SECURITY;');
  });

  it("usa bloque DO $$ para claves foráneas idempotentes", () => {
    expect(MIGRATION).toMatch(/DO\s+\$\$/);
    expect(MIGRATION).toContain("CanonicalRace_rulesetId_fkey");
    expect(MIGRATION).toContain("CanonicalTrait_rulesetId_fkey");
    expect(MIGRATION).toContain("CanonicalRaceTrait_rulesetId_raceCode_fkey");
    expect(MIGRATION).toContain("CanonicalBackground_rulesetId_fkey");
    expect(MIGRATION).toContain("CharacterOrigin_characterId_fkey");
  });
});
