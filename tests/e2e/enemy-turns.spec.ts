import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { assertSafeE2EDatabase } from "./support/database";
import {
  cleanupFixture,
  createGoblinFixture,
  holdCharacterLock,
  parseSseFrames,
  postAction,
  waitForBlockedCharacterLocks,
  type GoblinFixture,
} from "./support/combat-fixture";

/**
 * Enemy turns on real PostgreSQL
 * (docs/superpowers/specs/2026-09-15-enemy-turns-design.md §9.5). The shared
 * fixture lives in tests/e2e/support/combat-fixture.ts.
 */

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
