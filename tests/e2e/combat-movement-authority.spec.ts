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
  e?: { type?: string; payload?: Record<string, unknown> };
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

async function waitForTwoBlockedAuthorityClaims(prisma: PrismaClient): Promise<void> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
        AND (
          query ILIKE '%Character%'
          OR query ILIKE '%Combatant%'
          OR query ILIKE '%Encounter%'
        )
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
    `Timed out waiting for two blocked combat-authority claims. Active DB work: ${JSON.stringify(activity)}`
  );
}

test("@smoke concurrent distinct Move requests reject one stale transition (DC-AUD-014)", async ({
  request,
}) => {
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
  const authorityRowsLocked = new Promise<void>((resolve) => {
    lockHeld = resolve;
  });

  let lockTransaction: Promise<unknown> | undefined;

  try {
    created.characterId = await createdId(
      await request.post("/api/character", {
        data: {
          name: `Move race ${randomUUID().slice(0, 8)}`,
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
          title: `Move race ${randomUUID().slice(0, 8)}`,
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
        zones: {
          create: Array.from({ length: 9 }, (_, index) => ({
            name: `Zone ${index}`,
            x: index % 3,
            y: Math.floor(index / 3),
          })),
        },
      },
      include: { zones: true },
    });
    encounterId = encounter.id;

    const zoneAt = (x: number, y: number): string => {
      const zone = encounter.zones.find((candidate) => candidate.x === x && candidate.y === y);
      if (!zone) throw new Error(`Missing persisted zone at ${x},${y}.`);
      return zone.id;
    };

    const [player, enemy] = await prisma.$transaction([
      prisma.combatant.create({
        data: {
          encounterId: encounter.id,
          name: "Move Racer",
          isPlayer: true,
          hp: 20,
          maxHp: 20,
          ac: 16,
          initiativeTotal: 30,
          stats: { speed: 30, STR: 16, DEX: 14, CON: 14, INT: 10, WIS: 12, CHA: 8 },
          conditions: [],
          x: 1,
          y: 1,
          zoneId: zoneAt(1, 1),
        },
      }),
      prisma.combatant.create({
        data: {
          encounterId: encounter.id,
          name: "Move Observer",
          isPlayer: false,
          hp: 20,
          maxHp: 20,
          ac: 12,
          initiativeTotal: 10,
          stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
          conditions: [],
          x: 2,
          y: 2,
          zoneId: zoneAt(2, 2),
        },
      }),
    ]);

    // Hold every row family a corrected combat action may need. Both requests
    // must independently reach an authority claim from the same committed
    // position before release. The lock order preserves the repository's
    // Character -> Combatant invariant and then claims Encounter turn state.
    lockTransaction = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Character"
          WHERE "id" = ${created.characterId}
          FOR UPDATE
        `;
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Combatant"
          WHERE "id" = ${player.id}
          FOR UPDATE
        `;
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Encounter"
          WHERE "id" = ${encounter.id}
          FOR UPDATE
        `;
        lockHeld();
        await mayReleaseLock;
      },
      { timeout: 15_000 }
    );

    await authorityRowsLocked;

    const firstMove = request.post(`/api/campaign/${created.campaignId}/action`, {
      data: {
        requestId: `move-race-a-${randomUUID()}`,
        action: "Move",
        targetX: 0,
        targetY: 1,
      },
    });
    const secondMove = request.post(`/api/campaign/${created.campaignId}/action`, {
      data: {
        requestId: `move-race-b-${randomUUID()}`,
        action: "Move",
        targetX: 1,
        targetY: 0,
      },
    });

    await waitForTwoBlockedAuthorityClaims(prisma);
    releaseLock();
    await lockTransaction;

    const responses = await Promise.all([firstMove, secondMove]);
    const outcomes = await Promise.all(
      responses.map(async (response) => ({
        status: response.status(),
        body: await response.text(),
      }))
    );
    const moveEvents = outcomes.flatMap(({ body }) =>
      parseSseFrames(body).filter(
        (frame) => frame.t === "evt" && frame.e?.type === "MOVE_COMBATANT"
      )
    );
    const [persistedPlayer, canonicalMoveLogs] = await Promise.all([
      prisma.combatant.findUniqueOrThrow({
        where: { id: player.id },
        select: { x: true, y: true },
      }),
      prisma.gameLog.findMany({
        where: {
          campaignId: created.campaignId,
          role: "user",
          content: "Move",
        },
        select: { id: true },
      }),
    ]);

    expect.soft(outcomes.map(({ status }) => status).sort((a, b) => a - b)).toEqual([
      200,
      409,
    ]);
    expect.soft(moveEvents).toHaveLength(1);
    expect.soft(canonicalMoveLogs).toHaveLength(1);
    expect.soft([
      { x: 0, y: 1 },
      { x: 1, y: 0 },
    ]).toContainEqual(persistedPlayer);

    // Both responses were built from the same authoritative origin. A second
    // success would therefore be a stale transition, not a safe rebase.
    expect.soft(
      moveEvents.map((frame) => ({
        fromX: frame.e?.payload?.fromX,
        fromY: frame.e?.payload?.fromY,
      }))
    ).toEqual([{ fromX: 1, fromY: 1 }]);
    expect(enemy.id).not.toBe(player.id);
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
