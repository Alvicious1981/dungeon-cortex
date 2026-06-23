import { prisma } from "@/lib/db/prisma";
import { generateQuest, type ProceduralQuest } from "@/lib/rules/quests";
import { seededFloat } from "@/lib/rules/generators";

export const VALID_QUEST_STATUSES = ["active", "completed", "failed"] as const;
export type QuestStatus = typeof VALID_QUEST_STATUSES[number];

export type QuestServiceErrorCode =
  | "CAMPAIGN_NOT_FOUND"
  | "QUEST_NOT_FOUND"
  | "QUEST_OWNERSHIP_MISMATCH"
  | "INVALID_QUEST_STATUS"
  | "INVALID_QUEST_PAYLOAD";

export class QuestServiceError extends Error {
  constructor(
    public readonly code: QuestServiceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "QuestServiceError";
  }
}

interface QuestCampaignRecord {
  id: string;
}

interface QuestRecord {
  id: string;
  campaignId: string;
  title: string;
  description: string;
  status: QuestStatus;
  giverId?: string | null;
  location?: string | null;
  hook?: string | null;
  objective?: string | null;
  reward?: string | null;
}

export interface QuestDescriptor {
  title: string;
  description: string;
  giverId?: string | null;
  location?: string | null;
  hook?: string | null;
  objective?: string | null;
  reward?: string | null;
}

interface QuestDb {
  campaign: {
    findUnique(args: {
      where: { id: string };
      select?: Record<string, boolean>;
    }): Promise<QuestCampaignRecord | null | undefined>;
  };
  quest: {
    findUnique(args: {
      where: { id: string };
      select?: Record<string, boolean>;
    }): Promise<QuestRecord | null | undefined>;
    create(args: {
      data: {
        campaignId: string;
        title: string;
        description: string;
        status: QuestStatus;
        giverId?: string | null;
        location?: string | null;
        hook?: string | null;
        objective?: string | null;
        reward?: string | null;
      };
    }): Promise<QuestRecord>;
    update(args: {
      where: { id: string };
      data: { status: QuestStatus };
    }): Promise<QuestRecord>;
  };
}

export interface CreateTrackedQuestInput {
  campaignId: string;
  seed?: number;
  context?: string;
  giverId?: string;
  descriptor?: QuestDescriptor;
  tx?: QuestDb;
  db?: QuestDb;
}

export interface UpdateQuestStatusInput {
  campaignId: string;
  questId: string;
  status: QuestStatus | string;
  reason?: string;
  tx?: QuestDb;
  db?: QuestDb;
}

export interface QuestCreatedFacts {
  type: "quest_created";
  campaignId: string;
  questId: string;
  status: QuestStatus;
  title: string;
  description: string;
  giverId?: string | null;
  location?: string | null;
  hook?: string | null;
  objective?: string | null;
  reward?: string | null;
  context?: string;
}

export interface QuestStatusUpdatedFacts {
  type: "quest_status_updated";
  campaignId: string;
  questId: string;
  status: QuestStatus;
  previousStatus: QuestStatus;
  reason?: string;
}

export interface CreateTrackedQuestResult {
  ok: true;
  campaignId: string;
  questId: string;
  status: QuestStatus;
  title: string;
  description: string;
  giverId?: string | null;
  location?: string | null;
  hook?: string | null;
  objective?: string | null;
  reward?: string | null;
  quest: QuestRecord;
  facts: QuestCreatedFacts;
}

export interface UpdateQuestStatusResult {
  ok: true;
  campaignId: string;
  questId: string;
  status: QuestStatus;
  previousStatus: QuestStatus;
  quest: QuestRecord;
  facts: QuestStatusUpdatedFacts;
}

function resolveDb(input: CreateTrackedQuestInput | UpdateQuestStatusInput): QuestDb {
  return input.tx ?? input.db ?? (prisma as unknown as QuestDb);
}

function isValidStatus(status: string): status is QuestStatus {
  return (VALID_QUEST_STATUSES as readonly string[]).includes(status);
}

function assertValidStatus(status: string): asserts status is QuestStatus {
  if (!isValidStatus(status)) {
    throw new QuestServiceError(
      "INVALID_QUEST_STATUS",
      `Invalid quest status: ${status}`
    );
  }
}

function cleanOptionalText(value: string | null | undefined): string | null | undefined {
  if (value === null || value === undefined) return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function assertNonEmptyText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new QuestServiceError(
      "INVALID_QUEST_PAYLOAD",
      `Quest ${field} must be a non-empty string.`
    );
  }

  return value.trim();
}

