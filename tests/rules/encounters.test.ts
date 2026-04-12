/**
 * tests/rules/encounters.test.ts
 *
 * Tests for the encounter building rules — CR/XP budget math.
 * All tests use in-memory Monster fixtures; no database, no file I/O.
 */

import { describe, it, expect } from "vitest";
import {
  xpForCR,
  encounterMultiplier,
  buildEncounter,
  MAX_ENCOUNTER_SIZE,
} from "@/lib/rules/encounters";
import type { Monster } from "@/lib/rules/srd";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMonster(
  name: string,
  cr: number,
  type = "beast"
): Monster {
  return {
    index: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    hit_points: Math.max(1, Math.floor(cr * 10)),
    challenge_rating: cr,
    type,
  };
}

// ---------------------------------------------------------------------------
// xpForCR
// ---------------------------------------------------------------------------

describe("xpForCR", () => {
  it("returns 10 for CR 0", () => {
    expect(xpForCR(0)).toBe(10);
  });

  it("returns 25 for CR 1/8 (0.125)", () => {
    expect(xpForCR(0.125)).toBe(25);
  });

  it("returns 50 for CR 1/4 (0.25)", () => {
    expect(xpForCR(0.25)).toBe(50);
  });

  it("returns 100 for CR 1/2 (0.5)", () => {
    expect(xpForCR(0.5)).toBe(100);
  });

  it("returns 200 for CR 1", () => {
    expect(xpForCR(1)).toBe(200);
  });

  it("returns 450 for CR 2", () => {
    expect(xpForCR(2)).toBe(450);
  });

  it("returns 1800 for CR 5", () => {
    expect(xpForCR(5)).toBe(1_800);
  });

  it("returns 25000 for CR 20", () => {
    expect(xpForCR(20)).toBe(25_000);
  });

  it("returns 155000 for CR 30", () => {
    expect(xpForCR(30)).toBe(155_000);
  });

  it("falls back to nearest CR for non-standard values", () => {
    // 0.3 is closer to 0.25 (diff=0.05) than to 0.5 (diff=0.2)
    expect(xpForCR(0.3)).toBe(50);
    // 1.7 is closer to 2 (diff=0.3) than to 1 (diff=0.7)
    expect(xpForCR(1.7)).toBe(450);
  });

  it("throws RangeError for negative CR", () => {
    expect(() => xpForCR(-1)).toThrow(RangeError);
    expect(() => xpForCR(-0.1)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// encounterMultiplier
// ---------------------------------------------------------------------------

describe("encounterMultiplier", () => {
  it("returns 1.0 for 0 monsters", () => {
    expect(encounterMultiplier(0)).toBe(1.0);
  });

  it("returns 1.0 for 1 monster", () => {
    expect(encounterMultiplier(1)).toBe(1.0);
  });

  it("returns 1.5 for 2 monsters", () => {
    expect(encounterMultiplier(2)).toBe(1.5);
  });

  it("returns 2.0 for 3 monsters", () => {
    expect(encounterMultiplier(3)).toBe(2.0);
  });

  it("returns 2.0 for 6 monsters (upper edge of the ×2 band)", () => {
    expect(encounterMultiplier(6)).toBe(2.0);
  });

  it("returns 2.5 for 7 monsters", () => {
    expect(encounterMultiplier(7)).toBe(2.5);
  });

  it("returns 2.5 for 10 monsters (upper edge of the ×2.5 band)", () => {
    expect(encounterMultiplier(10)).toBe(2.5);
  });

  it("returns 3.0 for 11 monsters", () => {
    expect(encounterMultiplier(11)).toBe(3.0);
  });

  it("returns 3.0 for 14 monsters (upper edge of the ×3 band)", () => {
    expect(encounterMultiplier(14)).toBe(3.0);
  });

  it("returns 4.0 for 15+ monsters", () => {
    expect(encounterMultiplier(15)).toBe(4.0);
    expect(encounterMultiplier(100)).toBe(4.0);
  });
});

// ---------------------------------------------------------------------------
// buildEncounter
// ---------------------------------------------------------------------------

describe("buildEncounter", () => {
  it("returns empty array for an empty pool", () => {
    expect(buildEncounter(1, [])).toHaveLength(0);
  });

  it("returns empty array when themeType matches no monsters in pool", () => {
    const pool = [makeMonster("Wolf", 0.25, "beast")];
    expect(buildEncounter(1, pool, "undead")).toHaveLength(0);
  });

  it("throws RangeError for negative targetCR", () => {
    const pool = [makeMonster("Goblin", 0.25, "humanoid")];
    expect(() => buildEncounter(-1, pool)).toThrow(RangeError);
  });

  it("filters pool to the specified themeType (case-insensitive)", () => {
    const pool = [
      makeMonster("Wolf", 0.25, "beast"),
      makeMonster("Zombie", 0.25, "undead"),
      makeMonster("Skeleton", 0.25, "undead"),
    ];
    const result = buildEncounter(1, pool, "undead");
    expect(result.length).toBeGreaterThan(0);
    result.forEach((m) => expect(m.type?.toLowerCase()).toBe("undead"));
  });

  it("theme filter is case-insensitive (BEAST matches beast)", () => {
    const pool = [makeMonster("Wolf", 0.25, "beast")];
    const result = buildEncounter(1, pool, "BEAST");
    expect(result.length).toBeGreaterThan(0);
  });

  it("selects a single boss monster when pool contains an exact CR match", () => {
    const boss = makeMonster("Dragon Wyrmling", 2, "dragon");
    const pool = [boss];
    const result = buildEncounter(2, pool);
    // One monster at CR 2 fills the budget (adjusted XP = 450 × 1.0 = 450 = targetXP)
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Dragon Wyrmling");
  });

  it("selects multiple low-CR monsters to fill a higher budget", () => {
    // CR 1/4 goblins (XP=50 each). targetCR=2 → targetXP=450.
    // Expected: 3–5 goblins filling the budget.
    const pool = [
      makeMonster("Goblin A", 0.25, "humanoid"),
      makeMonster("Goblin B", 0.25, "humanoid"),
      makeMonster("Goblin C", 0.25, "humanoid"),
      makeMonster("Goblin D", 0.25, "humanoid"),
      makeMonster("Goblin E", 0.25, "humanoid"),
    ];
    const result = buildEncounter(2, pool);
    expect(result.length).toBeGreaterThan(1);
  });

  it("adjusted XP of result never exceeds targetXP", () => {
    const pool = [
      makeMonster("Rat", 0, "beast"),
      makeMonster("Goblin", 0.25, "humanoid"),
      makeMonster("Orc", 0.5, "humanoid"),
      makeMonster("Ogre", 2, "giant"),
      makeMonster("Troll", 5, "giant"),
    ];

    for (const targetCR of [0.25, 0.5, 1, 2, 5, 10]) {
      const result = buildEncounter(targetCR, pool);
      if (result.length === 0) continue;

      const rawXP = result.reduce(
        (sum, m) => sum + xpForCR(m.challenge_rating ?? 0),
        0
      );
      const adjustedXP = rawXP * encounterMultiplier(result.length);
      const targetXP = xpForCR(targetCR);
      expect(adjustedXP).toBeLessThanOrEqual(targetXP);
    }
  });

  it("never returns more than MAX_ENCOUNTER_SIZE monsters", () => {
    // Lots of tiny CR 0 monsters — greedy fill could pick many
    const pool = Array.from({ length: 20 }, (_, i) =>
      makeMonster(`Rat ${i}`, 0, "beast")
    );
    const result = buildEncounter(5, pool);
    expect(result.length).toBeLessThanOrEqual(MAX_ENCOUNTER_SIZE);
  });

  it("fallback: returns the cheapest monster when the entire pool exceeds budget", () => {
    // targetCR 0.25 → targetXP=50. Pool has only CR 5 monsters (XP=1800 > 50).
    const expensive = [
      makeMonster("Troll", 5, "giant"),
      makeMonster("Ogre", 2, "giant"),
    ];
    const result = buildEncounter(0.25, expensive);
    // Nothing fits budget (1800 > 50 for count=1, mult=1.0). Fallback: cheapest.
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Ogre"); // Ogre CR 2 < Troll CR 5
  });

  it("is deterministic — same arguments produce same result", () => {
    const pool = [
      makeMonster("Goblin", 0.25, "humanoid"),
      makeMonster("Orc", 0.5, "humanoid"),
      makeMonster("Ogre", 2, "giant"),
    ];
    const a = buildEncounter(1, pool);
    const b = buildEncounter(1, pool);
    expect(a.map((m) => m.name)).toEqual(b.map((m) => m.name));
  });

  it("omitting themeType uses the full pool", () => {
    const pool = [
      makeMonster("Wolf", 0.25, "beast"),
      makeMonster("Goblin", 0.25, "humanoid"),
    ];
    const withTheme = buildEncounter(1, pool, "beast").length;
    const noTheme = buildEncounter(1, pool).length;
    // Without a filter the pool is larger, so at minimum as many results
    expect(noTheme).toBeGreaterThanOrEqual(withTheme);
  });

  it("result contains only monsters from the provided pool", () => {
    const pool = [makeMonster("Wolf", 0.25, "beast"), makeMonster("Goblin", 0.25, "humanoid")];
    const poolNames = new Set(pool.map((m) => m.name));
    const result = buildEncounter(2, pool);
    result.forEach((m) => expect(poolNames.has(m.name)).toBe(true));
  });
});
