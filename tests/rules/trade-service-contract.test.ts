import { beforeEach, describe, expect, it, vi } from "vitest";

type CampaignFixture = {
  id: string;
  characterId: string;
  gold: number;
};

type CharacterFixture = {
  id: string;
  campaignId: string;
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

type ItemDescriptorFixture = {
  name: string;
  type: string;
  properties?: Record<string, unknown>;
};

type TradeTx = {
  campaign: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  character: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  inventoryItem: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
};

type ResolveTradeTransactionInput = {
  campaignId: string;
  characterId: string;
  merchantId?: string;
  npcId?: string;
  operation: "buy" | "sell" | string;
  itemId?: string;
  itemDescriptor?: ItemDescriptorFixture;
  price: number;
  quantity: number;
  tx: TradeTx;
};

type ResolveTradeTransaction = (
  input: ResolveTradeTransactionInput
) => Promise<unknown>;

const baseCampaigns: CampaignFixture[] = [
  { id: "campaign-1", characterId: "character-1", gold: 100 },
  { id: "campaign-2", characterId: "character-3", gold: 250 },
];

const baseCharacters: CharacterFixture[] = [
  { id: "character-1", campaignId: "campaign-1" },
  { id: "character-2", campaignId: "campaign-1" },
  { id: "character-3", campaignId: "campaign-2" },
];

const baseItems: InventoryItemFixture[] = [
  {
    id: "rope-1",
    characterId: "character-1",
    campaignId: "campaign-1",
    name: "Hempen Rope",
    type: "misc",
    quantity: 2,
    properties: { valueGP: 1 },
  },
  {
    id: "gem-1",
    characterId: "character-1",
    campaignId: "campaign-1",
    name: "Tiny Garnet",
    type: "misc",
    quantity: 1,
    properties: { valueGP: 25 },
  },
  {
    id: "other-character-rope",
    characterId: "character-2",
    campaignId: "campaign-1",
    name: "Hempen Rope",
    type: "misc",
    quantity: 5,
    properties: { valueGP: 1 },
  },
  {
    id: "other-campaign-rope",
    characterId: "character-3",
    campaignId: "campaign-2",
    name: "Hempen Rope",
    type: "misc",
    quantity: 4,
    properties: { valueGP: 1 },
  },
];

async function loadResolveTradeTransaction(): Promise<ResolveTradeTransaction> {
  const modulePath = "../../lib/rules/trade-service";
  const mod = await import(modulePath);
  return mod.resolveTradeTransaction as ResolveTradeTransaction;
}

function createTx(options?: {
  campaigns?: CampaignFixture[];
  characters?: CharacterFixture[];
  items?: InventoryItemFixture[];
}) {
  const campaigns = (options?.campaigns ?? baseCampaigns).map((campaign) => ({
    ...campaign,
  }));
  const characters = (options?.characters ?? baseCharacters).map((character) => ({
    ...character,
  }));
  const items = (options?.items ?? baseItems).map((item) => ({ ...item }));

  const tx: TradeTx = {
    campaign: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        campaigns.find((campaign) => campaign.id === where.id) ?? null
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { gold: { decrement?: number; increment?: number } };
        }) => {
          const campaign = campaigns.find((candidate) => candidate.id === where.id);
          if (!campaign) throw new Error(`Missing campaign ${where.id}`);
          campaign.gold -= data.gold.decrement ?? 0;
          campaign.gold += data.gold.increment ?? 0;
          return { ...campaign };
        }
      ),
    },
    character: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        characters.find((character) => character.id === where.id) ?? null
      ),
    },
    inventoryItem: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        items.find((item) => matchesItemWhere(item, where)) ?? null
      ),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        items.find((item) => item.id === where.id) ?? null
      ),
      create: vi.fn(
        async ({ data }: { data: Omit<InventoryItemFixture, "id" | "campaignId"> & { campaignId?: string } }) => {
          const item = {
            id: `created-${items.length + 1}`,
            campaignId: data.campaignId ?? characterCampaignId(data.characterId, characters),
            characterId: data.characterId,
            name: data.name,
            type: data.type,
            quantity: data.quantity,
            properties: data.properties ?? {},
          };
          items.push(item);
          return { ...item };
        }
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

  return { campaigns, characters, items, tx };
}

