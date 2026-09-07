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

async function waitForBlockedConsumableDeletes(prisma: PrismaClient): Promise<void> {
  // Prisma interactive transactions default to 5 seconds. A healthy request
  // reaches this barrier in milliseconds, so keep the deterministic wait well
  // below that ceiling and release the external row lock immediately afterward.
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
        AND query ILIKE 'DELETE%'
        AND query ILIKE '%InventoryItem%'
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
    `Timed out waiting for two blocked consumable deletes. Active DB work: ${JSON.stringify(activity)}`
  );
}

test("@smoke one consumable unit cannot authorize two concurrent uses", async ({ request }) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();

  let releaseLock!: () => void;
  const mayReleaseLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  let lockHeld!: () => void;
  const inventoryLockHeld = new Promise<void>((resolve) => {
    lockHeld = resolve;
  });

  let lockTransaction: Promise<unknown> | undefined;
  let potionId: string | undefined;

  try {
    created.characterId = await createdId(
      await request.post("/api/character", {
        data: {
          name: `Consumable race ${randomUUID().slice(0, 8)}`,
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
          title: `Consumable race ${randomUUID().slice(0, 8)}`,
        },
      })
    );

    // Keep healing far from max HP so the event remains observable. The test's
    // invariant is consumption count, not the separate Character.hp race.
    await prisma.character.update({
      where: { id: created.characterId },
      data: { hp: 1, maxHp: 100 },
    });

    const potion = await prisma.inventoryItem.create({
      data: {
        characterId: created.characterId,
        name: `Race Potion ${randomUUID().slice(0, 8)}`,
        type: "consumable",
        quantity: 1,
        properties: {
          healingDice: "1d2",
          healingBonus: 0,
          effects: [],
        },
      },
    });
    potionId = potion.id;

    const before = await prisma.inventoryItem.findUniqueOrThrow({
      where: { id: potion.id },
      select: { quantity: true },
    });
    expect(before.quantity).toBe(1);

    // Lock the sole InventoryItem row externally. Ordinary SELECTs in the two
    // application transactions remain MVCC-readable, so both requests can read
    // quantity=1. Their later deleteMany calls then block behind this lock.
    // Observing two blocked DELETE statements proves both transactions already
    // authorized consumption from the same single-unit snapshot.
    lockTransaction = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "InventoryItem"
          WHERE "id" = ${potion.id}
          FOR UPDATE
        `;
        lockHeld();
        await mayReleaseLock;
      },
      { timeout: 15_000 }
    );

    await inventoryLockHeld;

    const firstUse = request.post(`/api/campaign/${created.campaignId}/action`, {
      data: {
        requestId: `consumable-race-a-${randomUUID()}`,
        action: `drink ${potion.name}`,
      },
    });
    const secondUse = request.post(`/api/campaign/${created.campaignId}/action`, {
      data: {
        requestId: `consumable-race-b-${randomUUID()}`,
        action: `drink ${potion.name}`,
      },
    });

    await waitForBlockedConsumableDeletes(prisma);
    releaseLock();
    await lockTransaction;

    const [firstResponse, secondResponse] = await Promise.all([firstUse, secondUse]);

    expect(firstResponse.status()).not.toBe(500);
    expect(secondResponse.status()).not.toBe(500);
    expect([firstResponse.status(), secondResponse.status()]).toContain(200);

    const firstFrames = parseSseFrames(await firstResponse.text());
    const secondFrames = parseSseFrames(await secondResponse.text());
    const healingEvents = [...firstFrames, ...secondFrames].filter(
      (frame) => frame.t === "evt" && frame.e?.type === "HEALING_RECEIVED"
    );

    // Domain invariant: one persisted unit can authorize at most one mechanical
    // use. A losing concurrent request may be refused or resolve as a no-op,
    // but it must not emit a second healing fact from the same single unit.
    expect(healingEvents).toHaveLength(1);

    const after = await prisma.inventoryItem.findUnique({
      where: { id: potion.id },
      select: { quantity: true },
    });
    expect(after).toBeNull();
  } finally {
    releaseLock();
    await lockTransaction?.catch(() => undefined);
    if (potionId) {
      await prisma.inventoryItem.deleteMany({ where: { id: potionId } });
    }
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});