function buildDescriptorFromGeneratedQuest(quest: ProceduralQuest): QuestDescriptor {
  return {
    title: quest.title,
    description: quest.description,
    giverId: quest.giverId ?? null,
    location: quest.location,
    hook: quest.hook,
    objective: quest.objective,
    reward: quest.reward,
  };
}

function deriveGeneratedQuest(input: CreateTrackedQuestInput): QuestDescriptor {
  const seed =
    input.seed ??
    Math.floor(
      seededFloat(`${input.campaignId}:quest:${input.context ?? input.giverId ?? "anon"}`) *
        Number.MAX_SAFE_INTEGER
    );

  return buildDescriptorFromGeneratedQuest(generateQuest(seed, input.giverId));
}

function validateDescriptor(input: CreateTrackedQuestInput): QuestDescriptor {
  const descriptor = input.descriptor ?? deriveGeneratedQuest(input);

  return {
    title: assertNonEmptyText(descriptor.title, "title"),
    description: assertNonEmptyText(descriptor.description, "description"),
    giverId: cleanOptionalText(descriptor.giverId),
    location: cleanOptionalText(descriptor.location),
    hook: cleanOptionalText(descriptor.hook),
    objective: cleanOptionalText(descriptor.objective),
    reward: cleanOptionalText(descriptor.reward),
  };
}

async function assertCampaignExists(db: QuestDb, campaignId: string): Promise<void> {
  if (campaignId.trim().length === 0) {
    throw new QuestServiceError("CAMPAIGN_NOT_FOUND", "Campaign not found.");
  }

  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true },
  });

  if (campaign === null) {
    throw new QuestServiceError(
      "CAMPAIGN_NOT_FOUND",
      `Campaign not found: ${campaignId}`
    );
  }
}

export async function createTrackedQuest(
  input: CreateTrackedQuestInput
): Promise<CreateTrackedQuestResult> {
  const db = resolveDb(input);
  await assertCampaignExists(db, input.campaignId);

  const descriptor = validateDescriptor(input);
  const quest = await db.quest.create({
    data: {
      campaignId: input.campaignId,
      title: descriptor.title,
      description: descriptor.description,
      status: "active",
      giverId: descriptor.giverId,
      location: descriptor.location,
      hook: descriptor.hook,
      objective: descriptor.objective,
      reward: descriptor.reward,
    },
  });

  const facts: QuestCreatedFacts = {
    type: "quest_created",
    campaignId: input.campaignId,
    questId: quest.id,
    status: quest.status,
    title: quest.title,
    description: quest.description,
    giverId: quest.giverId,
    location: quest.location,
    hook: quest.hook,
    objective: quest.objective,
    reward: quest.reward,
    context: input.context,
  };

  return {
    ok: true,
    campaignId: input.campaignId,
    questId: quest.id,
    status: quest.status,
    title: quest.title,
    description: quest.description,
    giverId: quest.giverId,
    location: quest.location,
    hook: quest.hook,
    objective: quest.objective,
    reward: quest.reward,
    quest,
    facts,
  };
}

export async function updateQuestStatus(
  input: UpdateQuestStatusInput
): Promise<UpdateQuestStatusResult> {
  const db = resolveDb(input);
  await assertCampaignExists(db, input.campaignId);
  assertValidStatus(input.status);

  const quest = await db.quest.findUnique({
    where: { id: input.questId },
    select: {
      id: true,
      campaignId: true,
      title: true,
      description: true,
      status: true,
      giverId: true,
      location: true,
      hook: true,
      objective: true,
      reward: true,
    },
  });

  if (!quest) {
    throw new QuestServiceError(
      "QUEST_NOT_FOUND",
      `Quest not found: ${input.questId}`
    );
  }

  if (quest.campaignId !== input.campaignId) {
    throw new QuestServiceError(
      "QUEST_OWNERSHIP_MISMATCH",
      `Quest ${input.questId} does not belong to campaign ${input.campaignId}.`
    );
  }

  const previousStatus = quest.status;
  const updated = await db.quest.update({
    where: { id: input.questId },
    data: { status: input.status },
  });

  const facts: QuestStatusUpdatedFacts = {
    type: "quest_status_updated",
    campaignId: input.campaignId,
    questId: input.questId,
    status: updated.status,
    previousStatus,
    reason: input.reason,
  };

  return {
    ok: true,
    campaignId: input.campaignId,
    questId: input.questId,
    status: updated.status,
    previousStatus,
    quest: updated,
    facts,
  };
}
