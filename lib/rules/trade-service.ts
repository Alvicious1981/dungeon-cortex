import { prisma } from "@/lib/db/prisma";

export type TradeOperation = "buy" | "sell";

export type TradeServiceErrorCode =
  | "CAMPAIGN_NOT_FOUND"
  | "CHARACTER_NOT_FOUND"
  | "INVALID_OPERATION"
  | "INVALID_QUANTITY"
  | "INVALID_PRICE"
  | "INSUFFICIENT_GOLD"
  | "ITEM_NOT_FOUND"
  | "ITEM_OWNERSHIP_MISMATCH";

export class TradeServiceError extends Error {
  constructor(
    public readonly code: TradeServiceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "TradeServiceError";
  }
}

interface TradeCampaignRecord {
  id: string;
  characterId: string;
  gold: number;
}

interface TradeCharacterRecord {
  id: string;
  campaignId?: string;
}

interface TradeInventoryItemRecord {
  id: string;
  characterId: string;
  campaignId?: string;
  name: string;
  type: string;
  quantity: number;
  properties: unknown;
}

export interface TradeItemDescriptor {
  name: string;
  type: string;
  properties?: Record<string, unknown>;
}

interface TradeDb {
  $transaction?<T>(fn: (tx: TradeDb) => Promise<T>): Promise<T>;
  campaign: {
    findUnique(args: {
      where: { id: string };
      select?: Record<string, boolean>;
    }): Promise<TradeCampaignRecord | null>;
    update(args: {
      where: { id: string };
      data: { gold: { decrement?: number; increment?: number } };
    }): Promise<TradeCampaignRecord>;
  };
  character: {
    findUnique(args: {
      where: { id: string };
      select?: Record<string, boolean>;
    }): Promise<TradeCharacterRecord | null>;
  };
  inventoryItem: {
    findFirst(args: {
      where: Record<string, unknown>;
    }): Promise<TradeInventoryItemRecord | null>;
    findUnique(args: {
      where: { id: string };
    }): Promise<TradeInventoryItemRecord | null>;
    create(args: {
      data: {
        characterId: string;
        campaignId?: string;
        name: string;
        type: string;
        quantity: number;
        properties: Record<string, unknown>;
      };
    }): Promise<TradeInventoryItemRecord>;
    update(args: {
      where: { id: string };
      data: { quantity: number };
    }): Promise<TradeInventoryItemRecord>;
    delete(args: {
      where: { id: string };
    }): Promise<TradeInventoryItemRecord>;
  };
  gameLog?: {
    create(args: {
      data: { campaignId: string; role: string; content: string };
    }): Promise<unknown>;
  };
}

export interface ResolveTradeTransactionInput {
  campaignId: string;
  characterId: string;
  merchantId?: string;
  npcId?: string;
  operation: TradeOperation | string;
  itemId?: string;
  itemDescriptor?: TradeItemDescriptor;
  price: number;
  quantity: number;
  sellModifier?: number;
  tx?: TradeDb;
  db?: TradeDb;
}

export interface TradeTransactionFacts {
  type: "trade_transaction_resolved";
  campaignId: string;
  characterId: string;
  merchantId?: string;
  npcId?: string;
  operation: TradeOperation;
  itemId?: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  goldDelta: number;
  goldBefore: number;
  goldAfter: number;
  itemQuantityBefore?: number;
  itemQuantityAfter: number;
}

export interface ResolveTradeTransactionResult {
  ok: true;
  operation: TradeOperation;
  itemId?: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  goldDelta: number;
  newGoldBalance: number;
  facts: TradeTransactionFacts;
}

function resolveDb(input: ResolveTradeTransactionInput): TradeDb {
  return input.tx ?? input.db ?? (prisma as unknown as TradeDb);
}

function assertOperation(operation: string): asserts operation is TradeOperation {
  if (operation !== "buy" && operation !== "sell") {
    throw new TradeServiceError(
      "INVALID_OPERATION",
      `Invalid trade operation: ${operation}`
    );
  }
}

function assertPositiveQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new TradeServiceError(
      "INVALID_QUANTITY",
      `Invalid trade quantity: ${quantity}`
    );
  }
}

function assertValidPrice(price: number): void {
  if (!Number.isInteger(price) || price < 0) {
    throw new TradeServiceError(
      "INVALID_PRICE",
      `Invalid trade price: ${price}`
    );
  }
}

