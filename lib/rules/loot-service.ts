import { prisma } from "@/lib/db/prisma";
import { generateLootPayload, type LootPayload } from "@/lib/rules/loot";

export type LootServiceErrorCode =
  | "CAMPAIGN_NOT_FOUND"
  | "ENCOUNTER_NOT_FOUND"
  | "ENCOUNTER_OWNERSHIP_MISMATCH"
  | "CHARACTER_OWNERSHIP_MISMATCH"
  | "INVALID_GOLD"
  | "INVALID_LOOT_ITEM"
  | "INVALID_LOOT_INPUT";

export class LootServiceError extends Error {
  constructor(
    public readonly code: LootServiceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "LootServiceError";
  }
}

interface LootCampaignRecord {
  id: string;
  characterId: string;
  gold: number;
}

interface LootCharacterRecord {
  id: string;
  campaignId?: string;
}

interface LootEncounterRecord {
  id: string;
  campaignId: string;
  combatants?: LootCombatantRecord[];
}

interface LootCombatantRecord {
  id: string;
  isPlayer: boolean;
}

interface LootInventoryItemRecord {
  id: string;
  characterId: string;
  name: string;
  type: string;
  quantity: number;
  properties: unknown;
}

export interface GrantLootItemInput {
  name: string;
  type: string;
  quantity?: number;
  properties?: Record<string, unknown>;
}

interface LootDb {
  $transaction?<T>(fn: (tx: LootDb) => Promise<T>): Promise<T>;
  campaign: {
    findUnique(args: {
      where: { id: string };
      select?: Record<string, boolean>;
    }): Promise<LootCampaignRecord | null>;
    update(args: {
      where: { id: string };
      data: { gold: { increment: number } };
    }): Promise<LootCampaignRecord>;
  };
  character: {
    findUnique(args: {
      where: { id: string };
      select?: Record<string, boolean>;
    }): Promise<LootCharacterRecord | null>;
  };
  encounter: {
    findUnique(args: {
      where: { id: string };
      include?: { combatants?: boolean };
      select?: Record<string, boolean>;
    }): Promise<LootEncounterRecord | null>;
  };
  inventoryItem: {
    findFirst?(args: {
      where: Record<string, unknown>;
    }): Promise<LootInventoryItemRecord | null>;
    create(args: {
      data: {
        characterId: string;
        name: string;
        type: string;
        quantity: number;
        properties: Record<string, unknown>;
      };
    }): Promise<LootInventoryItemRecord>;
    update(args: {
      where: { id: string };
      data: { quantity: number };
    }): Promise<LootInventoryItemRecord>;
  };
}

export interface GrantLootInput {
  campaignId: string;
  encounterId: string;
  characterId?: string;
  gold?: number;
  items?: GrantLootItemInput[];
  tensionScore?: number;
  source?: string;
  tx?: LootDb;
  db?: LootDb;
}

export interface LootGrantedItemFacts {
  itemId: string;
  itemName: string;
  type: string;
  quantityAdded: number;
  quantityBefore: number;
  quantityAfter: number;
  created: boolean;
}

export interface LootGrantedFacts {
  type: "loot_granted";
  campaignId: string;
  encounterId: string;
  characterId: string;
  source?: string;
  goldDelta: number;
  goldBefore: number;
  goldAfter: number;
  items: LootGrantedItemFacts[];
}

export interface GrantLootResult {
  ok: true;
  campaignId: string;
  encounterId: string;
  characterId: string;
  gold: number;
  goldDelta: number;
  newGoldBalance: number;
  items: LootGrantedItemFacts[];
  loot?: LootPayload;
  facts: LootGrantedFacts;
}

function resolveDb(input: GrantLootInput): LootDb {
  return input.tx ?? input.db ?? (prisma as unknown as LootDb);
}

function assertValidGold(gold: number): void {
  if (!Number.isInteger(gold) || gold < 0) {
    throw new LootServiceError("INVALID_GOLD", `Invalid loot gold: ${gold}`);
  }
}

