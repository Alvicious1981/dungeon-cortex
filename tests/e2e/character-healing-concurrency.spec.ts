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
    payload?: Record<string, unknown>;
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

async function waitForBlockedCharacterUpdates(prisma: PrismaClient): Promise<void> {
  // Server-side Prisma interactive transactions expire after 5 seconds. Both
  // requests should reach the Character UPDATE in milliseconds, so this barrier
  // must stay comfortably below that limit and release the external lock as soon
  // as both stale writes are proven to be waiting.
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
        AND query ILIKE 'UPDATE%'
        AND query ILIKE '%Character%'
    `;

    if (Number(rows[0]?.count ?? 0) >= 2) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  const activity = await prisma.$queryRaw<
    Array<{
      state: string | null;
      wait_event_type: string | null;
      wait_event: string | null;
      query: string;
    }>
  >`
    SELECT state, wait_event_type, wait_event, query
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND state <> 'idle'
    ORDER BY pid
  `;

  throw new Error(
    `Timed out waiting for two blocked Character updates. Active DB work: ${JSON.stringify(activity)}`
  );
}

test("@smoke concurrent healing preserves both accepted HP recoveries", async ({ request }) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();

  let releaseLock!: () => void;
  const mayReleaseLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  let lockHeld!: () => void;
  const characterLockHeld = new Promise<void>((resolve) => {
    lockHeld = resolve;
  });

  let lockTransaction: Promise<unknown> | undefined;

  try {
    created.characterId = await createdId(
      await request.post("/api/character", {
        data: {
          name: `Healing race ${randomUUID().slice(0, 8)}`,
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
          title: `Healing race ${randomUUID().slice(0, 8)}`,
        },
      })
    );

    // Stay far below max HP so neither heal can be clipped. Any difference
    // between final HP and 1 + both emitted healing amounts is therefore a lost
    // accepted recovery, not a max-HP boundary effect.
    await prisma.character.update({
      where: { id: created.characterId },
      data: { hp: 1, maxHp: 100 },
    });

    const firstPotion = await prisma.inventoryItem.create({
      data: {
        characterId: created.characterId,
        name: `Healing Race Potion A ${randomUUID().slice(0, 8)}`,
        type: "consumable",
        quantity: 1,
        properties: {
          healingDice: "1d2",
          healingBonus: 0,
          effects: [],
        },
      },
    });

    const secondPotion = await prisma.inventoryItem.create({
      data: {
        characterId: created.characterId,
        name: `Healing Race Potion B ${randomUUID().slice(0, 8)}`,
        type: "consumable",
        quantity: 1,
        properties: {
          healingDice: "1d2",
          healingBonus: 0,
          effects: [],
        },
      },
    });

    // Lock only the Character row. The two requests consume different inventory
    // rows, so their newly hardened consumable claims cannot conflict. Plain
    // Character SELECTs remain MVCC-readable while this lock is held, allowing
    // both requests to read hp=1 and independently compute an absolute newHp.
    // Both later Character UPDATEs must block behind this lock.
    lockTransaction = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "Character"
          WHERE "id" = ${created.characterId!}
          FOR UPDATE
        `;
        lockHeld();
        await mayReleaseLock;
      },
      { timeout: 15_000 }
    );

    await characterLockHeld;

    const firstUse = request.post(`/api/campaign/${created.campaignId}/action`, {
      data: {
        requestId: `healing-race-a-${randomUUID()}`,
        action: `drink ${firstPotion.name}`,
      },
    });
    const secondUse = request.post(`/api/campaign/${created.campaignId}/action`, {
      data: {
        requestId: `healing-race-b-${randomUUID()}`,
        action: `drink ${secondPotion.name}`,
      },
    });

    await waitForBlockedCharacterUpdates(prisma);
    releaseLock();
    await lockTransaction;

    const [firstResponse, secondResponse] = await Promise.all([firstUse, secondUse]);

    expect(firstResponse.status()).toBe(200);
    expect(secondResponse.status()).toBe(200);

    const frames = [
      ...parseSseFrames(await firstResponse.text()),
      ...parseSseFrames(await secondResponse.text()),
    ];
    const healingEvents = frames.filter(
      (frame) => frame.t === "evt" && frame.e?.type === "HEALING_RECEIVED"
    );

    // Two distinct persisted units were successfully consumed, so both healing
    // effects are independently authorized. The inventory race fixed in
    // DC-PLAN-008 cannot explain a missing recovery here.
    expect(healingEvents).toHaveLength(2);

    const healingAmounts = healingEvents.map((frame) => {
      const amount = frame.e?.payload?.amount;
      expect(typeof amount).toBe("number");
      expect(amount as number).toBeGreaterThan(0);
      return amount as number;
    });

    const after = await prisma.character.findUniqueOrThrow({
      where: { id: created.characterId },
      select: { hp: true },
    });

    // Domain invariant: when both accepted healing facts committed and no cap
    // applies, persisted HP must contain their sum. The current pipeline reads
    // Character.hp, computes newHp in JS, then writes that whole value. Under
    // this forced interleaving the last stale write can erase the earlier heal.
    expect(after.hp).toBe(1 + healingAmounts.reduce((sum, amount) => sum + amount, 0));

    const remainingItems = await prisma.inventoryItem.findMany({
      where: { id: { in: [firstPotion.id, secondPotion.id] } },
      select: { id: true },
    });
    expect(remainingItems).toHaveLength(0);
  } finally {
    releaseLock();
    await lockTransaction?.catch(() => undefined);
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});
