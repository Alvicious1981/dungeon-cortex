import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { profileMonster } from "@/lib/rules/monster-attack-profile";
import { assertSafeE2EDatabase, cleanupE2ERecords, type E2ECreatedRecords } from "./support/database";
import { createdId, parseSseFrames, postAction } from "./support/combat-fixture";

/**
 * Area saving-throw attacks (breath weapons) on real PostgreSQL
 * (docs/superpowers/specs/2026-09-16-area-save-actions-design.md §8).
 *
 * A young red dragon (small enough numbers for a smoke test) at full
 * recharge, and a fighter — proficient in DEX? no: STR/CON — so this fixture
 * deliberately uses a class with NO Dexterity proficiency, so the save
 * modifier is exactly the ability modifier and the scenario stays a real
 * coin flip either way; the assertions accept both outcomes.
 */
const YOUNG_RED_DRAGON = (
  JSON.parse(readFileSync(join(process.cwd(), "data", "srd-es", "monsters.json"), "utf8")) as Array<
    Record<string, unknown>
  >
).find((m) => m.index === "young-red-dragon")!;

function types(body: string): string[] {
  return parseSseFrames(body)
    .filter((frame) => frame.t === "evt" && typeof frame.e?.type === "string")
    .map((frame) => frame.e!.type!);
}

async function createDragonFixture(request: import("@playwright/test").APIRequestContext, prisma: PrismaClient) {
  const created: E2ECreatedRecords = {};
  const suffix = randomUUID().slice(0, 8);
  created.characterId = await createdId(
    await request.post("/api/character", {
      data: {
        name: `Breath e2e ${suffix}`, race: "human", class: "fighter",
        stats: { STR: 16, DEX: 12, CON: 14, INT: 10, WIS: 12, CHA: 8 },
      },
    }),
  );
  created.campaignId = await createdId(
    await request.post("/api/campaign", {
      data: { characterId: created.characterId, title: `Breath e2e ${suffix}` },
    }),
  );
  await prisma.character.update({ where: { id: created.characterId }, data: { hp: 200, maxHp: 200 } });

  const profile = profileMonster(YOUNG_RED_DRAGON);
  expect(profile?.areaSaveAttack).not.toBeNull();

  const encounter = await prisma.encounter.create({
    data: {
      campaignId: created.campaignId, status: "active", round: 1,
      currentTurnIndex: 0, currentTurnMovementSpentFt: 0,
      currentTurnObjectInteractionUsed: false, totalDamageDealt: 0,
      combatants: {
        create: [
          {
            name: "Breath E2E Hero", isPlayer: true, hp: 200, maxHp: 200, ac: 16,
            characterId: created.characterId,
            initiativeTotal: 20, initiativeOrder: 0,
            stats: { STR: 16, DEX: 12, CON: 14, INT: 10, WIS: 12, CHA: 8 },
            conditions: [], x: 5, y: 5,
          },
          {
            name: "Young Red Dragon", isPlayer: false, hp: 88, maxHp: 88, ac: 18,
            initiativeTotal: 10, initiativeOrder: 1,
            stats: { STR: 19, DEX: 10, CON: 21, INT: 10, WIS: 11, CHA: 15 },
            conditions: [], size: "Large", x: 5, y: 6,
            attackProfile: profile as unknown as Prisma.InputJsonValue,
            breathAvailable: true,
          },
        ],
      },
    },
    include: { combatants: true },
  });

  return {
    created, encounterId: encounter.id,
    playerId: encounter.combatants.find((c) => c.isPlayer)!.id,
    dragonId: encounter.combatants.find((c) => !c.isPlayer)!.id,
  };
}

async function cleanup(prisma: PrismaClient, fixture: Awaited<ReturnType<typeof createDragonFixture>> | undefined) {
  if (fixture) {
    await prisma.combatant.deleteMany({ where: { encounterId: fixture.encounterId } });
    await prisma.encounter.deleteMany({ where: { id: fixture.encounterId } });
  }
  await prisma.$disconnect();
  if (fixture) await cleanupE2ERecords(fixture.created);
}

test("@smoke a charged dragon breathes instead of biting, on real PostgreSQL", async ({ request }) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();
  const prisma = new PrismaClient();
  let fixture: Awaited<ReturnType<typeof createDragonFixture>> | undefined;
  try {
    fixture = await createDragonFixture(request, prisma);
    const campaignId = fixture.created.campaignId!;

    const res = await postAction(request, campaignId, "End Turn");
    expect(res.status()).toBe(200);
    const events = types(await res.text());
    expect(events).toContain("COMBAT_CONSEQUENCE");

    const logs = await prisma.gameLog.findMany({
      where: { campaignId, role: "system", content: { contains: "Fire Breath" } },
      select: { content: true },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.content).toMatch(/DC \d+ Dexterity save, .+ rolls \d+ — (fails|succeeds), \d+ fire damage\./);
    // Whichever way the save went, the breath is now spent.
    await expect(
      prisma.combatant.findUniqueOrThrow({ where: { id: fixture.dragonId }, select: { breathAvailable: true } }),
    ).resolves.toEqual({ breathAvailable: false });
    // Never the plain weapon-attack log line — the dragon did not bite this turn.
    expect(
      await prisma.gameLog.count({
        where: { campaignId, role: "system", content: { contains: "vs AC" } },
      }),
    ).toBe(0);
  } finally {
    await cleanup(prisma, fixture);
  }
});

test("@smoke a spent breath recharges or stays spent, and either way the dragon still acts", async ({ request }) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();
  const prisma = new PrismaClient();
  let fixture: Awaited<ReturnType<typeof createDragonFixture>> | undefined;
  try {
    fixture = await createDragonFixture(request, prisma);
    await prisma.combatant.update({ where: { id: fixture.dragonId }, data: { breathAvailable: false } });

    const res = await postAction(request, fixture.created.campaignId!, "End Turn");
    expect(res.status()).toBe(200);

    const logs = await prisma.gameLog.findMany({
      where: { campaignId: fixture.created.campaignId!, role: "system" },
      orderBy: { createdAt: "asc" }, select: { content: true },
    });
    const recharge = logs.find((l) => l.content.includes("recharge"));
    expect(recharge).toBeDefined();
    expect(recharge!.content).toMatch(/^Young Red Dragon (recharges|fails to recharge) its Fire Breath \(\d\)\.$/);

    // Whichever way the recharge roll went, the dragon still acted this turn
    // (breathed if it recharged, bit otherwise) — the turn always advances.
    await expect(
      prisma.encounter.findUniqueOrThrow({ where: { id: fixture.encounterId }, select: { currentTurnIndex: true } }),
    ).resolves.toEqual({ currentTurnIndex: 0 });
  } finally {
    await cleanup(prisma, fixture);
  }
});
