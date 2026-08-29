import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  clauseFor,
  RECOGNISED_SRD_CLAUSES,
  UNRECOGNISED_SRD_CLAUSES,
} from "@/lib/rules/damage-clauses";
import { DAMAGE_TYPES } from "@/lib/rules/damage-modifiers";

/**
 * The table is keyed by the exact strings the data holds. These assertions bind
 * both ends against the real file: an entry no monster carries is dead weight,
 * and a clause in the data the table does not know is a number somebody has to
 * change on purpose — the same discipline as IMPLEMENTED_EFFECTS.
 */
const MONSTERS = JSON.parse(
  readFileSync(join(process.cwd(), "data", "srd-es", "monsters.json"), "utf8"),
) as Array<Record<string, unknown>>;

const BARE = new Set<string>(DAMAGE_TYPES);

function clausesInData(): string[] {
  const found = new Set<string>();
  for (const monster of MONSTERS) {
    for (const key of ["damage_immunities", "damage_resistances", "damage_vulnerabilities"]) {
      const entries = monster[key];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (typeof entry !== "string") continue;
        const trimmed = entry.trim();
        if (trimmed.length === 0 || BARE.has(trimmed.toLowerCase())) continue;
        found.add(trimmed);
      }
    }
  }
  return [...found].sort();
}

describe("the damage clause table", () => {
  it("reads the physical family the data actually contains", () => {
    const plain = clauseFor("bludgeoning, piercing, and slashing from nonmagical weapons");
    expect(plain).toEqual({ types: ["bludgeoning", "piercing", "slashing"], unless: null });

    const silvered = clauseFor(
      "bludgeoning, piercing, and slashing from nonmagical weapons that aren't silvered",
    );
    expect(silvered).toEqual({
      types: ["bludgeoning", "piercing", "slashing"],
      unless: "silvered",
    });

    const adamantine = clauseFor(
      "bludgeoning, piercing, and slashing from nonmagical weapons that aren't adamantine",
    );
    expect(adamantine).toEqual({
      types: ["bludgeoning", "piercing", "slashing"],
      unless: "adamantine",
    });

    const narrow = clauseFor("piercing and slashing from nonmagical weapons that aren't adamantine");
    expect(narrow).toEqual({ types: ["piercing", "slashing"], unless: "adamantine" });
  });

  it("matches regardless of case and surrounding whitespace", () => {
    expect(
      clauseFor("  Bludgeoning, Piercing, and Slashing from Nonmagical Weapons  "),
    ).not.toBeNull();
  });

  it("knows nothing about a wording it has never seen", () => {
    expect(clauseFor("slashing from weapons forged in moonlight")).toBeNull();
  });

  it("holds no entry the monster data does not carry", () => {
    const inData = new Set(clausesInData().map((entry) => entry.toLowerCase()));
    const orphans = RECOGNISED_SRD_CLAUSES.filter((key) => !inData.has(key));

    expect(orphans).toEqual([]);
  });

  it("leaves exactly the three out-of-scope wordings unrecognised", () => {
    const unrecognised = clausesInData().filter((entry) => clauseFor(entry) === null);

    expect(unrecognised.sort()).toEqual([...UNRECOGNISED_SRD_CLAUSES].sort());
  });
});
