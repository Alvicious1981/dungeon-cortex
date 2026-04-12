/**
 * tests/rules/quests.test.ts
 *
 * Structural tests for the quest template data tables — Milestone I Slice 5.
 *
 * This module is pure data. Tests verify:
 *   - Tables exist and are non-empty arrays.
 *   - Every entry is a non-empty string (no nulls, no blanks).
 *   - Each table has the required minimum number of entries.
 *   - The ProceduralQuest interface is satisfied by a valid object at compile time.
 */

import { describe, it, expect } from "vitest";
import {
  QUEST_HOOKS,
  QUEST_LOCATIONS,
  QUEST_OBJECTIVES,
  QUEST_REWARDS,
  QUEST_TITLES,
  generateQuest,
  type ProceduralQuest,
} from "@/lib/rules/quests";

const MIN_ENTRIES = 6;

// ---------------------------------------------------------------------------
// Helper: run the same structural assertions on any string table
// ---------------------------------------------------------------------------

function describeTable(name: string, table: readonly string[]) {
  describe(name, () => {
    it(`has at least ${MIN_ENTRIES} entries`, () => {
      expect(table.length).toBeGreaterThanOrEqual(MIN_ENTRIES);
    });

    it("contains only non-empty strings", () => {
      for (const entry of table) {
        expect(typeof entry).toBe("string");
        expect(entry.trim().length).toBeGreaterThan(0);
      }
    });

    it("has no duplicate entries", () => {
      const unique = new Set(table);
      expect(unique.size).toBe(table.length);
    });
  });
}

// ---------------------------------------------------------------------------
// Table structural tests
// ---------------------------------------------------------------------------

describe("Quest template tables", () => {
  describeTable("QUEST_HOOKS",      QUEST_HOOKS);
  describeTable("QUEST_LOCATIONS",  QUEST_LOCATIONS);
  describeTable("QUEST_OBJECTIVES", QUEST_OBJECTIVES);
  describeTable("QUEST_REWARDS",    QUEST_REWARDS);
  describeTable("QUEST_TITLES",     QUEST_TITLES);
});

// ---------------------------------------------------------------------------
// ProceduralQuest interface — compile-time and runtime shape checks
// ---------------------------------------------------------------------------

