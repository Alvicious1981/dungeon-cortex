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

async function waitForBlockedEncounterUpdates(
  prisma: PrismaClient,
  minimum: number
): Promise<void> {
  // The action route uses Prisma interactive transactions with the default
  // 5-second timeout. Both requests should reach their conditional Encounter
  // UPDATE quickly, so release the external lock as soon as both overlapping
  // transition claims are visible.
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

    if (Number(rows[0]?.count ?? 0) >= minimum) return;
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
    `Timed out waiting for ${minimum} blocked Encounter update(s). Active DB work: ${JSON.stringify(activity)}`
  );
}

type TurnRaceKind = "end_turn" | "ability_check" | "weapon_attack" | "equipment";

interface TurnRaceCase {
  kind: TurnRaceKind;
  label: string;
  action: string;
}

const TURN_RACES: readonly TurnRaceCase[] = [
  { kind: "end_turn", label: "End Turn", action: "End Turn" },
  {
    kind: "ability_check",
    label: "an allowed ability check",
    action: "I inspect the room",
  },
  { kind: "weapon_attack", label: "a weapon attack", action: "Attack" },
  {
    kind: "equipment",
    label: "an equipment action",
    action: "Equip Turn Race Charm",
  },
];

for (const race of TURN_RACES) {
  test(`@smoke concurrent ${race.label} versus End Turn rejects the stale action`, async ({
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

      if (race.kind === "weapon_attack") {
        await prisma.inventoryItem.create({
          data: {
            characterId: created.characterId,
            name: `Turn Race Blade ${randomUUID().slice(0, 8)}`,
            type: "weapon",
            quantity: 1,
            equippedSlot: "MAIN_HAND",
            properties: {
              damageDice: "1d8",
              damageBonus: 0,
              damageType: "slashing",
              weaponCategory: "Martial",
              weaponRange: "Melee",
            },
          },
        });
      }

      if (race.kind === "equipment") {
        await prisma.inventoryItem.create({
          data: {
            characterId: created.characterId,
            name: "Turn Race Charm",
            type: "misc",
            quantity: 1,
            properties: {},
          },
        });
      }

      const encounter = await prisma.encounter.create({
        data: {
          campaignId: created.campaignId,
          status: "active",
          round: 1,
          currentTurnIndex: 0,
          currentTurnObjectInteractionUsed: race.kind === "equipment",
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
                initiativeOrder: 0,
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
                initiativeOrder: 1,
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
                initiativeOrder: 2,
                stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
                conditions: [],
              },
            ],
          },
        },
      });
      encounterId = encounter.id;

      const attackTarget = await prisma.combatant.findFirstOrThrow({
        where: { encounterId: encounter.id, name: "Turn Target A" },
        select: { id: true, hp: true },
      });

      // Lock only the canonical Encounter row. Both requests first observe the
      // player at round/index 1/0 under MVCC, then stop at an Encounter UPDATE.
      // Releasing the lock lets exactly one claim that snapshot; the loser must
      // roll back its earlier check/attack work instead of rebasing onto 1/1.
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

      // Queue End Turn first so it deterministically owns the old turn when the
      // external lock is released. The second request must therefore exercise
      // its losing, rollback-only path rather than winning by scheduler luck.
      const endTurn = request.post(`/api/campaign/${created.campaignId}/action`, {
        data: {
          requestId: `turn-race-end-${randomUUID()}`,
          action: "End Turn",
        },
      });
      await waitForBlockedEncounterUpdates(prisma, 1);

      const contender = request.post(`/api/campaign/${created.campaignId}/action`, {
        data: {
          requestId: `turn-race-contender-${randomUUID()}`,
          action: race.action,
          ...(race.kind === "weapon_attack"
            ? { targetIds: [attackTarget.id] }
            : {}),
        },
      });

      await waitForBlockedEncounterUpdates(prisma, 2);
      releaseLock();
      await lockTransaction;

      const [contenderResponse, endTurnResponse] = await Promise.all([
        contender,
        endTurn,
      ]);
      const responses = [contenderResponse, endTurnResponse];
      expect(
        responses.map((response) => response.status()).sort((a, b) => a - b)
      ).toEqual([200, 409]);
      expect(endTurnResponse.status()).toBe(200);
      expect(contenderResponse.status()).toBe(409);

      const successResponse = responses.find((response) => response.status() === 200);
      const conflictResponse = responses.find((response) => response.status() === 409);
      expect(successResponse).toBeDefined();
      expect(conflictResponse).toBeDefined();

      const conflictBody = (await conflictResponse!.json()) as {
        error?: unknown;
        code?: unknown;
      };
      expect(conflictBody.code).toBe(
        race.kind === "equipment" ? "EQUIPMENT_STATE_CONFLICT" : "TURN_STATE_CONFLICT"
      );
      expect(typeof conflictBody.error).toBe("string");

      const successFrames = parseSseFrames(await successResponse!.text());
      const turnEvents = successFrames.filter(
        (frame) => frame.t === "evt" && frame.e?.type === "TURN_ADVANCE"
      );
      expect(turnEvents).toHaveLength(1);
      expect(turnEvents[0]?.e?.payload).toMatchObject({
        nextTurnIndex: 1,
        nextRound: 1,
      });

      const contenderSucceeded = contenderResponse.status() === 200;
      const checkEvents = successFrames.filter(
        (frame) => frame.t === "evt" && frame.e?.type === "ABILITY_CHECK_RESOLVED"
      );
      expect(checkEvents).toHaveLength(
        race.kind === "ability_check" && contenderSucceeded ? 1 : 0
      );

      const after = await prisma.encounter.findUniqueOrThrow({
        where: { id: encounter.id },
        select: {
          currentTurnIndex: true,
          round: true,
          status: true,
          totalDamageDealt: true,
        },
      });
      expect(after.status).toBe("active");
      expect(after.round).toBe(1);
      expect(after.currentTurnIndex).toBe(1);

      const actionContents = [...new Set([race.action, "End Turn"])];
      const userLogs = await prisma.gameLog.findMany({
        where: {
          campaignId: created.campaignId,
          role: "user",
          content: { in: actionContents },
        },
        select: { content: true },
      });
      expect(userLogs).toEqual([
        { content: contenderSucceeded ? race.action : "End Turn" },
      ]);

      const checkLogs = await prisma.gameLog.findMany({
        where: {
          campaignId: created.campaignId,
          role: "system",
          content: { startsWith: "🎲 Investigation check" },
        },
      });
      expect(checkLogs).toHaveLength(
        race.kind === "ability_check" && contenderSucceeded ? 1 : 0
      );

      if (race.kind === "weapon_attack" && !contenderSucceeded) {
        const targetAfter = await prisma.combatant.findUniqueOrThrow({
          where: { id: attackTarget.id },
          select: { hp: true },
        });
        expect(targetAfter.hp).toBe(attackTarget.hp);
        expect(after.totalDamageDealt).toBe(0);
      }

      if (race.kind === "equipment" && !contenderSucceeded) {
        const itemAfter = await prisma.inventoryItem.findFirstOrThrow({
          where: {
            characterId: created.characterId,
            name: "Turn Race Charm",
          },
          select: { equippedSlot: true },
        });
        expect(itemAfter.equippedSlot).toBeNull();
      }
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
}
