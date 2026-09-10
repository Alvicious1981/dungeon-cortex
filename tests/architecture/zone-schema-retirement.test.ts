import { Prisma } from "@prisma/client";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "prisma/migrations/20260910180000_retire_legacy_combat_zones/migration.sql",
  "utf8",
);

const models = new Map(
  Prisma.dmmf.datamodel.models.map((model) => [model.name, model]),
);

function fieldNames(modelName: string): string[] {
  const model = models.get(modelName);
  expect(model, `${modelName} must remain in the Prisma contract`).toBeDefined();
  return model?.fields.map((field) => field.name) ?? [];
}

describe("legacy Zone schema retirement", () => {
  it("removes the orphaned Zone model and Encounter relation", () => {
    expect(models.has("Zone")).toBe(false);
    expect(fieldNames("Encounter")).not.toContain("zones");
  });

  it("removes Combatant zone state while retaining authoritative coordinates", () => {
    const fields = fieldNames("Combatant");

    expect(fields).not.toContain("zoneId");
    expect(fields).not.toContain("zone");
    expect(fields).toEqual(expect.arrayContaining(["x", "y"]));
  });

  it("guards legacy data before dropping the retired schema atomically", () => {
    expect(migration).toContain("DO $retire_legacy_combat_zones$");
    expect(migration).toContain("Unexpected legacy Zone data");
    expect(migration).toContain("Unexpected legacy Zone layout");
    expect(migration).toContain("Orphaned Combatant.zoneId relation");
    expect(migration).toContain("Cross-encounter Combatant.zoneId relation");

    const zoneLock = migration.indexOf(
      `EXECUTE 'LOCK TABLE "Zone" IN ACCESS EXCLUSIVE MODE'`,
    );
    const combatantLock = migration.indexOf(
      `EXECUTE 'LOCK TABLE "Combatant" IN ACCESS EXCLUSIVE MODE'`,
    );
    const firstZoneGuardRead = migration.indexOf('FROM "Zone"');
    const firstRefusal = migration.indexOf("RAISE EXCEPTION");
    const firstDrop = migration.indexOf("DROP INDEX IF EXISTS");
    expect(zoneLock).toBeGreaterThan(-1);
    expect(combatantLock).toBeGreaterThan(zoneLock);
    expect(firstZoneGuardRead).toBeGreaterThan(combatantLock);
    expect(firstRefusal).toBeGreaterThan(combatantLock);
    expect(firstRefusal).toBeGreaterThan(-1);
    expect(firstDrop).toBeGreaterThan(firstRefusal);
    expect(migration).not.toContain("DROP TABLE IF EXISTS \"Zone\" CASCADE");
  });
});
