/**
 * Contrato estático de 20260917140000_add_combatant_character_link (DC-PARTY-002).
 *
 * No necesita PostgreSQL: parsea el SQL igual que
 * party-member-migration-contract.test.ts. Las garantías que sí requieren un
 * motor real (el backfill es correcto, el constraint dispara) viven en
 * tests/e2e/combatant-character-identity-real-db.spec.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const MIGRATION_DIR = "20260917140000_add_combatant_character_link";
const MIGRATION_PATH = join(ROOT, "prisma", "migrations", MIGRATION_DIR, "migration.sql");
const SCHEMA_PATH = join(ROOT, "prisma", "schema.prisma");

function executable(sql: string): string {
  return sql
    .split(/\r?\n/)
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");
}

describe("migración 20260917140000_add_combatant_character_link", () => {
  it("existe", () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });

  const sql = existsSync(MIGRATION_PATH) ? readFileSync(MIGRATION_PATH, "utf8") : "";
  const code = executable(sql);

  it("añade characterId como columna nullable, sin default", () => {
    expect(code).toMatch(/ADD COLUMN(?:\s+IF NOT EXISTS)?\s+"characterId"\s+TEXT\s*;/);
    expect(code).not.toMatch(/"characterId"[^;]*DEFAULT/);
    // Ningún NOT NULL de columna (en el ADD COLUMN ni en un SET NOT NULL
    // posterior). El predicado `"characterId" IS NOT NULL` del CHECK
    // Combatant_player_has_character_id no lo es: solo obliga a las filas
    // isPlayer, y las de enemigos siguen en NULL.
    expect(code).not.toMatch(/"characterId"[^;]*(?<!IS\s)NOT NULL/);
  });

  it("declara Combatant_characterId_fkey con ON DELETE RESTRICT ON UPDATE CASCADE", () => {
    // Must match the schema's explicit onDelete/onUpdate on Combatant.character
    // (Prisma's implicit default for an optional relation is SetNull, which
    // would silently defeat this constraint on a future `migrate dev`/`db pull`).
    expect(code).toMatch(
      /ADD CONSTRAINT "Combatant_characterId_fkey"[\s\S]*?ON DELETE RESTRICT ON UPDATE CASCADE/
    );
  });

  it("nunca toca la DDL de Campaign, Encounter o Character", () => {
    for (const table of ["Campaign", "Encounter", "Character"]) {
      expect(code).not.toMatch(new RegExp(`ALTER TABLE\\s+(?:"?public"?\\s*\\.\\s*)?"${table}"`));
      expect(code).not.toContain(`CREATE TABLE "${table}"`);
    }
  });

  it("hace backfill desde Encounter -> Campaign -> characterId, solo para filas isPlayer sin characterId", () => {
    expect(code).toMatch(/UPDATE\s+"Combatant"/);
    expect(code).toMatch(/FROM\s+"Encounter"/);
    expect(code).toMatch(/JOIN\s+"Campaign"/);
    expect(code).toMatch(/"isPlayer"\s*=\s*true/);
    expect(code).toMatch(/"characterId"\s+IS\s+NULL/);
  });

  it("exige characterId en toda fila isPlayer con el CHECK Combatant_player_has_character_id", () => {
    // Sin él, mirrorPlayerCombatantHp y applyPlayerDowned (que no comprueban
    // el count de su updateMany) escribirían cero filas en silencio para un
    // jugador sin characterId.
    expect(code).toMatch(
      /ALTER TABLE "Combatant"\s+ADD CONSTRAINT "Combatant_player_has_character_id"\s+CHECK \(NOT "isPlayer" OR "characterId" IS NOT NULL\);/
    );
  });

  it("añade ese CHECK DESPUÉS del backfill, nunca antes", () => {
    // Postgres valida un CHECK nuevo contra todas las filas existentes: antes
    // del backfill, las filas isPlayer previas aún tienen characterId NULL y
    // la migración entera fallaría.
    const backfill = code.search(/UPDATE\s+"Combatant"/);
    const check = code.search(/ADD CONSTRAINT "Combatant_player_has_character_id"/);
    expect(backfill).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(backfill);
  });

  it("añade Combatant_one_player_per_encounter_key como índice único parcial, con guarda previa", () => {
    expect(code).toMatch(/DO \$\w+\$/);
    expect(code).toMatch(/RAISE EXCEPTION/);
    // Optional space before the paren: 20260912220000_enforce_single_active_encounter's
    // Encounter_one_active_per_campaign_key (this migration's cited precedent) writes
    // `ON "Encounter" ("campaignId")` with a space, while 20260917130000_add_party_members'
    // PartyMember_one_main_per_campaign_key omits it — Postgres accepts both identically, and
    // this migration follows the spaced precedent, so the assertion must tolerate either.
    expect(code).toMatch(
      /CREATE UNIQUE INDEX "Combatant_one_player_per_encounter_key"[\s\S]*?ON "Combatant"\s*\("encounterId"\)[\s\S]*?WHERE "isPlayer" = true/
    );
  });

  it("crea Combatant_encounterId_characterId_key, el @@unique([encounterId, characterId]) del schema", () => {
    // El par por el que filtran las tres escrituras del jugador es único por
    // declaración. El nombre es el que Prisma deriva de ese @@unique; índice
    // completo, sin WHERE: los NULL de los enemigos son distintos entre sí.
    const combatantModel = readFileSync(SCHEMA_PATH, "utf8").match(/^model Combatant \{[\s\S]*?^\}/m)?.[0];
    expect(combatantModel).toMatch(/^\s*@@unique\(\[encounterId, characterId\]\)\s*$/m);
    expect(code).toMatch(
      /CREATE UNIQUE INDEX "Combatant_encounterId_characterId_key"\s+ON "Combatant"\("encounterId", "characterId"\);/
    );
  });

  it("crea ese índice después de la guarda de un solo jugador", () => {
    // El backfill copia el mismo characterId a todas las filas isPlayer de un
    // encuentro: si hubiera duplicadas, también chocarían aquí. La guarda
    // debe informar primero, con su propio mensaje.
    const guard = code.search(/DO \$combatant_one_player_per_encounter\$/);
    const index = code.search(/CREATE UNIQUE INDEX "Combatant_encounterId_characterId_key"/);
    expect(guard).toBeGreaterThan(-1);
    expect(index).toBeGreaterThan(guard);
  });

  it("no repara datos preexistentes de ninguna otra tabla", () => {
    const withoutCombatantUpdate = code.replace(/UPDATE\s+"Combatant"[\s\S]*?;/, "");
    expect(withoutCombatantUpdate.toUpperCase()).not.toMatch(/\bUPDATE\s+"/);
    expect(withoutCombatantUpdate.toUpperCase()).not.toMatch(/\bDELETE\s+FROM\b/);
    expect(withoutCombatantUpdate.toUpperCase()).not.toMatch(/\bTRUNCATE\b/);
  });
});
