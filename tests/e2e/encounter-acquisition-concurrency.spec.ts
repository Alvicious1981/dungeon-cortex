import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { spawnCombatEncounter } from "../../lib/rules/encounter-service";
import type { Monster } from "../../lib/rules/srd";
import {
  assertSafeE2EDatabase,
  cleanupE2ERecords,
  type E2ECreatedRecords,
} from "./support/database";

type EncounterDb = NonNullable<
  Parameters<typeof spawnCombatEncounter>[0]["db"]
>;

const wolf: Monster = {
  index: "wolf",
  name: "Wolf",
  hit_points: 11,
  armor_class: [{ type: "natural", value: 13 }],
  type: "beast",
  challenge_rating: 0.25,
  dexterity: 12,
  xp: 50,
};

async function createdId(response: {
  status(): number;
  json(): Promise<unknown>;
}): Promise<string> {
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { id?: unknown };
  expect(typeof body.id).toBe("string");
  return body.id as string;
}

function buildBarrierDb(
  prisma: PrismaClient,
  onEmptyEncounterRead: () => Promise<void>
): EncounterDb {
  return {
    campaign: {
      findUnique: (args: unknown) =>
        prisma.campaign.findUnique(args as Prisma.CampaignFindUniqueArgs),
    },
    encounter: {
      findFirst: async (args: unknown) => {
        const result = await prisma.encounter.findFirst(
          args as Prisma.EncounterFindFirstArgs
        );

        if (result === null) {
          await onEmptyEncounterRead();
        }

        return result;
      },
      create: (args: unknown) =>
        prisma.encounter.create(args as Prisma.EncounterCreateArgs),
    },
  } as unknown as EncounterDb;
}

test("@smoke concurrent encounter acquisition leaves at most one active encounter", async ({
  request,
}) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();

  let emptyReadCount = 0;
  let releaseBothReaders!: () => void;
  const bothReadersArrived = new Promise<void>((resolve) => {
    releaseBothReaders = resolve;
  });

  const waitForPeerAfterEmptyRead = async (): Promise<void> => {
    emptyReadCount += 1;
    if (emptyReadCount === 2) {
      releaseBothReaders();
    }
    await bothReadersArrived;
  };

  try {
    created.characterId = await createdId(
      await request.post("/api/character", {
        data: {
          name: `Encounter race ${randomUUID().slice(0, 8)}`,
          race: "human",
          class: "fighter",
          stats: { STR: 16, DEX: 14, CON: 14, INT: 10, WIS: 10, CHA: 8 },
        },
      })
    );

    created.campaignId = await createdId(
      await request.post("/api/campaign", {
        data: {
          characterId: created.characterId,
          title: `Encounter race ${randomUUID().slice(0, 8)}`,
        },
      })
    );

    expect(
      await prisma.encounter.count({
        where: { campaignId: created.campaignId, status: "active" },
      })
    ).toBe(0);

    const db = buildBarrierDb(prisma, waitForPeerAfterEmptyRead);
    const queryMonsters = async (): Promise<Monster[]> => [wolf];

    const attempts = await Promise.all([
      spawnCombatEncounter({
        campaignId: created.campaignId,
        targetCR: 0.25,
        theme: "beast",
        db,
        queryMonsters,
      }),
      spawnCombatEncounter({
        campaignId: created.campaignId,
        targetCR: 0.25,
        theme: "beast",
        db,
        queryMonsters,
      }),
    ]);

    const successfulAttempts = attempts.filter(
      (result) => "ok" in result && result.ok === true
    ).length;
    const activeEncounterCount = await prisma.encounter.count({
      where: { campaignId: created.campaignId, status: "active" },
    });

    // Contract under audit: one campaign has one acquisition winner. The loser
    // must observe or lose an atomic claim; two successful writers must never
    // leave two independently active initiative authorities.
    expect.soft(successfulAttempts).toBe(1);
    expect(activeEncounterCount).toBe(1);
  } finally {
    releaseBothReaders();

    if (created.campaignId) {
      const encounters = await prisma.encounter.findMany({
        where: { campaignId: created.campaignId },
        select: { id: true },
      });
      const encounterIds = encounters.map((encounter) => encounter.id);

      if (encounterIds.length > 0) {
        await prisma.combatant.deleteMany({
          where: { encounterId: { in: encounterIds } },
        });
        await prisma.encounter.deleteMany({
          where: { id: { in: encounterIds } },
        });
      }
    }

    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});
