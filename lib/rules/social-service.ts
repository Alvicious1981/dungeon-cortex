import { prisma } from "@/lib/db/prisma";
import { abilityModifier, d20Check } from "@/lib/rules/dice";
import type { RumorPayload, SocialCheckResult } from "@/lib/rules/social";
import {
  computeSocialDC,
  getDispositionBand,
  getRumorsPayload,
} from "@/lib/rules/social-logic";

export type SocialApproach = "persuade" | "intimidate" | "deceive";

export type SocialServiceErrorCode =
  | "CAMPAIGN_NOT_FOUND"
  | "CHARACTER_NOT_FOUND"
  | "CHARACTER_OWNERSHIP_MISMATCH"
  | "NPC_NOT_FOUND"
  | "NPC_OWNERSHIP_MISMATCH"
  | "NPC_NOT_MET"
  | "LOCATION_NOT_FOUND"
  | "INVALID_SOCIAL_APPROACH"
  | "INVALID_DISPOSITION_DELTA"
  | "INVALID_ROLL"
  | "INVALID_DC";

export class SocialServiceError extends Error {
  constructor(
    public readonly code: SocialServiceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "SocialServiceError";
  }
}

interface SocialCampaignRecord {
  id: string;
  characterId?: string;
  currentLocationId?: string | null;
}

interface SocialCharacterRecord {
  id: string;
  campaignId?: string;
  stats: unknown;
}

interface SocialNpcRecord {
  id?: string;
  campaignId?: string;
  seed?: string;
  name?: string;
  disposition?: number | null;
  hasMetPlayer?: boolean;
}

interface SocialLocationNodeRecord {
  id: string;
  name: string;
  feature: string;
  description: string;
}

interface SocialDb {
  $transaction?<T>(fn: (tx: SocialDb) => Promise<T>): Promise<T>;
  campaign: {
    findUnique(args: {
      where: { id: string };
      select?: Record<string, boolean>;
    }): Promise<SocialCampaignRecord | null | undefined>;
  };
  character: {
    findUnique(args: {
      where: { id: string };
      select?: Record<string, boolean>;
    }): Promise<SocialCharacterRecord | null | undefined>;
  };
  nPC: {
    findUnique(args: {
      where: { id: string } | { campaignId_seed: { campaignId: string; seed: string } };
      select?: Record<string, boolean>;
    }): Promise<SocialNpcRecord | null | undefined>;
    update(args: {
      where: { id: string } | { campaignId_seed: { campaignId: string; seed: string } };
      data: { disposition: number };
    }): Promise<SocialNpcRecord>;
  };
  locationNode: {
    findMany(args: {
      where: { locationId: string };
      select: Record<string, boolean>;
    }): Promise<SocialLocationNodeRecord[]>;
  };
}

export interface ResolveSocialCheckInput {
  campaignId: string;
  characterId?: string;
  npcId?: string;
  npcSeed?: string;
  approach: SocialApproach | string;
  intent?: string;
  dispositionDelta?: number;
  roll?: number;
  dc?: number;
  tx?: SocialDb;
  db?: SocialDb;
}

export interface ResolveRumorsInput {
  campaignId: string;
  npcSeed: string;
  tx?: SocialDb;
  db?: SocialDb;
}

export interface SocialCheckFacts {
  type: "social_check_resolved";
  ruleset: "D&D 5e/SRD 2014";
  mechanic: "d20_charisma_check";
  campaignId: string;
  characterId: string;
  npcId: string;
  npcSeed: string;
  approach: SocialApproach;
  roll: number;
  charismaModifier: number;
  total: number;
  dc: number;
  success: boolean;
  dispositionBefore: number;
  dispositionAfter: number;
  backfire: boolean;
}

export type ResolveSocialCheckResult = SocialCheckResult & {
  ok: true;
  campaignId: string;
  characterId: string;
  npcId: string;
  npcSeed: string;
  facts: SocialCheckFacts;
};

function resolveDb(input: { tx?: SocialDb; db?: SocialDb }): SocialDb {
  return input.tx ?? input.db ?? (prisma as unknown as SocialDb);
}

export async function resolveRumors(
  input: ResolveRumorsInput
): Promise<RumorPayload> {
  const db = resolveDb(input);
  const npc = await db.nPC.findUnique({
    where: {
      campaignId_seed: {
        campaignId: input.campaignId,
        seed: input.npcSeed,
      },
    },
    select: {
      id: true,
      name: true,
      disposition: true,
    },
  });
  if (!npc) {
    throw new SocialServiceError(
      "NPC_NOT_FOUND",
      "NPC not found. Cannot retrieve rumors."
    );
  }

  const campaign = await db.campaign.findUnique({
    where: { id: input.campaignId },
    select: { id: true, currentLocationId: true },
  });
  if (!campaign?.currentLocationId) {
    throw new SocialServiceError(
      "LOCATION_NOT_FOUND",
      "No active location — explore a location first."
    );
  }

  const nodes = await db.locationNode.findMany({
    where: { locationId: campaign.currentLocationId },
    select: { id: true, name: true, feature: true, description: true },
  });

  return getRumorsPayload(
    input.npcSeed,
    npc.name ?? input.npcSeed,
    npc.disposition ?? 0,
    nodes
  );
}

