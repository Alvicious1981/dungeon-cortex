import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

import {
  assertSafeE2EDatabase,
  cleanupE2ERecords,
  type E2ECreatedRecords,
} from "./support/database";

async function createdId(response: { status(): number; json(): Promise<unknown> }): Promise<string> {
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { id?: unknown };
  expect(typeof body.id).toBe("string");
  return body.id as string;
}

async function createCharacterAndCampaign(
  request: import("@playwright/test").APIRequestContext,
  created: E2ECreatedRecords,
  label: string
): Promise<void> {
  created.characterId = await createdId(
    await request.post("/api/character", {
      data: {
        name: label,
        race: "human",
        class: "fighter",
        stats: { STR: 14, DEX: 12, CON: 14, INT: 10, WIS: 10, CHA: 10 },
      },
    })
  );
  created.campaignId = await createdId(
    await request.post("/api/campaign", {
      data: { characterId: created.characterId, title: label },
    })
  );
}

function isUniqueViolation(error: unknown, expectedTargetColumns: string[]): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2002") return false;
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  if (!Array.isArray(target)) return false;
  const actual = [...target].sort();
  const expected = [...expectedTargetColumns].sort();
  return actual.length === expected.length && actual.every((v, i) => v === expected[i]);
}

const BACKFILL_SQL = `
  UPDATE "Combatant" AS c
  SET "characterId" = camp."characterId"
  FROM "Encounter" AS e
  JOIN "Campaign" AS camp ON camp."id" = e."campaignId"
  WHERE c."encounterId" = e."id"
    AND c."isPlayer" = true
    AND c."characterId" IS NULL
    AND c."id" = $1;
`;

test("the backfill sets characterId from the Encounter->Campaign chain, and is idempotent", async ({
  request,
}) => {
  test.setTimeout(60_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();
  const unique = randomUUID().slice(0, 8);
  let encounterId: string | undefined;

  try {
    await createCharacterAndCampaign(request, created, `Combatant link backfill ${unique}`);

    const encounter = await prisma.encounter.create({
      data: { campaignId: created.campaignId! },
    });
    encounterId = encounter.id;

    // Created directly via Prisma, characterId omitted (null) — reproduces
    // the pre-migration shape the backfill UPDATE must repair.
    const combatant = await prisma.combatant.create({
      data: {
        encounterId: encounter.id,
        name: "Player",
        isPlayer: true,
        hp: 10,
        maxHp: 10,
        initiativeTotal: 15,
        initiativeOrder: 0,
      },
    });
    expect(combatant.characterId).toBeNull();

    await prisma.$executeRawUnsafe(BACKFILL_SQL, combatant.id);
    const afterFirstRun = await prisma.combatant.findUniqueOrThrow({ where: { id: combatant.id } });
    expect(afterFirstRun.characterId).toBe(created.characterId);

    // Idempotency: characterId IS NULL in the WHERE means a retried
    // `prisma migrate deploy` re-running this UPDATE is a no-op, not an error.
    await prisma.$executeRawUnsafe(BACKFILL_SQL, combatant.id);
    const afterSecondRun = await prisma.combatant.findUniqueOrThrow({ where: { id: combatant.id } });
    expect(afterSecondRun.characterId).toBe(created.characterId);
  } finally {
    if (encounterId) await prisma.combatant.deleteMany({ where: { encounterId } });
    if (encounterId) await prisma.encounter.deleteMany({ where: { id: encounterId } });
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});

test("a second isPlayer:true Combatant in the same encounter is rejected by the database", async ({
  request,
}) => {
  test.setTimeout(60_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();
  const unique = randomUUID().slice(0, 8);
  let encounterId: string | undefined;
  let secondCharacterId: string | undefined;

  try {
    await createCharacterAndCampaign(request, created, `Combatant link single-player ${unique}`);

    const encounter = await prisma.encounter.create({
      data: { campaignId: created.campaignId! },
    });
    encounterId = encounter.id;

    await prisma.combatant.create({
      data: {
        encounterId: encounter.id,
        name: "Player",
        isPlayer: true,
        hp: 10,
        maxHp: 10,
        initiativeTotal: 15,
        initiativeOrder: 0,
        characterId: created.characterId,
      },
    });

    secondCharacterId = await createdId(
      await request.post("/api/character", {
        data: {
          name: `Combatant link single-player extra ${unique}`,
          race: "human",
          class: "cleric",
          stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 14, CHA: 10 },
        },
      })
    );

    const error = await prisma.combatant
      .create({
        data: {
          encounterId: encounter.id,
          name: "Second player",
          isPlayer: true,
          hp: 8,
          maxHp: 8,
          initiativeTotal: 10,
          initiativeOrder: 1,
          characterId: secondCharacterId,
        },
      })
      .catch((e: unknown) => e);

    expect(isUniqueViolation(error, ["encounterId"])).toBe(true);
  } finally {
    // Combatant rows first: characterId is now Restrict, so a Combatant
    // referencing secondCharacterId (which exists whenever the constraint
    // under test fails to fire) would block the Character delete below.
    // Same order as the sibling test above.
    if (encounterId) await prisma.combatant.deleteMany({ where: { encounterId } });
    if (encounterId) await prisma.encounter.deleteMany({ where: { id: encounterId } });
    if (secondCharacterId) {
      await prisma.inventoryItem.deleteMany({ where: { characterId: secondCharacterId } });
      await prisma.character.deleteMany({ where: { id: secondCharacterId } });
    }
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});
