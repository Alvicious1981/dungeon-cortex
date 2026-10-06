/**
 * tests/architecture/canonical-magic-contract.test.ts
 *
 * Contrato de arquitectura y seguridad para el modelo canónico de Espacios de Conjuro
 * y Conjuros del Personaje (Fase 7).
 * Verifica integridad del esquema Prisma, aislamiento de ruleset, compatibilidad
 * con el campo JSON legacy `Character.spellSlots` y políticas de RLS explícitas.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const SCHEMA = readFileSync(join(ROOT, "prisma", "schema.prisma"), "utf8");
const MIGRATION = readFileSync(
  join(
    ROOT,
    "prisma",
    "migrations",
    "20261007180000_add_spell_slots_and_character_spells",
    "migration.sql"
  ),
  "utf8"
);

describe("Contrato de esquema: Espacios de Conjuro y Conjuros Canónicos", () => {
  it("declara los modelos CharacterSpellSlot y CharacterSpell en schema.prisma", () => {
    expect(SCHEMA).toContain("model CharacterSpellSlot");
    expect(SCHEMA).toContain("model CharacterSpell");
  });

  it("CharacterSpellSlot define clave única [characterId, spellLevel]", () => {
    expect(SCHEMA).toMatch(/model CharacterSpellSlot[\s\S]*?@@unique\(\[characterId,\s*spellLevel\]\)/);
  });

  it("CharacterSpell define clave única [characterId, spellSlug]", () => {
    expect(SCHEMA).toMatch(/model CharacterSpell[\s\S]*?@@unique\(\[characterId,\s*spellSlug\]\)/);
  });

  it("Character conserva spellSlots Json? y concentrationSpellId sin romper compatibilidad", () => {
    expect(SCHEMA).toMatch(/spellSlots\s+Json\?/);
    expect(SCHEMA).toMatch(/concentrationSpellId\s+String\?/);
  });

  it("Character expone relaciones relacionales spellSlotRecords y spells", () => {
    expect(SCHEMA).toMatch(/spellSlotRecords\s+CharacterSpellSlot\[\]/);
    expect(SCHEMA).toMatch(/spells\s+CharacterSpell\[\]/);
  });

  it("Ruleset expone relaciones relacionales characterSpellSlots y characterSpells", () => {
    expect(SCHEMA).toMatch(/characterSpellSlots\s+CharacterSpellSlot\[\]/);
    expect(SCHEMA).toMatch(/characterSpells\s+CharacterSpell\[\]/);
  });
});

describe("Contrato de migración y seguridad: 20261007180000_add_spell_slots_and_character_spells", () => {
  it("es aditiva y contiene CREATE TABLE IF NOT EXISTS para ambas tablas", () => {
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS "CharacterSpellSlot"');
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS "CharacterSpell"');
  });

  it("habilita ROW LEVEL SECURITY explícitamente en todas las nuevas tablas", () => {
    expect(MIGRATION).toContain('ALTER TABLE "CharacterSpellSlot" ENABLE ROW LEVEL SECURITY;');
    expect(MIGRATION).toContain('ALTER TABLE "CharacterSpell" ENABLE ROW LEVEL SECURITY;');
  });

  it("usa bloque DO $$ para claves foráneas idempotentes", () => {
    expect(MIGRATION).toMatch(/DO\s+\$\$/);
    expect(MIGRATION).toContain("CharacterSpellSlot_characterId_fkey");
    expect(MIGRATION).toContain("CharacterSpellSlot_rulesetId_fkey");
    expect(MIGRATION).toContain("CharacterSpell_characterId_fkey");
    expect(MIGRATION).toContain("CharacterSpell_rulesetId_fkey");
  });
});