function assertApproach(approach: string): asserts approach is SocialApproach {
  if (approach !== "persuade" && approach !== "intimidate" && approach !== "deceive") {
    throw new SocialServiceError(
      "INVALID_SOCIAL_APPROACH",
      `Invalid social approach: ${approach}`
    );
  }
}

function assertDispositionDelta(delta: number): void {
  if (!Number.isInteger(delta) || delta < 1 || delta > 4) {
    throw new SocialServiceError(
      "INVALID_DISPOSITION_DELTA",
      `Invalid disposition delta: ${delta}`
    );
  }
}

function assertRoll(roll: number): void {
  if (!Number.isInteger(roll) || roll < 1 || roll > 20) {
    throw new SocialServiceError("INVALID_ROLL", `Invalid d20 roll: ${roll}`);
  }
}

function assertDc(dc: number): void {
  if (!Number.isInteger(dc) || dc < 1) {
    throw new SocialServiceError("INVALID_DC", `Invalid social DC: ${dc}`);
  }
}

function getChaModifier(stats: unknown): number {
  if (typeof stats !== "object" || stats === null) return abilityModifier(10);

  const cha = (stats as Record<string, unknown>).CHA;
  return abilityModifier(typeof cha === "number" ? cha : 10);
}

function clampDisposition(value: number): number {
  return Math.min(10, Math.max(-10, value));
}

function resolveD20Check(input: {
  approach: SocialApproach;
  dispositionDelta: number;
  charismaModifier: number;
  currentDisposition: number;
  roll?: number;
  dc?: number;
}): SocialCheckResult {
  if (input.roll !== undefined) assertRoll(input.roll);
  if (input.dc !== undefined) assertDc(input.dc);

  const dc =
    input.dc ??
    computeSocialDC(
      input.currentDisposition,
      input.dispositionDelta,
      input.approach
    );
  const checkResult =
    input.roll === undefined
      ? d20Check(input.charismaModifier, dc)
      : {
          roll: {
            notation: "1d20",
            dice: [{ faces: 20, result: input.roll }],
            diceTotal: input.roll,
            modifier: 0,
            total: input.roll + input.charismaModifier,
          },
          abilityModifier: input.charismaModifier,
          dc,
          isCriticalSuccess: input.roll === 20,
          isCriticalFailure: input.roll === 1,
          success:
            input.roll === 20 ||
            (input.roll !== 1 && input.roll + input.charismaModifier >= dc),
        };
  const natural = checkResult.roll.dice[0]!.result;
  const total = checkResult.roll.total;
  const isCriticalSuccess = checkResult.isCriticalSuccess;
  const isCriticalFailure = checkResult.isCriticalFailure;
  const success = checkResult.success;

  let dispositionShift: number;
  if (isCriticalSuccess) {
    dispositionShift = input.dispositionDelta + 1;
  } else if (success) {
    dispositionShift = input.dispositionDelta;
  } else if (isCriticalFailure) {
    dispositionShift = input.approach === "intimidate" ? -2 : 0;
  } else {
    dispositionShift = input.approach === "intimidate" ? -1 : 0;
  }

  const dispositionAfter = clampDisposition(
    input.currentDisposition + dispositionShift
  );

  return {
    approach: input.approach,
    roll: natural,
    charismaModifier: input.charismaModifier,
    total,
    dc,
    success,
    isCriticalSuccess,
    isCriticalFailure,
    dispositionBefore: input.currentDisposition,
    dispositionAfter,
    dispositionBandBefore: getDispositionBand(input.currentDisposition),
    dispositionBandAfter: getDispositionBand(dispositionAfter),
    backfire: input.approach === "intimidate" && !success,
  };
}

function assertCharacterOwnership(
  campaign: SocialCampaignRecord,
  character: SocialCharacterRecord,
  characterId: string,
  campaignId: string
): void {
  if (campaign.characterId && campaign.characterId !== characterId) {
    throw new SocialServiceError(
      "CHARACTER_OWNERSHIP_MISMATCH",
      `Character ${characterId} does not belong to campaign ${campaignId}.`
    );
  }

  if (character.campaignId && character.campaignId !== campaignId) {
    throw new SocialServiceError(
      "CHARACTER_OWNERSHIP_MISMATCH",
      `Character ${characterId} does not belong to campaign ${campaignId}.`
    );
  }
}

