/**
 * lib/rules/scene-presence-service.ts
 *
 * DC-NARR-002B PR 2 — Authoritative Scene-Presence Write Path Synchronization
 *
 * Transactional scene-presence synchronization abstraction:
 *   - CASE 1: Target scene has no npcSeed -> clears stale participants, establishes empty scene,
 *     promotes version 0 -> 1 (preserves existing version >= 1).
 *   - CASE 2: Target scene has npcSeed and matching persisted NPC exists -> clears stale participants,
 *     establishes matching persisted NPC as present, promotes version 0 -> 1 (preserves existing version >= 1).
 *   - CASE 3: Target scene has npcSeed but NO matching persisted NPC exists -> clears stale participants,
 *     never fabricates an NPC, keeps version 0 deferred (preserves existing version >= 1).
 *   - Materialization: Idempotently ensures materialized NPC is present if matching current node seed,
 *     promotes version 0 -> 1, preserves version >= 1, and NEVER deletes other canonical participants.
 *
 * "Code is Law": Backend code is authoritative for legality and presence. AI narration is never
 * authoritative for NPC existence or presence.
 */

export interface ScenePresenceDb {
  campaign: {
    findUnique(args: {
      where: { id: string };
      select?: Record<string, boolean>;
    }): Promise<{
      id?: string;
      currentNodeId?: string | null;
      currentLocationId?: string | null;
      scenePresenceVersion?: number;
    } | null | undefined>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<unknown>;
    updateMany?(args: {
      where: { id: string; scenePresenceVersion?: number };
      data: { scenePresenceVersion: number };
    }): Promise<{ count: number }>;
  };
  campaignSceneParticipant?: {
    deleteMany(args: {
      where: { campaignId: string };
    }): Promise<{ count: number }>;
    create(args: {
      data: { campaignId: string; npcId: string };
    }): Promise<unknown>;
    findUnique?(args: {
      where: {
        campaignId_npcId: { campaignId: string; npcId: string };
      };
    }): Promise<unknown>;
    upsert?(args: {
      where: {
        campaignId_npcId: { campaignId: string; npcId: string };
      };
      create: { campaignId: string; npcId: string };
      update: Record<string, unknown>;
    }): Promise<unknown>;
  };
  nPC?: {
    findUnique(args: {
      where: {
        campaignId_seed: { campaignId: string; seed: string };
      };
      select?: Record<string, boolean>;
    }): Promise<{ id: string } | null | undefined>;
  };
  npc?: {
    findUnique(args: {
      where: {
        campaignId_seed: { campaignId: string; seed: string };
      };
      select?: Record<string, boolean>;
    }): Promise<{ id: string } | null | undefined>;
  };
  locationNode?: {
    findUnique?(args: {
      where: { id: string };
      select?: Record<string, boolean>;
    }): Promise<{ npcSeed?: string | null } | null | undefined>;
  };
}

export interface SyncSceneParticipantsTransitionOptions {
  type?: "transition";
  campaignId: string;
  targetNodeNpcSeed?: string | null;
}

export interface SyncSceneParticipantsMaterializeOptions {
  type: "materialize";
  campaignId: string;
  npcId: string;
  npcSeed: string;
}

export type SyncSceneParticipantsOptions =
  | SyncSceneParticipantsTransitionOptions
  | SyncSceneParticipantsMaterializeOptions;

export interface SyncSceneTransitionResult {
  type: "transition";
  case: 1 | 2 | 3;
  modified: boolean;
  version: number;
  participantCount: number;
  npcId?: string;
}

export interface SyncMaterializedNpcResult {
  type: "materialize";
  modified: boolean;
  version: number;
  npcId?: string;
}

export type SyncSceneParticipantsResult =
  | SyncSceneTransitionResult
  | SyncMaterializedNpcResult;

/**
 * Atomically and monotonically promotes scenePresenceVersion from 0 to 1.
 * Guarded against concurrent updates so it never downgrades a version >= 1.
 */
async function promoteVersionMonotonically(
  tx: ScenePresenceDb,
  campaignId: string
): Promise<number> {
  if (tx.campaign.updateMany) {
    const res = await tx.campaign.updateMany({
      where: { id: campaignId, scenePresenceVersion: 0 },
      data: { scenePresenceVersion: 1 },
    });
    if (res.count === 0) {
      const camp = await tx.campaign.findUnique({
        where: { id: campaignId },
        select: { scenePresenceVersion: true },
      });
      return camp?.scenePresenceVersion ?? 1;
    }
  } else {
    await tx.campaign.update({
      where: { id: campaignId },
      data: { scenePresenceVersion: 1 },
    });
  }
  return 1;
}

/**
 * Synchronizes canonical scene participants during an authoritative scene transition.
 * Implements frozen CASE 1, CASE 2, and CASE 3 rules.
 */