function matchesItemWhere(
  item: InventoryItemFixture,
  where: Record<string, unknown>
): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "name" && isInsensitiveEqualsFilter(expected)) {
      return item.name.toLowerCase() === expected.equals.toLowerCase();
    }

    return item[key as keyof InventoryItemFixture] === expected;
  });
}

function isInsensitiveEqualsFilter(
  value: unknown
): value is { equals: string; mode?: "insensitive" } {
  return (
    typeof value === "object" &&
    value !== null &&
    "equals" in value &&
    typeof value.equals === "string"
  );
}

function characterCampaignId(
  characterId: string,
  characters: CharacterFixture[]
): string {
  return characters.find((character) => character.id === characterId)?.campaignId ?? "";
}

function buyInput(tx: TradeTx, overrides?: Partial<ResolveTradeTransactionInput>) {
  return {
    campaignId: "campaign-1",
    characterId: "character-1",
    merchantId: "merchant-1",
    operation: "buy",
    itemDescriptor: {
      name: "Potion of Healing",
      type: "consumable",
      properties: { valueGP: 50, healingAmount: 6 },
    },
    price: 50,
    quantity: 1,
    tx,
    ...overrides,
  };
}

function sellInput(tx: TradeTx, overrides?: Partial<ResolveTradeTransactionInput>) {
  return {
    campaignId: "campaign-1",
    characterId: "character-1",
    npcId: "merchant-1",
    operation: "sell",
    itemId: "rope-1",
    price: 2,
    quantity: 1,
    tx,
    ...overrides,
  };
}

