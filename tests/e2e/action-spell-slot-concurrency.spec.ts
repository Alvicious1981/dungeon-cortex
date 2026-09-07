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

test("@smoke concurrent action-route spell casts consume two slots", async ({ request }) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();
  const spellId = `action-slot-race-${randomUUID()}`;
  const spellName = `Action Slot Race ${randomUUID().slice(0, 8)}`;

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
          name: `Action slot race ${randomUUID().slice(0, 8)}`,
          race: "human",
          class: "wizard",
          stats: { STR: 8, DEX: 14, CON: 12, INT: 16, WIS: 10, CHA: 10 },
        },
      })
    );

    created.campaignId = await createdId(
      await request.post("/api/campaign", {
        data: {
          characterId: created.characterId,
          title: `Action slot race ${randomUUID().slice(0, 8)}`,
        },
      })
    );

    await prisma.srdSpell.create({
      data: {
        id: spellId,
        indexSlug: spellId,
        name: spellName,
        level: 1,
        concentration: false,
        hasHealing: false,
        hasAreaOfEffect: false,
        classes: ["wizard"],
        components: [],
        data: {
          index: spellId,
          name: spellName,
          level: 1,
          range: "Self",
          duration: "Instantaneous",
          concentration: false,
        },
      },
    });

    const initialSlots = { "1": { current: 2, max: 2 } };
    await prisma.character.update({
      where: { id: created.characterId },
      data: { spellSlots: initialSlots },
    });

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

    const firstCast = request.post(`/api/campaign/${created.campaignId}/action`, {
      data: {
        requestId: `action-slot-race-a-${randomUUID()}`,
        action: `cast ${spellName}`,
      },
    });
    const secondCast = request.post(`/api/campaign/${created.campaignId}/action`, {
      data: {
        requestId: `action-slot-race-b-${randomUUID()}`,
        action: `cast ${spellName}`,
      },
    });

    await waitForBlockedCharacterUpdates(prisma);
    releaseLock();
    await lockTransaction;

    const [firstResponse, secondResponse] = await Promise.all([firstCast, secondCast]);

    expect(firstResponse.status()).toBe(200);
    expect(secondResponse.status()).toBe(200);

    const frames = [
      ...parseSseFrames(await firstResponse.text()),
      ...parseSseFrames(await secondResponse.text()),
    ];
    const spellEvents = frames.filter(
      (frame) => frame.t === "evt" && frame.e?.type === "SPELL_CAST"
    );

    expect(spellEvents).toHaveLength(2);
    for (const event of spellEvents) {
      expect(event.e?.payload).toMatchObject({
        spellLevel: 1,
        spellName,
        slotConsumed: true,
      });
    }

    const after = await prisma.character.findUniqueOrThrow({
      where: { id: created.characterId },
      select: { spellSlots: true },
    });

    expect(after.spellSlots).toEqual({
      "1": { current: 0, max: 2 },
    });
  } finally {
    releaseLock();
    await lockTransaction?.catch(() => undefined);
    await prisma.srdSpell.deleteMany({ where: { id: spellId } }).catch(() => undefined);
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});