import { beforeEach, describe, expect, it, vi } from "vitest";

type CharacterFixture = {
  id: string;
  campaignId: string;
  hp: number;
  maxHp: number;
};

type InventoryItemFixture = {
  id: string;
  characterId: string;
  campaignId: string;
  name: string;
  type: string;
  quantity: number;
  properties: Record<string, unknown>;
};

type ConsumableTx = {
  campaign: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  character: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  inventoryItem: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
};

type UseConsumableItemInput = {
  campaignId: string;
  characterId: string;
  itemId: string;
  quantity?: number;
  tx: ConsumableTx;
};

type UseConsumableItem = (input: UseConsumableItemInput) => Promise<unknown>;

const baseCharacters: CharacterFixture[] = [
  {
    id: "character-1",
    campaignId: "campaign-1",
    hp: 4,
    maxHp: 10,
  },
  {
    id: "character-2",
    campaignId: "campaign-1",
    hp: 8,
    maxHp: 12,
  },
  {
    id: "character-3",
    campaignId: "campaign-2",
    hp: 3,
    maxHp: 9,
  },
];

const baseItems: InventoryItemFixture[] = [
  {
    id: "potion-1",
    characterId: "character-1",
    campaignId: "campaign-1",
    name: "Potion of Healing",
    type: "potion",
    quantity: 2,
    properties: { healingAmount: 6 },
  },
  {
    id: "potion-single",
    characterId: "character-1",
    campaignId: "campaign-1",
    name: "Potion of Healing",
    type: "potion",
    quantity: 1,
    properties: { healingAmount: 4 },
  },
  {
    id: "rope-1",
    characterId: "character-1",
    campaignId: "campaign-1",
    name: "Hempen Rope",
    type: "gear",
    quantity: 1,
    properties: {},
  },
  {
    id: "empty-potion",
    characterId: "character-1",
    campaignId: "campaign-1",
    name: "Empty Potion",
    type: "potion",
    quantity: 0,
    properties: { healingAmount: 4 },
  },
  {
    id: "other-character-potion",
    characterId: "character-2",
    campaignId: "campaign-1",
    name: "Potion of Healing",
    type: "potion",
    quantity: 1,
    properties: { healingAmount: 4 },
  },
  {
    id: "other-campaign-potion",
    characterId: "character-3",
    campaignId: "campaign-2",
    name: "Potion of Healing",
    type: "potion",
    quantity: 1,
    properties: { healingAmount: 4 },
  },
];

async function loadUseConsumableItem(): Promise<UseConsumableItem> {
  const modulePath = "../../lib/rules/consumable-service";
  const mod = await import(modulePath);
  return mod.useConsumableItem as UseConsumableItem;
}

function createTx(options?: {
  characters?: CharacterFixture[];
  items?: InventoryItemFixture[];
  campaignIds?: string[];
}) {
  const characters = (options?.characters ?? baseCharacters).map((character) => ({
    ...character,
  }));
  const items = (options?.items ?? baseItems).map((item) => ({ ...item }));
  const campaignIds = new Set(options?.campaignIds ?? ["campaign-1", "campaign-2"]);

  const tx: ConsumableTx = {
    campaign: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        campaignIds.has(where.id) ? { id: where.id } : null
      ),
    },
    character: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        characters.find((character) => character.id === where.id) ?? null
      ),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: { hp: number } }) => {
          const character = characters.find((candidate) => candidate.id === where.id);
          if (!character) throw new Error(`Missing character ${where.id}`);
          character.hp = data.hp;
          return { ...character };
        }
      ),
    },
    inventoryItem: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        items.find((item) => matchesItemWhere(item, where)) ?? null
      ),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        items.find((item) => item.id === where.id) ?? null
      ),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: { quantity: number } }) => {
          const item = items.find((candidate) => candidate.id === where.id);
          if (!item) throw new Error(`Missing item ${where.id}`);
          item.quantity = data.quantity;
          return { ...item };
        }
      ),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = items.findIndex((item) => item.id === where.id);
        if (index === -1) throw new Error(`Missing item ${where.id}`);
        const [deleted] = items.splice(index, 1);
        return { ...deleted };
      }),
    },
  };

  return { characters, items, tx };
}

function matchesItemWhere(
  item: InventoryItemFixture,
  where: Record<string, unknown>
): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "quantity" && isQuantityFilter(expected)) {
      if (typeof expected.gt === "number" && !(item.quantity > expected.gt)) return false;
      if (typeof expected.gte === "number" && !(item.quantity >= expected.gte)) return false;
      return true;
    }

    return item[key as keyof InventoryItemFixture] === expected;
  });
}

function isQuantityFilter(value: unknown): value is { gt?: number; gte?: number } {
  return typeof value === "object" && value !== null;
}

