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
  | "INVALID_LEVEL_JUMP"
  /**
   * The conditional write found no row still in the pre-ascension state.
   * Raised when a concurrent request applied the same level first; the losing
   * caller has mutated nothing and its HP roll is discarded.
   */
  | "LEVEL_UP_ALREADY_APPLIED";

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
    /**
     * Conditional write. `where` repeats the pre-ascension state so the
     * database, not the caller, decides whether the state that authorised this
     * level-up is still in place. Returns how many rows matched.
     */
    updateMany(args: {
      where: {
        id: string;
        level: number;
        hitDiceTotal: number;
      };
      data: {
        level: number;
        maxHp: number;
        hp: number;
        hitDiceTotal: number;
        hitDiceRemaining: number;
      };
    }): Promise<{ count: number }>;
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

  // Model E settled state. applyLevelUp advances `level` and `hitDiceTotal`
  // together, so any disagreement means the row was never resolved by this
  // service — old-contract residue or corruption. Either way its applied level
  // cannot be trusted as the base for the next ascension.
  if (character.hitDiceTotal !== character.level) {
    throw new LevelUpServiceError(
      "INVALID_LEVEL_UP_STATE",
      `Character ${character.id} has hitDiceTotal ${character.hitDiceTotal} but level ${character.level}; the two must agree before a level-up.`
    );
  }
}

/**
 * Resolves the single level this invocation may apply.
 *
 * Model E: exactly one level per call, always `level + 1`, and only when the
 * XP already supports it. `input.targetLevel` is accepted purely as an
 * optional assertion by the caller — it must equal the level the backend
 * derived, so no caller (least of all the narrator) can choose a level.
 */
function resolveNextLevel(
  input: ApplyLevelUpInput,
  character: LevelUpCharacterRecord
): number {
  if (character.level >= MAX_LEVEL) {
    throw new LevelUpServiceError(
      "INVALID_LEVEL_UP_STATE",
      `Character ${character.id} is already at the maximum level ${MAX_LEVEL}.`
    );
  }

  const nextLevel = character.level + 1;
  const xpLevel = getLevelFromXP(character.xp);

  if (nextLevel > xpLevel) {
    throw new LevelUpServiceError(
      "INVALID_LEVEL_UP_STATE",
      `Character ${character.id} has no pending level-up: XP supports level ${xpLevel} and level ${character.level} is already applied.`
    );
  }

  if (input.targetLevel !== undefined && input.targetLevel !== nextLevel) {
    throw new LevelUpServiceError(
      "INVALID_LEVEL_JUMP",
      `Level-up applies exactly one level at a time; expected ${nextLevel}, got ${input.targetLevel}.`
    );
  }

  return nextLevel;
}

function buildResult(
  input: ApplyLevelUpInput,
  character: LevelUpCharacterRecord,
  payload: LevelUpPayload,
  newHp: number,
  newHitDiceRemaining: number
): ApplyLevelUpResult {
  const common = {
    campaignId: input.campaignId,
    source: input.source,
    previousXP: character.xp,
    newXP: character.xp,
    previousHp: character.hp,
    newHp,
    previousHitDiceTotal: character.hitDiceTotal,
    newHitDiceRemaining,
    previousHitDiceRemaining: character.hitDiceRemaining,
    ...payload,
  };

  const facts: LevelUpFacts = { type: "level_up_applied", ...common };

  return { ok: true, ...common, facts };
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

  const fromLevel = character.level;
  const nextLevel = resolveNextLevel(input, character);

  const payload = buildLevelUpPayload({
    characterId: input.characterId,
    className: character.class,
    previousLevel: fromLevel,
    newLevel: nextLevel,
    currentMaxHp: character.maxHp,
    conModifier: getConstitutionModifier(character.stats),
    useAverage: input.useAverage,
  });

  // HP policy: the new hit die raises the ceiling and heals the same amount.
  // Damage already suffered is preserved — a level-up is not a rest.
  const newHp = Math.min(character.hp + payload.hpGained, payload.newMaxHp);
  // One new hit die becomes available, capped at the new total.
  const newHitDiceRemaining = Math.min(character.hitDiceRemaining + 1, nextLevel);

  const result = buildResult(input, character, payload, newHp, newHitDiceRemaining);

  // Compare-and-set. The guards above were evaluated against a row another
  // request may have changed in the meantime, so the write repeats the
  // pre-ascension state — `level` and `hitDiceTotal`, both still at
  // `fromLevel` — inside its own WHERE clause. Under READ COMMITTED the second
  // writer blocks on the row lock, re-evaluates the predicate against the
  // committed row, and matches nothing.
  //
  // The winner moves `level` and `hitDiceTotal` to `nextLevel` in the same
  // statement, so exactly one request can ever match. No extra column, table or
  // migration is involved: the pre-ascension state is its own lock.
  const applied = await db.character.updateMany({
    where: {
      id: input.characterId,
      level: fromLevel,
      hitDiceTotal: fromLevel,
    },
    data: {
      level: nextLevel,
      maxHp: payload.newMaxHp,
      hp: newHp,
      hitDiceTotal: payload.newHitDiceTotal,
      hitDiceRemaining: newHitDiceRemaining,
    },
  });

  if (applied.count !== 1) {
    // The losing caller discards its roll here, before any caller can see it.
    throw new LevelUpServiceError(
      "LEVEL_UP_ALREADY_APPLIED",
      `Character ${input.characterId} is no longer at level ${fromLevel}; a concurrent request applied this level-up first.`
    );
  }

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
