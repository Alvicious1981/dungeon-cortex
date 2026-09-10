import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  MoveStateConflictError,
  persistMoveTransition,
} from "@/lib/db/move-transition";
import { finalizeEncounterTurn } from "@/lib/rules/combat-pipeline";

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

async function createMoveFixture(
  request: APIRequestContext,
  prisma: PrismaClient,
  created: E2ECreatedRecords,
  label: string
): Promise<{ encounterId: string; playerId: string; enemyId: string }> {
  created.characterId = await createdId(
    await request.post("/api/character", {
      data: {
        name: `${label} ${randomUUID().slice(0, 8)}`,
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
        title: `${label} ${randomUUID().slice(0, 8)}`,
      },
    })
  );

  const encounter = await prisma.encounter.create({
    data: {
      campaignId: created.campaignId,
      status: "active",
      round: 1,
      currentTurnIndex: 0,
      currentTurnMovementSpentFt: 0,
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
        initiativeOrder: 0,
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
        initiativeOrder: 1,
        stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
        conditions: [],
        x: 2,
        y: 2,
        zoneId: zoneAt(2, 2),
      },
    }),
  ]);

  return { encounterId: encounter.id, playerId: player.id, enemyId: enemy.id };
}

async function waitForBlockedAuthorityClaims(
  prisma: PrismaClient,
  expectedCount: number
): Promise<void> {
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

    if (Number(rows[0]?.count ?? 0) >= expectedCount) return;
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
    `Timed out waiting for ${expectedCount} blocked combat-authority claim(s). Active DB work: ${JSON.stringify(activity)}`
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
    const fixture = await createMoveFixture(request, prisma, created, "Move race");
    encounterId = fixture.encounterId;

    // Hold the player's Combatant row so both requests independently reach the
    // origin claim from the same committed position before release. The winner
    // subsequently claims Encounter in the production Combatant -> Encounter order.
    lockTransaction = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Combatant"
          WHERE "id" = ${fixture.playerId}
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

    await waitForBlockedAuthorityClaims(prisma, 2);
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
        where: { id: fixture.playerId },
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
    expect.soft(
      outcomes
        .filter(({ status }) => status === 409)
        .map(({ body }) => (JSON.parse(body) as { code?: unknown }).code)
    ).toEqual(["MOVE_STATE_CONFLICT"]);
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
    expect(fixture.enemyId).not.toBe(fixture.playerId);
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

test("concurrent movement claims cannot spend the same remaining allowance", async ({
  request,
}) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();
  let encounterId: string | undefined;

  let releaseClaims!: () => void;
  const bothCombatantClaimsReached = new Promise<void>((resolve) => {
    releaseClaims = resolve;
  });
  let combatantClaimCount = 0;

  try {
    const fixture = await createMoveFixture(request, prisma, created, "Budget race");
    encounterId = fixture.encounterId;

    const initialSpend = {
      campaignId: created.campaignId!,
      encounterId: fixture.encounterId,
      combatantId: fixture.playerId,
      expectedFromX: 1,
      expectedFromY: 1,
      targetX: 5,
      targetY: 1,
      expectedRound: 1,
      expectedTurnIndex: 0,
      expectedMovementSpentFt: 0,
      requestedDistanceFt: 20,
      speedFt: 30,
      playerAction: "Move",
    };
    await prisma.$transaction((tx) => persistMoveTransition(tx, initialSpend));

    const race = (
      combatantId: string,
      expectedFromX: number,
      expectedFromY: number,
      targetX: number,
      targetY: number
    ) =>
      prisma.$transaction(async (tx) => {
        const synchronizedTx = {
          ...tx,
          combatant: {
            ...tx.combatant,
            updateMany: async (...args: Parameters<typeof tx.combatant.updateMany>) => {
              const claim = await tx.combatant.updateMany(...args);
              combatantClaimCount += 1;
              if (combatantClaimCount === 2) releaseClaims();
              await bothCombatantClaimsReached;
              return claim;
            },
          },
        };
        const input = {
          campaignId: created.campaignId!,
          encounterId: fixture.encounterId,
          combatantId,
          expectedFromX,
          expectedFromY,
          targetX,
          targetY,
          expectedRound: 1,
          expectedTurnIndex: 0,
          expectedMovementSpentFt: 20,
          requestedDistanceFt: 10,
          speedFt: 30,
          playerAction: "Move",
        };
        return persistMoveTransition(
          synchronizedTx as unknown as Prisma.TransactionClient,
          input
        );
      });

    const results = await Promise.allSettled([
      race(fixture.playerId, 5, 1, 7, 1),
      race(fixture.enemyId, 2, 2, 4, 2),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const rejectedRace = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    expect(rejectedRace?.reason).toBeInstanceOf(MoveStateConflictError);
    const [raceEncounter, raceCombatants, raceLogs] = await Promise.all([
      prisma.encounter.findUniqueOrThrow({
        where: { id: fixture.encounterId },
        select: { currentTurnMovementSpentFt: true },
      }),
      prisma.combatant.findMany({
        where: { id: { in: [fixture.playerId, fixture.enemyId] } },
        select: { id: true, x: true, y: true },
      }),
      prisma.gameLog.count({
        where: { campaignId: created.campaignId, role: "user", content: "Move" },
      }),
    ]);
    expect(raceEncounter.currentTurnMovementSpentFt).toBe(30);
    expect(raceLogs).toBe(2);
    expect(
      raceCombatants.filter(
        (combatant) =>
          (combatant.id === fixture.playerId && combatant.x === 7 && combatant.y === 1) ||
          (combatant.id === fixture.enemyId && combatant.x === 4 && combatant.y === 2)
      )
    ).toHaveLength(1);
  } finally {
    releaseClaims();
    if (encounterId) {
      await prisma.combatant.deleteMany({ where: { encounterId } });
      await prisma.encounter.deleteMany({ where: { id: encounterId } });
    }
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});

test("End Turn winning the Encounter race makes Move stale and rolls its origin claim back", async ({
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
  const combatantLocked = new Promise<void>((resolve) => {
    lockHeld = resolve;
  });
  let lockTransaction: Promise<unknown> | undefined;

  try {
    const fixture = await createMoveFixture(request, prisma, created, "Turn race");
    encounterId = fixture.encounterId;

    lockTransaction = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Combatant"
          WHERE "id" = ${fixture.playerId}
          FOR UPDATE
        `;
        lockHeld();
        await mayReleaseLock;
      },
      { timeout: 15_000 }
    );
    await combatantLocked;

    const pendingMove = request.post(`/api/campaign/${created.campaignId}/action`, {
      data: {
        requestId: `turn-race-move-${randomUUID()}`,
        action: "Move",
        targetX: 0,
        targetY: 1,
      },
    });
    await waitForBlockedAuthorityClaims(prisma, 1);

    const endTurn = await request.post(`/api/campaign/${created.campaignId}/action`, {
      data: {
        requestId: `turn-race-end-${randomUUID()}`,
        action: "End Turn",
      },
    });
    expect(endTurn.status()).toBe(200);

    releaseLock();
    await lockTransaction;

    const move = await pendingMove;
    const moveBody = await move.text();
    expect(move.status()).toBe(409);
    expect(JSON.parse(moveBody)).toMatchObject({ code: "MOVE_STATE_CONFLICT" });
    expect(
      parseSseFrames(moveBody).filter(
        (frame) => frame.t === "evt" && frame.e?.type === "MOVE_COMBATANT"
      )
    ).toHaveLength(0);
    const [playerAfterRace, encounterAfterRace] = await Promise.all([
      prisma.combatant.findUniqueOrThrow({
        where: { id: fixture.playerId },
        select: { x: true, y: true },
      }),
      prisma.encounter.findUniqueOrThrow({
        where: { id: fixture.encounterId },
        select: { currentTurnIndex: true, currentTurnMovementSpentFt: true },
      }),
    ]);
    expect(playerAfterRace).toEqual({ x: 1, y: 1 });
    expect(encounterAfterRace).toEqual({
      currentTurnIndex: 1,
      currentTurnMovementSpentFt: 0,
    });
    await expect(
      prisma.gameLog.count({
        where: { campaignId: created.campaignId, role: "user", content: "Move" },
      })
    ).resolves.toBe(0);
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

test("same-turn coordinate ABA invalidates an older movement-budget claim", async ({ request }) => {
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();
  let encounterId: string | undefined;

  try {
    const fixture = await createMoveFixture(request, prisma, created, "Move ABA");
    encounterId = fixture.encounterId;

    const transition = (
      expectedFromX: number,
      expectedFromY: number,
      targetX: number,
      targetY: number,
      expectedMovementSpentFt: number
    ) => ({
      campaignId: created.campaignId!,
      encounterId: fixture.encounterId,
      combatantId: fixture.playerId,
      expectedFromX,
      expectedFromY,
      targetX,
      targetY,
      expectedRound: 1,
      expectedTurnIndex: 0,
      expectedMovementSpentFt,
      requestedDistanceFt: 5,
      speedFt: 30,
      playerAction: "Move",
    });

    await prisma.$transaction((tx) =>
      persistMoveTransition(tx, transition(1, 1, 0, 1, 0))
    );
    await prisma.$transaction((tx) =>
      persistMoveTransition(tx, transition(0, 1, 1, 1, 5))
    );

    const staleResult = await Promise.allSettled([
      prisma.$transaction((tx) =>
        persistMoveTransition(tx, transition(1, 1, 1, 0, 0))
      ),
    ]);
    expect(staleResult[0]?.status).toBe("rejected");
    if (staleResult[0]?.status === "rejected") {
      expect(staleResult[0].reason).toBeInstanceOf(MoveStateConflictError);
    }
    const [playerAfterAba, encounterAfterAba] = await Promise.all([
      prisma.combatant.findUniqueOrThrow({
        where: { id: fixture.playerId },
        select: { x: true, y: true },
      }),
      prisma.encounter.findUniqueOrThrow({
        where: { id: fixture.encounterId },
        select: { currentTurnMovementSpentFt: true },
      }),
    ]);
    expect(playerAfterAba).toEqual({ x: 1, y: 1 });
    expect(encounterAfterAba.currentTurnMovementSpentFt).toBe(10);
    await expect(
      prisma.gameLog.count({
        where: { campaignId: created.campaignId, role: "user", content: "Move" },
      })
    ).resolves.toBe(2);
  } finally {
    if (encounterId) {
      await prisma.combatant.deleteMany({ where: { encounterId } });
      await prisma.encounter.deleteMany({ where: { id: encounterId } });
    }
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});

test("split movement exhausts exactly and a genuine new player turn resets the allowance", async ({
  request,
}) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();
  let encounterId: string | undefined;

  try {
    const fixture = await createMoveFixture(request, prisma, created, "Turn budget lifecycle");
    encounterId = fixture.encounterId;

    const destinations = [
      { targetX: 0, targetY: 1 }, // 5 ft
      { targetX: 2, targetY: 1 }, // 10 ft
      { targetX: 0, targetY: 1 }, // 10 ft
      { targetX: 1, targetY: 1 }, // 5 ft; exact 30 ft
    ];
    const successfulMoves = [];
    for (const [index, destination] of destinations.entries()) {
      successfulMoves.push(
        await request.post(`/api/campaign/${created.campaignId}/action`, {
          data: {
            requestId: `split-move-${index}-${randomUUID()}`,
            action: "Move",
            ...destination,
          },
        })
      );
    }

    expect(successfulMoves.map((response) => response.status())).toEqual([200, 200, 200, 200]);
    const successfulMoveEvents = (
      await Promise.all(successfulMoves.map((response) => response.text()))
    ).flatMap((body) =>
      parseSseFrames(body).filter(
        (frame) => frame.t === "evt" && frame.e?.type === "MOVE_COMBATANT"
      )
    );
    expect(successfulMoveEvents).toHaveLength(4);

    const exhausted = await request.post(`/api/campaign/${created.campaignId}/action`, {
      data: {
        requestId: `exhausted-move-${randomUUID()}`,
        action: "Move",
        targetX: 1,
        targetY: 0,
      },
    });
    expect(exhausted.status()).toBe(409);
    const exhaustedBody = await exhausted.json();
    expect(exhaustedBody).toMatchObject({
      code: "MOVEMENT_BUDGET_EXCEEDED",
      speedFt: 30,
      spentFt: 30,
      remainingFt: 0,
      requestedFt: 5,
    });

    const [atExhaustion, logsAtExhaustion] = await Promise.all([
      prisma.encounter.findUniqueOrThrow({
        where: { id: fixture.encounterId },
        select: { currentTurnMovementSpentFt: true },
      }),
      prisma.gameLog.count({
        where: { campaignId: created.campaignId, role: "user", content: "Move" },
      }),
    ]);
    expect(atExhaustion.currentTurnMovementSpentFt).toBe(30);
    expect(logsAtExhaustion).toBe(4);

    // Advance player -> enemy -> player through the production turn finalizer.
    // No enemy AI is fabricated; this is the deterministic state-machine edge.
    await prisma.$transaction((tx) =>
      finalizeEncounterTurn({
        tx,
        encounterId: fixture.encounterId,
        currentTurnIndex: 0,
        round: 1,
        collectEvents: false,
        failOnStaleTurn: true,
      })
    );
    await prisma.$transaction((tx) =>
      finalizeEncounterTurn({
        tx,
        encounterId: fixture.encounterId,
        currentTurnIndex: 1,
        round: 1,
        collectEvents: false,
        failOnStaleTurn: true,
      })
    );
    await expect(
      prisma.encounter.findUniqueOrThrow({
        where: { id: fixture.encounterId },
        select: {
          round: true,
          currentTurnIndex: true,
          currentTurnMovementSpentFt: true,
        },
      })
    ).resolves.toEqual({
      round: 2,
      currentTurnIndex: 0,
      currentTurnMovementSpentFt: 0,
    });

    const newTurnMove = await request.post(`/api/campaign/${created.campaignId}/action`, {
      data: {
        requestId: `new-turn-move-${randomUUID()}`,
        action: "Move",
        targetX: 1,
        targetY: 0,
      },
    });
    expect(newTurnMove.status()).toBe(200);
    expect(
      parseSseFrames(await newTurnMove.text()).filter(
        (frame) => frame.t === "evt" && frame.e?.type === "MOVE_COMBATANT"
      )
    ).toHaveLength(1);
    await expect(
      prisma.encounter.findUniqueOrThrow({
        where: { id: fixture.encounterId },
        select: { currentTurnMovementSpentFt: true },
      })
    ).resolves.toEqual({ currentTurnMovementSpentFt: 5 });
  } finally {
    if (encounterId) {
      await prisma.combatant.deleteMany({ where: { encounterId } });
      await prisma.encounter.deleteMany({ where: { id: encounterId } });
    }
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});

test("legacy null fails closed and the next turn transition canonicalizes the budget", async ({
  request,
}) => {
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();
  let encounterId: string | undefined;

  try {
    const fixture = await createMoveFixture(request, prisma, created, "Legacy movement budget");
    encounterId = fixture.encounterId;
    await expect(
      prisma.encounter.update({
        where: { id: fixture.encounterId },
        data: { currentTurnMovementSpentFt: -1 },
      })
    ).rejects.toThrow();
    await prisma.encounter.update({
      where: { id: fixture.encounterId },
      data: { currentTurnMovementSpentFt: null },
    });

    const refused = await request.post(`/api/campaign/${created.campaignId}/action`, {
      data: {
        requestId: `legacy-budget-move-${randomUUID()}`,
        action: "Move",
        targetX: 0,
        targetY: 1,
      },
    });
    expect(refused.status()).toBe(409);
    expect(await refused.json()).toEqual({
      error:
        "Movement budget is unavailable for this legacy turn. Advance the turn to initialize it.",
      code: "MOVEMENT_BUDGET_UNAVAILABLE",
    });
    await expect(
      prisma.gameLog.count({
        where: { campaignId: created.campaignId, role: "user", content: "Move" },
      })
    ).resolves.toBe(0);

    await prisma.$transaction((tx) =>
      finalizeEncounterTurn({
        tx,
        encounterId: fixture.encounterId,
        currentTurnIndex: 0,
        round: 1,
        collectEvents: false,
        failOnStaleTurn: true,
      })
    );
    await expect(
      prisma.encounter.findUniqueOrThrow({
        where: { id: fixture.encounterId },
        select: { currentTurnIndex: true, currentTurnMovementSpentFt: true },
      })
    ).resolves.toEqual({ currentTurnIndex: 1, currentTurnMovementSpentFt: 0 });
  } finally {
    if (encounterId) {
      await prisma.combatant.deleteMany({ where: { encounterId } });
      await prisma.encounter.deleteMany({ where: { id: encounterId } });
    }
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});

test("Move winning the Encounter race commits before End Turn resets the next turn", async ({
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
  const encounterLocked = new Promise<void>((resolve) => {
    lockHeld = resolve;
  });
  let lockTransaction: Promise<unknown> | undefined;

  try {
    const fixture = await createMoveFixture(request, prisma, created, "Move wins turn race");
    encounterId = fixture.encounterId;

    lockTransaction = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Encounter"
          WHERE "id" = ${fixture.encounterId}
          FOR UPDATE
        `;
        lockHeld();
        await mayReleaseLock;
      },
      { timeout: 15_000 }
    );
    await encounterLocked;

    const pendingMove = request.post(`/api/campaign/${created.campaignId}/action`, {
      data: {
        requestId: `move-wins-${randomUUID()}`,
        action: "Move",
        targetX: 0,
        targetY: 1,
      },
    });
    await waitForBlockedAuthorityClaims(prisma, 1);

    const pendingEndTurn = request.post(`/api/campaign/${created.campaignId}/action`, {
      data: {
        requestId: `end-after-move-${randomUUID()}`,
        action: "End Turn",
      },
    });
    await waitForBlockedAuthorityClaims(prisma, 2);
    releaseLock();
    await lockTransaction;

    const [move, endTurn] = await Promise.all([pendingMove, pendingEndTurn]);
    expect([move.status(), endTurn.status()]).toEqual([200, 200]);
    expect(
      parseSseFrames(await move.text()).filter(
        (frame) => frame.t === "evt" && frame.e?.type === "MOVE_COMBATANT"
      )
    ).toHaveLength(1);
    await expect(
      prisma.combatant.findUniqueOrThrow({
        where: { id: fixture.playerId },
        select: { x: true, y: true },
      })
    ).resolves.toEqual({ x: 0, y: 1 });
    await expect(
      prisma.encounter.findUniqueOrThrow({
        where: { id: fixture.encounterId },
        select: { round: true, currentTurnIndex: true, currentTurnMovementSpentFt: true },
      })
    ).resolves.toEqual({
      round: 1,
      currentTurnIndex: 1,
      currentTurnMovementSpentFt: 0,
    });
    await expect(
      prisma.gameLog.count({
        where: { campaignId: created.campaignId, role: "user", content: "Move" },
      })
    ).resolves.toBe(1);
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

test("stale expected origin returns a terminal MOVE_STATE_CONFLICT without a player log", async ({
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
  const combatantLocked = new Promise<void>((resolve) => {
    lockHeld = resolve;
  });
  let lockTransaction: Promise<unknown> | undefined;

  try {
    const fixture = await createMoveFixture(request, prisma, created, "Stale Move");
    encounterId = fixture.encounterId;

    lockTransaction = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Combatant"
          WHERE "id" = ${fixture.playerId}
          FOR UPDATE
        `;
        lockHeld();
        await mayReleaseLock;
        await tx.combatant.update({
          where: { id: fixture.playerId },
          data: { x: 2, y: 1 },
        });
      },
      { timeout: 15_000 }
    );

    await combatantLocked;

    const requestId = `stale-move-${randomUUID()}`;
    const requestData = {
      requestId,
      action: "Move",
      targetX: 0,
      targetY: 1,
    };
    const pendingMove = request.post(`/api/campaign/${created.campaignId}/action`, {
      data: requestData,
    });

    await waitForBlockedAuthorityClaims(prisma, 1);
    releaseLock();
    await lockTransaction;

    const response = await pendingMove;
    const responseBody = await response.json();
    expect(response.status()).toBe(409);
    expect(responseBody).toEqual({
      error:
        "Authoritative Move state changed before this Move could be applied. Refresh state and try again.",
      code: "MOVE_STATE_CONFLICT",
    });

    const [afterConflict, logsAfterConflict, receipt] = await Promise.all([
      prisma.combatant.findUniqueOrThrow({
        where: { id: fixture.playerId },
        select: { x: true, y: true },
      }),
      prisma.gameLog.count({
        where: { campaignId: created.campaignId, role: "user", content: "Move" },
      }),
      prisma.actionRequestReceipt.findUniqueOrThrow({
        where: {
          actorUserId_requestId: {
            actorUserId: "00000000-0000-0000-0000-000000000000",
            requestId,
          },
        },
        select: { status: true, responseStatus: true, responseBody: true },
      }),
    ]);
    expect(afterConflict).toEqual({ x: 2, y: 1 });
    expect(logsAfterConflict).toBe(0);
    expect(receipt).toMatchObject({ status: "REJECTED", responseStatus: 409 });

    // A rejected requestId is terminal. Even after the world changes such that
    // the old target would be legal from the new origin, replay must return the
    // stored refusal rather than execute a newly interpreted Move.
    await prisma.combatant.update({
      where: { id: fixture.playerId },
      data: { x: 3, y: 1 },
    });
    const replay = await request.post(`/api/campaign/${created.campaignId}/action`, {
      data: requestData,
    });
    expect(replay.status()).toBe(409);
    expect(await replay.json()).toEqual(responseBody);
    await expect(
      prisma.combatant.findUniqueOrThrow({
        where: { id: fixture.playerId },
        select: { x: true, y: true },
      })
    ).resolves.toEqual({ x: 3, y: 1 });
    await expect(
      prisma.gameLog.count({
        where: { campaignId: created.campaignId, role: "user", content: "Move" },
      })
    ).resolves.toBe(0);
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

test("legal Move atomically persists one transition and one canonical log", async ({ request }) => {
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();
  let encounterId: string | undefined;

  try {
    const fixture = await createMoveFixture(request, prisma, created, "Legal Move");
    encounterId = fixture.encounterId;

    const response = await request.post(`/api/campaign/${created.campaignId}/action`, {
      data: {
        requestId: `legal-move-${randomUUID()}`,
        action: "Move",
        targetX: 0,
        targetY: 1,
      },
    });
    expect(response.status()).toBe(200);
    const events = parseSseFrames(await response.text()).filter(
      (frame) => frame.t === "evt" && frame.e?.type === "MOVE_COMBATANT"
    );

    await expect(
      prisma.combatant.findUniqueOrThrow({
        where: { id: fixture.playerId },
        select: { x: true, y: true },
      })
    ).resolves.toEqual({ x: 0, y: 1 });
    await expect(
      prisma.gameLog.count({
        where: { campaignId: created.campaignId, role: "user", content: "Move" },
      })
    ).resolves.toBe(1);
    expect(events).toEqual([
      {
        t: "evt",
        e: {
          type: "MOVE_COMBATANT",
          payload: {
            combatantId: fixture.playerId,
            fromX: 1,
            fromY: 1,
            toX: 0,
            toY: 1,
            distanceFt: 5,
          },
        },
      },
    ]);
  } finally {
    if (encounterId) {
      await prisma.combatant.deleteMany({ where: { encounterId } });
      await prisma.encounter.deleteMany({ where: { id: encounterId } });
    }
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});

test("GameLog failure rolls back a claimed Move origin", async ({ request }) => {
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();
  let encounterId: string | undefined;
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const functionName = `dc_fail_move_log_${suffix}`;
  const triggerName = `dc_fail_move_log_trigger_${suffix}`;
  let triggerInstalled = false;

  try {
    const fixture = await createMoveFixture(request, prisma, created, "Rollback Move");
    encounterId = fixture.encounterId;

    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION ${functionName}() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."campaignId" = '${created.campaignId}'
          AND NEW."role" = 'user'
          AND NEW."content" = 'Move' THEN
          RAISE EXCEPTION 'forced Move history failure';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON "GameLog"
      FOR EACH ROW EXECUTE FUNCTION ${functionName}()
    `);
    triggerInstalled = true;

    await expect(
      prisma.$transaction((tx) =>
        persistMoveTransition(tx, {
          campaignId: created.campaignId!,
          encounterId: fixture.encounterId,
          combatantId: fixture.playerId,
          expectedFromX: 1,
          expectedFromY: 1,
          expectedRound: 1,
          expectedTurnIndex: 0,
          expectedMovementSpentFt: 0,
          requestedDistanceFt: 5,
          speedFt: 30,
          targetX: 0,
          targetY: 1,
          playerAction: "Move",
        })
      )
    ).rejects.toThrow(/forced Move history failure/);

    const [positionAfterLogFailure, budgetAfterLogFailure] = await Promise.all([
      prisma.combatant.findUniqueOrThrow({
        where: { id: fixture.playerId },
        select: { x: true, y: true },
      }),
      prisma.encounter.findUniqueOrThrow({
        where: { id: fixture.encounterId },
        select: { currentTurnMovementSpentFt: true },
      }),
    ]);
    expect(positionAfterLogFailure).toEqual({ x: 1, y: 1 });
    expect(budgetAfterLogFailure.currentTurnMovementSpentFt).toBe(0);
    await expect(
      prisma.gameLog.count({
        where: { campaignId: created.campaignId, role: "user", content: "Move" },
      })
    ).resolves.toBe(0);
  } finally {
    if (triggerInstalled) {
      await prisma.$executeRawUnsafe(`DROP TRIGGER ${triggerName} ON "GameLog"`);
    }
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${functionName}()`);

    if (encounterId) {
      await prisma.combatant.deleteMany({ where: { encounterId } });
      await prisma.encounter.deleteMany({ where: { id: encounterId } });
    }
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});
