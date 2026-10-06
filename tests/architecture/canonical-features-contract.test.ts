/**
 * tests/architecture/canonical-features-contract.test.ts
 *
 * Contrato de arquitectura y seguridad para el modelo canónico de Características de Clase
 * (Features), Dotes (Feats) y Adquisiciones del Personaje.
 * Verifica integridad del esquema Prisma, aislamiento de ruleset, catálogo SRD 5.1 completo
 * y políticas de RLS explícitas.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SRD_2014_FEATURES,
  SRD_2014_FEATS,
} from "@/lib/rules/canonical/seed-data";
import {
  CANONICAL_CLASS_CODES,
  CANONICAL_FEATURE_CODES,
  CANONICAL_FEAT_CODES,
} from "@/lib/rules/canonical/constants";

const ROOT = join(__dirname, "..", "..");
const SCHEMA = readFileSync(join(ROOT, "prisma", "schema.prisma"), "utf8");
const MIGRATION = readFileSync(
  join(
    ROOT,
    "prisma",
    "migrations",
    "20261007170000_add_features_feats_and_choices",
    "migration.sql"
  ),
  "utf8"
);

describe("Contrato de esquema: Características y Dotes Canónicas", () => {
  it("declara los 4 modelos y el enum FeatureType en schema.prisma", () => {
    expect(SCHEMA).toContain("enum FeatureType");
    expect(SCHEMA).toContain("model CanonicalFeature");
    expect(SCHEMA).toContain("model CanonicalFeat");
    expect(SCHEMA).toContain("model CharacterFeature");
    expect(SCHEMA).toContain("model CharacterFeat");
  });

  it("CanonicalFeature define clave primaria compuesta rulesetId_code", () => {
    expect(SCHEMA).toMatch(/model CanonicalFeature[\s\S]*?@@id\(\[rulesetId,\s*code\]\)/);
  });

  it("CanonicalFeat define clave primaria compuesta rulesetId_code", () => {
    expect(SCHEMA).toMatch(/model CanonicalFeat[\s\S]*?@@id\(\[rulesetId,\s*code\]\)/);
  });

  it("CharacterFeature define restricción única [characterId, featureCode]", () => {
    expect(SCHEMA).toMatch(/model CharacterFeature[\s\S]*?@@unique\(\[characterId,\s*featureCode\]\)/);
  });

  it("CharacterFeat define restricción única [characterId, featCode]", () => {
    expect(SCHEMA).toMatch(/model CharacterFeat[\s\S]*?@@unique\(\[characterId,\s*featCode\]\)/);
  });

  it("Character mantiene relaciones features y feats sin romper compatibilidad", () => {
    expect(SCHEMA).toMatch(/features\s+CharacterFeature\[\]/);
    expect(SCHEMA).toMatch(/feats\s+CharacterFeat\[\]/);
  });

  it("Ruleset mantiene relaciones features y feats", () => {
    expect(SCHEMA).toMatch(/features\s+CanonicalFeature\[\]/);
    expect(SCHEMA).toMatch(/feats\s+CanonicalFeat\[\]/);
  });

  it("CanonicalClass y CanonicalSubclass mantienen relación features", () => {
    expect(SCHEMA).toMatch(/model CanonicalClass[\s\S]*?features\s+CanonicalFeature\[\]/);
    expect(SCHEMA).toMatch(/model CanonicalSubclass[\s\S]*?features\s+CanonicalFeature\[\]/);
  });
});

describe("Contrato de catálogo: SRD 2014 Features & Feats", () => {
  it("todas las características en SRD_2014_FEATURES tienen un classCode válido del SRD", () => {
    const validClassCodes = new Set(CANONICAL_CLASS_CODES);
    for (const feat of SRD_2014_FEATURES) {
      if (feat.classCode) {
        expect(validClassCodes.has(feat.classCode)).toBe(true);
      }
    }
  });

  it("los códigos de características coinciden exactamente con CANONICAL_FEATURE_CODES", () => {
    const codes = SRD_2014_FEATURES.map((f) => f.code).sort();
    expect(codes).toEqual([...CANONICAL_FEATURE_CODES].sort());
  });

  it("los códigos de dotes coinciden con CANONICAL_FEAT_CODES", () => {
    const codes = SRD_2014_FEATS.map((f) => f.code).sort();
    expect(codes).toEqual([...CANONICAL_FEAT_CODES].sort());
  });
});

describe("Contrato de migración y seguridad: 20261007170000_add_features_feats_and_choices", () => {
  it("es aditiva y contiene CREATE TABLE IF NOT EXISTS para las 4 tablas", () => {
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS "CanonicalFeature"');
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS "CanonicalFeat"');
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS "CharacterFeature"');
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS "CharacterFeat"');
  });

  it("habilita ROW LEVEL SECURITY explícitamente en todas las nuevas tablas", () => {
    expect(MIGRATION).toContain('ALTER TABLE "CanonicalFeature" ENABLE ROW LEVEL SECURITY;');
    expect(MIGRATION).toContain('ALTER TABLE "CanonicalFeat" ENABLE ROW LEVEL SECURITY;');
    expect(MIGRATION).toContain('ALTER TABLE "CharacterFeature" ENABLE ROW LEVEL SECURITY;');
    expect(MIGRATION).toContain('ALTER TABLE "CharacterFeat" ENABLE ROW LEVEL SECURITY;');
  });

  it("usa bloque DO $$ para claves foráneas idempotentes", () => {
    expect(MIGRATION).toMatch(/DO\s+\$\$/);
    expect(MIGRATION).toContain("CanonicalFeature_rulesetId_fkey");
    expect(MIGRATION).toContain("CanonicalFeat_rulesetId_fkey");
    expect(MIGRATION).toContain("CharacterFeature_characterId_fkey");
    expect(MIGRATION).toContain("CharacterFeat_characterId_fkey");
  });
});
