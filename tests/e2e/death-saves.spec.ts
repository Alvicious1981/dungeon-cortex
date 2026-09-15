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
 * Death saves on real PostgreSQL
 * (docs/superpowers/specs/2026-09-15-death-saves-design.md §10.5). Dice cannot
 * be fixed here, so every scenario is either set up to be deterministic or
 * asserts what holds for any roll.
 */

function types(body: string): string[] {
  return parseSseFrames(body)
    .filter((frame) => frame.t === "evt" && typeof frame.e?.type === "string")
    .map((frame) => frame.e!.type!);
}

test("@smoke a dying player's death save runs the chain and no enemy strikes", async ({
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
      player: { hp: 0 },
    });
    const campaignId = fixture.created.campaignId!;

    const res = await postAction(request, campaignId, "Death Save");
    expect(res.status()).toBe(200);
    expect(types(await res.text())).toContain("DEATH_SAVE_ROLLED");
    // An adjacent, profiled goblin holds against a downed player.
    expect(
      await prisma.gameLog.count({
        where: { campaignId, role: "system", content: { startsWith: "Goblin —" } },
      }),
    ).toBe(0);
  } finally {
    await cleanupFixture(prisma, fixture);
  }
});

test("@smoke a terminal death save lands in exactly one consistent state", async ({
  request,
}) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();
  const prisma = new PrismaClient();
  let fixture: GoblinFixture | undefined;
  try {
    // Two successes and two failures: any d20 ends it.
    fixture = await createGoblinFixture(request, prisma, {
      goblinAt: { x: 5, y: 6 },
      withProfile: true,
      currentTurnIndex: 0,
      player: { hp: 0, deathSaveSuccesses: 2, deathSaveFailures: 2 },
    });
    const res = await postAction(request, fixture.created.campaignId!, "Death Save");
    expect(res.status()).toBe(200);
    const events = types(await res.text());

    const [player, encounter] = await Promise.all([
      prisma.combatant.findUniqueOrThrow({ where: { id: fixture.playerId } }),
      prisma.encounter.findUniqueOrThrow({ where: { id: fixture.encounterId } }),
    ]);
    if (events.includes("PLAYER_REVIVED")) {
      expect(player).toMatchObject({
        hp: 1, deathSaveSuccesses: 0, deathSaveFailures: 0, stableWakeRound: null,
      });
      expect(encounter.status).toBe("active");
    } else if (events.includes("PLAYER_STABILIZED")) {
      expect(player).toMatchObject({ hp: 0, deathSaveSuccesses: 3 });
      expect(player.stableWakeRound).toBeGreaterThanOrEqual(2);
      expect(encounter.status).toBe("active");
    } else {
      expect(events).toContain("PLAYER_DIED");
      expect(player.deathSaveFailures).toBe(3);
      expect(encounter.status).toBe("resolved");
    }
  } finally {
    await cleanupFixture(prisma, fixture);
  }
});

test("@smoke concurrent death saves roll once", async ({ request }) => {
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
      player: { hp: 0 },
    });
    const campaignId = fixture.created.campaignId!;

    // Both saves queue on the Character lock; once released, exactly one owns
    // the turn and the other must write nothing.
    lock = holdCharacterLock(prisma, fixture.created.characterId!);
    await lock.isHeld;
    const first = postAction(request, campaignId, "Death Save");
    const second = postAction(request, campaignId, "Death Save");
    await waitForBlockedCharacterLocks(prisma, 2);
    lock.release();
    await lock.transaction;

    const statuses = (await Promise.all([first, second])).map((r) => r.status()).sort();
    expect(statuses).toEqual([200, 409]);
    expect(
      await prisma.gameLog.count({
        where: { campaignId, role: "system", content: { startsWith: "Death save:" } },
      }),
    ).toBe(1);
  } finally {
    lock?.release();
    await lock?.transaction.catch(() => undefined);
    await cleanupFixture(prisma, fixture);
  }
});

test("@smoke Wait wakes a stable player on the scheduled round", async ({ request }) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();
  const prisma = new PrismaClient();
  let fixture: GoblinFixture | undefined;
  try {
    // The chain wraps into round 2, the scheduled wake round.
    fixture = await createGoblinFixture(request, prisma, {
      goblinAt: { x: 5, y: 6 },
      withProfile: true,
      currentTurnIndex: 0,
      player: { hp: 0, deathSaveSuccesses: 3, stableWakeRound: 2 },
    });
    const res = await postAction(request, fixture.created.campaignId!, "Wait");
    expect(res.status()).toBe(200);
    expect(types(await res.text())).toContain("PLAYER_WOKE");
    await expect(
      prisma.character.findUniqueOrThrow({
        where: { id: fixture.created.characterId! },
        select: { hp: true },
      }),
    ).resolves.toEqual({ hp: 1 });
  } finally {
    await cleanupFixture(prisma, fixture);
  }
});

test("@smoke PostgreSQL rejects an impossible death-save counter", async ({ request }) => {
  test.setTimeout(60_000);
  assertSafeE2EDatabase();
  const prisma = new PrismaClient();
  let fixture: GoblinFixture | undefined;
  try {
    fixture = await createGoblinFixture(request, prisma, {
      goblinAt: { x: 5, y: 6 },
      withProfile: false,
      currentTurnIndex: 0,
    });
    await expect(
      prisma.combatant.update({ where: { id: fixture.playerId }, data: { deathSaveFailures: 4 } }),
    ).rejects.toThrow(/Combatant_deathSaveFailures_range|check constraint/i);
  } finally {
    await cleanupFixture(prisma, fixture);
  }
});
