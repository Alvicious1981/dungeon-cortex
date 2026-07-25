import { prisma } from "@/lib/db/prisma";

export type ConsumableServiceErrorCode =
  | "CAMPAIGN_NOT_FOUND"
  | "CHARACTER_NOT_FOUND"
  | "ITEM_NOT_FOUND"
  | "ITEM_OWNERSHIP_MISMATCH"
  | "ITEM_NOT_CONSUMABLE"
  | "ITEM_QUANTITY_EMPTY"
  | "INVALID_CONSUMABLE_EFFECT";

export class ConsumableServiceError extends Error {
  constructor(
    public readonly code: ConsumableServiceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ConsumableServiceError";
  }
}

interface ConsumableCampaignRecord {
  id?: string;
  characterId?: string;
}

interface ConsumableCharacterRecord {
  id: string;
  campaignId?: string;
  hp: number;
  maxHp: number;
}

interface ConsumableInventoryItemRecord {
  id: string;
  characterId: string;
  campaignId?: string;
  name: string;
  type: string;
  quantity: number;
  properties: unknown;
}

interface ConsumableDb {
  $transaction?<T>(fn: (tx: ConsumableDb) => Promise<T>): Promise<T>;
  campaign?: {
    findUnique(args: {
      where: { id: string };
      select?: { id?: boolean; characterId?: boolean };
    }): Promise<ConsumableCampaignRecord | null>;
  };
  character: {
    findUnique(args: {
      where: { id: string };
      select?: Record<string, boolean>;
    }): Promise<ConsumableCharacterRecord | null>;
    update(args: {
      where: { id: string };
      data: { hp: number };
    }): Promise<ConsumableCharacterRecord>;
  };
  inventoryItem: {
    findFirst(args: {
      where: Record<string, unknown>;
    }): Promise<ConsumableInventoryItemRecord | null>;
    findUnique(args: {
      where: { id: string };
    }): Promise<ConsumableInventoryItemRecord | null>;
    update(args: {
      where: { id: string };
      data: { quantity: number };
    }): Promise<ConsumableInventoryItemRecord>;
    delete(args: {
      where: { id: string };
    }): Promise<ConsumableInventoryItemRecord>;
  };
}

export interface UseConsumableItemInput {
  campaignId: string;
  characterId: string;
  itemId?: string;
  itemName?: string;
  quantity?: number;
  tx?: ConsumableDb;
  db?: ConsumableDb;
}

export interface ConsumableUsedFacts {
  type: "consumable_used";
  campaignId: string;
  characterId: string;
  itemId: string;
  itemName: string;
  effect: "healing";
  quantityUsed: number;
  quantityBefore: number;
  quantityAfter: number;
  consumed: boolean;
  hpBefore: number;
  hpAfter: number;
  hpRestored: number;
  maxHp: number;
}

export interface UseConsumableItemResult {
  ok: true;
  itemId: string;
  itemName: string;
  effect: "healing";
  hpRestored: number;
  currentHp: number;
  maxHp: number;
  facts: ConsumableUsedFacts;
}

function resolveDb(input: UseConsumableItemInput): ConsumableDb {
  return input.tx ?? input.db ?? (prisma as unknown as ConsumableDb);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getHealingAmount(item: ConsumableInventoryItemRecord): number {
  if (!isObject(item.properties)) {
    throw new ConsumableServiceError(
      "ITEM_NOT_CONSUMABLE",
      `Item ${item.id} has no recognized consumable effect.`
    );
  }

  const healingAmount = item.properties.healingAmount;
  if (typeof healingAmount !== "number" || !Number.isFinite(healingAmount)) {
    throw new ConsumableServiceError(
      "ITEM_NOT_CONSUMABLE",
      `Item ${item.id} has no recognized consumable effect.`
    );
  }

  if (healingAmount <= 0) {
    throw new ConsumableServiceError(
      "INVALID_CONSUMABLE_EFFECT",
      `Item ${item.id} has an invalid healing effect.`
    );
  }

  return healingAmount;
}

async function assertCampaign(
  db: ConsumableDb,
  campaignId: string,
  characterId: string
): Promise<void> {
  if (!db.campaign) return;

  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, characterId: true },
  });

  if (!campaign) {
    throw new ConsumableServiceError(
      "CAMPAIGN_NOT_FOUND",
      `Campaign not found: ${campaignId}`
    );
  }

  if (campaign.characterId && campaign.characterId !== characterId) {
    throw new ConsumableServiceError(
      "ITEM_OWNERSHIP_MISMATCH",
      `Character ${characterId} does not belong to campaign ${campaignId}.`
    );
  }
}

