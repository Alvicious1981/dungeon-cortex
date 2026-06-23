import { prisma } from "@/lib/db/prisma";

export type NpcServiceErrorCode =
  | "CAMPAIGN_NOT_FOUND"
  | "NPC_NOT_FOUND"
  | "NPC_OWNERSHIP_MISMATCH"
  | "INVALID_NPC_PAYLOAD"
  | "INVALID_DISPOSITION"
  | "INITIAL_DISPOSITION_EXISTS";

export class NpcServiceError extends Error {
  constructor(
    public readonly code: NpcServiceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "NpcServiceError";
  }
}

interface NpcCampaignRecord {
  id: string;
}

interface NpcRecord {
  id: string;
  campaignId: string;
  seed: string;
  role: string;
  name: string;
  maxHp: number;
  hp: number;
  ac: number;
  notes?: string | null;
  race?: string | null;
  profession?: string | null;
  alignment?: string | null;
  abilityScores?: unknown;
  traits?: unknown;
  disposition?: number | null;
  personalityTags?: unknown;
  hasMetPlayer?: boolean;
}

export interface NpcDescriptor {
  seed?: string;
  role: string;
  name: string;
  maxHp: number;
  hp: number;
  ac: number;
  notes?: string | null;
  race?: string | null;
  profession?: string | null;
  alignment?: string | null;
  abilityScores?: unknown;
  traits?: unknown;
}

export interface MerchantDescriptor extends NpcDescriptor {
  archetype?: string;
  inventory?: Array<Record<string, unknown>>;
  buyModifier?: number;
  sellModifier?: number;
}

interface NpcDb {
  campaign: {
    findUnique(args: {
      where: { id: string };
      select?: Record<string, boolean>;
    }): Promise<NpcCampaignRecord | null | undefined>;
  };
  nPC: {
    findUnique(args: {
      where: { id: string } | { campaignId_seed: { campaignId: string; seed: string } };
      select?: Record<string, boolean>;
    }): Promise<NpcRecord | null | undefined>;
    create(args: { data: Record<string, unknown> }): Promise<NpcRecord>;
    update(args: {
      where: { id: string } | { campaignId_seed: { campaignId: string; seed: string } };
      data: Record<string, unknown>;
    }): Promise<NpcRecord>;
    upsert(args: {
      where: { campaignId_seed: { campaignId: string; seed: string } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<NpcRecord>;
  };
}

export interface TrackNpcStateInput {
  campaignId: string;
  npcId?: string;
  npcSeed?: string;
  role?: string;
  descriptor: NpcDescriptor;
  tx?: NpcDb;
  db?: NpcDb;
}

export interface EstablishInitialNpcDispositionInput {
  campaignId: string;
  npcId?: string;
  npcSeed?: string;
  disposition: number;
  traits?: unknown;
  personalityTags?: unknown;
  hasMetPlayer?: boolean;
  descriptor?: NpcDescriptor;
  tx?: NpcDb;
  db?: NpcDb;
}

export interface TrackMerchantStateInput {
  campaignId: string;
  merchantId?: string;
  npcSeed?: string;
  descriptor: MerchantDescriptor;
  merchantPayload?: Record<string, unknown>;
  tx?: NpcDb;
  db?: NpcDb;
}

export interface NpcStateFacts {
  type: "npc_state_tracked";
  campaignId: string;
  npcId: string;
  seed: string;
  role: string;
  name: string;
  created: boolean;
}

export interface MerchantStateFacts {
  type: "merchant_state_tracked";
  campaignId: string;
  merchantId: string;
  seed: string;
  name: string;
  created: boolean;
  archetype?: string;
}

export interface InitialNpcDispositionFacts {
  type: "initial_npc_disposition_established";
  campaignId: string;
  npcId: string;
  seed: string;
  disposition: number;
  hasMetPlayer: boolean;
}

export interface TrackNpcStateResult {
  ok: true;
  campaignId: string;
  npcId: string;
  seed: string;
  name: string;
  npc: NpcRecord;
  facts: NpcStateFacts;
}

export interface TrackMerchantStateResult {
  ok: true;
  campaignId: string;
  merchantId: string;
  seed: string;
  name: string;
  npc: NpcRecord;
  facts: MerchantStateFacts;
}

export interface EstablishInitialNpcDispositionResult {
  ok: true;
  campaignId: string;
  npcId: string;
  seed: string;
  disposition: number;
  hasMetPlayer: boolean;
  npc: NpcRecord;
  facts: InitialNpcDispositionFacts;
}

function resolveDb(
  input:
    | TrackNpcStateInput
    | TrackMerchantStateInput
    | EstablishInitialNpcDispositionInput
): NpcDb {
  return input.tx ?? input.db ?? (prisma as unknown as NpcDb);
}

async function assertCampaignExists(db: NpcDb, campaignId: string): Promise<void> {
  if (campaignId.trim().length === 0) {
    throw new NpcServiceError("CAMPAIGN_NOT_FOUND", "Campaign not found.");
  }

  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true },
  });

