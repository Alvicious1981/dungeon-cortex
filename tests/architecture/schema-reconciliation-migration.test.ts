import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "prisma/migrations/20260805090000_reconcile_nonlegacy_schema_preserving_combat_state/migration.sql",
  "utf8",
);
const schema = readFileSync("prisma/schema.prisma", "utf8");
const campaignPage = readFileSync("app/campaign/[id]/page.tsx", "utf8");
const actionRoute = readFileSync("app/api/campaign/[id]/action/route.ts", "utf8");
const explorationTurnService = readFileSync("lib/rules/exploration-turn-service.ts", "utf8");
const wildernessService = readFileSync("lib/rules/wilderness-service.ts", "utf8");

const legacyModels = [
  "CampaignTime",
  "PartyInventory",
  "WildernessMap",
  "TravelState",
  "Haven",
  "Retainer",
] as const;

describe("non-legacy schema reconciliation migration", () => {
  it("is atomic, additive, and keeps remote combat state in the Prisma contract", () => {
    expect(migration).toMatch(/\bBEGIN;\s/);
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT|TYPE)\b/i);
    expect(migration).toContain('"deathSaveSuccesses" INTEGER NOT NULL DEFAULT 0');
    expect(migration).toContain('"deathSaveFailures" INTEGER NOT NULL DEFAULT 0');
    expect(migration).toContain('"actionBudget" JSONB');
    expect(migration).toContain('"properties" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]');
    expect(schema).toMatch(/deathSaveSuccesses\s+Int\s+@default\(0\)/);
    expect(schema).toMatch(/deathSaveFailures\s+Int\s+@default\(0\)/);
    expect(schema).toMatch(/actionBudget\s+Json\?/);
  });

  it("uses retry-safe indexes and table-scoped constraint guards", () => {
    const indexStatements = migration
      .split(/\r?\n/)
      .filter((line) => /^CREATE (?:UNIQUE )?INDEX /.test(line));
    expect(indexStatements.length).toBeGreaterThan(0);
    for (const statement of indexStatements) {
      expect(statement).toContain("IF NOT EXISTS");
    }

    const constraintGuards = migration
      .split(/\r?\n/)
      .filter((line) => line.includes("WHERE conname ="));
    expect(constraintGuards).toHaveLength(10);
    for (const guard of constraintGuards) {
      expect(guard).toContain("conrelid =");
      expect(guard).toContain("::regclass");
    }

    expect(migration).toContain('CREATE INDEX IF NOT EXISTS "Combatant_zoneId_idx"');
    expect(schema).toContain('@@index([zoneId], map: "Combatant_zoneId_idx")');
  });

  it("reconciles only verified active tables and excludes legacy subsystems", () => {
    for (const table of ["SrdCondition", "SrdEquipment", "Location", "LocationNode", "LocationEdge"]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    }

    for (const legacyModel of legacyModels) {
      expect(schema).not.toMatch(new RegExp(`model\\s+${legacyModel}\\b`));
      expect(migration).not.toContain(`CREATE TABLE IF NOT EXISTS "${legacyModel}"`);
      expect(migration).not.toContain(`ALTER TABLE "${legacyModel}"`);
    }

    const activePersistenceSources = campaignPage + "\n" + actionRoute;
    expect(activePersistenceSources).not.toMatch(
      /\b(?:prisma|tx)\.(?:campaignTime|partyInventory|wildernessMap|travelState|haven|retainer)\b/,
    );
  });

  it("keeps legacy persistence services fail-closed outside injected contract tests", () => {
    for (const source of [explorationTurnService, wildernessService]) {
      expect(source).not.toContain('import { prisma }');
      expect(source).not.toContain("prisma as unknown");
      expect(source).toContain('"LEGACY_SUBSYSTEM_DISABLED"');
      expect(source).toContain("input.tx ?? input.db");
    }
  });

  it("rejects production calls to legacy persistence services", async () => {
    const [{ resolveExplorationTurn }, { resolveTravelWatch }] = await Promise.all([
      import("../../lib/rules/exploration-turn-service"),
      import("../../lib/rules/wilderness-service"),
    ]);

    await expect(
      resolveExplorationTurn({ campaignId: "campaign-1", turnAction: "move" }),
    ).rejects.toMatchObject({ code: "LEGACY_SUBSYSTEM_DISABLED" });

    await expect(
      resolveTravelWatch({ campaignId: "campaign-1", action: "travel" }),
    ).rejects.toMatchObject({ code: "LEGACY_SUBSYSTEM_DISABLED" });
  });

  it("models tenant-safe location relations in Prisma", () => {
    expect(schema).toMatch(
      /currentLocation\s+Location\?\s+@relation\("CampaignCurrentLocation", fields: \[currentLocationId, id\], references: \[id, campaignId\]/,
    );
    expect(schema).toMatch(
      /parent\s+Location\?\s+@relation\("LocationHierarchy", fields: \[parentId, campaignId\], references: \[id, campaignId\]/,
    );
    expect(schema).toMatch(
      /fromNode\s+LocationNode\s+@relation\("EdgeFrom", fields: \[fromNodeId, locationId\], references: \[id, locationId\]/,
    );
    expect(schema).toContain('@@unique([id, campaignId], map: "Location_id_campaignId_key")');
    expect(schema).toContain('@@unique([id, locationId], map: "LocationNode_id_locationId_key")');
  });

  it("models Prisma-managed remote indexes and documents the raw HNSW exception", () => {
    expect(schema).toContain('map: "Character_userId_idx"');
    expect(schema).toContain('map: "SrdMonster_name_trgm_idx"');
    expect(schema).toContain('map: "SrdSpell_name_trgm_idx"');
    expect(schema).toContain("raw-SQL managed because Prisma does");
  });
});