function assertCharacterOwnership(
  character: ConsumableCharacterRecord,
  campaignId: string
): void {
  if (character.campaignId && character.campaignId !== campaignId) {
    throw new ConsumableServiceError(
      "CHARACTER_NOT_FOUND",
      `Character ${character.id} does not belong to campaign ${campaignId}.`
    );
  }
}

function assertItemOwnership(
  item: ConsumableInventoryItemRecord,
  input: UseConsumableItemInput
): void {
  if (item.characterId !== input.characterId) {
    throw new ConsumableServiceError(
      "ITEM_OWNERSHIP_MISMATCH",
      `Item ${item.id} does not belong to character ${input.characterId}.`
    );
  }

  if (item.campaignId && item.campaignId !== input.campaignId) {
    throw new ConsumableServiceError(
      "ITEM_OWNERSHIP_MISMATCH",
      `Item ${item.id} does not belong to campaign ${input.campaignId}.`
    );
  }
}

async function findItem(
  db: ConsumableDb,
  input: UseConsumableItemInput
): Promise<ConsumableInventoryItemRecord | null> {
  if (input.itemId) {
    return db.inventoryItem.findUnique({
      where: { id: input.itemId },
    });
  }

  if (input.itemName) {
    return db.inventoryItem.findFirst({
      where: {
        characterId: input.characterId,
        name: {
          equals: input.itemName,
          mode: "insensitive",
        },
      },
    });
  }

  return null;
}

async function consumeItemInTransaction(
  db: ConsumableDb,
  input: UseConsumableItemInput
): Promise<UseConsumableItemResult> {
  const quantity = input.quantity ?? 1;

  await assertCampaign(db, input.campaignId, input.characterId);

  const character = await db.character.findUnique({
    where: { id: input.characterId },
    select: { id: true, hp: true, maxHp: true },
  });

  if (!character) {
    throw new ConsumableServiceError(
      "CHARACTER_NOT_FOUND",
      `Character not found: ${input.characterId}`
    );
  }
  assertCharacterOwnership(character, input.campaignId);

  const item = await findItem(db, input);
  if (!item) {
    throw new ConsumableServiceError(
      "ITEM_NOT_FOUND",
      `Item not found: ${input.itemId ?? input.itemName ?? "unknown"}`
    );
  }
  assertItemOwnership(item, input);

  if (item.quantity <= 0 || quantity <= 0) {
    throw new ConsumableServiceError(
      "ITEM_QUANTITY_EMPTY",
      `Item ${item.id} has no quantity available.`
    );
  }

  if (quantity > item.quantity) {
    throw new ConsumableServiceError(
      "ITEM_QUANTITY_EMPTY",
      `Item ${item.id} does not have enough quantity.`
    );
  }

  const healingAmount = getHealingAmount(item);
  const hpBefore = character.hp;
  const hpAfter = Math.min(character.maxHp, hpBefore + healingAmount);
  const hpRestored = hpAfter - hpBefore;
  const quantityAfter = item.quantity - quantity;

  if (hpAfter !== hpBefore) {
    await db.character.update({
      where: { id: character.id },
      data: { hp: hpAfter },
    });
  }

  if (quantityAfter <= 0) {
    await db.inventoryItem.delete({
      where: { id: item.id },
    });
  } else {
    await db.inventoryItem.update({
      where: { id: item.id },
      data: { quantity: quantityAfter },
    });
  }

  return {
    ok: true,
    itemId: item.id,
    itemName: item.name,
    effect: "healing",
    hpRestored,
    currentHp: hpAfter,
    maxHp: character.maxHp,
    facts: {
      type: "consumable_used",
      campaignId: input.campaignId,
      characterId: input.characterId,
      itemId: item.id,
      itemName: item.name,
      effect: "healing",
      quantityUsed: quantity,
      quantityBefore: item.quantity,
      quantityAfter,
      consumed: quantityAfter <= 0,
      hpBefore,
      hpAfter,
      hpRestored,
      maxHp: character.maxHp,
    },
  };
}

export async function useConsumableItem(
  input: UseConsumableItemInput
): Promise<UseConsumableItemResult> {
  const db = resolveDb(input);

  if (input.tx || !db.$transaction) {
    return consumeItemInTransaction(db, input);
  }

  return db.$transaction((tx) => consumeItemInTransaction(tx, input));
}
