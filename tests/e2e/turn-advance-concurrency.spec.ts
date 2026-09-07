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

async function waitForTwoBlockedEncounterUpdates(prisma: PrismaClient): Promise<void> {
  // The action route uses Prisma interactive transactions with the default
  // 5-second timeout. Both requests should reach the Encounter UPDATE quickly,
  // so this barrier stays comfortably below that limit and releases the
  // external row lock as soon as the stale writes are proven to overlap.
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
        AND query ILIKE 'UPDATE%'
        AND query ILIKE '%Encounter%'
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
    `Timed out waiting for two blocked Encounter updates. Active DB work: ${JSON.stringify(activity)}`
  );
}

test("@smoke concurrent End Turn preserves both accepted turn transitions", async ({ request }) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();
  let encounterId: string | undefined;

  let releaseLock!: () => void;
  const mayReleaseLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  let lockHeld!: () => void;
  const encounterLockHeld = new Promise<void>((resolve) => {
    lockHeld = resolve;
  });

  let lockTransaction: Promise<unknown> | undefined;

  try {
    created.characterId = await createdId(
      await request.post("/api/character", {
        data: {
          name: `Turn race ${randomUUID().slice(0, 8)}`,
          race: "human",
          class: "fighter",
          stats: { STR: 16, DEX: 14, CON: 14, INT: 10, WIS: 12, CHA: 8 },
        },
      })
    );

    created.campaignId = await createdId(
      await request.post("/api/campaign", {
        data: {
          characterId: created.characterId,
          title: `Turn race ${randomUUID().slice(0, 8)}`,
        },
      })
    );

    const encounter = await prisma.encounter.create({
      data: {
        campaignId: created.campaignId,
        status: "active",
        round: 1,
        currentTurnIndex: 0,
        totalDamageDealt: 0,
        combatants: {
          create: [
            {
              name: "Turn Racer",
              isPlayer: true,
              hp: 20,
              maxHp: 20,
              ac: 16,
              initiativeTotal: 30,
              stats: { STR: 16, DEX: 14, CON: 14, INT: 10, WIS: 12, CHA: 8 },
              conditions: [],
            },
            {
              name: "Turn Target A",
              isPlayer: false,
              hp: 20,
              maxHp: 20,
              ac: 12,
              initiativeTotal: 20,
              stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
              conditions: [],
            },
            {
              name: "Turn Target B",
              isPlayer: false,
              hp: 20,
              maxHp: 20,
              ac: 12,
              initiativeTotal: 10,
              stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
              conditions: [],
            },
          ],
        },
      },
    });
    encounterId = encounter.id;

    // Lock only the canonical Encounter row. buildCampaignContext can still
    // read currentTurnIndex=0 under MVCC, while the final UPDATE in each live
    // End Turn transaction waits behind this lock. Seeing two blocked UPDATEs
    // proves both requests independently resolved from the same pre-update turn
    // snapshot before either transition could commit.
    lockTransaction = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "Encounter"
          WHERE "id" = ${encounter.id}
          FOR UPDATE
        `;
        lockHeld();
        await mayReleaseLock;
      },
      { timeout: 15_000 }
    );

    await encounterLockHeld;

    const firstEndTurn = request.post(`/api/campaign/${created.campaignId}/action`, {
      data: {
        requestId: `turn-race-a-${randomUUID()}`,
        action: "End Turn",
      },
    });
    const secondEndTurn = request.post(`/api/campaign/${created.campaignId}/action`, {
      data: {
        requestId: `turn-race-b-${randomUUID()}`,
        action: "End Turn",
      },
    });

    await waitForTwoBlockedEncounterUpdates(prisma);
    releaseLock();
    await lockTransaction;

    const [firstResponse, secondResponse] = await Promise.all([
      firstEndTurn,
      secondEndTurn,
    ]);

    expect(firstResponse.status()).toBe(200);
    expect(secondResponse.status()).toBe(200);

    const firstFrames = parseSseFrames(await firstResponse.text());
    const secondFrames = parseSseFrames(await secondResponse.text());
    const turnEvents = [...firstFrames, ...secondFrames].filter(
      (frame) => frame.t === "evt" && frame.e?.type === "TURN_ADVANCE"
    );

    // Both distinct requests were accepted as mechanical turn advances. On the
    // vulnerable implementation each carries the same stale 0 -> 1 transition.
    expect(turnEvents).toHaveLength(2);
    expect(
      turnEvents.map((frame) => frame.e?.payload?.nextTurnIndex)
    ).toEqual([1, 1]);

    const after = await prisma.encounter.findUniqueOrThrow({
      where: { id: encounter.id },
      select: { currentTurnIndex: true, round: true, status: true },
    });

    expect(after.status).toBe("active");
    expect(after.round).toBe(1);

    // Sequential semantics: three living combatants, start index 0, and two
    // distinct accepted End Turn actions. Applying both transitions yields
    // 0 -> 1 -> 2. Persisting only 1 means the second accepted transition was
    // silently lost because both transactions wrote the same stale absolute
    // nextTurnIndex.
    expect(after.currentTurnIndex).toBe(2);
  } finally {
    releaseLock();
    await lockTransaction?.catch(() => undefined);

    if (encounterId) {
      await prisma.combatant.deleteMany({ where: { encounterId } });
      await prisma.encounter.deleteMany({ where: { id: encounterId } });
    }

    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});