async function handleSceneTransition(
  tx: ScenePresenceDb,
  options: SyncSceneParticipantsTransitionOptions
): Promise<SyncSceneTransitionResult> {
  const { campaignId, targetNodeNpcSeed } = options;

  if (!tx.campaignSceneParticipant || !tx.campaign) {
    return {
      type: "transition",
      case: 1,
      modified: false,
      version: 0,
      participantCount: 0,
    };
  }

  // 1. Read current campaign version
  const campaign = await tx.campaign.findUnique({
    where: { id: campaignId },
    select: { scenePresenceVersion: true },
  });

  const currentVersion = campaign?.scenePresenceVersion ?? 0;
  const seed = targetNodeNpcSeed?.trim() ? targetNodeNpcSeed.trim() : null;

  // 2. Clear stale participants from previous scene
  await tx.campaignSceneParticipant.deleteMany({
    where: { campaignId },
  });

  if (!seed) {
    // CASE 1: Target scene has no npcSeed
    let newVersion = currentVersion;
    if (currentVersion === 0) {
      newVersion = await promoteVersionMonotonically(tx, campaignId);
    }

    return {
      type: "transition",
      case: 1,
      modified: true,
      version: newVersion,
      participantCount: 0,
    };
  }

  // Target scene has npcSeed: resolve matching persisted NPC only by (campaignId, seed)
  const nPCDb = tx.nPC ?? tx.npc;
  const matchingNpc = nPCDb
    ? await nPCDb.findUnique({
        where: { campaignId_seed: { campaignId, seed } },
        select: { id: true },
      })
    : null;

  if (matchingNpc) {
    // CASE 2: Matching persisted NPC exists
    await tx.campaignSceneParticipant.create({
      data: {
        campaignId,
        npcId: matchingNpc.id,
      },
    });

    let newVersion = currentVersion;
    if (currentVersion === 0) {
      newVersion = await promoteVersionMonotonically(tx, campaignId);
    }

    return {
      type: "transition",
      case: 2,
      modified: true,
      version: newVersion,
      participantCount: 1,
      npcId: matchingNpc.id,
    };
  }

  // CASE 3: Target scene has npcSeed but NO matching persisted NPC exists
  // NEVER fabricate an NPC. Stale participants cleared above.
  // If version is 0 -> KEEP scenePresenceVersion = 0 (deferred initialization).
  // If version >= 1 -> preserve canonical version.
  return {
    type: "transition",
    case: 3,
    modified: true,
    version: currentVersion,
    participantCount: 0,
  };
}

/**
 * Synchronizes canonical scene presence after authoritative NPC materialization.
 * Does NOT erase other canonical participants already present in the scene.
 */
export async function syncMaterializedNpcPresence(
  tx: ScenePresenceDb,
  options: { campaignId: string; npcId: string; npcSeed: string }
): Promise<SyncMaterializedNpcResult> {
  const { campaignId, npcId, npcSeed } = options;

  const locationNode = tx.locationNode;
  if (!tx.campaignSceneParticipant || !locationNode?.findUnique || !tx.campaign) {
    return {
      type: "materialize",
      modified: false,
      version: 0,
    };
  }

  // Read the campaign's CURRENT node and version inside the same transaction
  const campaign = await tx.campaign.findUnique({
    where: { id: campaignId },
    select: { currentNodeId: true, scenePresenceVersion: true },
  });

  const currentVersion = campaign?.scenePresenceVersion ?? 0;

  if (!campaign || !campaign.currentNodeId) {
    return {
      type: "materialize",
      modified: false,
      version: currentVersion,
    };
  }

  const currentNode = await locationNode.findUnique({
    where: { id: campaign.currentNodeId },
    select: { npcSeed: true },
  });

  const currentSeed = currentNode?.npcSeed?.trim() ? currentNode.npcSeed.trim() : null;
  const targetSeed = npcSeed?.trim() ? npcSeed.trim() : null;

  // If currentNode.npcSeed != npc.seed -> DO NOT modify scene presence.
  if (!currentSeed || !targetSeed || currentSeed !== targetSeed) {
    return {
      type: "materialize",
      modified: false,
      version: currentVersion,
    };
  }

  // currentNode.npcSeed == npc.seed: ensure this NPC is canonically present idempotently
  // Critical: do NOT erase other canonical participants already present in the scene.
  if (tx.campaignSceneParticipant.upsert) {
    await tx.campaignSceneParticipant.upsert({
      where: {
        campaignId_npcId: { campaignId, npcId },
      },
      create: { campaignId, npcId },
      update: {},
    });
  } else if (tx.campaignSceneParticipant.findUnique) {
    const existing = await tx.campaignSceneParticipant.findUnique({
      where: {
        campaignId_npcId: { campaignId, npcId },
      },
    });
    if (!existing) {
      try {
        await tx.campaignSceneParticipant.create({
          data: { campaignId, npcId },
        });
      } catch {
        // Idempotency: duplicate entry already present is fine
      }
    }
  } else {
    try {
      await tx.campaignSceneParticipant.create({
        data: { campaignId, npcId },
      });
    } catch {
      // Idempotency: duplicate entry already present is fine
    }
  }

  let newVersion = campaign.scenePresenceVersion ?? 0;
  if (newVersion === 0) {
    newVersion = await promoteVersionMonotonically(tx, campaignId);
  }

  return {
    type: "materialize",
    modified: true,
    version: newVersion,
    npcId,
  };
}

/**
 * Shared transactional scene-presence synchronization entry point.
 */
export async function syncSceneParticipants(
  tx: ScenePresenceDb,
  options: SyncSceneParticipantsOptions
): Promise<SyncSceneParticipantsResult> {
  if (options.type === "materialize") {
    return syncMaterializedNpcPresence(tx, {
      campaignId: options.campaignId,
      npcId: options.npcId,
      npcSeed: options.npcSeed,
    });
  }

  return handleSceneTransition(tx, options);
}
