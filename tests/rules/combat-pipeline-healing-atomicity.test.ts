import { afterEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

import {
  executeCombatAction,
  type CombatActionPayload,
} from "@/lib/rules/combat-pipeline";

function healingSpellPayload(dice = "1d2"): CombatActionPayload {
  return {
    actionType: "cast_spell",
    encounter: {
      id: "",
      round: 0,
      currentTurnIndex: 0,
      totalDamageDealt: 0,
      status: "active",
      combatants: [],
    },
    actorId: "char-1",
    actorName: "Aldric",
    actorConditions: [],
    targetCombatants: [],
    spellName: "Healing Word",
    spellLevel: 0,
    spellEffect: { type: "healing", dice },
    playerCharacterId: "char-1",
    collectEvents: true,
  };
}

function casTx() {
  return {
    character: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    inventoryItem: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
    },
    combatant: {
      update: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    encounter: {
      update: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
  } as unknown as Prisma.TransactionClient;
}

describe("combat-pipeline Character.hp healing atomicity", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rebases the same healing roll after a stale HP compare-and-set misses", async () => {
    const tx = casTx();
    const character = tx.character as unknown as {
      findUnique: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };

    character.findUnique
      .mockResolvedValueOnce({ hp: 10, maxHp: 20 })
      .mockResolvedValueOnce({ hp: 14, maxHp: 20 });
    character.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    const random = vi.spyOn(Math, "random").mockReturnValue(0.99); // 1d2 => 2

    const outcome = await executeCombatAction(healingSpellPayload(), tx);

    expect(character.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "char-1", hp: 10 },
      data: { hp: 12 },
    });
    expect(character.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "char-1", hp: 14 },
      data: { hp: 16 },
    });
    expect(character.update).not.toHaveBeenCalled();
    expect(random).toHaveBeenCalledTimes(1);

    const healing = outcome.events.find((event) => event.type === "HEALING_RECEIVED");
    expect(healing?.payload).toMatchObject({ amount: 2, newHp: 16 });
  });

  it("preserves the max-HP cap on the CAS path", async () => {
    const tx = casTx();
    const character = tx.character as unknown as {
      findUnique: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };

    character.findUnique.mockResolvedValueOnce({ hp: 19, maxHp: 20 });
    character.updateMany.mockResolvedValueOnce({ count: 1 });
    vi.spyOn(Math, "random").mockReturnValue(0.99); // 1d8 => 8

    const outcome = await executeCombatAction(healingSpellPayload("1d8"), tx);

    expect(character.updateMany).toHaveBeenCalledWith({
      where: { id: "char-1", hp: 19 },
      data: { hp: 20 },
    });
    expect(character.update).not.toHaveBeenCalled();

    const healing = outcome.events.find((event) => event.type === "HEALING_RECEIVED");
    expect(healing?.payload).toMatchObject({ amount: 8, newHp: 20 });
  });
});
