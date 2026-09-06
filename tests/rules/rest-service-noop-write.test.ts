import { describe, expect, it, vi } from "vitest";

import { resolveRest } from "../../lib/rules/rest-service";

type RestTx = NonNullable<Parameters<typeof resolveRest>[0]["tx"]>;

function makeTx(input: {
  hp: number;
  maxHp: number;
  hitDiceRemaining: number;
}) {
  const character = {
    id: "char-1",
    hp: input.hp,
    maxHp: input.maxHp,
    level: 2,
    class: "fighter",
    stats: { CON: 14 },
    spellSlots: null,
    hitDiceTotal: 2,
    hitDiceRemaining: input.hitDiceRemaining,
    exhaustionLevel: 0,
  };

  const update = vi.fn(async () => {
    throw new Error("a no-op short rest must not write Character");
  });

  const tx = {
    campaign: {
      findUnique: vi.fn(async () => ({ id: "camp-1", characterId: "char-1" })),
    },
    character: {
      findUnique: vi.fn(async () => character),
      update,
    },
    encounter: {
      findFirst: vi.fn(async () => null),
    },
  } as unknown as RestTx;

  return { tx, update };
}

describe("rest-service no-op writes", () => {
  it("does not update Character when an implicit short rest starts at full HP", async () => {
    const { tx, update } = makeTx({ hp: 20, maxHp: 20, hitDiceRemaining: 2 });

    const result = await resolveRest({
      campaignId: "camp-1",
      characterId: "char-1",
      restType: "short",
      tx,
    });

    expect(result.facts.hpRecovered).toBe(0);
    expect(result.facts.hitDiceSpent).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it("does not update Character when an implicit short rest has no Hit Dice left", async () => {
    const { tx, update } = makeTx({ hp: 5, maxHp: 20, hitDiceRemaining: 0 });

    const result = await resolveRest({
      campaignId: "camp-1",
      characterId: "char-1",
      restType: "short",
      tx,
    });

    expect(result.facts.hpRecovered).toBe(0);
    expect(result.facts.hitDiceSpent).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });
});
