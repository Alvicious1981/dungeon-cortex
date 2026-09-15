import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const SCHEMA = read("prisma", "schema.prisma");
const MIGRATION = read("prisma", "migrations", "20260916120000_add_death_save_state", "migration.sql");
const CONTEXT = read("lib", "memory", "context.ts");

describe("death-save schema (spec §8.1)", () => {
  it("declares both columns nullable with no default", () => {
    expect(SCHEMA).toMatch(/\n\s+stableWakeRound\s+Int\?\s*\r?\n/);
    expect(SCHEMA).toMatch(/\n\s+diedAt\s+DateTime\?\s*\r?\n/);
  });

  it("adds the columns idempotently and pins the ranges", () => {
    expect(MIGRATION).toContain('ADD COLUMN IF NOT EXISTS "stableWakeRound" INTEGER');
    expect(MIGRATION).toContain('ADD COLUMN IF NOT EXISTS "diedAt" TIMESTAMP(3)');
    expect(MIGRATION).toContain('CHECK ("deathSaveSuccesses" BETWEEN 0 AND 3)');
    expect(MIGRATION).toContain('CHECK ("deathSaveFailures" BETWEEN 0 AND 3)');
    expect(MIGRATION).toContain('CHECK ("stableWakeRound" IS NULL OR "stableWakeRound" >= 1)');
    expect(MIGRATION).not.toMatch(/\bDEFAULT\b/);
  });

  it("selects the death-save fields into the campaign context", () => {
    for (const field of ["deathSaveSuccesses", "deathSaveFailures", "stableWakeRound"]) {
      expect(CONTEXT).toContain(`${field}: true`);
    }
  });
});
