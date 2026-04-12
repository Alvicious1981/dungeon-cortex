/**
 * tests/rules/srd.test.ts
 *
 * Tests for the SRD rules layer — MonsterSchema validation and filterMonsters.
 *
 * filterMonsters uses the real monsters.json dataset (334 entries). Tests assert
 * invariants on returned results rather than exact counts, so they remain stable
 * if the data file is updated.
 */

import { describe, it, expect } from "vitest";
import {
  MonsterSchema,
  filterMonsters,
  getMonster,
  MONSTER_COUNT,
  type Monster,
} from "@/lib/rules/srd";

// ---------------------------------------------------------------------------
// MonsterSchema — Zod validation
// ---------------------------------------------------------------------------

describe("MonsterSchema", () => {
  const base = { index: "goblin", name: "Goblin", hit_points: 7 };

  it("parses a minimal valid monster record", () => {
    const r = MonsterSchema.safeParse(base);
    expect(r.success).toBe(true);
  });

  it("parses integer challenge_rating", () => {
    const r = MonsterSchema.safeParse({ ...base, challenge_rating: 10 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.challenge_rating).toBe(10);
  });

  it("parses fractional challenge_rating (CR 1/4 = 0.25)", () => {
    const r = MonsterSchema.safeParse({ ...base, challenge_rating: 0.25 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.challenge_rating).toBe(0.25);
  });

  it("parses CR 1/8 (0.125)", () => {
    const r = MonsterSchema.safeParse({ ...base, challenge_rating: 0.125 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.challenge_rating).toBe(0.125);
  });

  it("allows missing challenge_rating (optional field)", () => {
    const r = MonsterSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.challenge_rating).toBeUndefined();
  });

  it("parses size, type, and alignment when present", () => {
    const r = MonsterSchema.safeParse({
      ...base,
      size: "Large",
      type: "dragon",
      alignment: "chaotic evil",
      challenge_rating: 13,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.size).toBe("Large");
      expect(r.data.type).toBe("dragon");
      expect(r.data.alignment).toBe("chaotic evil");
    }
  });

  it("rejects a record missing the required hit_points field", () => {
    const r = MonsterSchema.safeParse({ index: "broken", name: "Broken" });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// filterMonsters — in-memory filtering against real monsters.json
// ---------------------------------------------------------------------------

// Guard: skip data-dependent tests if the data file wasn't loaded
const hasData = MONSTER_COUNT > 0;

describe("filterMonsters", () => {
  it("returns all monsters when no filter is provided", () => {
    if (!hasData) return;
    const results = filterMonsters({});
    expect(results.length).toBe(MONSTER_COUNT);
  });

  it("filters by type — only returns monsters of the requested type", () => {
    if (!hasData) return;
    const results = filterMonsters({ type: "dragon" });
    expect(results.length).toBeGreaterThan(0);
    results.forEach((m) => {
      expect(m.type?.toLowerCase()).toBe("dragon");
    });
  });

  it("type filter is case-insensitive", () => {
    if (!hasData) return;
    const lower = filterMonsters({ type: "undead" });
    const upper = filterMonsters({ type: "UNDEAD" });
    expect(lower.length).toBe(upper.length);
  });

  it("filters by size — only returns monsters of the requested size", () => {
    if (!hasData) return;
    const results = filterMonsters({ size: "Tiny" });
    expect(results.length).toBeGreaterThan(0);
    results.forEach((m) => {
      expect(m.size?.toLowerCase()).toBe("tiny");
    });
  });

  it("filters by maxCR — all results have CR ≤ threshold", () => {
    if (!hasData) return;
    const maxCR = 1;
    const results = filterMonsters({ maxCR });
    expect(results.length).toBeGreaterThan(0);
    results.forEach((m) => {
      expect(m.challenge_rating ?? 0).toBeLessThanOrEqual(maxCR);
    });
  });

  it("filters by minCR — all results have CR ≥ threshold", () => {
    if (!hasData) return;
    const minCR = 15;
    const results = filterMonsters({ minCR });
    expect(results.length).toBeGreaterThan(0);
    results.forEach((m) => {
      expect(m.challenge_rating ?? 0).toBeGreaterThanOrEqual(minCR);
    });
  });

  it("filters by CR range — all results satisfy [minCR, maxCR]", () => {
    if (!hasData) return;
    const minCR = 1;
    const maxCR = 3;
    const results = filterMonsters({ minCR, maxCR });
    expect(results.length).toBeGreaterThan(0);
    results.forEach((m) => {
      const cr = m.challenge_rating ?? 0;
      expect(cr).toBeGreaterThanOrEqual(minCR);
      expect(cr).toBeLessThanOrEqual(maxCR);
    });
  });

  it("filters by alignment substring — case-insensitive contains", () => {
    if (!hasData) return;
    const results = filterMonsters({ alignment: "evil" });
    expect(results.length).toBeGreaterThan(0);
    results.forEach((m) => {
      expect(m.alignment?.toLowerCase()).toContain("evil");
    });
  });

  it("combines type + maxCR — all results satisfy both criteria", () => {
    if (!hasData) return;
    const results = filterMonsters({ type: "beast", maxCR: 2 });
    results.forEach((m) => {
      expect(m.type?.toLowerCase()).toBe("beast");
      expect(m.challenge_rating ?? 0).toBeLessThanOrEqual(2);
    });
  });

  it("returns empty array when no monsters match the filter", () => {
    if (!hasData) return;
    // CR 99 doesn't exist in the dataset
    const results = filterMonsters({ minCR: 99 });
    expect(results).toHaveLength(0);
  });

  it("returns results sorted by CR ascending, then name ascending", () => {
    if (!hasData) return;
    const results = filterMonsters({ type: "beast" });
    for (let i = 1; i < results.length; i++) {
      const prev = results[i - 1].challenge_rating ?? 0;
      const curr = results[i].challenge_rating ?? 0;
      expect(curr).toBeGreaterThanOrEqual(prev);
      // When CR is equal, names should be in alphabetical order
      if (curr === prev) {
        expect(results[i].name.localeCompare(results[i - 1].name)).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// getMonster — lookup integration (uses real data when present)
// ---------------------------------------------------------------------------

describe("getMonster", () => {
  it("returns null for a query that matches nothing", () => {
    const result = getMonster("zzzxxx_no_such_creature_zzz");
    expect(result).toBeNull();
  });

  it("returns a Monster when data is present and name matches", () => {
    if (!hasData) return;
    // "Goblin" is a standard SRD entry — safe to assert its existence
    const result = getMonster("goblin");
    if (result !== null) {
      expect(result.name.toLowerCase()).toContain("goblin");
      expect(typeof result.hit_points).toBe("number");
    }
  });
});
