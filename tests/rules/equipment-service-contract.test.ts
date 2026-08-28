import { beforeEach, describe, expect, it, vi } from "vitest";

type InventoryItemFixture = {
  id: string;
  characterId: string;
  campaignId: string;
  name: string;
  type: string;
  quantity: number;
  properties: Record<string, unknown>;
  equippedSlot: string | null;
};

type EquipCharacterItemInput = {
  campaignId: string;
  characterId: string;
  itemId: string;
  targetSlot: string;
  tx: {
    inventoryItem: {
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
};

type EquipCharacterItem = (input: EquipCharacterItemInput) => Promise<unknown>;

const baseItems: InventoryItemFixture[] = [
  {
    id: "sword-1",
    characterId: "character-1",
    campaignId: "campaign-1",
    name: "Longsword",
    type: "weapon",
    quantity: 1,
    properties: {},
    equippedSlot: null,
  },
  {
    id: "dagger-1",
    characterId: "character-1",
    campaignId: "campaign-1",
    name: "Dagger",
    type: "weapon",
    quantity: 1,
    properties: {},
    equippedSlot: "MAIN_HAND",
  },
  {
    id: "staff-other",
    characterId: "character-2",
    campaignId: "campaign-1",
    name: "Quarterstaff",
    type: "weapon",
    quantity: 1,
    properties: {},
    equippedSlot: "MAIN_HAND",
  },
  {
    id: "axe-other-campaign",
    characterId: "character-3",
    campaignId: "campaign-2",
    name: "Handaxe",
    type: "weapon",
    quantity: 1,
    properties: {},
    equippedSlot: "MAIN_HAND",
  },
];

async function loadEquipCharacterItem(): Promise<EquipCharacterItem> {
  // Future module intentionally does not exist in Fase 2. Runtime failure is
  // the expected red TDD state until Fase 3 adds the authoritative service.
  const mod = await import("../../lib/rules/equipment-service");
  return mod.equipCharacterItem as EquipCharacterItem;
}

function createTx(items: InventoryItemFixture[]) {
  const state = items.map((item) => ({ ...item }));
  return {
    state,
    tx: {
      inventoryItem: {
        findMany: vi.fn(async ({ where }: { where: { campaignId: string } }) =>
          state.filter((item) => item.campaignId === where.campaignId)
        ),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: { equippedSlot: string | null } }) => {
          const item = state.find((candidate) => candidate.id === where.id);
          if (!item) throw new Error(`Missing item ${where.id}`);
          item.equippedSlot = data.equippedSlot;
          return { ...item };
        }),
      },
    },
  };
}

describe("equipCharacterItem service contract", () => {
  let equipCharacterItem: EquipCharacterItem;

  beforeEach(async () => {
    equipCharacterItem = await loadEquipCharacterItem();
  });

  it("rejects a missing item", async () => {
    const { tx } = createTx(baseItems);

    await expect(
      equipCharacterItem({
        campaignId: "campaign-1",
        characterId: "character-1",
        itemId: "missing-item",
        targetSlot: "MAIN_HAND",
        tx,
      })
    ).rejects.toMatchObject({
      code: "ITEM_NOT_FOUND",
    });
  });

  it("rejects an item that does not belong to the character in the campaign", async () => {
    const { tx } = createTx(baseItems);

    await expect(
      equipCharacterItem({
        campaignId: "campaign-1",
        characterId: "character-1",
        itemId: "staff-other",
        targetSlot: "MAIN_HAND",
        tx,
      })
    ).rejects.toMatchObject({
      code: "ITEM_OWNERSHIP_MISMATCH",
    });
  });

  it("equips a valid item into the target slot", async () => {
    const { state, tx } = createTx(baseItems);

    const result = await equipCharacterItem({
      campaignId: "campaign-1",
      characterId: "character-1",
      itemId: "sword-1",
      targetSlot: "MAIN_HAND",
      tx,
    });

    expect(state.find((item) => item.id === "sword-1")?.equippedSlot).toBe("MAIN_HAND");
    expect(result).toMatchObject({
      ok: true,
      facts: {
        type: "equipment_changed",
        characterId: "character-1",
        itemId: "sword-1",
        itemName: "Longsword",
        targetSlot: "MAIN_HAND",
      },
    });
  });

  it("clears another item already equipped in the same slot", async () => {
    const { state, tx } = createTx(baseItems);

    await equipCharacterItem({
      campaignId: "campaign-1",
      characterId: "character-1",
      itemId: "sword-1",
      targetSlot: "MAIN_HAND",
      tx,
    });

    expect(state.find((item) => item.id === "dagger-1")?.equippedSlot).toBeNull();
    expect(state.find((item) => item.id === "sword-1")?.equippedSlot).toBe("MAIN_HAND");
  });

  it("does not touch items owned by other characters", async () => {
    const { state, tx } = createTx(baseItems);

    await equipCharacterItem({
      campaignId: "campaign-1",
      characterId: "character-1",
      itemId: "sword-1",
      targetSlot: "MAIN_HAND",
      tx,
    });

    expect(state.find((item) => item.id === "staff-other")?.equippedSlot).toBe("MAIN_HAND");
    expect(state.find((item) => item.id === "axe-other-campaign")?.equippedSlot).toBe("MAIN_HAND");
  });

  it("returns structured facts for narration without deciding prose", async () => {
    const { tx } = createTx(baseItems);

    const result = await equipCharacterItem({
      campaignId: "campaign-1",
      characterId: "character-1",
      itemId: "sword-1",
      targetSlot: "MAIN_HAND",
      tx,
    });

    expect(result).toMatchObject({
      ok: true,
      facts: {
        type: "equipment_changed",
        itemName: "Longsword",
        targetSlot: "MAIN_HAND",
      },
    });
    expect(result).not.toHaveProperty("narration");
    expect(result).not.toHaveProperty("prose");
    expect(result).not.toHaveProperty("message");
  });

  it("maps an illegal placement to ILLEGAL_SLOT_FOR_ITEM and writes nothing", async () => {
    const { tx } = createTx(baseItems);

    await expect(
      equipCharacterItem({
        campaignId: "campaign-1",
        characterId: "character-1",
        itemId: "sword-1",
        targetSlot: "ARMOR",
        tx,
      })
    ).rejects.toMatchObject({
      name: "EquipmentServiceError",
      code: "ILLEGAL_SLOT_FOR_ITEM",
    });

    expect(tx.inventoryItem.update).not.toHaveBeenCalled();
  });
});
