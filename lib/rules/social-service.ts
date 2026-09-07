import { prisma } from "@/lib/db/prisma";
import type { RumorPayload, SocialCheckResult } from "@/lib/rules/social";
import {
  resolveSocialCheck as resolveSocialCheckPure,
  rebaseSocialCheckResult,
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
  | "INVALID_SOCIAL_APPROACH"
  | "SOCIAL_STATE_CONFLICT";

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
  knownRumors?: unknown;
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
    updateMany?(args: {
      where: {
        id?: string;
        campaignId?: string;
        seed?: string;
        disposition: number | null;
      };
      data: { disposition: number };
    }): Promise<{ count: number }>;
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
  /** Either identifier resolves the NPC; the route holds an id, older callers a seed. */
  npcId?: string;
  npcSeed?: string;
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

const MAX_SOCIAL_CAS_ATTEMPTS = 8;

function resolveDb(input: { tx?: SocialDb; db?: SocialDb }): SocialDb {
  return input.tx ?? input.db ?? (prisma as unknown as SocialDb);
}

export async function resolveRumors(
  input: ResolveRumorsInput
): Promise<RumorPayload> {
  const db = resolveDb(input);

  const npc = await db.nPC.findUnique({
    where: input.npcId
      ? { id: input.npcId }
      : {
          campaignId_seed: {
            campaignId: input.campaignId,
            seed: input.npcSeed ?? "",
          },
        },
    select: {
      id: true,
      campaignId: true,
      seed: true,
      name: true,
      disposition: true,
      knownRumors: true,
    },
  });
  if (!npc) {
    throw new SocialServiceError(
      "NPC_NOT_FOUND",
      "NPC not found. Cannot retrieve rumors."
    );
  }
  assertNpcOwnership(npc, input.campaignId);

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

  const seed = npc.seed ?? input.npcSeed ?? "";
  return getRumorsPayload(
    seed,
    npc.name ?? seed,
    npc.disposition ?? 0,
    nodes,
    Array.isArray(npc.knownRumors) ? npc.knownRumors : []
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
  characterId: string,
  campaignId: string
): void {
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

function assertNpcReady(npc: SocialNpcRecord, campaignId: string): void {
  assertNpcOwnership(npc, campaignId);
  if (!npc.hasMetPlayer) {
    throw new SocialServiceError(
      "NPC_NOT_MET",
      "Call establishInitialDisposition before socialCheck; the party has not yet met this NPC."
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

function buildSocialCheckResult(
  input: ResolveSocialCheckInput,
  characterId: string,
  npcId: string,
  npcSeed: string,
  socialResult: SocialCheckResult
): ResolveSocialCheckResult {
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
  assertCharacterOwnership(campaign, characterId, input.campaignId);

  let npc = await findNpc(db, input);
  if (!npc) {
    throw new SocialServiceError(
      "NPC_NOT_FOUND",
      "NPC not found. Call establishInitialDisposition first to establish first contact."
    );
  }
  assertNpcReady(npc, input.campaignId);

  const actor = toAbilityCheckActor(character);
  const initialDisposition = npc.disposition ?? null;
  let socialResult = resolveSocialCheckPure(
    { npcSeed: npc.seed ?? input.npcSeed ?? "", approach: input.approach, intent: input.intent ?? "" },
    actor,
    initialDisposition
  );

  for (let attempt = 0; attempt < MAX_SOCIAL_CAS_ATTEMPTS; attempt += 1) {
    const npcId = npc.id ?? input.npcId ?? input.npcSeed;
    const npcSeed = npc.seed ?? input.npcSeed ?? npcId;
    if (!npcId || !npcSeed) {
      throw new SocialServiceError("NPC_NOT_FOUND", "Missing NPC identity.");
    }

    const expectedDisposition = npc.disposition ?? null;

    // Compatibility seam for legacy injected unit-test doubles. Production
    // Prisma always exposes updateMany, and the real-PostgreSQL regression
    // exercises only the compare-and-set path below.
    if (!db.nPC.updateMany) {
      await db.nPC.update({
        where: input.npcSeed
          ? { campaignId_seed: { campaignId: input.campaignId, seed: input.npcSeed } }
          : { id: npcId },
        data: { disposition: socialResult.dispositionAfter },
      });
      return buildSocialCheckResult(input, characterId, npcId, npcSeed, socialResult);
    }

    const write = await db.nPC.updateMany({
      where: npc.id ?? input.npcId
        ? { id: npcId, disposition: expectedDisposition }
        : {
            campaignId: input.campaignId,
            seed: npcSeed,
            disposition: expectedDisposition,
          },
      data: { disposition: socialResult.dispositionAfter },
    });

    if (write.count === 1) {
      return buildSocialCheckResult(input, characterId, npcId, npcSeed, socialResult);
    }

    const refreshed = await findNpc(db, input);
    if (!refreshed) {
      throw new SocialServiceError("NPC_NOT_FOUND", "NPC disappeared during social resolution.");
    }
    assertNpcReady(refreshed, input.campaignId);
    npc = refreshed;

    // Reuse the exact original d20 roll and modifiers. Only the attitude-derived
    // DC and the resulting disposition transition are rebased to the state that
    // actually won the previous write.
    socialResult = rebaseSocialCheckResult(socialResult, npc.disposition ?? null);
  }

  throw new SocialServiceError(
    "SOCIAL_STATE_CONFLICT",
    "NPC disposition changed repeatedly while resolving the social action."
  );
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
