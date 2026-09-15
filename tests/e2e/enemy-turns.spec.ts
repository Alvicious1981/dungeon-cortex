import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

import { profileMonster } from "@/lib/rules/monster-attack-profile";
import {
  assertSafeE2EDatabase,
  cleanupE2ERecords,
  type E2ECreatedRecords,
} from "./support/database";

/**
 * Enemy turns on real PostgreSQL
 * (docs/superpowers/specs/2026-09-15-enemy-turns-design.md §9.5).
 *
 * Every fixture raises the player to 200 HP so a critical hit can never down
 * them and turn a smoke test into a coin flip; the goblin's profile comes from
 * the same SRD file prisma/seed-srd.ts loads, through the production
 * recognizer.
 */
const GOBLIN = (
  JSON.parse(
    readFileSync(join(process.cwd(), "data", "srd-es", "monsters.json"), "utf8"),
  ) as Array<Record<string, unknown>>
).find((m) => m.index === "goblin")!;

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

async function createdId(response: APIResponse): Promise<string> {
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { id?: unknown };
  expect(typeof body.id).toBe("string");
  return body.id as string;
}

function postAction(
  request: APIRequestContext,
  campaignId: string,
  action: string,
  extra: Record<string, unknown> = {},
): Promise<APIResponse> {
  return request.post(`/api/campaign/${campaignId}/action`, {
    data: { requestId: `enemy-turns-${randomUUID()}`, action, ...extra },
  });
}

interface GoblinFixture {
  created: E2ECreatedRecords;
  encounterId: string;
  playerId: string;
  goblinId: string;
}

async function createGoblinFixture(
  request: APIRequestContext,
  prisma: PrismaClient,
  options: { goblinAt: { x: number; y: number }; withProfile: boolean; currentTurnIndex: number },
): Promise<GoblinFixture> {
  const created: E2ECreatedRecords = {};
  const suffix = randomUUID().slice(0, 8);
  created.characterId = await createdId(
    await request.post("/api/character", {
      data: {
        name: `Enemy turns ${suffix}`,
        race: "human",
        class: "fighter",
        stats: { STR: 16, DEX: 14, CON: 14, INT: 10, WIS: 12, CHA: 8 },
      },
    }),
  );
  created.campaignId = await createdId(
    await request.post("/api/campaign", {
      data: { characterId: created.characterId, title: `Enemy turns ${suffix}` },
    }),
  );
  await prisma.character.update({
    where: { id: created.characterId },
    data: { hp: 200, maxHp: 200 },
  });

  const profile = profileMonster(GOBLIN);
  expect(profile).not.toBeNull();

  const encounter = await prisma.encounter.create({
    data: {
      campaignId: created.campaignId,
      status: "active",
      round: 1,
      currentTurnIndex: options.currentTurnIndex,
      currentTurnMovementSpentFt: 0,
      currentTurnObjectInteractionUsed: false,
      totalDamageDealt: 0,
      combatants: {
        create: [
          {
            name: "Enemy Turn Hero",
            isPlayer: true,
            hp: 200,
            maxHp: 200,
            ac: 16,
            initiativeTotal: 20,
            initiativeOrder: 0,
            stats: { STR: 16, DEX: 14, CON: 14, INT: 10, WIS: 12, CHA: 8 },
            conditions: [],
            x: 5,
            y: 5,
          },
          {
            name: "Goblin",
            isPlayer: false,
            hp: 7,
            maxHp: 7,
            ac: 15,
            initiativeTotal: 10,
            initiativeOrder: 1,
            stats: { STR: 8, DEX: 14, CON: 10, INT: 10, WIS: 8, CHA: 8 },
            conditions: [],
            size: "Small",
            x: options.goblinAt.x,
            y: options.goblinAt.y,
            ...(options.withProfile
              ? { attackProfile: profile as unknown as Prisma.InputJsonValue }
              : {}),
          },
        ],
      },
    },
    include: { combatants: true },
  });

  return {
    created,
    encounterId: encounter.id,
    playerId: encounter.combatants.find((c) => c.isPlayer)!.id,
    goblinId: encounter.combatants.find((c) => !c.isPlayer)!.id,
  };
}