function assertNpcOwnership(npc: SocialNpcRecord, campaignId: string): void {
  if (npc.campaignId && npc.campaignId !== campaignId) {
    throw new SocialServiceError(
      "NPC_OWNERSHIP_MISMATCH",
      `NPC ${npc.id ?? npc.seed ?? "unknown"} does not belong to campaign ${campaignId}.`
    );
  }
}

async function findNpc(
  db: SocialDb,
  input: ResolveSocialCheckInput
): Promise<SocialNpcRecord | null | undefined> {
  if (input.npcId) {
    return db.nPC.findUnique({
      where: { id: input.npcId },
      select: {
        id: true,
        campaignId: true,
        seed: true,
        name: true,
        disposition: true,
        hasMetPlayer: true,
      },
    });
  }

  if (input.npcSeed) {
    return db.nPC.findUnique({
      where: {
        campaignId_seed: {
          campaignId: input.campaignId,
          seed: input.npcSeed,
        },
      },
      select: {
        id: true,
        campaignId: true,
        seed: true,
        name: true,
        disposition: true,
        hasMetPlayer: true,
      },
    });
  }

  throw new SocialServiceError("NPC_NOT_FOUND", "Missing NPC identity.");
}

async function resolveSocialCheckInTransaction(
  db: SocialDb,
  input: ResolveSocialCheckInput
): Promise<ResolveSocialCheckResult> {
  assertApproach(input.approach);
  const dispositionDelta = input.dispositionDelta ?? 1;
  assertDispositionDelta(dispositionDelta);

  const campaign = await db.campaign.findUnique({
    where: { id: input.campaignId },
    select: { id: true, characterId: true },
  });
  if (!campaign) {
    throw new SocialServiceError(
      "CAMPAIGN_NOT_FOUND",
      `Campaign not found: ${input.campaignId}`
    );
  }

  const characterId = input.characterId ?? campaign.characterId;
  if (!characterId) {
    throw new SocialServiceError("CHARACTER_NOT_FOUND", "Character not found.");
  }

  const character = await db.character.findUnique({
    where: { id: characterId },
    select: { id: true, campaignId: true, stats: true },
  });
  if (!character) {
    throw new SocialServiceError(
      "CHARACTER_NOT_FOUND",
      `Character not found: ${characterId}`
    );
  }
  assertCharacterOwnership(campaign, character, characterId, input.campaignId);

  const npc = await findNpc(db, input);
  if (!npc) {
    throw new SocialServiceError(
      "NPC_NOT_FOUND",
      "NPC not found. Call establishInitialDisposition first to establish first contact."
    );
  }
  assertNpcOwnership(npc, input.campaignId);

  if (!npc.hasMetPlayer) {
    throw new SocialServiceError(
      "NPC_NOT_MET",
      "Call establishInitialDisposition before socialCheck; the party has not yet met this NPC."
    );
  }

  const charismaModifier = getChaModifier(character.stats);
  const currentDisposition = npc.disposition ?? 0;
  const socialResult = resolveD20Check({
    approach: input.approach,
    dispositionDelta,
    charismaModifier,
    currentDisposition,
    roll: input.roll,
    dc: input.dc,
  });

  const npcId = npc.id ?? input.npcId ?? input.npcSeed;
  const npcSeed = npc.seed ?? input.npcSeed ?? npcId;
  if (!npcId || !npcSeed) {
    throw new SocialServiceError("NPC_NOT_FOUND", "Missing NPC identity.");
  }

  await db.nPC.update({
    where: input.npcSeed
      ? { campaignId_seed: { campaignId: input.campaignId, seed: input.npcSeed } }
      : { id: npcId },
    data: { disposition: socialResult.dispositionAfter },
  });

  const facts: SocialCheckFacts = {
    type: "social_check_resolved",
    ruleset: "D&D 5e/SRD 2014",
    mechanic: "d20_charisma_check",
    campaignId: input.campaignId,
    characterId,
    npcId,
    npcSeed,
    approach: socialResult.approach,
    roll: socialResult.roll,
    charismaModifier: socialResult.charismaModifier,
    total: socialResult.total,
    dc: socialResult.dc,
    success: socialResult.success,
    dispositionBefore: socialResult.dispositionBefore,
    dispositionAfter: socialResult.dispositionAfter,
    backfire: socialResult.backfire,
  };

  return {
    ok: true,
    campaignId: input.campaignId,
    characterId,
    npcId,
    npcSeed,
    ...socialResult,
    facts,
  };
}

export async function resolveSocialCheck(
  input: ResolveSocialCheckInput
): Promise<ResolveSocialCheckResult> {
  const db = resolveDb(input);

  if (input.tx || !db.$transaction) {
    return resolveSocialCheckInTransaction(db, input);
  }

  return db.$transaction((tx) => resolveSocialCheckInTransaction(tx, input));
}


