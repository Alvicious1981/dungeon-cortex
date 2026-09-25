import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseSrdBoolean } from "@/lib/srd/seed-values";

type JsonRecord = Record<string, unknown>;

/**
 * prisma/seed-srd.ts connects to the database as soon as it is imported
 * (`new PrismaClient()` at module scope), so it can never be imported from a
 * test. Reading it as text is how this file checks that the seed actually
 * calls parseSrdBoolean rather than a local reader that happens to have the
 * same shape.
 */
const SEED_SOURCE = readFileSync(
  join(process.cwd(), "prisma", "seed-srd.ts"),
  "utf8",
);

const SPELLS: JsonRecord[] = JSON.parse(
  readFileSync(join(process.cwd(), "data", "srd-es", "spells.json"), "utf8"),
);

const CONCENTRATION_KEYS = ["concentration", "concentracion", "concentración"] as const;

function rawConcentration(spell: JsonRecord): unknown {
  for (const key of CONCENTRATION_KEYS) {
    if (key in spell) return spell[key];
  }
  return undefined;
}

function spellLabel(spell: JsonRecord): string {
  return String(spell.index ?? spell.name ?? "?");
}

describe("prisma/seed-srd.ts wiring", () => {
  it("reads ritual and concentration through parseSrdBoolean and has no local reader left behind", () => {
    expect(SEED_SOURCE).toContain("ritual: parseSrdBoolean(");
    expect(SEED_SOURCE).toContain("concentration: parseSrdBoolean(");
    expect(SEED_SOURCE).not.toContain("function asBool");
  });
});

describe("parseSrdBoolean against data/srd-es/spells.json", () => {
  it("reads every ritual and concentration value in the cache as non-null", () => {
    const unresolved: string[] = [];
    for (const spell of SPELLS) {
      if (parseSrdBoolean(spell.ritual) === null) {
        unresolved.push(`${spellLabel(spell)}.ritual`);
      }
      if (parseSrdBoolean(rawConcentration(spell)) === null) {
        unresolved.push(`${spellLabel(spell)}.concentration`);
      }
    }
    expect(unresolved).toEqual([]);
  });

  it("reads Fear, Gaseous Form, Hypnotic Pattern, Phantasmal Killer and Suggestion as concentration spells", () => {
    const indices = [
      "fear",
      "gaseous-form",
      "hypnotic-pattern",
      "phantasmal-killer",
      "suggestion",
    ];

    for (const index of indices) {
      const spell = SPELLS.find((s) => s.index === index);
      expect(spell, `spell "${index}" not found in spells.json`).toBeDefined();
      expect(parseSrdBoolean(rawConcentration(spell as JsonRecord))).toBe(true);
    }
  });
});

describe("parseSrdBoolean", () => {
  it("passes booleans through unchanged", () => {
    expect(parseSrdBoolean(true)).toBe(true);
    expect(parseSrdBoolean(false)).toBe(false);
  });

  it("still accepts every value the previous reader accepted, including 'SI' and ' Yes '", () => {
    for (const value of ["true", "1", "yes", "si", "s", "SI", " Yes "]) {
      expect(parseSrdBoolean(value)).toBe(true);
    }
    for (const value of ["false", "0", "no", "n"]) {
      expect(parseSrdBoolean(value)).toBe(false);
    }
  });

  it("reads 'Falso', 'falso' and 'No' as false", () => {
    expect(parseSrdBoolean("Falso")).toBe(false);
    expect(parseSrdBoolean("falso")).toBe(false);
    expect(parseSrdBoolean("No")).toBe(false);
  });

  it("returns null for unrecognized text and for undefined", () => {
    expect(parseSrdBoolean("quizás")).toBeNull();
    expect(parseSrdBoolean(undefined)).toBeNull();
  });
});
