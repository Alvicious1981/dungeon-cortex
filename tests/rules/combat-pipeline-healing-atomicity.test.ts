import { afterEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

import {
  executeCombatAction,
  type CombatActionPayload,
} from "@/lib/rules/combat-pipeline";

function emptyEncounter(): CombatActionPayload["encounter"] {
  return {
    id: "",
    round: 0,
    currentTurnIndex: 0,
    totalDamageDealt: 0,
    status: "active",
    combatants: [],
  };
}

function itemPayload(): CombatActionPayload {
  return {
    actionType: "use_item",
    encounter: emptyEncounter(),
    actorId: "char-1",
    actorName: "Aldric",
    actorConditions: [],
    targetCombatants: [],
    itemId: "item-1",
    itemName: "Healing Potion",
    healingDice: "1d2",
    healingBonus: 0,
    playerCharacterId: "char-1",
    collectEvents: true,
  };
}

function spellPayload(): CombatActionPayload {
  return {
    actionType: "cast_spell",
    encounter: emptyEncounter(),
    actorId: "char-1",
    actorName: "Aldric",
    actorConditions: [],
    targetCombatants: [],
    spellName: "Cure Wounds",
    spellEffect: { type: "healing", dice: "1d2" },
    playerCharacterId: "char-1",
    collectEvents: true,
  };
}

function atomicTx() {
  return {
    inventoryItem: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
    },
    character: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
  } as unknown as Prisma.TransactionClient;
}

describe("combat-pipeline Character healing atomicity", () => {
  afterEach(() => vi.restoreAllMocks());

  it("re-bases the same rolled heal after a stale HP compare-and-set", async () => {
    const tx = atomicTx();
    const inventory = tx.inventoryItem as unknown as {
      findUnique: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    const character = tx.character as unknown as {
      findUnique: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };

    // Consumable authorization succeeds once and must not be repeated merely
    // because Character.hp changed underneath the healing write.
    inventory.findUnique.mockResolvedValueOnce({ quantity: 1 });
    inventory.deleteMany.mockResolvedValueOnce({ count: 1 });

    // First healing snapshot loses its CAS. The retry observes another heal
    // already committed at hp=12 and applies this action's original +1 there.
    character.findUnique
      .mockResolvedValueOnce({ hp: 10, maxHp: 20 })
      .mockResolvedValueOnce({ hp: 12, maxHp: 20 });
    character.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    const random = vi.spyOn(Math, "random").mockReturnValue(0); // 1d2 => 1

    const outcome = await executeCombatAction(itemPayload(), tx);

    expect(random).toHaveBeenCalledTimes(1);
    expect(inventory.findUnique).toHaveBeenCalledTimes(1);
    expect(inventory.deleteMany).toHaveBeenCalledTimes(1);
    expect(character.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "char-1", hp: 10, maxHp: 20 },
      data: { hp: 11 },
    });
    expect(character.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "char-1", hp: 12, maxHp: 20 },
      data: { hp: 13 },
    });
    expect(character.update).not.toHaveBeenCalled();

    expect(outcome.events).toContainEqual({
      type: "HEALING_RECEIVED",
      payload: { amount: 1, newHp: 13, itemName: "Healing Potion" },
    });
  });

  it("keeps the max-HP cap on the CAS path", async () => {
    const tx = atomicTx();
    const character = tx.character as unknown as {
      findUnique: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };

    character.findUnique.mockResolvedValueOnce({ hp: 19, maxHp: 20 });
    character.updateMany.mockResolvedValueOnce({ count: 1 });
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99); // 1d2 => 2

    const outcome = await executeCombatAction(spellPayload(), tx);

    expect(random).toHaveBeenCalledTimes(1);
    expect(character.updateMany).toHaveBeenCalledWith({
      where: { id: "char-1", hp: 19, maxHp: 20 },
      data: { hp: 20 },
    });
    expect(character.update).not.toHaveBeenCalled();
    expect(outcome.events).toContainEqual({
      type: "HEALING_RECEIVED",
      payload: { amount: 2, newHp: 20, spellName: "Cure Wounds" },
    });
  });
});
