import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { weaponQualitiesFor } from "@/lib/rules/weapon-quality";

/**
 * A rule with no producer is dormant the day it lands — the armour-proficiency
 * rule shipped while no loot row carried a category, and could not fire in
 * production. These assertions read the real file so the silvered and
 * adamantine branches always have something in the game that reaches them.
 *
 * Neither row may carry a `damageBonus`. A silvered sword that also had +1
 * would derive as magical, the "that aren't silvered" clause would be lifted by
 * the magic instead of by the silver, and the branch under test would never run.
 */
const LOOT = JSON.parse(
  readFileSync(join(process.cwd(), "data", "loot-tables.json"), "utf8"),
) as Record<string, unknown>;

function weapons(): Array<Record<string, unknown>> {
  return Object.values(LOOT)
    .filter((table): table is Array<Record<string, unknown>> => Array.isArray(table))
    .flat()
    .filter((row) => row.type === "weapon");
}

describe("the loot tables produce weapons the damage clauses can meet", () => {
  it.each(["silvered", "adamantine"] as const)("has at least one %s weapon", (quality) => {
    const matching = weapons().filter((row) =>
      weaponQualitiesFor(row.properties).includes(quality),
    );

    expect(matching.length).toBeGreaterThan(0);
  });

  it.each(["silvered", "adamantine"] as const)(
    "keeps the %s weapon nonmagical, so the clause is lifted by the material",
    (quality) => {
      const matching = weapons().filter((row) =>
        weaponQualitiesFor(row.properties).includes(quality),
      );

      for (const row of matching) {
        expect(weaponQualitiesFor(row.properties)).not.toContain("magical");
      }
    },
  );
});
