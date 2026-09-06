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
  d?: string;
  e?: {
    type?: string;
    payload?: {
      type?: string;
      hpRecovered?: number;
      hitDiceSpent?: number;
    };
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

/**
 * Regression for PR #140.
 *
 * Contract tests could not catch the historical failure because rest-service
 * talks to Prisma through a hand-written facade and those tests inject fake
 * database objects. This journey crosses the real action route, real
 * rest-service, generated Prisma Client, and disposable PostgreSQL used by CI.
 */
test("@smoke short rest resolves through the action route and real Prisma", async ({
  request,
}) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();
  const requestId = `rest-e2e-${randomUUID()}`;

  try {
    created.characterId = await createdId(
      await request.post("/api/character", {
        data: {
          name: `Rest E2E ${randomUUID().slice(0, 8)}`,
          race: "human",
          class: "fighter",
          stats: { STR: 14, DEX: 12, CON: 14, INT: 10, WIS: 10, CHA: 10 },
        },
      })
    );

    created.campaignId = await createdId(
      await request.post("/api/campaign", {
        data: {
          characterId: created.characterId,
          title: `Rest regression ${requestId.slice(-8)}`,
        },
      })
    );

    // Fixture only: place the API-created fighter in a deterministic state.
    // The real rest path still owns the subsequent read, roll, and write.
    await prisma.character.update({
      where: { id: created.characterId },
      data: {
        hp: 1,
        maxHp: 20,
        hitDiceTotal: 1,
        hitDiceRemaining: 1,
        stats: { STR: 14, DEX: 12, CON: 14, INT: 10, WIS: 10, CHA: 10 },
      },
    });

    const before = await prisma.character.findUniqueOrThrow({
      where: { id: created.characterId },
      select: {
        hp: true,
        maxHp: true,
        hitDiceTotal: true,
        hitDiceRemaining: true,
      },
    });
    expect(before).toEqual({
      hp: 1,
      maxHp: 20,
      hitDiceTotal: 1,
      hitDiceRemaining: 1,
    });

    const response = await request.post(
      `/api/campaign/${created.campaignId}/action`,
      {
        data: { requestId, action: "short rest" },
      }
    );

    expect(response.status()).not.toBe(500);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/event-stream");

    const frames = parseSseFrames(await response.text());
    expect(frames.length).toBeGreaterThanOrEqual(3);
    expect(frames[0]?.t).toBe("evt");
    expect(frames[0]?.e?.type).toBe("REST_COMPLETED");
    expect(frames[0]?.e?.payload?.type).toBe("SHORT_REST");
    expect(frames[0]?.e?.payload?.hitDiceSpent).toBe(1);
    expect(frames.some((frame) => frame.t === "txt")).toBe(true);
    expect(frames.at(-1)?.t).toBe("done");

    const after = await prisma.character.findUniqueOrThrow({
      where: { id: created.characterId },
      select: { hp: true, maxHp: true, hitDiceRemaining: true },
    });

    // Fighter d10 + CON 14 (+2): from 1 HP the real roll must land at 4..13.
    // The exact roll is intentionally not fixed; the persisted resource spend
    // and the event/database agreement are deterministic.
    expect(after.maxHp).toBe(20);
    expect(after.hitDiceRemaining).toBe(0);
    expect(after.hp).toBeGreaterThanOrEqual(4);
    expect(after.hp).toBeLessThanOrEqual(13);
    expect(frames[0]?.e?.payload?.hpRecovered).toBe(after.hp - before.hp);
  } finally {
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});
