import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const migrationPath = resolve(
  process.cwd(),
  "prisma/migrations/20260725180000_replace_zones_with_encounter_map/migration.sql"
)

const migration = readFileSync(migrationPath, "utf8")

describe("replace zones with encounter map migration", () => {
  it("fails before destructive cleanup when a combatant references a missing zone", () => {
    expect(migration).toContain('LEFT JOIN "Zone" z ON z."id" = c."zoneId"')
    expect(migration).toContain("RAISE EXCEPTION")
    expect(migration).toContain("references a missing Zone")
  })

  it("copies legacy zone coordinates before map sizing and zone removal", () => {
    const backfill = migration.indexOf('UPDATE "Combatant" c')
    const mapInsert = migration.indexOf('INSERT INTO "EncounterMap"')
    const dropZoneId = migration.indexOf('DROP COLUMN IF EXISTS "zoneId"')
    const dropZone = migration.indexOf('DROP TABLE "Zone"')

    expect(backfill).toBeGreaterThan(-1)
    expect(mapInsert).toBeGreaterThan(backfill)
    expect(dropZoneId).toBeGreaterThan(mapInsert)
    expect(dropZone).toBeGreaterThan(dropZoneId)
    expect(migration).toContain('"x" = z."x"')
    expect(migration).toContain('"y" = z."y"')
  })
})