  if (campaign === null) {
    throw new NpcServiceError(
      "CAMPAIGN_NOT_FOUND",
      `Campaign not found: ${campaignId}`
    );
  }
}

function assertValidDisposition(disposition: number): void {
  if (!Number.isInteger(disposition) || disposition < -10 || disposition > 10) {
    throw new NpcServiceError(
      "INVALID_DISPOSITION",
      `Invalid NPC disposition: ${disposition}`
    );
  }
}

function cleanOptionalText(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function assertNonEmptyText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NpcServiceError(
      "INVALID_NPC_PAYLOAD",
      `NPC ${field} must be a non-empty string.`
    );
  }

  return value.trim();
}

function validateDescriptor(
  descriptor: NpcDescriptor,
  fallbackSeed?: string,
  fallbackRole?: string
): Required<Pick<NpcDescriptor, "seed" | "role" | "name" | "maxHp" | "hp" | "ac">> &
  Omit<NpcDescriptor, "seed" | "role" | "name" | "maxHp" | "hp" | "ac"> {
  const seed = assertNonEmptyText(fallbackSeed ?? descriptor.seed, "seed");
  const role = assertNonEmptyText(fallbackRole ?? descriptor.role, "role");
  const name = assertNonEmptyText(descriptor.name, "name");

  if (!Number.isInteger(descriptor.maxHp) || descriptor.maxHp <= 0) {
    throw new NpcServiceError("INVALID_NPC_PAYLOAD", "NPC maxHp must be positive.");
  }

  if (!Number.isInteger(descriptor.hp) || descriptor.hp < 0) {
    throw new NpcServiceError("INVALID_NPC_PAYLOAD", "NPC hp must be non-negative.");
  }

  if (!Number.isInteger(descriptor.ac) || descriptor.ac <= 0) {
    throw new NpcServiceError("INVALID_NPC_PAYLOAD", "NPC ac must be positive.");
  }

  return {
    ...descriptor,
    seed,
    role,
    name,
    notes: cleanOptionalText(descriptor.notes),
  };
}

async function findNpcById(
  db: NpcDb,
  npcId: string
): Promise<NpcRecord | null | undefined> {
  return db.nPC.findUnique({
    where: { id: npcId },
    select: {
      id: true,
      campaignId: true,
      seed: true,
      role: true,
      name: true,
      maxHp: true,
      hp: true,
      ac: true,
      notes: true,
      disposition: true,
      hasMetPlayer: true,
      traits: true,
      personalityTags: true,
    },
  });
}

async function findNpcBySeed(
  db: NpcDb,
  campaignId: string,
  seed: string
): Promise<NpcRecord | null | undefined> {
  return db.nPC.findUnique({
    where: { campaignId_seed: { campaignId, seed } },
  });
}