describe("resolveTradeTransaction service contract", () => {
  let resolveTradeTransaction: ResolveTradeTransaction;

  beforeEach(async () => {
    resolveTradeTransaction = await loadResolveTradeTransaction();
  });

  it("rejects a missing campaign", async () => {
    const { tx } = createTx({ campaigns: [] });

    await expect(resolveTradeTransaction(buyInput(tx))).rejects.toMatchObject({
      code: "CAMPAIGN_NOT_FOUND",
    });
  });

  it("rejects a missing character", async () => {
    const { tx } = createTx({ characters: [] });

    await expect(resolveTradeTransaction(buyInput(tx))).rejects.toMatchObject({
      code: "CHARACTER_NOT_FOUND",
    });
  });

  it("rejects an invalid operation", async () => {
    const { tx } = createTx();

    await expect(
      resolveTradeTransaction(buyInput(tx, { operation: "barter" }))
    ).rejects.toMatchObject({ code: "INVALID_OPERATION" });
  });

  it("rejects quantity <= 0", async () => {
    const { tx } = createTx();

    await expect(
      resolveTradeTransaction(buyInput(tx, { quantity: 0 }))
    ).rejects.toMatchObject({ code: "INVALID_QUANTITY" });
  });

  it("rejects price < 0", async () => {
    const { tx } = createTx();

    await expect(
      resolveTradeTransaction(buyInput(tx, { price: -1 }))
    ).rejects.toMatchObject({ code: "INVALID_PRICE" });
  });

  it("rejects a buy with insufficient gold", async () => {
    const { tx } = createTx({ campaigns: [{ id: "campaign-1", characterId: "character-1", gold: 10 }] });

    await expect(
      resolveTradeTransaction(buyInput(tx, { price: 50, quantity: 1 }))
    ).rejects.toMatchObject({ code: "INSUFFICIENT_GOLD" });
  });

  it("deducts gold and creates or adds an item for a valid buy", async () => {
    const { campaigns, items, tx } = createTx();

    const result = await resolveTradeTransaction(buyInput(tx));

    expect(campaigns.find((campaign) => campaign.id === "campaign-1")?.gold).toBe(50);
    expect(items.find((item) => item.name === "Potion of Healing")).toMatchObject({
      characterId: "character-1",
      campaignId: "campaign-1",
      quantity: 1,
    });
    expect(result).toMatchObject({
      ok: true,
      operation: "buy",
      facts: {
        type: "trade_transaction_resolved",
        campaignId: "campaign-1",
        characterId: "character-1",
        operation: "buy",
        itemName: "Potion of Healing",
        goldDelta: -50,
        goldAfter: 50,
      },
    });
  });

  it("does not allow a valid buy to make gold negative", async () => {
    const { campaigns, tx } = createTx({ campaigns: [{ id: "campaign-1", characterId: "character-1", gold: 50 }] });

    await resolveTradeTransaction(buyInput(tx, { price: 50, quantity: 1 }));

    expect(campaigns.find((campaign) => campaign.id === "campaign-1")?.gold).toBe(0);
  });

  it("rejects sale of a missing item", async () => {
    const { tx } = createTx();

    await expect(
      resolveTradeTransaction(sellInput(tx, { itemId: "missing-item" }))
    ).rejects.toMatchObject({ code: "ITEM_NOT_FOUND" });
  });

  it("rejects sale of an item that does not belong to the character and campaign", async () => {
    const { tx } = createTx();

    await expect(
      resolveTradeTransaction(sellInput(tx, { itemId: "other-character-rope" }))
    ).rejects.toMatchObject({ code: "ITEM_OWNERSHIP_MISMATCH" });
  });

  it("increments gold and decrements or removes an item for a valid sale", async () => {
    const { campaigns, items, tx } = createTx();

    const result = await resolveTradeTransaction(sellInput(tx, { quantity: 2, price: 2 }));

    expect(campaigns.find((campaign) => campaign.id === "campaign-1")?.gold).toBe(104);
    expect(items.find((item) => item.id === "rope-1")).toBeUndefined();
    expect(result).toMatchObject({
      ok: true,
      operation: "sell",
      facts: {
        type: "trade_transaction_resolved",
        campaignId: "campaign-1",
        characterId: "character-1",
        operation: "sell",
        itemId: "rope-1",
        itemName: "Hempen Rope",
        quantity: 2,
        goldDelta: 4,
        goldAfter: 104,
      },
    });
  });

  it("does not touch inventory of other characters", async () => {
    const { items, tx } = createTx();

    await resolveTradeTransaction(sellInput(tx, { quantity: 1, price: 2 }));

    expect(items.find((item) => item.id === "other-character-rope")?.quantity).toBe(5);
    expect(items.find((item) => item.id === "other-campaign-rope")?.quantity).toBe(4);
  });

  it("does not touch gold of another campaign", async () => {
    const { campaigns, tx } = createTx();

    await resolveTradeTransaction(buyInput(tx, { price: 20, quantity: 1 }));

    expect(campaigns.find((campaign) => campaign.id === "campaign-2")?.gold).toBe(250);
  });

  it("returns structured facts for narration", async () => {
    const { tx } = createTx();

    const result = await resolveTradeTransaction(buyInput(tx));

    expect(result).toMatchObject({
      ok: true,
      facts: {
        type: "trade_transaction_resolved",
        operation: "buy",
        itemName: "Potion of Healing",
        quantity: 1,
        goldBefore: 100,
        goldAfter: 50,
      },
    });
  });

  it("does not return narrative text", async () => {
    const { tx } = createTx();

    const result = await resolveTradeTransaction(buyInput(tx));

    expect(JSON.stringify(result)).not.toMatch(
      /\b(narration|narrative|prose|flavorText|message|Purchased|Sold)\b/i
    );
  });

  it("does not call AI", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { tx } = createTx();

    await resolveTradeTransaction(buyInput(tx));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not introduce AD&D or OSR mechanics", async () => {
    const { tx } = createTx();

    const result = await resolveTradeTransaction(buyInput(tx));

    expect(JSON.stringify(result)).not.toMatch(
      /AD&D|OSR|THAC0|descending AC|AC descendente|saving throw vs|save vs death|gold for XP|XP por oro/i
    );
  });
});
