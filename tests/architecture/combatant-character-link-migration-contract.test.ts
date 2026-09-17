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
    expect(code).not.toMatch(/"characterId"[^;]*NOT NULL/);
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

  it("no repara datos preexistentes de ninguna otra tabla", () => {
    const withoutCombatantUpdate = code.replace(/UPDATE\s+"Combatant"[\s\S]*?;/, "");
    expect(withoutCombatantUpdate.toUpperCase()).not.toMatch(/\bUPDATE\s+"/);
    expect(withoutCombatantUpdate.toUpperCase()).not.toMatch(/\bDELETE\s+FROM\b/);
    expect(withoutCombatantUpdate.toUpperCase()).not.toMatch(/\bTRUNCATE\b/);
  });
});
