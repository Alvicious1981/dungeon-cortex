import { prisma } from "@/lib/db/prisma";
import { equipItem, type InventoryItem } from "@/lib/rules/inventory";

export type EquipmentServiceErrorCode =
  | "CAMPAIGN_NOT_FOUND"
  | "ITEM_NOT_FOUND"
  | "ITEM_OWNERSHIP_MISMATCH"
  | "ILLEGAL_SLOT_FOR_ITEM";

export class EquipmentServiceError extends Error {
  constructor(
    public readonly code: EquipmentServiceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "EquipmentServiceError";
  }
}

interface EquipmentDb {
  campaign?: {
    findUnique(args: {
      where: { id: string };
      select: { characterId: true };
    }): Promise<{ characterId: string } | null>;
  };
  inventoryItem: {
    findMany(args: {
      where: Record<string, unknown>;
      select?: Record<string, boolean>;
    }): Promise<EquipmentInventoryItem[]>;
    update(args: {
      where: { id: string };
      data: { equippedSlot: string | null };
    }): Promise<EquipmentInventoryItem>;
  };
}

export interface EquipmentInventoryItem extends InventoryItem {
  campaignId?: string;
}

export interface EquipCharacterItemInput {
  campaignId: string;
  characterId: string;
  itemId: string;
  targetSlot: string;
  tx?: EquipmentDb;
  db?: EquipmentDb;
}

export interface EquipmentChangedFacts {
  type: "equipment_changed";
  campaignId: string;
  characterId: string;
  itemId: string;
  itemName: string;
  targetSlot: string;
  unequippedItemIds: string[];
}

export interface EquipCharacterItemResult {
  ok: true;
  itemId: string;
  itemName: string;
  targetSlot: string;
  facts: EquipmentChangedFacts;
}

const inventorySelect = {
  id: true,
  characterId: true,
  name: true,
  type: true,
  quantity: true,
  properties: true,
  equippedSlot: true,
  indexSlug: true,
} satisfies Record<keyof InventoryItem, boolean>;

function resolveDb(input: EquipCharacterItemInput): EquipmentDb {
  return input.tx ?? input.db ?? (prisma as unknown as EquipmentDb);
}

async function assertCampaignOwnership(
  db: EquipmentDb,
  campaignId: string,
  characterId: string
): Promise<void> {
  if (!db.campaign) return;

  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    select: { characterId: true },
  });

  if (campaign === null) {
    throw new EquipmentServiceError(
      "CAMPAIGN_NOT_FOUND",
      `Campaign not found: ${campaignId}`
    );
  }

  if (campaign && campaign.characterId !== characterId) {
    throw new EquipmentServiceError(
      "ITEM_OWNERSHIP_MISMATCH",
      `Character ${characterId} does not belong to campaign ${campaignId}.`
    );
  }
}

function assertItemOwnership(
  campaignItems: EquipmentInventoryItem[],
  characterItems: EquipmentInventoryItem[],
  input: EquipCharacterItemInput
): void {
  const itemInCampaign = campaignItems.find((item) => item.id === input.itemId);

  if (!itemInCampaign) {
    throw new EquipmentServiceError(
      "ITEM_NOT_FOUND",
      `Item not found: ${input.itemId}`
    );
  }

  if (itemInCampaign.characterId !== input.characterId) {
    throw new EquipmentServiceError(
      "ITEM_OWNERSHIP_MISMATCH",
      `Item ${input.itemId} does not belong to character ${input.characterId}.`
    );
  }

  if (!characterItems.some((item) => item.id === input.itemId)) {
    throw new EquipmentServiceError(
      "ITEM_NOT_FOUND",
      `Item not found in character inventory: ${input.itemId}`
    );
  }
}

export async function equipCharacterItem(
  input: EquipCharacterItemInput
): Promise<EquipCharacterItemResult> {
  const db = resolveDb(input);

  await assertCampaignOwnership(db, input.campaignId, input.characterId);

  const campaignItems = db.campaign
    ? await db.inventoryItem.findMany({
        where: { characterId: input.characterId },
        select: inventorySelect,
      })
    : await db.inventoryItem.findMany({
        where: { campaignId: input.campaignId },
        select: inventorySelect,
      });

  const characterItems = campaignItems.filter(
    (item) => item.characterId === input.characterId
  );

  assertItemOwnership(campaignItems, characterItems, input);

  let updated: EquipmentInventoryItem[];
  try {
    updated = equipItem(
      input.itemId,
      input.targetSlot,
      characterItems
    ) as EquipmentInventoryItem[];
  } catch (error) {
    // `assertItemOwnership` has already proved the item exists, so the only
    // RangeError reachable here is an illegal placement.
    if (error instanceof RangeError) {
      throw new EquipmentServiceError("ILLEGAL_SLOT_FOR_ITEM", error.message);
    }
    throw error;
  }
  const changed = updated.filter(
    (item, index) => item.equippedSlot !== characterItems[index]?.equippedSlot
  );

  await Promise.all(
    changed.map((item) =>
      db.inventoryItem.update({
        where: { id: item.id },
        data: { equippedSlot: item.equippedSlot ?? null },
      })
    )
  );

  const equippedItem = updated.find((item) => item.id === input.itemId);
  if (!equippedItem) {
    throw new EquipmentServiceError(
      "ITEM_NOT_FOUND",
      `Item not found after equipment update: ${input.itemId}`
    );
  }

  const unequippedItemIds = changed
    .filter((item) => item.id !== input.itemId && item.equippedSlot === null)
    .map((item) => item.id);

  return {
    ok: true,
    itemId: equippedItem.id,
    itemName: equippedItem.name,
    targetSlot: input.targetSlot,
    facts: {
      type: "equipment_changed",
      campaignId: input.campaignId,
      characterId: input.characterId,
      itemId: equippedItem.id,
      itemName: equippedItem.name,
      targetSlot: input.targetSlot,
      unequippedItemIds,
    },
  };
}



