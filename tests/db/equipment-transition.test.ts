import { beforeEach, describe, expect, it, vi } from "vitest";

const { finalizeEncounterTurn } = vi.hoisted(() => ({ finalizeEncounterTurn: vi.fn() }));
vi.mock("@/lib/rules/combat-pipeline", () => ({ finalizeEncounterTurn }));

import {
  EquipmentTransitionError,
  persistEquipmentTransition,
} from "@/lib/db/equipment-transition";

function txFixture(overrides: { interaction?: boolean | null; occupant?: { id: string } | null } = {}) {
  const item = { id: "sword", name: "Sword", type: "weapon", properties: {}, equippedSlot: null };
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "character" }]),
    inventoryItem: {
      findFirst: vi.fn()
        .mockResolvedValueOnce(item)
        .mockResolvedValueOnce(overrides.occupant ?? null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn().mockResolvedValue(item),
    },
    encounter: {
      findFirst: vi.fn().mockResolvedValue({
        currentTurnObjectInteractionUsed: overrides.interaction ?? false,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    gameLog: { create: vi.fn().mockResolvedValue({}) },
  };
}

const input = {
  campaignId: "campaign",
  characterId: "character",
  itemId: "sword",
  encounterId: "encounter",
  expectedRound: 2,
  expectedTurnIndex: 0,
  playerAction: "equip Sword",
};

describe("persistEquipmentTransition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    finalizeEncounterTurn.mockResolvedValue({ events: [], turnAdvanceConflict: false });
  });

  it("locks, re-reads, claims the exact free interaction, mutates, then logs", async () => {
    const tx = txFixture();
    await persistEquipmentTransition(tx as never, input);

    expect(tx.$queryRaw).toHaveBeenCalledBefore(tx.inventoryItem.findFirst);
    expect(tx.encounter.updateMany).toHaveBeenCalledWith({
      where: {
        id: "encounter", status: "active", round: 2, currentTurnIndex: 0,
        currentTurnObjectInteractionUsed: false,
      },
      data: { currentTurnObjectInteractionUsed: true },
    });
    expect(tx.encounter.updateMany).toHaveBeenCalledBefore(tx.inventoryItem.updateMany);
    expect(tx.gameLog.create).toHaveBeenCalledOnce();
    expect(finalizeEncounterTurn).not.toHaveBeenCalled();
  });

  it("aborts before inventory/history when the budget claim loses", async () => {
    const tx = txFixture();
    tx.encounter.updateMany.mockResolvedValue({ count: 0 });
    await expect(persistEquipmentTransition(tx as never, input)).rejects.toEqual(
      expect.objectContaining<Partial<EquipmentTransitionError>>({ code: "EQUIPMENT_STATE_CONFLICT" })
    );
    expect(tx.inventoryItem.update).not.toHaveBeenCalled();
    expect(tx.gameLog.create).not.toHaveBeenCalled();
  });

  it("uses the fail-closed turn finalizer for an action-cost replacement", async () => {
    const tx = txFixture({ occupant: { id: "old" } });
    await persistEquipmentTransition(tx as never, input);
    expect(finalizeEncounterTurn).toHaveBeenCalledWith(expect.objectContaining({
      encounterId: "encounter", currentTurnIndex: 0, round: 2, failOnStaleTurn: true,
    }));
  });
});
