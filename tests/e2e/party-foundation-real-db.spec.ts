import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

import {
  assertSafeE2EDatabase,
  cleanupE2ERecords,
  type E2ECreatedRecords,
} from "./support/database";

// Mirrors lib/auth/session.ts's PRIVATE_USER_ID (not exported) — the one
// user every private-mode record in this database is owned by.
const PRIVATE_USER_ID = "00000000-0000-0000-0000-000000000000";

async function createdId(response: {
  status(): number;
  json(): Promise<unknown>;
}): Promise<string> {
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

async function createStandaloneCharacter(
  request: import("@playwright/test").APIRequestContext,
  label: string
): Promise<string> {
  return createdId(
    await request.post("/api/character", {
      data: {
        name: label,
        race: "human",
        class: "cleric",
        stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 14, CHA: 10 },
      },
    })
  );
}

async function deleteStandaloneCharacter(
  prisma: PrismaClient,
  characterId: string | undefined
): Promise<void> {
  if (!characterId) return;
  await prisma.inventoryItem.deleteMany({ where: { characterId } });
  await prisma.character.deleteMany({ where: { id: characterId } });
}

/**
 * Prisma 6.19 reports a Postgres unique-violation's meta.target as the raw
 * column names the index covers (e.g. ["campaignId", "characterId"]), not
 * the constraint/index name — confirmed by running this against the real
 * disposable database. campaignId+characterId and the campaignId-only
 * partial index are distinguishable by that column set alone.
 */
function isUniqueViolation(error: unknown, expectedTargetColumns: string[]): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2002") return false;
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  if (!Array.isArray(target)) return false;
  const actual = [...target].sort();
  const expected = [...expectedTargetColumns].sort();
  return actual.length === expected.length && actual.every((v, i) => v === expected[i]);
}

/**
 * DC-PARTY-001 — the Party membership foundation, proven against real
 * PostgreSQL. Mocks cannot demonstrate a Postgres unique/partial-unique
 * constraint actually exists and fires; these tests create real rows and
 * real violations against the disposable e2e database.
 */
test("campaign creation atomically creates exactly one MAIN PartyMember row", async ({
  request,
}) => {
  test.setTimeout(60_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();
  const unique = randomUUID().slice(0, 8);

  try {
    await createCharacterAndCampaign(request, created, `Party foundation ${unique}`);

    const members = await prisma.partyMember.findMany({
      where: { campaignId: created.campaignId },
    });
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      campaignId: created.campaignId,
      characterId: created.characterId,
      role: "MAIN",
      control: "USER",
    });

    // Invariant 2: Campaign.characterId is untouched by adding party membership.
    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: created.campaignId },
      select: { characterId: true },
    });
    expect(campaign.characterId).toBe(created.characterId);
  } finally {
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});

