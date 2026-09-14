import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

import {
  assertSafeE2EDatabase,
  cleanupE2ERecords,
  type E2ECreatedRecords,
} from "./support/database";

interface ActionSseFrame {
  t: string;
  e?: {
    type?: string;
    payload?: { targetNodeId?: string; passageType?: string };
  };
}

function parseSseFrames(body: string): ActionSseFrame[] {
  return body
    .split(/\n\n/)
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice(6)) as ActionSseFrame);
}

async function createdId(response: {
  status(): number;
  json(): Promise<unknown>;
}): Promise<string> {
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { id?: unknown };
  expect(typeof body.id).toBe("string");
  return body.id as string;
}

async function createCharacterAndCampaign(
  request: import("@playwright/test").APIRequestContext,
  created: E2ECreatedRecords,
  label: string
): Promise<void> {
  created.characterId = await createdId(
    await request.post("/api/character", {
      data: {
        name: label,
        race: "human",
        class: "fighter",
        stats: { STR: 14, DEX: 12, CON: 14, INT: 10, WIS: 10, CHA: 10 },
      },
    })
  );

  created.campaignId = await createdId(
    await request.post("/api/campaign", {
      data: { characterId: created.characterId, title: label },
    })
  );
}

interface TwoRooms {
  locationId: string;
  originNodeId: string;
  destinationNodeId: string;
  destinationName: string;
}

/**
 * Two rooms joined by an open passage, with the party in the first. An
 * ungenerated destination makes a committed move also write its content, so a
 * rollback can be checked against that write too.
 */
async function givenTwoRooms(
  prisma: PrismaClient,
  campaignId: string,
  unique: string,
  destinationGenerated: boolean
): Promise<TwoRooms> {
  const location = await prisma.location.create({
    data: {
      campaignId,
      seed: `dc-aud-023-move-${unique}`,
      type: "dungeon",
      name: `Move audit ${unique.slice(0, 8)}`,
      description: "Two rooms used by the move GameLog atomicity regression.",
    },
  });

  const destinationName = `Chamber ${unique.slice(0, 8)}`;
  const origin = await prisma.locationNode.create({
    data: {
      locationId: location.id,
      index: 0,
      name: "Antechamber",
      description: "Where the party starts.",
      feature: "rest",
      featureData: { generated: true },
      x: 0,
      y: 0,
    },
  });
  const destination = await prisma.locationNode.create({
    data: {
      locationId: location.id,
      index: 1,
      name: destinationName,
      description: "Not yet explored.",
      feature: destinationGenerated ? "rest" : "empty",
      featureData: destinationGenerated ? { generated: true } : {},
      x: 1,
      y: 0,
    },
  });

  await prisma.locationEdge.create({
    data: {
      locationId: location.id,
      fromNodeId: origin.id,
      toNodeId: destination.id,
      passageType: "open",
    },
  });

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { currentLocationId: location.id, currentNodeId: origin.id },
  });

  return {
    locationId: location.id,
    originNodeId: origin.id,
    destinationNodeId: destination.id,
    destinationName,
  };
}

async function removeRooms(
  prisma: PrismaClient,
  campaignId: string | undefined,
  locationId: string | undefined
): Promise<void> {
  if (!locationId) return;
  if (campaignId) {
    await prisma.campaign.updateMany({
      where: { id: campaignId },
      data: { currentNodeId: null, currentLocationId: null },
    });
  }
  await prisma.location.deleteMany({ where: { id: locationId } });
}

/**
 * DC-AUD-023 — the exploration move and the player's line commit together.
 *
 * The line used to be written after the move's transaction had committed, so a
 * failed write left the party moved with no record of the action. Both journeys
 * cross the real action route, `moveToNode` and disposable PostgreSQL.
 */
test("@smoke a node move through the action route writes exactly one player line", async ({
  request,
}) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();
  const unique = randomUUID().replaceAll("-", "");
  let locationId: string | undefined;

  try {
    await createCharacterAndCampaign(request, created, `Move log ${unique.slice(0, 8)}`);
    // Already generated, so the move writes no content of its own here.
    const rooms = await givenTwoRooms(prisma, created.campaignId!, unique, true);
    locationId = rooms.locationId;
    const action = `move to ${rooms.destinationName}`;

    const response = await request.post(`/api/campaign/${created.campaignId}/action`, {
      data: { requestId: `move-e2e-${unique}`, action },
    });
    expect(response.status()).toBe(200);

    const moved = parseSseFrames(await response.text()).find(
      (frame) => frame.t === "evt" && frame.e?.type === "PLAYER_MOVE"
    );
    expect(moved?.e?.payload?.targetNodeId).toBe(rooms.destinationNodeId);

    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: created.campaignId },
      select: { currentNodeId: true },
    });
    expect(campaign.currentNodeId).toBe(rooms.destinationNodeId);

    const playerLines = await prisma.gameLog.count({
      where: { campaignId: created.campaignId, role: "user", content: action },
    });
    expect(playerLines).toBe(1);
  } finally {
    await removeRooms(prisma, created.campaignId, locationId);
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});

test("@smoke a failed player line rolls back the node move", async ({ request }) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();
  const unique = randomUUID().replaceAll("-", "");
  const triggerName = `dc_aud_023_move_log_${unique}`;
  const functionName = `dc_aud_023_move_log_fn_${unique}`;
  let functionInstalled = false;
  let triggerInstalled = false;
  let locationId: string | undefined;

  try {
    await createCharacterAndCampaign(request, created, `Move rollback ${unique.slice(0, 8)}`);
    // Ungenerated, so the move also writes the destination's content — which
    // must be rolled back with everything else.
    const rooms = await givenTwoRooms(prisma, created.campaignId!, unique, false);
    locationId = rooms.locationId;
    const action = `move to ${rooms.destinationName}`;

    const destinationBefore = await prisma.locationNode.findUniqueOrThrow({
      where: { id: rooms.destinationNodeId },
      select: { feature: true, description: true, featureData: true },
    });

    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger AS $dc_aud_023$
      BEGIN
        IF NEW."role" = 'user' AND NEW."content" = '${action}' THEN
          RAISE EXCEPTION 'DC-AUD-023 forced GameLog failure';
        END IF;
        RETURN NEW;
      END;
      $dc_aud_023$ LANGUAGE plpgsql;
    `);
    functionInstalled = true;
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE INSERT ON "GameLog"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
    `);
    triggerInstalled = true;

    const response = await request.post(`/api/campaign/${created.campaignId}/action`, {
      data: { requestId: `move-log-failure-${unique}`, action },
    });
    expect(response.status()).toBe(500);

    // The party is still where it started.
    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: created.campaignId },
      select: { currentNodeId: true },
    });
    expect(campaign.currentNodeId).toBe(rooms.originNodeId);

    // The destination's content write rolled back with the move.
    const destinationAfter = await prisma.locationNode.findUniqueOrThrow({
      where: { id: rooms.destinationNodeId },
      select: { feature: true, description: true, featureData: true },
    });
    expect(destinationAfter).toEqual(destinationBefore);

    const playerLines = await prisma.gameLog.count({
      where: { campaignId: created.campaignId, role: "user", content: action },
    });
    expect(playerLines).toBe(0);
  } finally {
    if (triggerInstalled) {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "GameLog";`);
    }
    if (functionInstalled) {
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"();`);
    }
    await removeRooms(prisma, created.campaignId, locationId);
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});
