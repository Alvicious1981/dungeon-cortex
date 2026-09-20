import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { moveToNode } from "@/lib/rules/navigation";
import {
  lockCampaignForSocialAction,
  assertNpcScenePresenceInTransaction,
  resolveSocialSceneTargetInTransaction,
  SocialScenePresenceError,
} from "@/lib/db/social-scene-target";
import { resolveSocialCheck } from "@/lib/rules/social-service";
import {
  assertSafeE2EDatabase,
  cleanupE2ERecords,
  type E2ECreatedRecords,
} from "./support/database";

async function createdId(response: {
  status(): number;
  json(): Promise<unknown>;
}): Promise<string> {
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { id?: unknown };
  expect(typeof body.id).toBe("string");
  return body.id as string;
}

test("@smoke social scene presence serializes with movement via Campaign row lock", async ({
  request,
}) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();

  let locationId: string | undefined;
  let originNodeId: string | undefined;
  let targetNodeId: string | undefined;
  let npcAId: string | undefined;
  let npcBId: string | undefined;

  try {
    created.characterId = await createdId(
      await request.post("/api/character", {
        data: {
          name: `Social Scene Race ${randomUUID().slice(0, 8)}`,
          race: "human",
          class: "bard",
          stats: { STR: 10, DEX: 14, CON: 12, INT: 10, WIS: 12, CHA: 16 },
        },
      })
    );

    created.campaignId = await createdId(
      await request.post("/api/campaign", {
        data: {
          characterId: created.characterId,
          title: `Social Scene Race ${randomUUID().slice(0, 8)}`,
        },
      })
    );

    // Set scenePresenceVersion to 1 (canonical mode)
    await prisma.campaign.update({
      where: { id: created.campaignId },
      data: { scenePresenceVersion: 1 },
    });

    const location = await prisma.location.create({
      data: {
        campaignId: created.campaignId,
        seed: `social-scene-loc-${randomUUID()}`,
        type: "dungeon",
        name: "Presence Corridor",
        description: "Two connected nodes with different NPCs.",
      },
    });
    locationId = location.id;

    const npcASeed = `npc-a-${randomUUID().slice(0, 8)}`;
    const npcBSeed = `npc-b-${randomUUID().slice(0, 8)}`;

    const [originNode, destNode] = await Promise.all([
      prisma.locationNode.create({
        data: {
          locationId,
          index: 0,
          name: "Inn Common Room",
          description: "A bustling common room.",
          feature: "npc",
          npcSeed: npcASeed,
          featureData: { generated: true },
          x: 0,
          y: 0,
        },
      }),
      prisma.locationNode.create({
        data: {
          locationId,
          index: 1,
          name: "Cellar",
          description: "A dark cellar.",
          feature: "npc",
          npcSeed: npcBSeed,
          featureData: { generated: true },
          x: 1,
          y: 0,
        },
      }),
    ]);

    originNodeId = originNode.id;
    targetNodeId = destNode.id;

    await prisma.locationEdge.create({
      data: {
        locationId,
        fromNodeId: originNodeId,
        toNodeId: targetNodeId,
        passageType: "open",
      },
    });

    // Create the two NPCs
    const [npcA, npcB] = await Promise.all([
      prisma.nPC.create({
        data: {
          campaignId: created.campaignId,
          seed: npcASeed,
          name: "Barnaby the Innkeeper",
          role: "commoner",
          maxHp: 10,
          hp: 10,
          ac: 10,
          disposition: 0,
          hasMetPlayer: true,
        },
      }),
      prisma.nPC.create({
        data: {
          campaignId: created.campaignId,
          seed: npcBSeed,
          name: "Cellar Rat Catcher",
          role: "commoner",
          maxHp: 10,
          hp: 10,
          ac: 10,
          disposition: 0,
          hasMetPlayer: true,
        },
      }),
    ]);

    npcAId = npcA.id;
    npcBId = npcB.id;

    // Party is at origin, participant is NPC A
    await prisma.campaign.update({
      where: { id: created.campaignId },
      data: {
        currentLocationId: locationId,
        currentNodeId: originNodeId,
      },
    });

    await prisma.campaignSceneParticipant.create({
      data: {
        campaignId: created.campaignId,
        npcId: npcAId,
      },
    });

    // CONCURRENCY TEST:
    // Move commits first: moveToNode moves party to destNode, removing NPC A and adding NPC B.
    // Social interaction attempting to talk to NPC A locks the campaign row, observes the updated scene,
    // and throws NPC_NOT_PRESENT rather than mutating the absent NPC.

    let moveAcquiredLock!: () => void;
    const moveLockAcquired = new Promise<void>((resolve) => {
      moveAcquiredLock = resolve;
    });

    let continueSocial!: () => void;
    const socialCanProceed = new Promise<void>((resolve) => {
      continueSocial = resolve;
    });

    const movePromise = prisma.$transaction(async (tx) => {
      const result = await moveToNode(tx, created.campaignId!, targetNodeId!);
      expect(result.success).toBe(true);
      moveAcquiredLock();
      // Hold the movement transaction open briefly until social check is waiting on the lock
      await new Promise((r) => setTimeout(r, 100));
      return result;
    });

    await moveLockAcquired;

    // Concurrently attempt social interaction with NPC A (now absent after move commits)
    const socialPromise = prisma.$transaction(async (tx) => {
      // This will wait on Campaign row lock until movePromise commits
      await assertNpcScenePresenceInTransaction(tx, created.campaignId!, npcAId!);
      return resolveSocialCheck({
        campaignId: created.campaignId!,
        npcId: npcAId!,
        approach: "persuade",
        intent: "I persuade the innkeeper",
        tx: tx as never,
      });
    });

    const [moveResult, socialResult] = await Promise.allSettled([
      movePromise,
      socialPromise,
    ]);

    expect(moveResult.status).toBe("fulfilled");
    // Social transaction must be rejected with NPC_NOT_PRESENT because move committed first
    expect(socialResult.status).toBe("rejected");
    if (socialResult.status === "rejected") {
      expect(socialResult.reason).toBeInstanceOf(SocialScenePresenceError);
      expect((socialResult.reason as SocialScenePresenceError).code).toBe("NPC_NOT_PRESENT");
    }

    // Assert NPC A disposition was NOT modified
    const npcAAfter = await prisma.nPC.findUniqueOrThrow({
      where: { id: npcAId },
      select: { disposition: true },
    });
    expect(npcAAfter.disposition).toBe(0);

    // Assert party is at destination and only NPC B is a scene participant
    const participantsAfter = await prisma.campaignSceneParticipant.findMany({
      where: { campaignId: created.campaignId },
      select: { npcId: true },
    });
    expect(participantsAfter).toHaveLength(1);
    expect(participantsAfter[0].npcId).toBe(npcBId);
  } finally {
    if (created.campaignId) {
      await prisma.campaign.updateMany({
        where: { id: created.campaignId },
        data: {
          currentNodeId: null,
          currentLocationId: null,
        },
      });
      await prisma.campaignSceneParticipant.deleteMany({
        where: { campaignId: created.campaignId },
      });
      await prisma.gameLog.deleteMany({
        where: { campaignId: created.campaignId },
      });
      await prisma.nPC.deleteMany({
        where: { campaignId: created.campaignId },
      });
      if (locationId) {
        await prisma.locationEdge.deleteMany({ where: { locationId } });
        await prisma.locationNode.deleteMany({ where: { locationId } });
        await prisma.location.deleteMany({ where: { id: locationId } });
      }
    }
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});
