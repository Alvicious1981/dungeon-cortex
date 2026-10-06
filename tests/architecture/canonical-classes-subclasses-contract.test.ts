/**
 * tests/architecture/canonical-classes-subclasses-contract.test.ts
 *
 * Contrato de arquitectura y seguridad para el modelo canónico de Clases y Subclases.
 * Verifica integridad del esquema Prisma, aislamiento de ruleset, catálogo SRD 5.1 completo
 * y políticas de RLS explícitas.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SRD_2014_CLASSES,
  SRD_2014_SUBCLASSES,
} from "@/lib/rules/canonical/seed-data";
import {
  CANONICAL_CLASS_CODES,
  CANONICAL_SUBCLASS_CODES,
} from "@/lib/rules/canonical/constants";

const ROOT = join(__dirname, "..", "..");
const SCHEMA = readFileSync(join(ROOT, "prisma", "schema.prisma"), "utf8");
const MIGRATION = readFileSync(
  join(
    ROOT,
    "prisma",
    "migrations",
    "20261007150000_add_canonical_classes_and_subclasses",
    "migration.sql"
  ),
  "utf8"
);

describe("Contrato de esquema: Clases y Subclases Canónicas", () => {
  it("declara los modelos canónicos en schema.prisma", () => {
    expect(SCHEMA).toContain("model CanonicalClass");
    expect(SCHEMA).toContain("model CanonicalSubclass");
    expect(SCHEMA).toContain("model CharacterClassLevel");
  });

  it("CanonicalClass define clave primaria compuesta rulesetId_code", () => {
    expect(SCHEMA).toMatch(/@@id\(\[rulesetId,\s*code\]\)/);
  });

  it("CanonicalSubclass define clave primaria compuesta rulesetId_classCode_code", () => {
    expect(SCHEMA).toMatch(/@@id\(\[rulesetId,\s*classCode,\s*code\]\)/);
  });

  it("CharacterClassLevel define restricción única [characterId, classCode]", () => {
    expect(SCHEMA).toMatch(/@@unique\(\[characterId,\s*classCode\]\)/);
  });

  it("Character mantiene relación classLevels sin romper compatibilidad", () => {
    expect(SCHEMA).toMatch(/classLevels\s+CharacterClassLevel\[\]/);
  });

  it("Ruleset mantiene relación classes sin romper compatibilidad", () => {
    expect(SCHEMA).toMatch(/classes\s+CanonicalClass\[\]/);
  });
});

describe("Contrato de catálogo: SRD 2014 Classes & Subclasses", () => {
  it("contiene exactamente las 12 clases oficiales del SRD 5.1", () => {
    expect(SRD_2014_CLASSES).toHaveLength(12);
    const codes = SRD_2014_CLASSES.map((c) => c.code).sort();
    expect(codes).toEqual([...CANONICAL_CLASS_CODES].sort());
  });

  it("todas las clases tienen dados de golpe oficiales (6, 8, 10 o 12)", () => {
    const validDice = new Set([6, 8, 10, 12]);
    for (const cls of SRD_2014_CLASSES) {
      expect(validDice.has(cls.hitDie)).toBe(true);
    }
  });

  it("contiene exactamente las 12 subclases canónicas del SRD 5.1 (una por clase)", () => {
    expect(SRD_2014_SUBCLASSES).toHaveLength(12);
    const codes = SRD_2014_SUBCLASSES.map((s) => s.code).sort();
    expect(codes).toEqual([...CANONICAL_SUBCLASS_CODES].sort());

    // Cada clase tiene exactamente 1 subclase en el SRD
    const classCodesWithSubclass = new Set(SRD_2014_SUBCLASSES.map((s) => s.classCode));
    expect(classCodesWithSubclass.size).toBe(12);
  });
});

describe("Contrato de seguridad y RLS de migración", () => {
  it("la migración activa ROW LEVEL SECURITY explícito en las 3 nuevas tablas", () => {
    expect(MIGRATION).toMatch(/ALTER TABLE\s+(?:"?public"?\s*\.\s*)?"CanonicalClass"\s+ENABLE ROW LEVEL SECURITY;/);
    expect(MIGRATION).toMatch(/ALTER TABLE\s+(?:"?public"?\s*\.\s*)?"CanonicalSubclass"\s+ENABLE ROW LEVEL SECURITY;/);
    expect(MIGRATION).toMatch(/ALTER TABLE\s+(?:"?public"?\s*\.\s*)?"CharacterClassLevel"\s+ENABLE ROW LEVEL SECURITY;/);
  });

  it("la migración incluye cláusulas IF NOT EXISTS en CREATE TABLE", () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS\s+(?:"?public"?\s*\.\s*)?"CanonicalClass"/);
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS\s+(?:"?public"?\s*\.\s*)?"CanonicalSubclass"/);
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS\s+(?:"?public"?\s*\.\s*)?"CharacterClassLevel"/);
  });
});