function assertNpcOwnership(npc: NpcRecord, campaignId: string): void {
  if (npc.campaignId !== campaignId) {
    throw new NpcServiceError(
      "NPC_OWNERSHIP_MISMATCH",
      `NPC ${npc.id} does not belong to campaign ${campaignId}.`
    );
  }
}

function assertInitialDispositionIsAvailable(npc: NpcRecord): void {
  if (npc.hasMetPlayer) {
    throw new NpcServiceError(
      "INITIAL_DISPOSITION_EXISTS",
      "Initial disposition already established."
    );
  }
}

function baseNpcCreateData(
  campaignId: string,
  descriptor: ReturnType<typeof validateDescriptor>,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  return {
    campaignId,
    seed: descriptor.seed,
    role: descriptor.role,
    name: descriptor.name,
    maxHp: descriptor.maxHp,
    hp: descriptor.hp,
    ac: descriptor.ac,
    notes: descriptor.notes ?? "",
    ...(descriptor.race !== undefined && { race: descriptor.race }),
    ...(descriptor.profession !== undefined && { profession: descriptor.profession }),
    ...(descriptor.alignment !== undefined && { alignment: descriptor.alignment }),
    ...(descriptor.abilityScores !== undefined && { abilityScores: descriptor.abilityScores }),
    ...(descriptor.traits !== undefined && { traits: descriptor.traits }),
    ...extra,
  };
}

function baseNpcUpdateData(
  descriptor: ReturnType<typeof validateDescriptor>
): Record<string, unknown> {
  return {
    ...(descriptor.notes !== undefined && { notes: descriptor.notes }),
    hp: descriptor.hp,
    maxHp: descriptor.maxHp,
    ac: descriptor.ac,
    name: descriptor.name,
    role: descriptor.role,
    ...(descriptor.race !== undefined && { race: descriptor.race }),
    ...(descriptor.profession !== undefined && { profession: descriptor.profession }),
    ...(descriptor.alignment !== undefined && { alignment: descriptor.alignment }),
    ...(descriptor.abilityScores !== undefined && { abilityScores: descriptor.abilityScores }),
    ...(descriptor.traits !== undefined && { traits: descriptor.traits }),
  };
}

export async function trackNpcState(
  input: TrackNpcStateInput
): Promise<TrackNpcStateResult> {
  const db = resolveDb(input);
  await assertCampaignExists(db, input.campaignId);

  const descriptor = validateDescriptor(
    input.descriptor,
    input.npcSeed,
    input.role
  );

  if (input.npcId) {
    const existing = await findNpcById(db, input.npcId);
    if (!existing) {
      throw new NpcServiceError("NPC_NOT_FOUND", `NPC not found: ${input.npcId}`);
    }
    assertNpcOwnership(existing, input.campaignId);

    const npc = await db.nPC.update({
      where: { id: input.npcId },
      data: baseNpcUpdateData(descriptor),
    });

    return buildTrackNpcResult(input.campaignId, npc, false);
  }

  const existing = await findNpcBySeed(db, input.campaignId, descriptor.seed);
  const npc = await db.nPC.upsert({
    where: {
      campaignId_seed: {
        campaignId: input.campaignId,
        seed: descriptor.seed,
      },
    },
    create: baseNpcCreateData(input.campaignId, descriptor),
    update: baseNpcUpdateData(descriptor),
  });

  return buildTrackNpcResult(input.campaignId, npc, !existing);
}

function buildTrackNpcResult(
  campaignId: string,
  npc: NpcRecord,
  created: boolean
): TrackNpcStateResult {
  const facts: NpcStateFacts = {
    type: "npc_state_tracked",
    campaignId,
    npcId: npc.id,
    seed: npc.seed,
    role: npc.role,
    name: npc.name,
    created,
  };

  return {
    ok: true,
    campaignId,
    npcId: npc.id,
    seed: npc.seed,
    name: npc.name,
    npc,
    facts,
  };
}

