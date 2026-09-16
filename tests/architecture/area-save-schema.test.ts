import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const SCHEMA = read("prisma", "schema.prisma");
const MIGRATION = read(
  "prisma", "migrations", "20260917120000_add_combatant_breath_available", "migration.sql",
);

describe("breathAvailable schema (area-save-actions spec §5, §7)", () => {
  it("declares the column nullable with no default", () => {
    expect(SCHEMA).toMatch(/\n\s+breathAvailable\s+Boolean\?\s*\r?\n/);
  });

  it("adds the column idempotently, with no default and no backfill", () => {
    expect(MIGRATION).toContain('ADD COLUMN IF NOT EXISTS "breathAvailable" BOOLEAN');
    expect(MIGRATION).not.toMatch(/\bDEFAULT\b/);
    expect(MIGRATION).not.toMatch(/\bUPDATE\b/);
  });
});
