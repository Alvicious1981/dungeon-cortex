import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  grantConditions,
  conditionImmunityIndexes,
  immuneConditionLog,
} from "@/lib/rules/condition-immunity";
import { isKnownCondition } from "@/lib/rules/conditions";

describe("grantConditions", () => {
  it("grants a condition the target is not immune to", () => {
    expect(grantConditions({ conditions: ["poisoned"], immunities: [] })).toEqual({
      granted: ["poisoned"],
      blocked: [],
    });
  });

  it("blocks a condition the target is immune to", () => {
    expect(
      grantConditions({ conditions: ["poisoned"], immunities: ["poisoned"] }),
    ).toEqual({ granted: [], blocked: ["poisoned"] });
  });

  it("splits a mixed list, keeping each side in the order given", () => {
    expect(
      grantConditions({
        conditions: ["prone", "poisoned", "frightened"],
        immunities: ["poisoned", "frightened"],
      }),
    ).toEqual({ granted: ["prone"], blocked: ["poisoned", "frightened"] });
  });

  it("matches case-insensitively and ignores surrounding space", () => {
    // The registry stores "Poisoned" capitalised while the SRD index is
    // lowercase, and both reach this function from different directions.
    expect(
      grantConditions({ conditions: ["Poisoned"], immunities: ["  poisoned "] }).blocked,
    ).toEqual(["Poisoned"]);
  });

  it("reports the condition as it was asked for, not as the immunity spelled it", () => {
    // The blocked list is what the caller tried to apply. Echoing the immunity's
    // spelling back would make the log describe the monster's data rather than
    // what the spell attempted.
    expect(
      grantConditions({ conditions: ["Prone"], immunities: ["prone"] }).blocked,
    ).toEqual(["Prone"]);
  });

  it("ignores an immunity that matches nothing", () => {
    expect(
      grantConditions({ conditions: ["prone"], immunities: ["petrified"] }),
    ).toEqual({ granted: ["prone"], blocked: [] });
  });

  it("never throws on values Postgres can hand back", () => {
    for (const junk of [null, undefined, 42, {}, "poisoned"] as unknown[]) {
      expect(() =>
        grantConditions({
          conditions: junk as string[],
          immunities: junk as string[],
        }),
      ).not.toThrow();
    }
  });

  it("returns nothing granted and nothing blocked for an empty attempt", () => {
    expect(grantConditions({ conditions: [], immunities: ["poisoned"] })).toEqual({
      granted: [],
      blocked: [],
    });
  });
});

describe("immuneConditionLog", () => {
  it("says nothing when nothing was blocked", () => {
    expect(immuneConditionLog({ defenderName: "Wraith", blocked: [] })).toBeNull();
  });

  it("names the creature and every condition it shrugged off", () => {
    const line = immuneConditionLog({
      defenderName: "Wraith",
      blocked: ["poisoned", "frightened"],
    });

    expect(line).toContain("Wraith");
    expect(line).toContain("poisoned");
    expect(line).toContain("frightened");
  });

  it("says the condition was not applied, not that it was", () => {
    // The damage-modifier log shipped a sentence that claimed full damage had
    // been applied when the target was immune. This asserts the opposite claim
    // is what gets written here.
    const line = immuneConditionLog({ defenderName: "Wraith", blocked: ["poisoned"] })!;
    expect(line).toMatch(/not applied|immune/i);
  });
});

/**
 * The vocabulary, checked against the file the seeder reads.
 *
 * `toStringArray` in `prisma/seed-srd.ts` normalises each `{index, name, url}`
 * object down to its `index`, so the column holds bare condition ids. This
 * asserts every id the data contains is one the engine's registry knows — if
 * that ever stops being true, an immunity would silently match nothing.
 */
const MONSTERS = JSON.parse(
  readFileSync(join(process.cwd(), "data", "srd-es", "monsters.json"), "utf8"),
) as Array<Record<string, unknown>>;

function everyConditionImmunityIndex(): string[] {
  return MONSTERS.flatMap((monster) => {
    const value = monster.condition_immunities;
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) =>
        typeof entry === "object" && entry !== null
          ? (entry as Record<string, unknown>).index
          : entry,
      )
      .filter((index): index is string => typeof index === "string");
  });
}

describe("the real monster file", () => {
  it("has condition immunities to test against at all", () => {
    // Guards the guard: a reader bug returning [] would make the next
    // assertion vacuously true.
    expect(everyConditionImmunityIndex().length).toBeGreaterThan(50);
  });

  it("uses only condition ids the engine's registry recognises", () => {
    const unknown = [...new Set(everyConditionImmunityIndex())]
      .filter((index) => !isKnownCondition(index))
      .sort();

    expect(unknown).toEqual([]);
  });

  it("blocks every one of those ids when a target carries it", () => {
    // The end the vocabulary check exists for: a recognised id must actually
    // stop the condition, not merely be spelled correctly.
    for (const index of new Set(everyConditionImmunityIndex())) {
      expect(
        grantConditions({ conditions: [index], immunities: [index] }),
      ).toEqual({ granted: [], blocked: [index] });
    }
  });
});

describe("conditionImmunityIndexes", () => {
  // `Monster.condition_immunities` is declared `z.array(z.any())`, and it
  // genuinely arrives in two shapes: bare strings when the Monster came from
  // the database (the seeder's toStringArray already reduced them), and
  // {index, name, url} objects when it came from the in-memory SRD JSON via
  // filterMonsters. Spawn must not care which.
  it("reads bare strings through unchanged", () => {
    expect(conditionImmunityIndexes(["poisoned", "grappled"])).toEqual([
      "poisoned",
      "grappled",
    ]);
  });

  it("reduces SRD objects to their index", () => {
    expect(
      conditionImmunityIndexes([
        { index: "poisoned", name: "Poisoned", url: "/api/conditions/poisoned" },
        { index: "prone", name: "Prone", url: "/api/conditions/prone" },
      ]),
    ).toEqual(["poisoned", "prone"]);
  });

  it("falls back to name when an object has no index, as the seeder does", () => {
    expect(conditionImmunityIndexes([{ name: "Poisoned" }])).toEqual(["Poisoned"]);
  });

  it("drops entries it cannot read rather than emitting empty strings", () => {
    expect(conditionImmunityIndexes([{}, null, 42, "", "   ", "prone"])).toEqual([
      "prone",
    ]);
  });

  it("returns an empty array for anything that is not an array", () => {
    for (const junk of [null, undefined, 42, {}, "poisoned"]) {
      expect(conditionImmunityIndexes(junk)).toEqual([]);
    }
  });

  it("produces ids the registry recognises, from the real file", () => {
    const withImmunities = MONSTERS.filter(
      (m) => Array.isArray(m.condition_immunities) && m.condition_immunities.length > 0,
    );
    expect(withImmunities.length).toBeGreaterThan(10);

    for (const monster of withImmunities) {
      for (const id of conditionImmunityIndexes(monster.condition_immunities)) {
        expect(isKnownCondition(id)).toBe(true);
      }
    }
  });
});
