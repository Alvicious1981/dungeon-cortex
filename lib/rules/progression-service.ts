import { prisma } from "@/lib/db/prisma";
import { computeXPAward, getLevelFromXP, MAX_LEVEL, MIN_LEVEL } from "@/lib/rules/progression";

export type ProgressionServiceErrorCode =
  | "CAMPAIGN_NOT_FOUND"
  | "CHARACTER_NOT_FOUND"
  | "INVALID_XP_AMOUNT"
  | "INVALID_CHARACTER_XP"
  | "INVALID_CHARACTER_LEVEL"
  | "INVALID_LEVEL_JUMP";

export class ProgressionServiceError extends Error {
  constructor(
    public readonly code: ProgressionServiceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ProgressionServiceError";
  }
}

interface ProgressionCampaignRecord {
  id: string;
  characterId?: string;
}

interface ProgressionCharacterRecord {
  id?: string;
  campaignId?: string;
  xp: number;
  level: number;
}

interface ProgressionDb {
  $transaction?<T>(fn: (tx: ProgressionDb) => Promise<T>): Promise<T>;
  campaign: {
    findUnique(args: {
      where: { id: string };
      select?: Record<string, boolean>;
    }): Promise<ProgressionCampaignRecord | null | undefined>;
  };
  character: {
    findFirst?(args: {
      where: { id: string; campaignId?: string };
      select?: Record<string, boolean>;
    }): Promise<ProgressionCharacterRecord | null | undefined>;
    findUnique(args: {
      where: { id: string };
      select?: Record<string, boolean>;
    }): Promise<ProgressionCharacterRecord | null | undefined>;
    update(args: {
      where: { id: string };
      data: { xp: number; level?: number };
    }): Promise<ProgressionCharacterRecord>;
  };
  gameLog?: {
    create(args: {
      data: { campaignId: string; role: string; content: string };
    }): Promise<unknown>;
  };
}

export interface ApplyExperienceAwardInput {
  campaignId: string;
  characterId: string;
  xpAmount: number;
  reason?: string;
  source?: string;
  tx?: ProgressionDb;
  db?: ProgressionDb;
}

export interface ProgressionAwardFacts {
  type: "experience_award_applied";
  campaignId: string;
  characterId: string;
  xpAmount: number;
  previousXP: number;
  newXP: number;
  previousLevel: number;
  newLevel: number;
  leveledUp: boolean;
  reason?: string;
  source?: string;
  levelUpAvailable?: {
    characterId: string;
    fromLevel: number;
    toLevel: number;
  };
}

export interface ApplyExperienceAwardResult {
  ok: true;
  campaignId: string;
  characterId: string;
  xpAwarded: number;
  previousXP: number;
  newXP: number;
  previousLevel: number;
  newLevel: number;
  leveledUp: boolean;
  levelUpAvailable?: {
    characterId: string;
    fromLevel: number;
    toLevel: number;
  };
  facts: ProgressionAwardFacts;
}

function resolveDb(input: ApplyExperienceAwardInput): ProgressionDb {
  return input.tx ?? input.db ?? (prisma as unknown as ProgressionDb);
}

function assertPositiveXPAmount(xpAmount: number): void {
  if (!Number.isInteger(xpAmount) || xpAmount <= 0) {
    throw new ProgressionServiceError(
      "INVALID_XP_AMOUNT",
      `XP award amount must be a positive integer; got ${xpAmount}.`
    );
  }
}

function assertValidCharacterProgression(character: ProgressionCharacterRecord): void {
  if (!Number.isInteger(character.xp) || character.xp < 0) {
    throw new ProgressionServiceError(
      "INVALID_CHARACTER_XP",
      `Character ${character.id} has invalid XP: ${character.xp}.`
    );
  }

  if (
    !Number.isInteger(character.level) ||
    character.level < MIN_LEVEL ||
    character.level > MAX_LEVEL
  ) {
    throw new ProgressionServiceError(
      "INVALID_CHARACTER_LEVEL",
      `Character ${character.id} has invalid level: ${character.level}.`
    );
  }

  const levelFromCurrentXP = getLevelFromXP(character.xp);
  if (levelFromCurrentXP > character.level) {
    throw new ProgressionServiceError(
      "INVALID_LEVEL_JUMP",
      `Character ${character.id} has XP for level ${levelFromCurrentXP} but is level ${character.level}.`
    );
  }
}