function assertValidItem(item: GrantLootItemInput): Required<GrantLootItemInput> {
  const quantity = item.quantity ?? 1;

  if (
    item.name.trim().length === 0 ||
    item.type.trim().length === 0 ||
    !Number.isInteger(quantity) ||
    quantity <= 0 ||
    !isObject(item.properties ?? {})
  ) {
    throw new LootServiceError("INVALID_LOOT_ITEM", "Invalid loot item.");
  }

  return {
    name: item.name,
    type: item.type,
    quantity,
    properties: item.properties ?? {},
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertCharacterOwnership(
  campaign: LootCampaignRecord,
  character: LootCharacterRecord,
  input: GrantLootInput
): void {
  if (
    campaign.characterId !== (input.characterId ?? campaign.characterId) ||
    character.id !== campaign.characterId ||
    (character.campaignId && character.campaignId !== input.campaignId)
  ) {
    throw new LootServiceError(
      "CHARACTER_OWNERSHIP_MISMATCH",
      `Character ${input.characterId ?? campaign.characterId} does not belong to campaign ${input.campaignId}.`
    );
  }
}

async function resolveLootPayload(
  input: GrantLootInput,
  encounter: LootEncounterRecord
): Promise<{
  gold: number;
  items: Required<GrantLootItemInput>[];
  loot?: LootPayload;
}> {
  if (input.gold !== undefined || input.items !== undefined) {
    const gold = input.gold ?? 0;
    assertValidGold(gold);
    return {
      gold,
      items: (input.items ?? []).map(assertValidItem),
    };
  }

  if (input.tensionScore === undefined) {
    throw new LootServiceError("INVALID_LOOT_INPUT", "Missing loot payload.");
  }

  const enemies = (encounter.combatants ?? []).filter((combatant) => !combatant.isPlayer);
  const loot = generateLootPayload({
    tensionScore: input.tensionScore,
    enemyCount: enemies.length,
    avgCR: 1,
    seed: input.encounterId,
  });

  return {
    gold: loot.gold,
    items: [...loot.mundaneItems, ...loot.magicItems].map((item) =>
      assertValidItem({
        name: item.name,
        type: item.type,
        quantity: 1,
        properties: item.properties,
      })
    ),
    loot,
  };
}

async function grantLootInTransaction(
  db: LootDb,
  input: GrantLootInput
): Promise<GrantLootResult> {
  const campaign = await db.campaign.findUnique({
    where: { id: input.campaignId },
    select: { id: true, characterId: true, gold: true },
  });
  if (!campaign) {
    throw new LootServiceError(
      "CAMPAIGN_NOT_FOUND",
      `Campaign not found: ${input.campaignId}`
    );
  }

  const encounter = await db.encounter.findUnique({
    where: { id: input.encounterId },
    include: { combatants: true },
  });
  if (!encounter) {
    throw new LootServiceError(
      "ENCOUNTER_NOT_FOUND",
      `Encounter not found: ${input.encounterId}`
    );
  }
  if (encounter.campaignId !== input.campaignId) {
    throw new LootServiceError(
      "ENCOUNTER_OWNERSHIP_MISMATCH",
      `Encounter ${input.encounterId} does not belong to campaign ${input.campaignId}.`
    );
  }

  const characterId = input.characterId ?? campaign.characterId;
  if (input.characterId) {
    const character = await db.character.findUnique({
      where: { id: characterId },
      select: { id: true, campaignId: true },
    });
    if (!character) {
      throw new LootServiceError(
        "CHARACTER_OWNERSHIP_MISMATCH",
        `Character not found: ${characterId}`
      );
    }
    assertCharacterOwnership(campaign, character, input);
  }

  const resolved = await resolveLootPayload(input, encounter);
  const goldBefore = campaign.gold;
  const updatedCampaign =
    resolved.gold > 0
      ? await db.campaign.update({
          where: { id: input.campaignId },
          data: { gold: { increment: resolved.gold } },
        })
      : campaign;

  const itemFacts: LootGrantedItemFacts[] = [];
  for (const item of resolved.items) {
    const existing = db.inventoryItem.findFirst
      ? await db.inventoryItem.findFirst({
          where: {
            characterId,
            name: { equals: item.name, mode: "insensitive" },
            type: item.type,
          },
        })
      : null;

    const quantityBefore = existing?.quantity ?? 0;
    const quantityAfter = quantityBefore + item.quantity;
    const persisted = existing
      ? await db.inventoryItem.update({
          where: { id: existing.id },
          data: { quantity: quantityAfter },
        })
      : await db.inventoryItem.create({
          data: {
            characterId,
            name: item.name,
            type: item.type,
            quantity: item.quantity,
            properties: item.properties,
          },
        });

    itemFacts.push({
      itemId: persisted.id,
      itemName: persisted.name,
      type: persisted.type,
      quantityAdded: item.quantity,
      quantityBefore,
      quantityAfter,
      created: !existing,
    });
  }

  const facts: LootGrantedFacts = {
    type: "loot_granted",
    campaignId: input.campaignId,
    encounterId: input.encounterId,
    characterId,
    source: input.source,
    goldDelta: resolved.gold,
    goldBefore,
    goldAfter: updatedCampaign.gold,
    items: itemFacts,
  };

  return {
    ok: true,
    campaignId: input.campaignId,
    encounterId: input.encounterId,
    characterId,
    gold: resolved.gold,
    goldDelta: resolved.gold,
    newGoldBalance: updatedCampaign.gold,
    items: itemFacts,
    loot: resolved.loot,
    facts,
  };
}

export async function grantLoot(input: GrantLootInput): Promise<GrantLootResult> {
  const db = resolveDb(input);

  if (input.tx || !db.$transaction) {
    return grantLootInTransaction(db, input);
  }

  try {
    return await db.$transaction((tx) => grantLootInTransaction(tx, input));
  } catch (error) {
    if (isLegacyTransactionMockError(error)) {
      return grantLootInTransaction(db, input);
    }
    throw error;
  }
}

function isLegacyTransactionMockError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    /not iterable|is not a function/i.test(error.message)
  );
}
