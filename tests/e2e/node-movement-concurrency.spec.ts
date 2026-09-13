import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { moveToNode } from "@/lib/rules/navigation";
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

test("@smoke concurrent node moves from the same origin allow at most one transition", async ({
  request,
}) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();

  let locationId: string | undefined;
  let originNodeId: string | undefined;
  let firstTargetId: string | undefined;
  let secondTargetId: string | undefined;

  let releaseBothOriginReads!: () => void;
  const bothOriginReads = new Promise<void>((resolve) => {
    releaseBothOriginReads = resolve;
  });
  let staleOriginReads = 0;

  try {
    created.characterId = await createdId(
      await request.post("/api/character", {
        data: {
          name: `Node race ${randomUUID().slice(0, 8)}`,
          race: "human",
          class: "fighter",
          stats: { STR: 16, DEX: 14, CON: 14, INT: 10, WIS: 10, CHA: 10 },
        },
      })
    );

    created.campaignId = await createdId(
      await request.post("/api/campaign", {
        data: {
          characterId: created.characterId,
          title: `Node race ${randomUUID().slice(0, 8)}`,
        },
      })
    );

    const location = await prisma.location.create({
      data: {
        campaignId: created.campaignId,
        seed: `dc-aud-020-${randomUUID()}`,
        type: "dungeon",
        name: "Concurrency Fork",
        description: "A three-room fork used by the real PostgreSQL movement audit.",
      },
    });
    locationId = location.id;

    const [origin, firstTarget, secondTarget] = await Promise.all([
      prisma.locationNode.create({
        data: {
          locationId,
          index: 0,
          name: "Origin",
          description: "The shared origin.",
          feature: "rest",
          featureData: { generated: true },
          x: 0,
          y: 0,
        },
      }),
      prisma.locationNode.create({
        data: {
          locationId,
          index: 1,
          name: "Left Branch",
          description: "The first competing destination.",
          feature: "rest",
          featureData: { generated: true },
          x: 1,
          y: 0,
        },
      }),
      prisma.locationNode.create({
        data: {
          locationId,
          index: 2,
          name: "Right Branch",
          description: "The second competing destination.",
          feature: "rest",
          featureData: { generated: true },
          x: 0,
          y: 1,
        },
      }),
    ]);

    originNodeId = origin.id;
    firstTargetId = firstTarget.id;
    secondTargetId = secondTarget.id;

    await Promise.all([
      prisma.locationEdge.create({
        data: {
          locationId,
          fromNodeId: originNodeId,
          toNodeId: firstTargetId,
          passageType: "open",
        },
      }),
      prisma.locationEdge.create({
        data: {
          locationId,
          fromNodeId: originNodeId,
          toNodeId: secondTargetId,
          passageType: "open",
        },
      }),
    ]);

    await prisma.campaign.update({
      where: { id: created.campaignId },
      data: {
        currentLocationId: locationId,
        currentNodeId: originNodeId,
      },
    });

    const moveFromSharedOrigin = async (targetNodeId: string) =>
      prisma.$transaction(async (tx) => {
        const wrappedTx = {
          campaign: {
            findUnique: async (
              args: Parameters<typeof tx.campaign.findUnique>[0]
            ) => {
              const row = await tx.campaign.findUnique(args);

              if (row?.currentNodeId === originNodeId) {
                staleOriginReads += 1;
                if (staleOriginReads === 2) {
                  releaseBothOriginReads();
                }
                await bothOriginReads;
              }

              return row;
            },
            updateMany: tx.campaign.updateMany.bind(tx.campaign),
          },
          location: tx.location,
          locationNode: tx.locationNode,
        } as unknown as Prisma.TransactionClient;

        return moveToNode(
          wrappedTx,
          created.campaignId!,
          targetNodeId
        );
      });

    const results = await Promise.all([
      moveFromSharedOrigin(firstTargetId),
      moveFromSharedOrigin(secondTargetId),
    ]);

    // Prove the concurrency seam actually forced both production calls to
    // validate against the same committed origin before either could mutate it.
    expect(staleOriginReads).toBe(2);

    const successfulMoves = results.filter((result) => result.success);

    // Invariant under audit: one campaign cannot atomically leave the same
    // origin twice. Exactly one competing A -> B / A -> C transition may win.
    expect(successfulMoves).toHaveLength(1);

    const after = await prisma.campaign.findUniqueOrThrow({
      where: { id: created.campaignId },
      select: { currentNodeId: true },
    });

    expect([firstTargetId, secondTargetId]).toContain(after.currentNodeId);
  } finally {
    releaseBothOriginReads();

    if (locationId) {
      await prisma.campaign.updateMany({
        where: { id: created.campaignId },
        data: {
          currentNodeId: null,
          currentLocationId: null,
        },
      });
      await prisma.location.deleteMany({ where: { id: locationId } });
    }

    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});