test("duplicate party membership (same campaign + character) is rejected by the database", async ({
  request,
}) => {
  test.setTimeout(60_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();
  const unique = randomUUID().slice(0, 8);

  try {
    await createCharacterAndCampaign(request, created, `Party dup ${unique}`);

    // Same (campaignId, characterId) pair as the row the route already
    // created — role differs, which proves the constraint is on the pair,
    // not on the full row.
    const error = await prisma.partyMember
      .create({
        data: {
          campaignId: created.campaignId!,
          characterId: created.characterId!,
          role: "COMPANION",
          control: "AI",
        },
      })
      .catch((e: unknown) => e);
    expect(isUniqueViolation(error, ["campaignId", "characterId"])).toBe(true);
  } finally {
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});

test("a second MAIN row for the same campaign is rejected by the database", async ({
  request,
}) => {
  test.setTimeout(60_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();
  const unique = randomUUID().slice(0, 8);
  let secondCharacterId: string | undefined;

  try {
    await createCharacterAndCampaign(request, created, `Party single-main ${unique}`);
    secondCharacterId = await createStandaloneCharacter(request, `Party single-main extra ${unique}`);

    const error = await prisma.partyMember
      .create({
        data: {
          campaignId: created.campaignId!,
          characterId: secondCharacterId,
          role: "MAIN",
          control: "USER",
        },
      })
      .catch((e: unknown) => e);
    expect(isUniqueViolation(error, ["campaignId"])).toBe(true);
  } finally {
    await deleteStandaloneCharacter(prisma, secondCharacterId);
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});

test("control mode can be flipped without touching the Character row (invariant 10)", async ({
  request,
}) => {
  test.setTimeout(60_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();
  const unique = randomUUID().slice(0, 8);

  try {
    await createCharacterAndCampaign(request, created, `Party control-flip ${unique}`);

    const before = await prisma.character.findUniqueOrThrow({
      where: { id: created.characterId },
      select: { revision: true, updatedAt: true },
    });

    const member = await prisma.partyMember.findFirstOrThrow({
      where: { campaignId: created.campaignId },
    });

    await prisma.partyMember.update({ where: { id: member.id }, data: { control: "AI" } });
    await prisma.partyMember.update({ where: { id: member.id }, data: { control: "USER" } });

    const flipped = await prisma.partyMember.findUniqueOrThrow({ where: { id: member.id } });
    expect(flipped.control).toBe("USER");

    const after = await prisma.character.findUniqueOrThrow({
      where: { id: created.characterId },
      select: { revision: true, updatedAt: true },
    });
    expect(after.revision).toBe(before.revision);
    expect(after.updatedAt).toEqual(before.updatedAt);
  } finally {
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});

test("the backfill INSERT is correct and idempotent against a campaign that predates it", async ({
  request: _request,
}) => {
  test.setTimeout(60_000);
  assertSafeE2EDatabase();

  const prisma = new PrismaClient();
  const unique = randomUUID().slice(0, 8);
  let characterId: string | undefined;
  let campaignId: string | undefined;

  try {
    // Created directly via Prisma, bypassing the /api/campaign route, so
    // this campaign starts with zero PartyMember rows — reproducing the
    // pre-migration shape of every historical campaign the real backfill
    // must repair.
    const character = await prisma.character.create({
      data: {
        userId: PRIVATE_USER_ID,
        name: `Party backfill ${unique}`,
        race: "human",
        class: "wizard",
        hp: 8,
        maxHp: 8,
        stats: { STR: 8, DEX: 12, CON: 10, INT: 16, WIS: 10, CHA: 10 },
      },
    });
    characterId = character.id;

    const campaign = await prisma.campaign.create({
      data: { userId: PRIVATE_USER_ID, characterId: character.id, title: `Party backfill ${unique}` },
    });
    campaignId = campaign.id;

    const before = await prisma.partyMember.count({ where: { campaignId } });
    expect(before).toBe(0);

    // Same mechanism as the migration's backfill INSERT (…/20260917130000_
    // add_party_members/migration.sql), scoped to this one campaign so a
    // shared e2e database isn't reprocessed wholesale by this test.
    const backfillSql = `
      INSERT INTO "PartyMember" ("id", "campaignId", "characterId", "role", "control", "createdAt", "updatedAt")
      SELECT gen_random_uuid()::text, "Campaign"."id", "Campaign"."characterId", 'MAIN', 'USER', "Campaign"."createdAt", "Campaign"."createdAt"
      FROM "Campaign"
      WHERE "Campaign"."id" = $1
      ON CONFLICT ("campaignId", "characterId") DO NOTHING;
    `;

    await prisma.$executeRawUnsafe(backfillSql, campaignId);
    const afterFirstRun = await prisma.partyMember.findMany({ where: { campaignId } });
    expect(afterFirstRun).toHaveLength(1);
    expect(afterFirstRun[0]).toMatchObject({ role: "MAIN", control: "USER", characterId: character.id });

    // Idempotency: a retried `prisma migrate deploy` must not fail or duplicate.
    await prisma.$executeRawUnsafe(backfillSql, campaignId);
    const afterSecondRun = await prisma.partyMember.count({ where: { campaignId } });
    expect(afterSecondRun).toBe(1);
  } finally {
    if (campaignId) await prisma.partyMember.deleteMany({ where: { campaignId } });
    if (campaignId) await prisma.campaign.deleteMany({ where: { id: campaignId } });
    await deleteStandaloneCharacter(prisma, characterId);
    await prisma.$disconnect();
  }
});
