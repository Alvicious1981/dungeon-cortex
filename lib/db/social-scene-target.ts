/**
 * lib/db/social-scene-target.ts
 *
 * Typed persistence layer for scene-presence target resolution and Campaign locking.
 *
 * Concurrency & Serialization:
 * - Locks the Campaign row with SELECT "id" FROM "Campaign" WHERE "id" = $id FOR UPDATE.
 * - Movement (`moveToNode`) executes `tx.campaign.updateMany(...)` on the same Campaign row.
 * - This serializes social target checks against scene transitions in PostgreSQL.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  type SocialTargetCandidate,
  type SocialTargetResolution,
  resolveSocialTargetCandidate,
} from "@/lib/rules/social-target";

export class SocialSceneTargetError extends Error {
  constructor(public readonly resolution: Extract<SocialTargetResolution, { ok: false }>) {
    super(resolution.error);
    this.name = "SocialSceneTargetError";
  }
}

export class SocialScenePresenceError extends Error {
  constructor(
    public readonly code: "NPC_NOT_PRESENT",
    message: string
  ) {
    super(message);
    this.name = "SocialScenePresenceError";
  }
}

interface TxDelegates {
  campaign?: Prisma.TransactionClient["campaign"];
  campaignSceneParticipant?: Prisma.TransactionClient["campaignSceneParticipant"];
  nPC?: Prisma.TransactionClient["nPC"];
}

/**
 * Acquires an exclusive row lock on the Campaign record for the duration of the transaction.
 * Serializes against moveToNode's campaign update.
 */
export async function lockCampaignForSocialAction(
  tx: Prisma.TransactionClient,
  campaignId: string
): Promise<void> {
  if (typeof tx.$queryRaw !== "function") return;

  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Campaign"
    WHERE "id" = ${campaignId}
    FOR UPDATE
  `;
}

/**
 * Loads scene target candidates under the active Campaign lock.
 */
export async function loadSceneTargetCandidates(
  tx: Prisma.TransactionClient,
  campaignId: string,
  currentNodeNpcSeed?: string | null
): Promise<{
  scenePresenceVersion: number;
  candidates: SocialTargetCandidate[];
}> {
  const txDelegates = tx as unknown as TxDelegates;
  const campaignClient = txDelegates.campaign ?? prisma.campaign;
  const participantClient =
    txDelegates.campaignSceneParticipant ?? prisma.campaignSceneParticipant;
  const npcClient = txDelegates.nPC ?? prisma.nPC;

  const campaign = await campaignClient?.findUnique({
    where: { id: campaignId },
    select: {
      scenePresenceVersion: true,
      currentNodeId: true,
    },
  });

  const scenePresenceVersion = campaign?.scenePresenceVersion ?? 0;
  let candidates: SocialTargetCandidate[] = [];

  if (scenePresenceVersion >= 1) {
    if (participantClient?.findMany) {
      const participants = await participantClient.findMany({
        where: { campaignId },
        orderBy: { npcId: "asc" },
        include: {
          npc: {
            select: {
              id: true,
              name: true,
              seed: true,
              campaignId: true,
            },
          },
        },
      });

      candidates = participants
        .map(
          (p: {
            npc?: SocialTargetCandidate | null;
            nPC?: SocialTargetCandidate | null;
          }) => p.npc ?? p.nPC
        )
        .filter(
          (
            npc: SocialTargetCandidate | null | undefined
          ): npc is SocialTargetCandidate =>
            Boolean(npc && npc.campaignId === campaignId && npc.id)
        );
    }
  } else {
    // Legacy mode (scenePresenceVersion === 0)
    const seed = currentNodeNpcSeed ?? null;
    if (seed && npcClient?.findUnique) {
      const legacyNpc = await npcClient.findUnique({
        where: {
          campaignId_seed: {
            campaignId,
            seed,
          },
        },
        select: {
          id: true,
          name: true,
          seed: true,
          campaignId: true,
        },
      });

      if (legacyNpc && legacyNpc.campaignId === campaignId) {
        candidates = [legacyNpc];
      }
    }
  }

  return { scenePresenceVersion, candidates };
}

/**
 * Resolves the social target candidate within an active transaction holding the Campaign row lock.
 */
export async function resolveSocialSceneTargetInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    campaignId: string;
    targetName?: string;
    currentNodeNpcSeed?: string | null;
  }
): Promise<SocialTargetResolution> {
  await lockCampaignForSocialAction(tx, input.campaignId);

  const { candidates } = await loadSceneTargetCandidates(
    tx,
    input.campaignId,
    input.currentNodeNpcSeed
  );

  return resolveSocialTargetCandidate(candidates, input.targetName);
}

/**
 * Asserts that an NPC is present in the current scene under the Campaign lock (used by /social).
 */
export async function assertNpcScenePresenceInTransaction(
  tx: Prisma.TransactionClient,
  campaignId: string,
  npcId: string
): Promise<void> {
  await lockCampaignForSocialAction(tx, campaignId);

  const txDelegates = tx as unknown as TxDelegates;
  const campaignClient = txDelegates.campaign ?? prisma.campaign;
  const participantClient =
    txDelegates.campaignSceneParticipant ?? prisma.campaignSceneParticipant;

  const campaign = await campaignClient?.findUnique({
    where: { id: campaignId },
    select: { scenePresenceVersion: true },
  });

  const scenePresenceVersion = campaign?.scenePresenceVersion ?? 0;
  if (scenePresenceVersion >= 1 && participantClient?.findUnique) {
    const participant = await participantClient.findUnique({
      where: {
        campaignId_npcId: {
          campaignId,
          npcId,
        },
      },
      select: { npcId: true },
    });

    if (!participant) {
      throw new SocialScenePresenceError(
        "NPC_NOT_PRESENT",
        "NPC is not present in the current scene."
      );
    }
  }
}
