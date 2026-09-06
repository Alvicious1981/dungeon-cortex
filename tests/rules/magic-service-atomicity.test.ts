import { describe, expect, it, vi } from "vitest";
import { castSpell } from "@/lib/rules/magic-service";

type Slots = Record<string, { current: number; max: number }>;

function cloneSlots(slots: Slots): Slots {
  return Object.fromEntries(
    Object.entries(slots).map(([level, entry]) => [level, { ...entry }])
  );
}

function makeDb(initial: Slots, conflictTo?: Slots) {
  let liveSlots = cloneSlots(initial);
  let firstWrite = true;

  const db = {
    campaign: {
      findUnique: vi.fn(async () => ({ id: "campaign-1", characterId: "character-1" })),
    },
    character: {
      findUnique: vi.fn(async () => ({
        id: "character-1",
        spellSlots: cloneSlots(liveSlots),
        class: "wizard",
        inventory: [],
      })),
      update: vi.fn(async () => {
        throw new Error("legacy absolute update must not be used when updateMany is available");
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (firstWrite && conflictTo) {
          firstWrite = false;
          liveSlots = cloneSlots(conflictTo);
          return { count: 0 };
        }

        const expected = where.spellSlots.equals as Slots;
        if (JSON.stringify(expected) !== JSON.stringify(liveSlots)) {
          return { count: 0 };
        }

        liveSlots = cloneSlots(data.spellSlots as Slots);
        return { count: 1 };
      }),
    },
  };

  return {
    db,
    slots: () => cloneSlots(liveSlots),
  };
}

describe("castSpell — atomic spell-slot consumption", () => {
  it("refreshes after a lost compare-and-set and consumes from the committed state", async () => {
    const store = makeDb(
      { "1": { current: 2, max: 2 } },
      { "1": { current: 1, max: 2 } }
    );

    const result = await castSpell({
      campaignId: "campaign-1",
      characterId: "character-1",
      spellLevel: 1,
      slotLevel: 1,
      tx: store.db as any,
    });

    expect(store.db.character.updateMany).toHaveBeenCalledTimes(2);
    expect(store.db.character.findUnique).toHaveBeenCalledTimes(2);
    expect(store.db.character.update).not.toHaveBeenCalled();
    expect(store.slots()).toEqual({ "1": { current: 0, max: 2 } });
    expect(result).toMatchObject({
      spellSlots: { "1": { current: 0, max: 2 } },
      facts: {
        slotConsumed: true,
        spellSlotsBefore: { "1": { current: 1, max: 2 } },
        spellSlotsAfter: { "1": { current: 0, max: 2 } },
      },
    });
  });

  it("refuses after a concurrent writer consumes the final available slot", async () => {
    const store = makeDb(
      { "1": { current: 1, max: 1 } },
      { "1": { current: 0, max: 1 } }
    );

    await expect(
      castSpell({
        campaignId: "campaign-1",
        characterId: "character-1",
        spellLevel: 1,
        slotLevel: 1,
        tx: store.db as any,
      })
    ).rejects.toMatchObject({ code: "NO_SPELL_SLOT_AVAILABLE" });

    expect(store.db.character.updateMany).toHaveBeenCalledTimes(1);
    expect(store.db.character.update).not.toHaveBeenCalled();
    expect(store.slots()).toEqual({ "1": { current: 0, max: 1 } });
  });
});