async function cleanupFixture(prisma: PrismaClient, fixture: GoblinFixture | undefined) {
  if (fixture) {
    await prisma.combatant.deleteMany({ where: { encounterId: fixture.encounterId } });
    await prisma.encounter.deleteMany({ where: { id: fixture.encounterId } });
  }
  await prisma.$disconnect();
  if (fixture) await cleanupE2ERecords(fixture.created);
}

function holdCharacterLock(prisma: PrismaClient, characterId: string) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held!: () => void;
  const isHeld = new Promise<void>((resolve) => {
    held = resolve;
  });
  const transaction = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Character" WHERE "id" = ${characterId} FOR UPDATE
      `;
      held();
      await released;
    },
    { timeout: 15_000 },
  );
  return { release, isHeld, transaction };
}

async function waitForBlockedCharacterLocks(prisma: PrismaClient, minimum: number) {
  // Prisma interactive transactions default to 5 seconds; both End Turns reach
  // the finalizer's Character lock in milliseconds.
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
        AND query ILIKE '%Character%'
        AND query ILIKE '%FOR UPDATE%'
    `;
    if (Number(rows[0]?.count ?? 0) >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${minimum} blocked Character lock(s).`);
}

test("@smoke a goblin closes, attacks, and the turn returns to the player", async ({
  request,
}) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();
  const prisma = new PrismaClient();
  let fixture: GoblinFixture | undefined;
  try {
    fixture = await createGoblinFixture(request, prisma, {
      goblinAt: { x: 5, y: 8 },
      withProfile: true,
      currentTurnIndex: 0,
    });
    const campaignId = fixture.created.campaignId!;

    const response = await postAction(request, campaignId, "End Turn");
    expect(response.status()).toBe(200);

    const types = parseSseFrames(await response.text())
      .filter((frame) => frame.t === "evt" && typeof frame.e?.type === "string")
      .map((frame) => frame.e!.type!);
    expect(types[0]).toBe("TURN_ADVANCE");
    expect(types.at(-1)).toBe("ROUND_ADVANCE");
    expect(types.indexOf("MOVE_COMBATANT")).toBeGreaterThan(0);
    expect(types.indexOf("COMBAT_CONSEQUENCE")).toBeGreaterThan(types.indexOf("MOVE_COMBATANT"));

    const [encounter, goblin, player, character] = await Promise.all([
      prisma.encounter.findUniqueOrThrow({
        where: { id: fixture.encounterId },
        select: { currentTurnIndex: true, round: true, status: true },
      }),
      prisma.combatant.findUniqueOrThrow({
        where: { id: fixture.goblinId },
        select: { x: true, y: true },
      }),
      prisma.combatant.findUniqueOrThrow({
        where: { id: fixture.playerId },
        select: { hp: true },
      }),
      prisma.character.findUniqueOrThrow({
        where: { id: fixture.created.characterId! },
        select: { hp: true },
      }),
    ]);
    expect(encounter).toEqual({ currentTurnIndex: 0, round: 2, status: "active" });
    // From (5,8) with 30 ft: the adjacent squares on row 6 move least; ties go
    // to the lowest x (spec §5.3).
    expect(goblin).toEqual({ x: 4, y: 6 });
    // One source of truth for the player's HP, mirrored on the Combatant.
    expect(player.hp).toBe(character.hp);

    const systemLogs = await prisma.gameLog.findMany({
      where: { campaignId, role: "system" },
      select: { content: true },
    });
    const contents = systemLogs.map((log) => log.content);
    expect(contents).toContain("Goblin moves 10 ft.");
    expect(contents.filter((content) => content.startsWith("Goblin — Scimitar:"))).toHaveLength(1);
    expect(
      await prisma.gameLog.count({ where: { campaignId, role: "user", content: "End Turn" } }),
    ).toBe(1);
  } finally {
    await cleanupFixture(prisma, fixture);
  }
});

test("@smoke concurrent End Turns: one chain wins and the other is refused", async ({
  request,
}) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();
  const prisma = new PrismaClient();
  let fixture: GoblinFixture | undefined;
  let lock: ReturnType<typeof holdCharacterLock> | undefined;
  try {
    fixture = await createGoblinFixture(request, prisma, {
      goblinAt: { x: 5, y: 6 },
      withProfile: true,
      currentTurnIndex: 0,
    });
    const campaignId = fixture.created.campaignId!;

    // Both requests observe the player's turn, then queue on the finalizer's
    // entry lock. Releasing it lets exactly one chain run; the other then finds
    // its observed turn gone and must write nothing.
    lock = holdCharacterLock(prisma, fixture.created.characterId!);
    await lock.isHeld;
    const first = postAction(request, campaignId, "End Turn");
    const second = postAction(request, campaignId, "End Turn");
    await waitForBlockedCharacterLocks(prisma, 2);
    lock.release();
    await lock.transaction;

    const responses = await Promise.all([first, second]);
    expect(responses.map((r) => r.status()).sort((a, b) => a - b)).toEqual([200, 409]);
    const loser = responses.find((r) => r.status() === 409)!;
    expect(((await loser.json()) as { code?: unknown }).code).toBe("TURN_STATE_CONFLICT");

    expect(
      await prisma.gameLog.count({ where: { campaignId, role: "user", content: "End Turn" } }),
    ).toBe(1);
    expect(
      await prisma.gameLog.count({
        where: { campaignId, role: "system", content: { startsWith: "Goblin — Scimitar:" } },
      }),
    ).toBe(1);
    await expect(
      prisma.encounter.findUniqueOrThrow({
        where: { id: fixture.encounterId },
        select: { currentTurnIndex: true, round: true },
      }),
    ).resolves.toEqual({ currentTurnIndex: 0, round: 2 });
  } finally {
    lock?.release();
    await lock?.transaction.catch(() => undefined);
    await cleanupFixture(prisma, fixture);
  }
});

test("@smoke End Turn racing a rest settles without deadlock and refuses the rest", async ({
  request,
}) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();
  const prisma = new PrismaClient();
  let fixture: GoblinFixture | undefined;
  try {
    fixture = await createGoblinFixture(request, prisma, {
      goblinAt: { x: 5, y: 6 },
      withProfile: true,
      currentTurnIndex: 0,
    });
    const campaignId = fixture.created.campaignId!;

    // Both take the Character lock first — rest to read the character, End Turn
    // at the finalizer's entry — so they serialise in one order and cannot
    // deadlock. A rest is refused while the encounter is active.
    const [endTurn, rest] = await Promise.all([
      postAction(request, campaignId, "End Turn"),
      request.post(`/api/campaign/${campaignId}/rest`, { data: { type: "short" } }),
    ]);

    expect(endTurn.status()).toBe(200);
    expect(rest.status()).toBeGreaterThanOrEqual(400);
    expect(rest.status()).toBeLessThan(500);
  } finally {
    await cleanupFixture(prisma, fixture);
  }
});

test("@smoke End Turn recovers an encounter parked on an enemy slot", async ({ request }) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();
  const prisma = new PrismaClient();
  let fixture: GoblinFixture | undefined;
  try {
    // A pre-column save: the goblin owns the slot and has no attack profile.
    fixture = await createGoblinFixture(request, prisma, {
      goblinAt: { x: 5, y: 6 },
      withProfile: false,
      currentTurnIndex: 1,
    });
    const campaignId = fixture.created.campaignId!;

    const move = await postAction(request, campaignId, "Move", { targetX: 5, targetY: 4 });
    expect(move.status()).toBe(409);
    expect(((await move.json()) as { code?: unknown }).code).toBe("NOT_PLAYER_TURN");

    const endTurn = await postAction(request, campaignId, "End Turn");
    expect(endTurn.status()).toBe(200);

    await expect(
      prisma.encounter.findUniqueOrThrow({
        where: { id: fixture.encounterId },
        select: { currentTurnIndex: true, round: true },
      }),
    ).resolves.toEqual({ currentTurnIndex: 0, round: 2 });
    expect(
      await prisma.gameLog.count({
        where: { campaignId, role: "system", content: { startsWith: "Goblin" } },
      }),
    ).toBe(0);
    expect(
      await prisma.gameLog.count({ where: { campaignId, role: "user", content: "End Turn" } }),
    ).toBe(1);
  } finally {
    await cleanupFixture(prisma, fixture);
  }
});