describe("useConsumableItem service contract", () => {
  let useConsumableItem: UseConsumableItem;

  beforeEach(async () => {
    useConsumableItem = await loadUseConsumableItem();
  });

  it("rejects a missing campaign", async () => {
    const { tx } = createTx({ campaignIds: ["campaign-1"] });

    await expect(
      useConsumableItem({
        campaignId: "missing-campaign",
        characterId: "character-1",
        itemId: "potion-1",
        tx,
      })
    ).rejects.toMatchObject({ code: "CAMPAIGN_NOT_FOUND" });
  });

  it("rejects a missing character", async () => {
    const { tx } = createTx();

    await expect(
      useConsumableItem({
        campaignId: "campaign-1",
        characterId: "missing-character",
        itemId: "potion-1",
        tx,
      })
    ).rejects.toMatchObject({ code: "CHARACTER_NOT_FOUND" });
  });

  it("rejects a missing item", async () => {
    const { tx } = createTx();

    await expect(
      useConsumableItem({
        campaignId: "campaign-1",
        characterId: "character-1",
        itemId: "missing-item",
        tx,
      })
    ).rejects.toMatchObject({ code: "ITEM_NOT_FOUND" });
  });

  it("rejects an item that does not belong to the character and campaign", async () => {
    const { tx } = createTx();

    await expect(
      useConsumableItem({
        campaignId: "campaign-1",
        characterId: "character-1",
        itemId: "other-character-potion",
        tx,
      })
    ).rejects.toMatchObject({ code: "ITEM_OWNERSHIP_MISMATCH" });
  });

  it("rejects a non-consumable item without a recognized consumable effect", async () => {
    const { tx } = createTx();

    await expect(
      useConsumableItem({
        campaignId: "campaign-1",
        characterId: "character-1",
        itemId: "rope-1",
        tx,
      })
    ).rejects.toMatchObject({ code: "ITEM_NOT_CONSUMABLE" });
  });

  it("rejects an item with quantity <= 0", async () => {
    const { tx } = createTx();

    await expect(
      useConsumableItem({
        campaignId: "campaign-1",
        characterId: "character-1",
        itemId: "empty-potion",
        tx,
      })
    ).rejects.toMatchObject({ code: "ITEM_QUANTITY_EMPTY" });
  });

  it("heals HP without exceeding maxHp", async () => {
    const { characters, tx } = createTx();

    const result = await useConsumableItem({
      campaignId: "campaign-1",
      characterId: "character-1",
      itemId: "potion-1",
      tx,
    });

    expect(characters.find((character) => character.id === "character-1")?.hp).toBe(10);
    expect(result).toMatchObject({
      ok: true,
      facts: {
        type: "consumable_used",
        campaignId: "campaign-1",
        characterId: "character-1",
        itemId: "potion-1",
        hpBefore: 4,
        hpAfter: 10,
        hpRestored: 6,
      },
    });
  });

  it("decrements quantity when quantity is greater than 1", async () => {
    const { items, tx } = createTx();

    await useConsumableItem({
      campaignId: "campaign-1",
      characterId: "character-1",
      itemId: "potion-1",
      tx,
    });

    expect(items.find((item) => item.id === "potion-1")?.quantity).toBe(1);
    expect(tx.inventoryItem.delete).not.toHaveBeenCalledWith({
      where: { id: "potion-1" },
    });
  });

  it("removes or marks consumed an item when quantity is exactly 1", async () => {
    const { items, tx } = createTx();

    await useConsumableItem({
      campaignId: "campaign-1",
      characterId: "character-1",
      itemId: "potion-single",
      tx,
    });

    const consumedItem = items.find((item) => item.id === "potion-single");
    expect(consumedItem === undefined || consumedItem.quantity === 0).toBe(true);
  });

  it("does not touch items owned by other characters", async () => {
    const { items, tx } = createTx();

    await useConsumableItem({
      campaignId: "campaign-1",
      characterId: "character-1",
      itemId: "potion-1",
      tx,
    });

    expect(items.find((item) => item.id === "other-character-potion")?.quantity).toBe(1);
    expect(items.find((item) => item.id === "other-campaign-potion")?.quantity).toBe(1);
  });

  it("returns structured facts for narration", async () => {
    const { tx } = createTx();

    const result = await useConsumableItem({
      campaignId: "campaign-1",
      characterId: "character-1",
      itemId: "potion-1",
      tx,
    });

    expect(result).toMatchObject({
      ok: true,
      facts: {
        type: "consumable_used",
        itemName: "Potion of Healing",
        effect: "healing",
      },
    });
  });

  it("does not return narrative text", async () => {
    const { tx } = createTx();

    const result = await useConsumableItem({
      campaignId: "campaign-1",
      characterId: "character-1",
      itemId: "potion-1",
      tx,
    });

    expect(JSON.stringify(result)).not.toMatch(
      /\b(narration|narrative|prose|flavorText|message)\b/i
    );
  });

  it("does not call AI", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { tx } = createTx();

    await useConsumableItem({
      campaignId: "campaign-1",
      characterId: "character-1",
      itemId: "potion-1",
      tx,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not introduce AD&D or OSR mechanics", async () => {
    const { tx } = createTx();

    const result = await useConsumableItem({
      campaignId: "campaign-1",
      characterId: "character-1",
      itemId: "potion-1",
      tx,
    });

    expect(JSON.stringify(result)).not.toMatch(
      /AD&D|OSR|THAC0|descending AC|AC descendente|saving throw vs|save vs death|gold for XP|XP por oro/i
    );
  });
});
