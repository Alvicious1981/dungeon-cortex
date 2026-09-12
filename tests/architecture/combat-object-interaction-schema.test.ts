import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("combat object-interaction persistence", () => {
  it("is nullable, has no fabricated legacy default, and has complete lifecycle writers", () => {
    expect(read("prisma/schema.prisma")).toContain("currentTurnObjectInteractionUsed Boolean?");
    const migration = read("prisma/migrations/20260912150000_add_current_turn_object_interaction/migration.sql");
    const statements = migration.replace(/^--.*$/gm, "");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS");
    expect(statements).not.toMatch(/\bDEFAULT\b|\bUPDATE\s+"Encounter"/i);
    expect(read("app/api/campaign/[id]/encounter/route.ts")).toContain("currentTurnObjectInteractionUsed: false");
    expect(read("lib/rules/encounter-service.ts")).toContain("currentTurnObjectInteractionUsed: false");
    expect(read("lib/rules/combat-pipeline.ts").match(/currentTurnObjectInteractionUsed: false/g)).toHaveLength(2);
    expect(read("lib/memory/context.ts")).toContain("currentTurnObjectInteractionUsed: true");
    expect(read("app/api/campaign/[id]/action/route.ts")).toContain("persistEquipmentTransition");
  });
});
