import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { profileMonster } from "@/lib/rules/monster-attack-profile";
import {
  assertSafeE2EDatabase,
  cleanupE2ERecords,
  type E2ECreatedRecords,
} from "./support/database";

/**
 * The encounter route is the only writer of Combatant.attackProfile
 * (docs/superpowers/specs/2026-09-15-enemy-turns-design.md §7). CI does not
 * seed the SRD, so this spec brings its own SrdMonster row, built from the same
 * file prisma/seed-srd.ts loads.
 */
const GOBLIN = (
  JSON.parse(
    readFileSync(join(process.cwd(), "data", "srd-es", "monsters.json"), "utf8"),
  ) as Array<Record<string, unknown>>
).find((m) => m.index === "goblin")!;

async function createdId(response: {
  status(): number;
  json(): Promise<unknown>;
}): Promise<string> {
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { id?: unknown };
  expect(typeof body.id).toBe("string");
  return body.id as string;
}

test("@smoke the encounter route snapshots a recognised goblin's attack profile", async ({
  request,
}) => {
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 8);
  const monsterId = `e2e-goblin-${suffix}`;
  let encounterId: string | undefined;

  try {
    await prisma.srdMonster.create({
      data: { id: monsterId, name: "Goblin", indexSlug: monsterId, data: GOBLIN as object },
    });

    created.characterId = await createdId(
      await request.post("/api/character", {
        data: {
          name: `Profile ${suffix}`,
          race: "human",
          class: "fighter",
          stats: { STR: 16, DEX: 14, CON: 14, INT: 10, WIS: 12, CHA: 8 },
        },
      }),
    );
    created.campaignId = await createdId(
      await request.post("/api/campaign", {
        data: { characterId: created.characterId, title: `Profile ${suffix}` },
      }),
    );

    const response = await request.post(`/api/campaign/${created.campaignId}/encounter`, {
      data: {
        enemies: [{ name: "Goblin", hp: 7, maxHp: 7, dexModifier: 2, monsterIndex: monsterId }],
      },
    });
    expect(response.status()).toBe(201);
    encounterId = ((await response.json()) as { id: string }).id;

    const rows = await prisma.combatant.findMany({
      where: { encounterId },
      select: { isPlayer: true, attackProfile: true },
    });
    expect(rows.find((r) => !r.isPlayer)?.attackProfile).toEqual(profileMonster(GOBLIN));
    expect(rows.find((r) => r.isPlayer)?.attackProfile).toBeNull();
  } finally {
    if (encounterId) {
      await prisma.combatant.deleteMany({ where: { encounterId } });
      await prisma.encounter.deleteMany({ where: { id: encounterId } });
    }
    await prisma.srdMonster.deleteMany({ where: { id: monsterId } });
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});