describe("ProceduralQuest interface", () => {
  it("is satisfied by an object with all required fields", () => {
    // TypeScript will error at compile time if the interface changes.
    const q: ProceduralQuest = {
      title:       "The Hollow Well",
      description: "The village well has run black for three days.",
      hook:        QUEST_HOOKS[0]!,
      location:    QUEST_LOCATIONS[0]!,
      objective:   QUEST_OBJECTIVES[0]!,
      reward:      QUEST_REWARDS[0]!,
    };

    expect(typeof q.title).toBe("string");
    expect(typeof q.description).toBe("string");
    expect(typeof q.hook).toBe("string");
    expect(typeof q.location).toBe("string");
    expect(typeof q.objective).toBe("string");
    expect(typeof q.reward).toBe("string");
  });

  it("allows an optional giverId field", () => {
    const q: ProceduralQuest = {
      title:       "The Missing Patrol",
      description: "No one returned from the eastern road.",
      hook:        QUEST_HOOKS[1]!,
      location:    QUEST_LOCATIONS[1]!,
      objective:   QUEST_OBJECTIVES[1]!,
      reward:      QUEST_REWARDS[1]!,
      giverId:     "innkeeper_saltmarsh_harlan",
    };
    expect(q.giverId).toBe("innkeeper_saltmarsh_harlan");
  });

  it("allows omitting giverId (optional field)", () => {
    const q: ProceduralQuest = {
      title:       "The Sealed Vault",
      description: "Something stirs beneath the old keep.",
      hook:        QUEST_HOOKS[2]!,
      location:    QUEST_LOCATIONS[2]!,
      objective:   QUEST_OBJECTIVES[2]!,
      reward:      QUEST_REWARDS[2]!,
    };
    expect(q.giverId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// generateQuest — pure generator
// ---------------------------------------------------------------------------

describe("generateQuest", () => {
  describe("determinism", () => {
    it("same seed produces identical quest", () => {
      const a = generateQuest(12345);
      const b = generateQuest(12345);
      expect(a).toEqual(b);
    });

    it("same seed + same giverId produces identical quest", () => {
      const giver = "innkeeper_saltmarsh_main";
      const a = generateQuest(99999, giver);
      const b = generateQuest(99999, giver);
      expect(a).toEqual(b);
    });

    it("different seeds usually produce different quests", () => {
      const a = generateQuest(1);
      const b = generateQuest(1_000_000);
      // At least one field should differ — astronomically unlikely to collide on all
      const allSame =
        a.title === b.title &&
        a.hook === b.hook &&
        a.location === b.location &&
        a.objective === b.objective &&
        a.reward === b.reward;
      expect(allSame).toBe(false);
    });
  });

  describe("output shape", () => {
    const quest = generateQuest(42);

    it("returns a ProceduralQuest with all required fields", () => {
      expect(typeof quest.title).toBe("string");
      expect(typeof quest.description).toBe("string");
      expect(typeof quest.hook).toBe("string");
      expect(typeof quest.location).toBe("string");
      expect(typeof quest.objective).toBe("string");
      expect(typeof quest.reward).toBe("string");
    });

    it("all fields are non-empty strings", () => {
      for (const [key, val] of Object.entries(quest)) {
        if (key === "giverId") continue;
        expect(typeof val).toBe("string");
        expect((val as string).trim().length).toBeGreaterThan(0);
      }
    });

    it("title is drawn from QUEST_TITLES", () => {
      expect(QUEST_TITLES).toContain(quest.title);
    });

    it("hook is drawn from QUEST_HOOKS", () => {
      expect(QUEST_HOOKS).toContain(quest.hook);
    });

    it("location is drawn from QUEST_LOCATIONS", () => {
      expect(QUEST_LOCATIONS).toContain(quest.location);
    });

    it("objective is drawn from QUEST_OBJECTIVES", () => {
      expect(QUEST_OBJECTIVES).toContain(quest.objective);
    });

    it("reward is drawn from QUEST_REWARDS", () => {
      expect(QUEST_REWARDS).toContain(quest.reward);
    });

    it("description equals the hook (hook doubles as description)", () => {
      expect(quest.description).toBe(quest.hook);
    });
  });

  describe("giverId handling", () => {
    it("includes giverId when provided", () => {
      const q = generateQuest(7, "blacksmith_ironhaven_oskar");
      expect(q.giverId).toBe("blacksmith_ironhaven_oskar");
    });

    it("omits giverId when not provided", () => {
      const q = generateQuest(7);
      expect(q.giverId).toBeUndefined();
    });

    it("same seed with and without giverId produces same title/hook/location/objective/reward", () => {
      const withGiver    = generateQuest(777, "some_npc");
      const withoutGiver = generateQuest(777);
      expect(withGiver.title).toBe(withoutGiver.title);
      expect(withGiver.hook).toBe(withoutGiver.hook);
      expect(withGiver.location).toBe(withoutGiver.location);
      expect(withGiver.objective).toBe(withoutGiver.objective);
      expect(withGiver.reward).toBe(withoutGiver.reward);
    });
  });

  describe("stability across many seeds", () => {
    it("always returns values from the correct tables for 50 random seeds", () => {
      for (let i = 0; i < 50; i++) {
        const q = generateQuest(i * 13_337 + 1);
        expect(QUEST_TITLES).toContain(q.title);
        expect(QUEST_HOOKS).toContain(q.hook);
        expect(QUEST_LOCATIONS).toContain(q.location);
        expect(QUEST_OBJECTIVES).toContain(q.objective);
        expect(QUEST_REWARDS).toContain(q.reward);
      }
    });
  });
});