function assertCharacterOwnership(
  campaign: TradeCampaignRecord,
  character: TradeCharacterRecord,
  input: ResolveTradeTransactionInput
): void {
  if (
    campaign.characterId !== input.characterId ||
    (character.campaignId && character.campaignId !== input.campaignId)
  ) {
    throw new TradeServiceError(
      "CHARACTER_NOT_FOUND",
      `Character ${input.characterId} does not belong to campaign ${input.campaignId}.`
    );
  }
}

function assertItemOwnership(
  item: TradeInventoryItemRecord,
  input: ResolveTradeTransactionInput
): void {
  if (item.characterId !== input.characterId) {
    throw new TradeServiceError(
      "ITEM_OWNERSHIP_MISMATCH",
      `Item ${item.id} does not belong to character ${input.characterId}.`
    );
  }

  if (item.campaignId && item.campaignId !== input.campaignId) {
    throw new TradeServiceError(
      "ITEM_OWNERSHIP_MISMATCH",
      `Item ${item.id} does not belong to campaign ${input.campaignId}.`
    );
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function deriveSellUnitPrice(
  item: TradeInventoryItemRecord,
  input: ResolveTradeTransactionInput
): number {
  if (input.sellModifier === undefined) return input.price;

  const properties = isObject(item.properties) ? item.properties : {};
  const baseValueGP =
    typeof properties.valueGP === "number" && Number.isFinite(properties.valueGP)
      ? properties.valueGP
      : 0;

  return Math.max(1, Math.floor(baseValueGP * input.sellModifier));
}

async function findExistingPurchasedItem(
  db: TradeDb,
  input: ResolveTradeTransactionInput,
  descriptor: TradeItemDescriptor
): Promise<TradeInventoryItemRecord | null> {
  return db.inventoryItem.findFirst({
    where: {
      characterId: input.characterId,
      name: { equals: descriptor.name, mode: "insensitive" },
      type: descriptor.type,
    },
  });
}

async function resolveTradeTransactionInTransaction(
  db: TradeDb,
  input: ResolveTradeTransactionInput
): Promise<ResolveTradeTransactionResult> {
  assertOperation(input.operation);
  assertPositiveQuantity(input.quantity);
  assertValidPrice(input.price);

  const campaign = await db.campaign.findUnique({
    where: { id: input.campaignId },
    select: { id: true, characterId: true, gold: true },
  });
  if (!campaign) {
    throw new TradeServiceError(
      "CAMPAIGN_NOT_FOUND",
      `Campaign not found: ${input.campaignId}`
    );
  }

  const character = await db.character.findUnique({
    where: { id: input.characterId },
    select: { id: true },
  });
  if (!character) {
    throw new TradeServiceError(
      "CHARACTER_NOT_FOUND",
      `Character not found: ${input.characterId}`
    );
  }
  assertCharacterOwnership(campaign, character, input);

  return input.operation === "buy"
    ? buyItem(db, input, campaign)
    : sellItem(db, input, campaign);
}

async function buyItem(
  db: TradeDb,
  input: ResolveTradeTransactionInput,
  campaign: TradeCampaignRecord
): Promise<ResolveTradeTransactionResult> {
  const descriptor = input.itemDescriptor;
  if (!descriptor) {
    throw new TradeServiceError("ITEM_NOT_FOUND", "Missing itemDescriptor for buy.");
  }

  const totalCost = input.price * input.quantity;
  if (campaign.gold < totalCost) {
    throw new TradeServiceError(
      "INSUFFICIENT_GOLD",
      `Insufficient gold. Needs ${totalCost}, has ${campaign.gold}.`
    );
  }

  const existing = await findExistingPurchasedItem(db, input, descriptor);
  const goldBefore = campaign.gold;
  const newCampaign = await db.campaign.update({
    where: { id: input.campaignId },
    data: { gold: { decrement: totalCost } },
  });

  let item: TradeInventoryItemRecord;
  const quantityBefore = existing?.quantity ?? 0;
  const quantityAfter = quantityBefore + input.quantity;

  if (existing) {
    item = await db.inventoryItem.update({
      where: { id: existing.id },
      data: { quantity: quantityAfter },
    });
  } else {
    item = await db.inventoryItem.create({
      data: {
        campaignId: input.campaignId,
        characterId: input.characterId,
        name: descriptor.name,
        type: descriptor.type,
        quantity: input.quantity,
        properties: descriptor.properties ?? {},
      },
    });
  }

  const result = buildResult(input, {
    operation: "buy",
    itemId: item.id,
    itemName: item.name,
    unitPrice: input.price,
    goldBefore,
    goldAfter: newCampaign.gold,
    goldDelta: -totalCost,
    itemQuantityBefore: quantityBefore,
    itemQuantityAfter: quantityAfter,
  });

  await writeTradeLog(db, result.facts);

  return result;
}

async function sellItem(
  db: TradeDb,
  input: ResolveTradeTransactionInput,
  campaign: TradeCampaignRecord
): Promise<ResolveTradeTransactionResult> {
  if (!input.itemId) {
    throw new TradeServiceError("ITEM_NOT_FOUND", "Missing itemId for sell.");
  }

  const item = await db.inventoryItem.findUnique({
    where: { id: input.itemId },
  });
  if (!item) {
    throw new TradeServiceError(
      "ITEM_NOT_FOUND",
      `Item not found: ${input.itemId}`
    );
  }
  assertItemOwnership(item, input);

  if (item.quantity < input.quantity) {
    throw new TradeServiceError(
      "ITEM_NOT_FOUND",
      `Item ${item.id} does not have enough quantity to sell.`
    );
  }

  const unitPrice = deriveSellUnitPrice(item, input);
  const totalRevenue = unitPrice * input.quantity;
  const goldBefore = campaign.gold;
  const newCampaign = await db.campaign.update({
    where: { id: input.campaignId },
    data: { gold: { increment: totalRevenue } },
  });

  const quantityAfter = item.quantity - input.quantity;
  if (quantityAfter <= 0) {
    await db.inventoryItem.delete({ where: { id: item.id } });
  } else {
    await db.inventoryItem.update({
      where: { id: item.id },
      data: { quantity: quantityAfter },
    });
  }

  const result = buildResult(input, {
    operation: "sell",
    itemId: item.id,
    itemName: item.name,
    unitPrice,
    goldBefore,
    goldAfter: newCampaign.gold,
    goldDelta: totalRevenue,
    itemQuantityBefore: item.quantity,
    itemQuantityAfter: quantityAfter,
  });

  await writeTradeLog(db, result.facts);

  return result;
}

function buildResult(
  input: ResolveTradeTransactionInput,
  details: {
    operation: TradeOperation;
    itemId?: string;
    itemName: string;
    unitPrice: number;
    goldBefore: number;
    goldAfter: number;
    goldDelta: number;
    itemQuantityBefore?: number;
    itemQuantityAfter: number;
  }
): ResolveTradeTransactionResult {
  const facts: TradeTransactionFacts = {
    type: "trade_transaction_resolved",
    campaignId: input.campaignId,
    characterId: input.characterId,
    merchantId: input.merchantId,
    npcId: input.npcId,
    operation: details.operation,
    itemId: details.itemId,
    itemName: details.itemName,
    quantity: input.quantity,
    unitPrice: details.unitPrice,
    goldDelta: details.goldDelta,
    goldBefore: details.goldBefore,
    goldAfter: details.goldAfter,
    itemQuantityBefore: details.itemQuantityBefore,
    itemQuantityAfter: details.itemQuantityAfter,
  };

  return {
    ok: true,
    operation: details.operation,
    itemId: details.itemId,
    itemName: details.itemName,
    quantity: input.quantity,
    unitPrice: details.unitPrice,
    goldDelta: details.goldDelta,
    newGoldBalance: details.goldAfter,
    facts,
  };
}

async function writeTradeLog(
  db: TradeDb,
  facts: TradeTransactionFacts
): Promise<void> {
  if (!db.gameLog) return;

  await db.gameLog.create({
    data: {
      campaignId: facts.campaignId,
      role: "system",
      content: JSON.stringify(facts),
    },
  });
}

export async function resolveTradeTransaction(
  input: ResolveTradeTransactionInput
): Promise<ResolveTradeTransactionResult> {
  const db = resolveDb(input);

  if (input.tx || !db.$transaction) {
    return resolveTradeTransactionInTransaction(db, input);
  }

  return db.$transaction((tx) => resolveTradeTransactionInTransaction(tx, input));
}
