import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { resolveTravelGate } from "../../lib/actions/travel-command";
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

test("@smoke concurrent travel transitions claim the validated origin at most once", async ({
  request,
}) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();

  let bothPlayerLogsWritten!: () => void;
  const bothAtCommitBoundary = new Promise<void>((resolve) => {
    bothPlayerLogsWritten = resolve;
  });
  let playerLogCount = 0;

  try {
    created.characterId = await createdId(
      await request.post("/api/character", {
        data: {
          name: `Travel race ${randomUUID().slice(0, 8)}`,
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
          title: `Travel race ${randomUUID().slice(0, 8)}`,
        },
      })
    );

    const [origin, destinationB, destinationC] = await Promise.all([
      prisma.location.create({
        data: {
          campaignId: created.campaignId,
          seed: `travel-origin-${randomUUID()}`,
          type: "wilderness",
          name: "Origin",
          description: "Concurrency audit origin.",
        },
      }),
      prisma.location.create({
        data: {
          campaignId: created.campaignId,
          seed: `travel-b-${randomUUID()}`,
          type: "wilderness",
          name: "Destination B",
          description: "Concurrency audit destination B.",
        },
      }),
      prisma.location.create({
        data: {
          campaignId: created.campaignId,
          seed: `travel-c-${randomUUID()}`,
          type: "wilderness",
          name: "Destination C",
          description: "Concurrency audit destination C.",
        },
      }),
    ]);

    const [originNode, destinationBNode, destinationCNode] = await Promise.all([
      prisma.locationNode.create({
        data: {
          locationId: origin.id,
          index: 0,
          name: "Origin Entry",
          description: "Origin entry node.",
          x: 0,
          y: 0,
        },
      }),
      prisma.locationNode.create({
        data: {
          locationId: destinationB.id,
          index: 0,
          name: "B Entry",
          description: "Destination B entry node.",
          x: 0,
          y: 0,
        },
      }),
      prisma.locationNode.create({
        data: {
          locationId: destinationC.id,
          index: 0,
          name: "C Entry",
          description: "Destination C entry node.",
          x: 0,
          y: 0,
        },
      }),
    ]);

    await prisma.campaign.update({
      where: { id: created.campaignId },
      data: {
        currentLocationId: origin.id,
        currentNodeId: originNode.id,
      },
    });

    const character = await prisma.character.findUniqueOrThrow({
      where: { id: created.characterId },
      select: {
        id: true,
        stats: true,
        exhaustionLevel: true,
      },
    });

    const persistPlayerAction = (content: string) =>
      async (tx: Prisma.TransactionClient): Promise<void> => {
      await tx.gameLog.create({
        data: {
          campaignId: created.campaignId!,
          role: "user",
          content,
        },
      });

      playerLogCount += 1;
      if (playerLogCount === 2) {
        bothPlayerLogsWritten();
      }

      // Production resolveTravelGate has completed every travel validation before
      // it awaits this callback. Holding both callers here therefore makes both
      // operations carry the same validated origin snapshot into the competing
      // Campaign writes, without mocking Prisma or changing production code.
      await bothAtCommitBoundary;
    };

    const attempts = await Promise.all([
      resolveTravelGate({
        campaignId: created.campaignId,
        destination: destinationB.name,
        forceMarch: false,
        hasActiveEncounter: false,
        originLocationId: origin.id,
        character,
        persistPlayerAction: persistPlayerAction("Travel attempt: Destination B"),
      }),
      resolveTravelGate({
        campaignId: created.campaignId,
        destination: destinationC.name,
        forceMarch: false,
        hasActiveEncounter: false,
        originLocationId: origin.id,
        character,
        persistPlayerAction: persistPlayerAction("Travel attempt: Destination C"),
      }),
    ]);

    const successfulTransitions = attempts.filter((result) => result === null).length;

    const [campaignAfter, characterAfter, travelLogs] = await Promise.all([
      prisma.campaign.findUniqueOrThrow({
        where: { id: created.campaignId },
        select: {
          currentLocationId: true,
          currentNodeId: true,
        },
      }),
      prisma.character.findUniqueOrThrow({
        where: { id: created.characterId },
        select: { exhaustionLevel: true },
      }),
      prisma.gameLog.findMany({
        where: { campaignId: created.campaignId },
        orderBy: { createdAt: "asc" },
        select: { role: true, content: true },
      }),
    ]);

    const playerTravelLogs = travelLogs.filter(
      (log) => log.role === "user" && log.content.startsWith("Travel attempt:")
    );
    const systemTravelLogs = travelLogs.filter(
      (log) => log.role === "system" && log.content.startsWith("Travel:")
    );

    expect([
      destinationB.id,
      destinationC.id,
    ]).toContain(campaignAfter.currentLocationId);
    expect([
      destinationBNode.id,
      destinationCNode.id,
    ]).toContain(campaignAfter.currentNodeId);
    expect(characterAfter.exhaustionLevel).toBe(character.exhaustionLevel);

    // Contract under audit: both callers validated the same origin A, so only
    // one may acquire that state transition. The loser must not persist either
    // its player line or its travel system line.
    expect.soft(successfulTransitions).toBe(1);
    expect.soft(playerTravelLogs).toHaveLength(1);
    expect(systemTravelLogs).toHaveLength(1);
  } finally {
    bothPlayerLogsWritten();

    if (created.campaignId) {
      await prisma.campaign.updateMany({
        where: { id: created.campaignId },
        data: {
          currentNodeId: null,
          currentLocationId: null,
        },
      });
      await prisma.locationEdge.deleteMany({
        where: { location: { campaignId: created.campaignId } },
      });
      await prisma.locationNode.deleteMany({
        where: { location: { campaignId: created.campaignId } },
      });
      await prisma.location.deleteMany({
        where: { campaignId: created.campaignId },
      });
    }

    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});
