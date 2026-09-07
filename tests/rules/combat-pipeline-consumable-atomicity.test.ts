import { afterEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

import {
  executeCombatAction,
  type CombatActionPayload,
} from "@/lib/rules/combat-pipeline";

function payload(): CombatActionPayload {
  return {
    actionType: "use_item",
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
    itemId: "item-1",
    itemName: "Healing Potion",
    healingDice: "1d2",
    healingBonus: 0,
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
      findUnique: vi.fn().mockResolvedValue({ hp: 10, maxHp: 20 }),
      update: vi.fn().mockResolvedValue({}),
    },
  } as unknown as Prisma.TransactionClient;
}

describe("combat-pipeline consumable atomicity", () => {
  afterEach(() => vi.restoreAllMocks());

  it("grants no effect when the final-unit conditional delete loses", async () => {
    const tx = atomicTx();
    const inventory = tx.inventoryItem as unknown as {
      findUnique: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    const character = tx.character as unknown as {
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };

    inventory.findUnique
      .mockResolvedValueOnce({ quantity: 1 })
      .mockResolvedValueOnce(null);
    inventory.deleteMany.mockResolvedValueOnce({ count: 0 });

    const outcome = await executeCombatAction(payload(), tx);

    expect(inventory.deleteMany).toHaveBeenCalledWith({
      where: { id: "item-1", quantity: 1 },
    });
    expect(inventory.updateMany).not.toHaveBeenCalled();
    expect(inventory.update).not.toHaveBeenCalled();
    expect(character.findUnique).not.toHaveBeenCalled();
    expect(character.update).not.toHaveBeenCalled();
    expect(outcome.events.some((event) => event.type === "HEALING_RECEIVED")).toBe(false);
  });

  it("re-reads after a stale stacked-item claim and consumes the remaining unit", async () => {
    const tx = atomicTx();
    const inventory = tx.inventoryItem as unknown as {
      findUnique: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    const character = tx.character as unknown as {
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };

    inventory.findUnique
      .mockResolvedValueOnce({ quantity: 2 })
      .mockResolvedValueOnce({ quantity: 1 });
    inventory.updateMany.mockResolvedValueOnce({ count: 0 });
    inventory.deleteMany.mockResolvedValueOnce({ count: 1 });
    vi.spyOn(Math, "random").mockReturnValue(0);

    const outcome = await executeCombatAction(payload(), tx);

    expect(inventory.updateMany).toHaveBeenCalledWith({
      where: { id: "item-1", quantity: 2 },
      data: { quantity: { decrement: 1 } },
    });
    expect(inventory.deleteMany).toHaveBeenCalledWith({
      where: { id: "item-1", quantity: 1 },
    });
    expect(inventory.update).not.toHaveBeenCalled();
    expect(character.update).toHaveBeenCalledWith({
      where: { id: "char-1" },
      data: { hp: 11 },
    });
    expect(outcome.events.filter((event) => event.type === "HEALING_RECEIVED")).toHaveLength(1);
  });
});
