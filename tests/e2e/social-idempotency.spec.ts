import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { assertSafeE2EDatabase, cleanupE2ERecords, type E2ECreatedRecords } from "./support/database";

function socialHash(npcId: string, approach: string, intent: string) {
  return createHash("sha256")
    .update(JSON.stringify({ npcId, approach, intent }))
    .digest("hex");
}

async function createdId(response: { status(): number; json(): Promise<unknown> }) {
  expect(response.status()).toBe(201);
  const body = await response.json() as { id?: unknown };
  expect(typeof body.id).toBe("string");
  return body.id as string;
}

test("@smoke social submissions are idempotent in PostgreSQL", async ({ request }) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();
  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();
  try {
    created.characterId = await createdId(await request.post("/api/character", { data: {
      name: `Social idempotency ${randomUUID().slice(0, 8)}`,
      race: "human", class: "bard",
      stats: { STR: 8, DEX: 14, CON: 12, INT: 10, WIS: 10, CHA: 16 },
    } }));
    created.campaignId = await createdId(await request.post("/api/campaign", { data: {
      characterId: created.characterId, title: `Social idempotency ${randomUUID().slice(0, 8)}`,
    } }));
    const npcResponse = await request.post(`/api/campaign/${created.campaignId}/npc`, { data: {
      seed: `social-idempotency-${randomUUID()}`, role: "commoner",
    } });
    expect(npcResponse.status()).toBe(200);
    const npcId = (await npcResponse.json() as { id: string }).id;
    const body = { npcId, approach: "persuade", intent: "ask for a room" };

    const completedId = `social-${randomUUID()}`;
    const first = await request.post(`/api/campaign/${created.campaignId}/social`, { data: { ...body, requestId: completedId } });
    expect(first.status()).toBe(200);
    const firstJson = await first.json();
    const afterFirst = await prisma.nPC.findUniqueOrThrow({ where: { id: npcId }, select: { disposition: true } });
    const replay = await request.post(`/api/campaign/${created.campaignId}/social`, { data: { ...body, requestId: completedId } });
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toEqual(firstJson);
    expect((await prisma.nPC.findUniqueOrThrow({ where: { id: npcId }, select: { disposition: true } })).disposition).toBe(afterFirst.disposition);

    const reused = await request.post(`/api/campaign/${created.campaignId}/social`, { data: { ...body, intent: "a different request", requestId: completedId } });
    expect(reused.status()).toBe(409);
    expect(await reused.json()).toMatchObject({ code: "REQUEST_ID_REUSED" });

    const second = await request.post(`/api/campaign/${created.campaignId}/social`, { data: { ...body, requestId: `social-${randomUUID()}` } });
    expect(second.status()).toBe(200);
    expect((await prisma.actionRequestReceipt.count({ where: { campaignId: created.campaignId } }))).toBe(2);

    const processingId = `social-${randomUUID()}`;
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: created.campaignId }, select: { userId: true } });
    await prisma.actionRequestReceipt.create({ data: {
      actorUserId: campaign.userId, campaignId: created.campaignId, requestId: processingId,
      requestHash: socialHash(npcId, body.approach, body.intent), status: "PROCESSING",
    } });
    const processing = await request.post(`/api/campaign/${created.campaignId}/social`, { data: { ...body, requestId: processingId } });
    expect(processing.status()).toBe(409);
    expect(await processing.json()).toMatchObject({ code: "SOCIAL_ACTION_IN_FLIGHT" });
  } finally {
    if (created.campaignId) await prisma.nPC.deleteMany({ where: { campaignId: created.campaignId } });
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});