export async function establishInitialNpcDisposition(
  input: EstablishInitialNpcDispositionInput
): Promise<EstablishInitialNpcDispositionResult> {
  const db = resolveDb(input);
  await assertCampaignExists(db, input.campaignId);
  assertValidDisposition(input.disposition);

  let npc: NpcRecord | null | undefined;

  if (input.npcId) {
    npc = await findNpcById(db, input.npcId);
    if (!npc) {
      throw new NpcServiceError("NPC_NOT_FOUND", `NPC not found: ${input.npcId}`);
    }
    assertNpcOwnership(npc, input.campaignId);
    assertInitialDispositionIsAvailable(npc);

    npc = await db.nPC.update({
      where: { id: input.npcId },
      data: initialDispositionData(input),
    });
  } else if (input.npcSeed) {
    npc = await findNpcBySeed(db, input.campaignId, input.npcSeed);

    if (npc) {
      assertInitialDispositionIsAvailable(npc);
      npc = await db.nPC.update({
        where: { campaignId_seed: { campaignId: input.campaignId, seed: input.npcSeed } },
        data: initialDispositionData(input),
      });
    } else {
      if (!input.descriptor) {
        throw new NpcServiceError(
          "NPC_NOT_FOUND",
          `NPC not found: ${input.npcSeed}`
        );
      }

      const descriptor = validateDescriptor(input.descriptor, input.npcSeed);
      npc = await db.nPC.upsert({
        where: { campaignId_seed: { campaignId: input.campaignId, seed: input.npcSeed } },
        create: baseNpcCreateData(
          input.campaignId,
          descriptor,
          initialDispositionData(input)
        ),
        update: initialDispositionData(input),
      });
    }
  } else {
    throw new NpcServiceError("NPC_NOT_FOUND", "Missing NPC identity.");
  }

  const facts: InitialNpcDispositionFacts = {
    type: "initial_npc_disposition_established",
    campaignId: input.campaignId,
    npcId: npc.id,
    seed: npc.seed,
    disposition: input.disposition,
    hasMetPlayer: input.hasMetPlayer ?? true,
  };

  return {
    ok: true,
    campaignId: input.campaignId,
    npcId: npc.id,
    seed: npc.seed,
    disposition: input.disposition,
    hasMetPlayer: input.hasMetPlayer ?? true,
    npc,
    facts,
  };
}

function initialDispositionData(
  input: EstablishInitialNpcDispositionInput
): Record<string, unknown> {
  return {
    disposition: input.disposition,
    hasMetPlayer: input.hasMetPlayer ?? true,
    ...(input.traits !== undefined && { traits: input.traits }),
    ...(input.personalityTags !== undefined && {
      personalityTags: input.personalityTags,
    }),
  };
}

export async function trackMerchantState(
  input: TrackMerchantStateInput
): Promise<TrackMerchantStateResult> {
  const db = resolveDb(input);
  await assertCampaignExists(db, input.campaignId);

  const descriptor = validateDescriptor(input.descriptor, input.npcSeed);
  const existing = input.merchantId
    ? await findNpcById(db, input.merchantId)
    : await findNpcBySeed(db, input.campaignId, descriptor.seed);

  if (input.merchantId && !existing) {
    throw new NpcServiceError(
      "NPC_NOT_FOUND",
      `Merchant NPC not found: ${input.merchantId}`
    );
  }

  if (existing) {
    assertNpcOwnership(existing, input.campaignId);
  }

  const npc = existing
    ? await db.nPC.update({
        where: { id: existing.id },
        data: baseNpcUpdateData(descriptor),
      })
    : await db.nPC.create({
        data: baseNpcCreateData(input.campaignId, descriptor),
      });

  const facts: MerchantStateFacts = {
    type: "merchant_state_tracked",
    campaignId: input.campaignId,
    merchantId: npc.id,
    seed: npc.seed,
    name: npc.name,
    created: !existing,
    archetype: input.descriptor.archetype,
  };

  return {
    ok: true,
    campaignId: input.campaignId,
    merchantId: npc.id,
    seed: npc.seed,
    name: npc.name,
    npc,
    facts,
  };
}