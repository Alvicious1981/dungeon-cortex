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

function transactionWithOriginBarrier(
  tx: Prisma.TransactionClient,
  campaignId: string,
  originNodeId: string,
  barrier: {
    noteOriginRead(): Promise<void>;
  }
): Prisma.TransactionClient {
  return {
    campaign: {
      findUnique: async (args: Prisma.CampaignFindUniqueArgs) => {
        const row = await tx.campaign.findUnique(args);
        if (
          args.where.id === campaignId &&
          row?.currentNodeId === originNodeId
        ) {
          await barrier.noteOriginRead();
        }
        return row;
      },
      update: tx.campaign.update.bind(tx.campaign),
    },
    location: {
      findUnique: tx.location.findUnique.bind(tx.location),
    },
    locationNode: {
      findUnique: tx.locationNode.findUnique.bind(tx.locationNode),
      update: tx.locationNode.update.bind(tx.locationNode),
    },
  } as unknown as Prisma.TransactionClient;
}

test("@smoke competing node moves cannot both commit from the same stale origin", async ({
  request,
}) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();

  let locationId: string | undefined;
  let originNodeId: string | undefined;
  let leftNodeId: string | undefined;
  let rightNodeId: string | undefined;

  let originReads = 0;
  let releaseOriginReads!: () => void;
  const bothOriginReads = new Promise<void>((resolve) => {
    releaseOriginReads = resolve;
  });

  const barrier = {
    async noteOriginRead(): Promise<void> {
      originReads += 1;
      if (originReads === 2) releaseOriginReads();

      await Promise.race([
        bothOriginReads,
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  "Timed out waiting for both movement transactions to read the same origin."
                )
              ),
            10_000
          )
        ),
      ]);
    },
  };

  try {
    created.characterId = await createdId(
      await request.post("/api/character", {
        data: {
          name: `Node race ${randomUUID().slice(0, 8)}`,
          race: "human",
          class: "fighter",
          stats: { STR: 16, DEX: 14, CON: 14, INT: 10, WIS: 10, CHA: 8 },
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
        seed: `node-race-${randomUUID()}`,
        type: "dungeon",
        name: "Concurrency Test Junction",
        description: "A disposable junction used only by the E2E concurrency audit.",
      },
    });
    locationId = location.id;

    const [origin, left, right] = await Promise.all([
      prisma.locationNode.create({
        data: {
          locationId,
          index: 0,
          name: "Origin",
          description: "The shared origin.",
          feature: "empty",
          featureData: {},
          x: 0,
          y: 0,
        },
      }),
      prisma.locationNode.create({
        data: {
          locationId,
          index: 1,
          name: "Left Branch",
          description: "The left branch.",
          feature: "empty",
          featureData: {},
          x: 1,
          y: 0,
        },
      }),
      prisma.locationNode.create({
        data: {
          locationId,
          index: 2,
          name: "Right Branch",
          description: "The right branch.",
          feature: "empty",
          featureData: {},
          x: 0,
          y: 1,
        },
      }),
    ]);

    originNodeId = origin.id;
    leftNodeId = left.id;
    rightNodeId = right.id;

    await prisma.locationEdge.createMany({
      data: [
        {
          locationId,
          fromNodeId: originNodeId,
          toNodeId: leftNodeId,
          passageType: "open",
        },
        {
          locationId,
          fromNodeId: originNodeId,
          toNodeId: rightNodeId,
          passageType: "open",
        },
      ],
    });

    await prisma.campaign.update({
      where: { id: created.campaignId },
      data: {
        currentLocationId: locationId,
        currentNodeId: originNodeId,
      },
    });

    const runMove = (targetNodeId: string) =>
      prisma.$transaction(async (tx) =>
        moveToNode(
          transactionWithOriginBarrier(
            tx,
            created.campaignId!,
            originNodeId!,
            barrier
          ),
          created.campaignId!,
          targetNodeId
        )
      );

    const [leftResult, rightResult] = await Promise.all([
      runMove(leftNodeId),
      runMove(rightNodeId),
    ]);

    // Test precondition: both production movement calls validated from exactly
    // the same persisted origin before either was allowed to continue.
    expect(originReads).toBe(2);

    const results = [leftResult, rightResult];
    const successfulMoves = results.filter((result) => result.success);

    const after = await prisma.campaign.findUniqueOrThrow({
      where: { id: created.campaignId },
      select: { currentNodeId: true },
    });

    const targetNodes = await prisma.locationNode.findMany({
      where: { id: { in: [leftNodeId, rightNodeId] } },
      select: { id: true, featureData: true },
    });

    const generatedTargets = targetNodes.filter((node) => {
      const data =
        node.featureData &&
        typeof node.featureData === "object" &&
        !Array.isArray(node.featureData)
          ? (node.featureData as Record<string, unknown>)
          : null;
      return data?.generated === true;
    });

    expect([leftNodeId, rightNodeId]).toContain(after.currentNodeId);

    // Invariant under audit:
    // once one A -> B / A -> C transition claims A, the competing stale move
    // must lose. Its transaction must also roll back target generation.
    //
    // Current master is expected to violate both assertions: moveToNode ends in
    // an unconditional Campaign.update({ id }), so PostgreSQL serializes the
    // writes but does not re-check the origin that each request validated.
    expect.soft(successfulMoves).toHaveLength(1);
    expect.soft(generatedTargets).toHaveLength(1);
  } finally {
    releaseOriginReads();

    if (created.campaignId) {
      await prisma.campaign.updateMany({
        where: { id: created.campaignId },
        data: { currentNodeId: null, currentLocationId: null },
      });
    }

    if (locationId) {
      await prisma.location.deleteMany({ where: { id: locationId } });
    }

    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});
