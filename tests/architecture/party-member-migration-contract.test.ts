/**
 * Contrato estático de 20260917130000_add_party_members (DC-PARTY-001).
 *
 * No necesita PostgreSQL: parsea el SQL igual que migration-schema-drift.test.ts
 * y rls-deny-by-default.test.ts. Las garantías que sí requieren un motor real
 * (el unique constraint dispara, el partial index dispara, el backfill es
 * idempotente) viven en tests/e2e/party-foundation-real-db.spec.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const MIGRATION_DIR = "20260917130000_add_party_members";
const MIGRATION_PATH = join(ROOT, "prisma", "migrations", MIGRATION_DIR, "migration.sql");

/** SQL sin comentarios de línea: lo único que el motor llega a ejecutar. */
function executable(sql: string): string {
  return sql
    .split(/\r?\n/)
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");
}

describe("migración 20260917130000_add_party_members", () => {
  it("existe", () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });

  const sql = existsSync(MIGRATION_PATH) ? readFileSync(MIGRATION_PATH, "utf8") : "";
  const code = executable(sql);

  it("crea PartyMember con un CREATE TABLE literal, no dentro de un DO/EXECUTE dinámico", () => {
    // migration-schema-drift.test.ts exige exactamente esta forma para poder
    // parsear las columnas.
    expect(code).toMatch(/CREATE TABLE "PartyMember" \(\n[\s\S]*?\n\);/);
  });

  it("declara las columnas que schema.prisma espera", () => {
    for (const column of ["id", "campaignId", "characterId", "role", "control", "createdAt", "updatedAt"]) {
      expect(code).toMatch(new RegExp(`^\\s{2,}"${column}"\\s+`, "m"));
    }
  });

  it("nunca toca la DDL de Campaign — Campaign.characterId permanece intacto (invariante 2)", () => {
    expect(code).not.toMatch(/ALTER TABLE\s+(?:"?public"?\s*\.\s*)?"Campaign"/);
    expect(code).not.toContain('CREATE TABLE "Campaign"');
  });

  it("invariante 4 — un Character no puede repetirse en la misma Party", () => {
    expect(code).toMatch(
      /CREATE UNIQUE INDEX "PartyMember_campaignId_characterId_key"\s*\n?\s*ON "PartyMember"\("campaignId",\s*"characterId"\)/
    );
  });

  it("como mucho un MAIN por campaña, vía índice único parcial (mismo patrón que Encounter_one_active_per_campaign_key)", () => {
    expect(code).toMatch(
      /CREATE UNIQUE INDEX "PartyMember_one_main_per_campaign_key"[\s\S]*?ON "PartyMember"\("campaignId"\)[\s\S]*?WHERE "role" = 'MAIN'/
    );
  });

  it("ambas FK usan ON DELETE RESTRICT ON UPDATE CASCADE — el default universal de este repo hacia Campaign/Character", () => {
    for (const column of ["campaignId", "characterId"]) {
      const fk = new RegExp(
        `ADD CONSTRAINT "PartyMember_${column}_fkey"[\\s\\S]*?FOREIGN KEY \\("${column}"\\)[\\s\\S]*?ON DELETE RESTRICT ON UPDATE CASCADE`
      );
      expect(code).toMatch(fk);
    }
  });

  it("activa RLS explícitamente (tests/architecture/rls-deny-by-default.test.ts lo exige)", () => {
    expect(code).toMatch(/ALTER TABLE "public"\."PartyMember" ENABLE ROW LEVEL SECURITY;/);
  });

  it("el backfill es un INSERT...SELECT idempotente sobre Campaign, con ON CONFLICT DO NOTHING", () => {
    expect(code).toMatch(/INSERT INTO "PartyMember"/);
    expect(code).toMatch(/FROM "Campaign"/);
    expect(code).toMatch(/ON CONFLICT \("campaignId",\s*"characterId"\)\s*DO NOTHING/);
  });

  it("el backfill asigna role=MAIN y control=USER a partir de Campaign.characterId", () => {
    expect(code).toMatch(/"Campaign"\."characterId"/);
    expect(code).toMatch(/'MAIN'/);
    expect(code).toMatch(/'USER'/);
  });

  it("no repara datos preexistentes de ninguna otra tabla", () => {
    // UPDATE/DELETE como palabra suelta da falso positivo: las dos FK usan
    // "ON UPDATE CASCADE" / "ON DELETE RESTRICT", que son cláusulas de DDL,
    // no las sentencias DML que esta prueba busca excluir. Se exige el resto
    // de la sintaxis real de la sentencia (UPDATE "Tabla" / DELETE FROM).
    expect(code.toUpperCase()).not.toMatch(/\bUPDATE\s+"/);
    expect(code.toUpperCase()).not.toMatch(/\bDELETE\s+FROM\b/);
    expect(code.toUpperCase()).not.toMatch(/\bTRUNCATE\b/);
  });
});