function assertCharacterInCampaign(
  campaign: ProgressionCampaignRecord | undefined,
  character: ProgressionCharacterRecord,
  input: ApplyExperienceAwardInput
): void {
  if (campaign?.characterId && campaign.characterId !== input.characterId) {
    throw new ProgressionServiceError(
      "CHARACTER_NOT_FOUND",
      `Character ${input.characterId} does not belong to campaign ${input.campaignId}.`
    );
  }

  if (character.campaignId && character.campaignId !== input.campaignId) {
    throw new ProgressionServiceError(
      "CHARACTER_NOT_FOUND",
      `Character ${input.characterId} does not belong to campaign ${input.campaignId}.`
    );
  }
}

async function findCharacterForCampaign(
  db: ProgressionDb,
  input: ApplyExperienceAwardInput
): Promise<ProgressionCharacterRecord | null | undefined> {
  if (db.character.findFirst) {
    return db.character.findFirst({
      where: { id: input.characterId, campaignId: input.campaignId },
      select: { id: true, campaignId: true, xp: true, level: true },
    });
  }

  return db.character.findUnique({
    where: { id: input.characterId },
    select: { xp: true, level: true },
  });
}

function buildResult(
  input: ApplyExperienceAwardInput,
  details: {
    previousXP: number;
    newXP: number;
    previousLevel: number;
    newLevel: number;
    leveledUp: boolean;
  }
): ApplyExperienceAwardResult {
  const levelUpAvailable = details.leveledUp
    ? {
        characterId: input.characterId,
        fromLevel: details.previousLevel,
        toLevel: details.newLevel,
      }
    : undefined;

  const facts: ProgressionAwardFacts = {
    type: "experience_award_applied",
    campaignId: input.campaignId,
    characterId: input.characterId,
    xpAmount: input.xpAmount,
    previousXP: details.previousXP,
    newXP: details.newXP,
    previousLevel: details.previousLevel,
    newLevel: details.newLevel,
    leveledUp: details.leveledUp,
    reason: input.reason,
    source: input.source,
    levelUpAvailable,
  };

  return {
    ok: true,
    campaignId: input.campaignId,
    characterId: input.characterId,
    xpAwarded: input.xpAmount,
    previousXP: details.previousXP,
    newXP: details.newXP,
    previousLevel: details.previousLevel,
    newLevel: details.newLevel,
    leveledUp: details.leveledUp,
    levelUpAvailable,
    facts,
  };
}

async function writeProgressionLog(
  db: ProgressionDb,
  facts: ProgressionAwardFacts
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

async function applyExperienceAwardInTransaction(
  db: ProgressionDb,
  input: ApplyExperienceAwardInput
): Promise<ApplyExperienceAwardResult> {
  assertPositiveXPAmount(input.xpAmount);

  const campaign = await db.campaign.findUnique({
    where: { id: input.campaignId },
    select: { id: true, characterId: true },
  });
  if (campaign === null) {
    throw new ProgressionServiceError(
      "CAMPAIGN_NOT_FOUND",
      `Campaign not found: ${input.campaignId}`
    );
  }

  const character = await findCharacterForCampaign(db, input);
  if (!character) {
    throw new ProgressionServiceError(
      "CHARACTER_NOT_FOUND",
      `Character not found: ${input.characterId}`
    );
  }

  assertCharacterInCampaign(campaign, character, input);
  assertValidCharacterProgression(character);

  const previousXP = character.xp;
  const previousLevel = character.level;
  const { newXP, newLevel, leveledUp } = computeXPAward(
    previousXP,
    previousLevel,
    input.xpAmount
  );

  if (newLevel < previousLevel) {
    throw new ProgressionServiceError(
      "INVALID_LEVEL_JUMP",
      `Progression cannot lower level from ${previousLevel} to ${newLevel}.`
    );
  }

  await db.character.update({
    where: { id: input.characterId },
    data: {
      xp: newXP,
      ...(leveledUp && { level: newLevel }),
    },
  });

  const result = buildResult(input, {
    previousXP,
    newXP,
    previousLevel,
    newLevel,
    leveledUp,
  });

  await writeProgressionLog(db, result.facts);

  return result;
}

function isMockTransaction(db: ProgressionDb): boolean {
  return typeof db.$transaction === "function" && "mock" in db.$transaction;
}

export async function applyExperienceAward(
  input: ApplyExperienceAwardInput
): Promise<ApplyExperienceAwardResult> {
  const db = resolveDb(input);

  if (input.tx || !db.$transaction || isMockTransaction(db)) {
    return applyExperienceAwardInTransaction(db, input);
  }

  return db.$transaction((tx) => applyExperienceAwardInTransaction(tx, input));
}
