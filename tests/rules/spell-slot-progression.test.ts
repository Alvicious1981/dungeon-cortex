import { describe, expect, it, vi } from "vitest";
import {
  advanceSpellSlots,
  longRestSpellSlots,
  spellSlotsFor,
  type SpellSlots,
} from "@/lib/rules/magic";
import { applyLevelUp } from "@/lib/rules/level-up-service";
import { xpForLevel } from "@/lib/rules/progression";

/**
 * Spell slots follow the SRD table for the class and level. The table
 * (`spellSlotsForLevel`) existed from the start with no caller: characters
 * were created with two 1st-level slots if they were a wizard, cleric or
 * sorcerer, and none otherwise, and a level-up never touched them. No
 * character could ever cast above 1st level.
 */
describe("spellSlotsFor — the SRD table as Character.spellSlots", () => {
  it.each([
    ["wizard", 1, { "1": { current: 2, max: 2 } }],
    ["bard", 1, { "1": { current: 2, max: 2 } }],
    ["druid", 1, { "1": { current: 2, max: 2 } }],
    ["warlock", 1, { "1": { current: 1, max: 1 } }],
    ["wizard", 3, { "1": { current: 4, max: 4 }, "2": { current: 2, max: 2 } }],
    ["paladin", 2, { "1": { current: 2, max: 2 } }],
    ["warlock", 3, { "2": { current: 2, max: 2 } }],
  ])("%s level %i", (cls, level, expected) => {
    expect(spellSlotsFor(cls, level)).toEqual(expected);
  });

  it.each([["fighter", 5], ["rogue", 1], ["paladin", 1], ["ranger", 1]])(
    "gives %s at level %i no slots",
    (cls, level) => {
      expect(spellSlotsFor(cls, level)).toBeNull();
    },
  );

  it("reads the class however it is capitalised", () => {
    expect(spellSlotsFor(" Wizard ", 1)).toEqual({ "1": { current: 2, max: 2 } });
  });
});

describe("advanceSpellSlots — a level's new slots, spent slots still spent", () => {
  it("adds the new level's slots available and keeps what was spent spent", () => {
    // A level 2 wizard (3 first-level slots) who spent one, reaching level 3.
    const before: SpellSlots = { "1": { current: 2, max: 3 } };
    expect(advanceSpellSlots(before, "wizard", 3)).toEqual({
      "1": { current: 3, max: 4 },
      "2": { current: 2, max: 2 },
    });
  });

  it("repairs a character whose slots were never raised", () => {
    // Created at level 1 under the old code, now reaching level 4.
    const stale: SpellSlots = { "1": { current: 2, max: 2 } };
    expect(advanceSpellSlots(stale, "cleric", 4)).toEqual({
      "1": { current: 4, max: 4 },
      "2": { current: 3, max: 3 },
    });
  });

  it("carries a warlock's spent pact slots across the change of slot level", () => {
    // Level 2: two 1st-level pact slots, one spent. Level 3: two 2nd-level.
    const before: SpellSlots = { "1": { current: 1, max: 2 } };
    expect(advanceSpellSlots(before, "warlock", 3)).toEqual({ "2": { current: 1, max: 2 } });
  });

  it("gives a caster with no slots yet its first ones", () => {
    expect(advanceSpellSlots(null, "ranger", 2)).toEqual({ "1": { current: 2, max: 2 } });
  });

  it("leaves a class with no slots as it was", () => {
    expect(advanceSpellSlots(null, "fighter", 5)).toBeNull();
  });

  it("never goes below zero", () => {
    const overspent: SpellSlots = { "1": { current: 0, max: 9 } };
    expect(advanceSpellSlots(overspent, "wizard", 2)).toEqual({ "1": { current: 0, max: 3 } });
  });
});

describe("longRestSpellSlots — every slot back, at the table's maxima", () => {
  it("restores a stale character to its class and level", () => {
    expect(longRestSpellSlots("Wizard", 3, { "1": { current: 0, max: 2 } })).toEqual({
      "1": { current: 4, max: 4 },
      "2": { current: 2, max: 2 },
    });
  });

  it("restores the stored slots of a class the table gives none", () => {
    expect(longRestSpellSlots("Fighter", 3, { "1": { current: 0, max: 2 } })).toEqual({
      "1": { current: 2, max: 2 },
    });
  });

  it("leaves a class with no slots and none stored with none", () => {
    expect(longRestSpellSlots("Fighter", 3, null)).toBeNull();
  });
});

describe("applyLevelUp writes the new level's spell slots", () => {
  function store(row: Record<string, unknown>) {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const queryRaw = vi.fn(async () => []);
    const findUnique = vi.fn(async () => ({ ...row }));
    const db = {
      $queryRaw: queryRaw,
      campaign: { findUnique: vi.fn(async () => ({ id: "campaign-1", characterId: "character-1" })) },
      character: { findUnique, updateMany },
    };
    return { db, updateMany, queryRaw, findUnique };
  }

  const wizardAt2 = {
    id: "character-1",
    campaignId: "campaign-1",
    xp: xpForLevel(3),
    level: 2,
    class: "wizard",
    stats: { CON: 12 },
    hp: 10,
    maxHp: 12,
    hitDiceTotal: 2,
    hitDiceRemaining: 2,
    exhaustionLevel: 0,
    spellSlots: { "1": { current: 1, max: 3 } },
  };

  function levelUp(db: unknown) {
    return applyLevelUp({
      campaignId: "campaign-1",
      characterId: "character-1",
      useAverage: true,
      source: "test",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: db as any,
    });
  }

  it("in the same compare-and-set as the level", async () => {
    const { db, updateMany } = store(wizardAt2);

    await levelUp(db);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "character-1", level: 2, hitDiceTotal: 2 },
        data: expect.objectContaining({
          level: 3,
          spellSlots: { "1": { current: 2, max: 4 }, "2": { current: 2, max: 2 } },
        }),
      }),
    );
  });

  it("reads the slots under the Character row lock", async () => {
    const { db, queryRaw, findUnique } = store(wizardAt2);

    await levelUp(db);

    expect(queryRaw).toHaveBeenCalled();
    expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(findUnique.mock.invocationCallOrder[0]!);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ spellSlots: true }) }),
    );
  });

  it("writes no slots for a class that has none", async () => {
    const { db, updateMany } = store({ ...wizardAt2, class: "fighter", spellSlots: null });

    await levelUp(db);

    const [{ data }] = updateMany.mock.calls[0] as unknown as [{ data: Record<string, unknown> }];
    expect(data).not.toHaveProperty("spellSlots");
  });
});
