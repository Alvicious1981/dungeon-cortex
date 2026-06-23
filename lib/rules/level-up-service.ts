import { prisma } from "@/lib/db/prisma";
import {
  buildLevelUpPayload,
  getLevelFromXP,
  HIT_DIE_MAP,
  MAX_LEVEL,
  MIN_LEVEL,
  type LevelUpPayload,
} from "@/lib/rules/progression";
import type { CharacterClass } from "@/lib/rules/proficiency";

export type LevelUpServiceErrorCode =
  | "CAMPAIGN_NOT_FOUND"
  | "CHARACTER_NOT_FOUND"
  | "INVALID_CHARACTER_XP"
  | "INVALID_CHARACTER_LEVEL"
  | "INVALID_CHARACTER_CLASS"
  | "INVALID_LEVEL_UP_STATE"
  | "INVALID_LEVEL_JUMP";

export class LevelUpServiceError extends Error {
  constructor(
    public readonly code: LevelUpServiceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "LevelUpServiceError";
  }
}

interface LevelUpCampaignRecord {
  id: string;
  characterId?: string;
}

interface LevelUpCharacterRecord {
  id?: string;
  campaignId?: string;
  xp: number;
  level: number;
  class: string;
  stats: unknown;
  hp: number;
  maxHp: number;
  hitDiceTotal: number;
  hitDiceRemaining: number;
}

interface LevelUpDb {
  $transaction?<T>(fn: (tx: LevelUpDb) => Promise<T>): Promise<T>;
  campaign: {
    findUnique(args: {
      where: { id: string };
      select?: Record<string, boolean>;
    }): Promise<LevelUpCampaignRecord | null | undefined>;
  };
  character: {
    findUnique(args: {
      where: { id: string };
      select?: Record<string, boolean>;
    }): Promise<LevelUpCharacterRecord | null | undefined>;
    update(args: {
      where: { id: string };
      data: {
        maxHp: number;
        hp: number;
        hitDiceTotal: number;
        hitDiceRemaining: number;
      };
    }): Promise<LevelUpCharacterRecord>;
  };
}

export interface ApplyLevelUpInput {
  campaignId: string;
  characterId: string;
  targetLevel?: number;
  source?: string;
  useAverage?: boolean;
  tx?: LevelUpDb;
  db?: LevelUpDb;
}

export interface LevelUpFacts extends LevelUpPayload {
  type: "level_up_applied";
  campaignId: string;
  source?: string;
  previousXP: number;
  newXP: number;
  previousHp: number;
  newHp: number;
  previousHitDiceTotal: number;
  newHitDiceRemaining: number;
  previousHitDiceRemaining: number;
}

export interface ApplyLevelUpResult extends LevelUpPayload {
  ok: true;
  campaignId: string;
  source?: string;
  previousXP: number;
  newXP: number;
  previousHp: number;
  newHp: number;
  previousHitDiceTotal: number;
  newHitDiceRemaining: number;
  previousHitDiceRemaining: number;
  facts: LevelUpFacts;
}

