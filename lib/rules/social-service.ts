import { prisma } from "@/lib/db/prisma";
import type { RumorPayload, SocialCheckResult } from "@/lib/rules/social";
import {
  resolveSocialCheck as resolveSocialCheckPure,
  getRumorsPayload,
} from "@/lib/rules/social-logic";
import type { AbilityCheckActor, Ability } from "@/lib/rules/ability-check";

export type SocialApproach = "persuade" | "intimidate" | "deceive";

export type SocialServiceErrorCode =
  | "CAMPAIGN_NOT_FOUND"
  | "CHARACTER_NOT_FOUND"
  | "CHARACTER_OWNERSHIP_MISMATCH"
  | "NPC_NOT_FOUND"
  | "NPC_OWNERSHIP_MISMATCH"
  | "NPC_NOT_MET"
  | "LOCATION_NOT_FOUND"
  | "INVALID_SOCIAL_APPROACH";

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
  level?: number;
  skillProficiencies?: unknown;
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
  skill: SocialCheckResult["skill"];
  roll: number;
  abilityModifier: number;
  proficiencyApplied: number;
  total: number;
  dc: number;
  success: boolean;
  dispositionBefore: number;
  dispositionAfter: number;
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

/**
 * Builds the actor `resolveSocialCheck` (the pure function) rolls against,
 * from a loosely-typed persisted character record. Unknown or malformed
 * stats/level/proficiencies degrade to safe defaults rather than throwing —
 * this wrapper is dead code and its job here is only to shape the call, not
 * to validate the database. Dead since commit a0bb009 removed `buildSocialTools`
 * from `buildNarratorTools`: `buildNarratorTools` in `lib/ai/narrator.ts` now
 * spreads only `buildSrdTools()`, so nothing calls this module's exports from
 * production.
 */
function toAbilityCheckActor(character: SocialCharacterRecord): AbilityCheckActor {
  const stats =
    typeof character.stats === "object" && character.stats !== null
      ? (character.stats as Partial<Record<Ability, number>>)
      : {};
  const level = typeof character.level === "number" ? character.level : 1;
  const skillProficiencies = Array.isArray(character.skillProficiencies)
    ? (character.skillProficiencies as AbilityCheckActor["skillProficiencies"])
    : undefined;

  return { stats, level, skillProficiencies };
}

function assertCharacterOwnership(
  campaign: SocialCampaignRecord,
  character: SocialCharacterRecord,
  characterId: string,
  campaignId: string
): void {
  // `Character` has no campaignId scalar — only a campaigns relation — so the
  // earlier version of this check read `character.campaignId`, was always
  // undefined, and never once fired. `Campaign.characterId` is the field that
  // actually records the link, and this function already has the campaign row.
  if (campaign.characterId !== characterId) {
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
    select: { id: true, stats: true, level: true, skillProficiencies: true },
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

  const actor = toAbilityCheckActor(character);
  const currentDisposition = npc.disposition ?? null;
  const socialResult = resolveSocialCheckPure(
    { npcSeed: npc.seed ?? input.npcSeed ?? "", approach: input.approach, intent: input.intent ?? "" },
    actor,
    currentDisposition
  );

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
    skill: socialResult.skill,
    roll: socialResult.roll,
    abilityModifier: socialResult.abilityModifier,
    proficiencyApplied: socialResult.proficiencyApplied,
    total: socialResult.total,
    dc: socialResult.dc,
    success: socialResult.success,
    dispositionBefore: socialResult.dispositionBefore,
    dispositionAfter: socialResult.dispositionAfter,
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


