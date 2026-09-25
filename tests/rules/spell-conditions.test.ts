import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFERRED_SPELL_CONDITIONS,
  SPELL_CONDITIONS,
  endSpellConditionRecords,
  readSpellConditionRecords,
  recordsForGrant,
  type SpellConditionRecord,
} from "@/lib/rules/spell-conditions";
import { CONDITION_REGISTRY } from "@/lib/rules/conditions";
import { resolveSpellEffect } from "@/lib/rules/magic";

/**
 * The table is a hand transcription (docs/DECISION_SPELL_CONDITIONS.md). These
 * assertions bind it to the SRD cache the game actually reads, so a row that
 * names a spell the cache lacks, a condition the engine does not know, or a
 * save or concentration the cache contradicts fails here instead of in play.
 */
const SPELLS = JSON.parse(
  readFileSync(join(process.cwd(), "data", "srd-es", "spells.json"), "utf8"),
) as Array<Record<string, unknown>>;
const BY_INDEX = new Map(SPELLS.map((s) => [String(s.index), s]));

function dcIndexOf(record: Record<string, unknown>): string | null {
  const dc = record.dc as { dc_type?: { index?: unknown } } | null | undefined;
  return typeof dc?.dc_type?.index === "string" ? dc.dc_type.index : null;
}

describe("SPELL_CONDITIONS — against the SRD cache", () => {
  it("names only spells the cache holds", () => {
    for (const index of Object.keys(SPELL_CONDITIONS)) {
      expect(BY_INDEX.has(index), index).toBe(true);
    }
  });

  it("names only conditions the engine knows", () => {
    for (const [index, entry] of Object.entries(SPELL_CONDITIONS)) {
      expect(Object.keys(CONDITION_REGISTRY), index).toContain(entry.condition);
    }
  });

  it("agrees with the cache's save wherever the cache has one", () => {
    for (const [index, entry] of Object.entries(SPELL_CONDITIONS)) {
      const dc = dcIndexOf(BY_INDEX.get(index)!);
      if (dc === null) continue;
      expect(entry.save, index).toBe(dc.toUpperCase());
    }
  });

  it("agrees with the cache's concentration flag", () => {
    for (const [index, entry] of Object.entries(SPELL_CONDITIONS)) {
      expect(entry.concentration, index).toBe(BY_INDEX.get(index)!.concentration === true);
    }
  });

  it("keeps the deferred list to spells the cache holds, apart from the applied ones", () => {
    for (const index of Object.keys(DEFERRED_SPELL_CONDITIONS)) {
      expect(BY_INDEX.has(index), index).toBe(true);
      expect(SPELL_CONDITIONS[index], index).toBeUndefined();
    }
  });

  it("was reviewed against a cache of exactly this many spells", () => {
    // A refreshed cache is a new set of spells to check against the table and
    // the deferred list; this number is changed on purpose, after that check.
    expect(SPELLS.length).toBe(316);
  });
});

describe("resolveSpellEffect — conditions come from the table and nowhere else", () => {
  it("gives a condition to exactly the spells in the table", () => {
    for (const record of SPELLS) {
      const effect = resolveSpellEffect(record, 9, 3, 20);
      const inTable = String(record.index) in SPELL_CONDITIONS;
      expect(effect.condition !== null, String(record.index)).toBe(inTable);
      expect(effect.conditionEnds !== null, String(record.index)).toBe(inTable);
    }
  });

  it("resolves Entangle as a Strength save against restrained, held by concentration", () => {
    const effect = resolveSpellEffect(BY_INDEX.get("entangle")!, 1, 3, 1);
    expect(effect).toMatchObject({
      type: "utility",
      dice: null,
      hasSavingThrow: true,
      saveAbility: "STR",
      condition: "restrained",
      conditionEnds: { spellIndex: "entangle", concentration: true, durationRounds: 10 },
    });
  });

  it("takes Web's save from the table, because the cache row has no dc", () => {
    expect(dcIndexOf(BY_INDEX.get("web")!)).toBeNull();
    const effect = resolveSpellEffect(BY_INDEX.get("web")!, 2, 3, 3);
    expect(effect).toMatchObject({ hasSavingThrow: true, saveAbility: "DEX", condition: "restrained" });
  });

  it("keeps Black Tentacles' damage and adds its condition", () => {
    const effect = resolveSpellEffect(BY_INDEX.get("black-tentacles")!, 4, 3, 7);
    expect(effect).toMatchObject({
      type: "damage",
      dice: "3d6",
      damageType: "bludgeoning",
      saveAbility: "DEX",
      condition: "restrained",
    });
  });
});

const record = (overrides: Partial<SpellConditionRecord> = {}): SpellConditionRecord => ({
  condition: "restrained",
  spellIndex: "entangle",
  casterId: "p1",
  concentration: true,
  endsAtRound: 11,
  ...overrides,
});

describe("endSpellConditionRecords", () => {
  it("removes the condition with its last record", () => {
    const result = endSpellConditionRecords({
      conditions: ["restrained"],
      records: [record()],
      shouldEnd: () => true,
    });
    expect(result.conditions).toEqual([]);
    expect(result.records).toEqual([]);
    expect(result.ended).toEqual([record()]);
  });

  it("keeps a condition another spell still holds", () => {
    const web = record({ spellIndex: "web", endsAtRound: 601 });
    const result = endSpellConditionRecords({
      conditions: ["restrained"],
      records: [record(), web],
      shouldEnd: (r) => r.spellIndex === "entangle",
    });
    expect(result.conditions).toEqual(["restrained"]);
    expect(result.records).toEqual([web]);
  });

  it("never touches a condition no spell record holds", () => {
    const result = endSpellConditionRecords({
      conditions: ["prone", "restrained"],
      records: [record()],
      shouldEnd: () => true,
    });
    expect(result.conditions).toEqual(["prone"]);
  });

  it("matches the condition without regard to case", () => {
    const result = endSpellConditionRecords({
      conditions: ["Restrained"],
      records: [record()],
      shouldEnd: () => true,
    });
    expect(result.conditions).toEqual([]);
  });

  it("changes nothing when no record is selected", () => {
    const result = endSpellConditionRecords({
      conditions: ["restrained"],
      records: [record()],
      shouldEnd: () => false,
    });
    expect(result).toEqual({ conditions: ["restrained"], records: [record()], ended: [] });
  });
});

describe("recordsForGrant and readSpellConditionRecords", () => {
  it("writes one record per condition that took hold, ending the duration after the cast round", () => {
    expect(
      recordsForGrant({
        granted: ["restrained"],
        spellIndex: "entangle",
        casterId: "p1",
        entry: { concentration: true, durationRounds: 10 },
        round: 3,
      }),
    ).toEqual([record({ endsAtRound: 13 })]);
  });

  it("writes none for a creature that took no condition", () => {
    expect(
      recordsForGrant({
        granted: [],
        spellIndex: "entangle",
        casterId: "p1",
        entry: { concentration: true, durationRounds: 10 },
        round: 3,
      }),
    ).toEqual([]);
  });

  it("drops a malformed entry rather than trusting it", () => {
    expect(readSpellConditionRecords([record(), { condition: "restrained" }, "x", null])).toEqual([
      record(),
    ]);
    expect(readSpellConditionRecords(null)).toEqual([]);
  });
});
