import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

import {
  assertSafeE2EDatabase,
  cleanupE2ERecords,
  type E2ECreatedRecords,
} from "./support/database";

async function createdId(response: {
  status(): number;
  json(): Promise<unknown>;
}): Promise<string> {
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { id?: unknown };
  expect(typeof body.id).toBe("string");
  return body.id as string;
}

test("@smoke equal initiative totals keep one deterministic active combatant", async ({
  page,
  request,
}) => {
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 8);
  const playerId = `tie-player-z-${suffix}`;
  const enemyId = `tie-enemy-a-${suffix}`;
  let encounterId: string | undefined;

  try {
    created.characterId = await createdId(
      await request.post("/api/character", {
        data: {
          name: `Tie authority ${suffix}`,
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
          title: `Tie authority ${suffix}`,
        },
      })
    );

    const encounter = await prisma.encounter.create({
      data: {
        campaignId: created.campaignId,
        status: "active",
        round: 1,
        currentTurnIndex: 0,
        combatants: {
          create: [
            {
              id: playerId,
              name: "Tie Player",
              isPlayer: true,
              hp: 20,
              maxHp: 20,
              ac: 16,
              initiativeTotal: 15,
              initiativeOrder: 1,
              x: 0,
              y: 0,
            },
            {
              id: enemyId,
              name: "Tie Enemy",
              isPlayer: false,
              hp: 10,
              maxHp: 10,
              ac: 12,
              initiativeTotal: 15,
              initiativeOrder: 0,
              x: 2,
              y: 2,
            },
          ],
        },
      },
    });
    encounterId = encounter.id;

    const beforeUserLogs = await prisma.gameLog.count({
      where: { campaignId: created.campaignId, role: "user" },
    });

    // The player row was inserted first, but persisted initiativeOrder makes
    // the enemy own currentTurnIndex=0. Exercise the real context reader and
    // action gate repeatedly; this test deliberately does not import the
    // production ordering constant or resolver.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request.post(
        `/api/campaign/${created.campaignId}/action`,
        {
          data: { action: "Move", targetX: 1, targetY: 0 },
        },
      );
      expect(response.status()).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        code: "NOT_PLAYER_TURN",
      });
    }

    const after = await prisma.encounter.findUniqueOrThrow({
      where: { id: encounter.id },
      include: { combatants: true },
    });
    expect(after.currentTurnIndex).toBe(0);
    expect(after.round).toBe(1);
    expect(after.combatants.find((combatant) => combatant.id === playerId)).toMatchObject({
      x: 0,
      y: 0,
    });
    expect(
      await prisma.gameLog.count({
        where: { campaignId: created.campaignId, role: "user" },
      }),
    ).toBe(beforeUserLogs);

    await page.goto(`/campaign/${created.campaignId}`);
    const initiative = page.getByRole("region", { name: "Orden de iniciativa" });
    const entries = initiative.getByRole("listitem");
    await expect(entries.nth(0)).toContainText("Tie Enemy");
    await expect(entries.nth(0)).toHaveAttribute("aria-current", "true");
    await expect(entries.nth(1)).toContainText("Tie Player");
  } finally {
    if (encounterId) {
      await prisma.combatant.deleteMany({ where: { encounterId } });
      await prisma.encounter.deleteMany({ where: { id: encounterId } });
    }
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});