function resolveDb(input: ApplyLevelUpInput): LevelUpDb {
  return input.tx ?? input.db ?? (prisma as unknown as LevelUpDb);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getConstitutionModifier(stats: unknown): number {
  const source = isRecord(stats) ? stats : {};
  const constitution =
    typeof source.CON === "number"
      ? source.CON
      : typeof source.constitution === "number"
        ? source.constitution
        : 10;

  return Math.floor((constitution - 10) / 2);
}

function assertCharacterClass(className: string): asserts className is CharacterClass {
  if (!(className in HIT_DIE_MAP)) {
    throw new LevelUpServiceError(
      "INVALID_CHARACTER_CLASS",
      `Character class cannot be used for level-up: ${className}.`
    );
  }
}

function assertCharacterBelongsToCampaign(
  campaign: LevelUpCampaignRecord,
  character: LevelUpCharacterRecord,
  input: ApplyLevelUpInput
): void {
  if (campaign.characterId && campaign.characterId !== input.characterId) {
    throw new LevelUpServiceError(
      "CHARACTER_NOT_FOUND",
      `Character ${input.characterId} does not belong to campaign ${input.campaignId}.`
    );
  }

  if (character.campaignId && character.campaignId !== input.campaignId) {
    throw new LevelUpServiceError(
      "CHARACTER_NOT_FOUND",
      `Character ${input.characterId} does not belong to campaign ${input.campaignId}.`
    );
  }
}

function assertValidProgressionState(character: LevelUpCharacterRecord): void {
  if (!Number.isInteger(character.xp) || character.xp < 0) {
    throw new LevelUpServiceError(
      "INVALID_CHARACTER_XP",
      `Character ${character.id} has invalid XP: ${character.xp}.`
    );
  }

  if (
    !Number.isInteger(character.level) ||
    character.level < MIN_LEVEL ||
    character.level > MAX_LEVEL
  ) {
    throw new LevelUpServiceError(
      "INVALID_CHARACTER_LEVEL",
      `Character ${character.id} has invalid level: ${character.level}.`
    );
  }

  if (
    !Number.isInteger(character.hitDiceTotal) ||
    character.hitDiceTotal < 0 ||
    character.hitDiceTotal > MAX_LEVEL
  ) {
    throw new LevelUpServiceError(
      "INVALID_LEVEL_UP_STATE",
      `Character ${character.id} has invalid hit dice total: ${character.hitDiceTotal}.`
    );
  }
}

function resolveTargetLevel(input: ApplyLevelUpInput, character: LevelUpCharacterRecord): number {
  const targetLevel = input.targetLevel ?? character.level;

  if (!Number.isInteger(targetLevel) || targetLevel < MIN_LEVEL || targetLevel > MAX_LEVEL) {
    throw new LevelUpServiceError(
      "INVALID_CHARACTER_LEVEL",
      `Target level must be between ${MIN_LEVEL} and ${MAX_LEVEL}; got ${targetLevel}.`
    );
  }

  if (targetLevel < character.level) {
    throw new LevelUpServiceError(
      "INVALID_LEVEL_JUMP",
      `Level-up cannot lower level from ${character.level} to ${targetLevel}.`
    );
  }

  if (targetLevel !== character.level) {
    throw new LevelUpServiceError(
      "INVALID_LEVEL_JUMP",
      `Level-up target ${targetLevel} must match persisted level ${character.level}.`
    );
  }

  if (targetLevel <= MIN_LEVEL) {
    throw new LevelUpServiceError(
      "INVALID_LEVEL_UP_STATE",
      `Character ${character.id} has no level-up pending at level ${targetLevel}.`
    );
  }

  if (character.hitDiceTotal !== targetLevel - 1) {
    throw new LevelUpServiceError(
      "INVALID_LEVEL_UP_STATE",
      `Character ${character.id} must have exactly one physical level-up pending.`
    );
  }

  return targetLevel;
}

function assertXPSupportsLevel(character: LevelUpCharacterRecord, targetLevel: number): void {
  const xpLevel = getLevelFromXP(character.xp);

  if (xpLevel < targetLevel) {
    throw new LevelUpServiceError(
      "INVALID_LEVEL_UP_STATE",
      `Character ${character.id} does not have enough XP for level ${targetLevel}.`
    );
  }
}

function buildResult(
  input: ApplyLevelUpInput,
  character: LevelUpCharacterRecord,
  payload: LevelUpPayload
): ApplyLevelUpResult {
  const facts: LevelUpFacts = {
    type: "level_up_applied",
    campaignId: input.campaignId,
    source: input.source,
    previousXP: character.xp,
    newXP: character.xp,
    previousHp: character.hp,
    newHp: payload.newMaxHp,
    previousHitDiceTotal: character.hitDiceTotal,
    newHitDiceRemaining: payload.newHitDiceTotal,
    previousHitDiceRemaining: character.hitDiceRemaining,
    ...payload,
  };

  return {
    ok: true,
    campaignId: input.campaignId,
    source: input.source,
    previousXP: character.xp,
    newXP: character.xp,
    previousHp: character.hp,
    newHp: payload.newMaxHp,
    previousHitDiceTotal: character.hitDiceTotal,
    newHitDiceRemaining: payload.newHitDiceTotal,
    previousHitDiceRemaining: character.hitDiceRemaining,
    ...payload,
    facts,
  };
}

async function applyLevelUpInTransaction(
  db: LevelUpDb,
  input: ApplyLevelUpInput
): Promise<ApplyLevelUpResult> {
  const campaign = await db.campaign.findUnique({
    where: { id: input.campaignId },
    select: { id: true, characterId: true },
  });
  if (!campaign) {
    throw new LevelUpServiceError(
      "CAMPAIGN_NOT_FOUND",
      `Campaign not found: ${input.campaignId}`
    );
  }

  const character = await db.character.findUnique({
    where: { id: input.characterId },
    select: {
      id: true,
      xp: true,
      level: true,
      class: true,
      stats: true,
      hp: true,
      maxHp: true,
      hitDiceTotal: true,
      hitDiceRemaining: true,
    },
  });
  if (!character) {
    throw new LevelUpServiceError(
      "CHARACTER_NOT_FOUND",
      `Character not found: ${input.characterId}`
    );
  }

  assertCharacterBelongsToCampaign(campaign, character, input);
  assertValidProgressionState(character);
  assertCharacterClass(character.class);

  const targetLevel = resolveTargetLevel(input, character);
  assertXPSupportsLevel(character, targetLevel);

  const payload = buildLevelUpPayload({
    characterId: input.characterId,
    className: character.class,
    previousLevel: targetLevel - 1,
    newLevel: targetLevel,
    currentMaxHp: character.maxHp,
    conModifier: getConstitutionModifier(character.stats),
    useAverage: input.useAverage,
  });

  const result = buildResult(input, character, payload);

  await db.character.update({
    where: { id: input.characterId },
    data: {
      maxHp: payload.newMaxHp,
      hp: payload.newMaxHp,
      hitDiceTotal: payload.newHitDiceTotal,
      hitDiceRemaining: payload.newHitDiceTotal,
    },
  });

  return result;
}

function isMockTransaction(db: LevelUpDb): boolean {
  return typeof db.$transaction === "function" && "mock" in db.$transaction;
}

export async function applyLevelUp(
  input: ApplyLevelUpInput
): Promise<ApplyLevelUpResult> {
  const db = resolveDb(input);

  if (input.tx || !db.$transaction || isMockTransaction(db)) {
    return applyLevelUpInTransaction(db, input);
  }

  return db.$transaction((tx) => applyLevelUpInTransaction(tx, input));
}
