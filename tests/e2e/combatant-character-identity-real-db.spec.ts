import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

/**
 * A CHECK violation (SQLSTATE 23514) on the named constraint. Observed
 * empirically: Prisma 6.19.2 has no known-error code for it, so it surfaces as
 * PrismaClientUnknownRequestError — no `code`, no `meta` — whose message embeds
 * the Postgres error debug-formatted, inner quotes escaped:
 *   PostgresError { code: "23514", message: "new row for relation \"Combatant\"
 *   violates check constraint \"<name>\"", ... }
 * The full phrase is matched, not the bare name: the same message also quotes
 * the calling source lines, so a comment naming the constraint would satisfy a
 * bare-name match for any error at all.
 */
function isCheckViolation(error: unknown, constraint: string): boolean {
  if (!(error instanceof Prisma.PrismaClientUnknownRequestError)) return false;
  return (
    error.message.includes('code: "23514"') &&
    error.message.includes(`violates check constraint \\"${constraint}\\"`)
  );
}

/**
 * The same SQLSTATE 23514, raised by a raw statement (here, ADD CONSTRAINT
 * validating existing rows). Prisma reports a failed raw query as P2010 and
 * carries the Postgres code and message in `meta`.
 */
function isRawCheckViolation(error: unknown, constraint: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2010") return false;
  const meta = error.meta as { code?: unknown; message?: unknown } | undefined;
  return meta?.code === "23514" && String(meta.message).includes(`check constraint "${constraint}"`);
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return `not an Error: ${String(error)}`;
  const { code, meta } = error as { code?: unknown; meta?: unknown };
  return `${error.constructor.name} code=${String(code)} meta=${JSON.stringify(meta)} message=${error.message}`;
}

const MIGRATION_SQL = readFileSync(
  join(
    process.cwd(),
    "prisma",
    "migrations",
    "20260917140000_add_combatant_character_link",
    "migration.sql"
  ),
  "utf8"
);

/**
 * One statement exactly as the migration writes it, read from the file rather
 * than hand-copied, so this spec cannot drift from what `migrate deploy` runs.
 */
function migrationStatement(pattern: RegExp): string {
  const statement = MIGRATION_SQL.match(pattern)?.[0];
  if (!statement) throw new Error(`Statement not found in the migration: ${pattern}`);
  return statement;
}

const BACKFILL_SQL = migrationStatement(/UPDATE "Combatant" AS c\b[\s\S]*?;/);
const PLAYER_LINK_CHECK_SQL = migrationStatement(
  /ALTER TABLE "Combatant"\s+ADD CONSTRAINT "Combatant_player_has_character_id"[\s\S]*?;/
);

interface BackfillObservation {
  before: { player: string | null; enemy: string | null };
  /** What adding the CHECK threw before the backfill ran; null if it did not throw. */
  checkBeforeBackfill: unknown;
  firstRun: number;
  afterFirst: { player: string | null; enemy: string | null };
  secondRun: number;
  afterSecond: { player: string | null; enemy: string | null };
}

/** Ends the backfill proof's transaction in a rollback, carrying what it saw. */
class BackfillProofRolledBack extends Error {
  constructor(readonly observed: BackfillObservation) {
    super("The backfill proof always rolls back.");
  }
}

test("the migration's own backfill links the player row, leaves the enemy row NULL, is idempotent, and must precede the CHECK", async ({
  request,
}) => {
  test.setTimeout(60_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();
  const unique = randomUUID().slice(0, 8);

  try {
    await createCharacterAndCampaign(request, created, `Combatant link backfill ${unique}`);

    const observed = await prisma
      .$transaction(
        async (tx) => {
          // The schema as the migration's backfill meets it: the column exists,
          // but Combatant_player_has_character_id — added after the backfill —
          // does not yet, so a pre-migration player row can still be built.
          // Postgres DDL is transactional and this transaction always rolls
          // back, so the constraint cannot be left dropped: not by a failed
          // assertion, and not by this process dying mid-test (the server
          // aborts the transaction when the connection closes).
          await tx.$executeRawUnsafe(
            'ALTER TABLE "Combatant" DROP CONSTRAINT "Combatant_player_has_character_id"'
          );

          const encounter = await tx.encounter.create({
            data: { campaignId: created.campaignId! },
          });
          // Pre-migration shape: neither row carries a characterId.
          const shared = { encounterId: encounter.id, hp: 10, maxHp: 10, initiativeTotal: 15 };
          const player = await tx.combatant.create({
            data: { ...shared, name: "Player", isPlayer: true, initiativeOrder: 0 },
          });
          const enemy = await tx.combatant.create({
            data: { ...shared, name: "Goblin", isPlayer: false, initiativeOrder: 1 },
          });
          const links = async () => ({
            player: (await tx.combatant.findUniqueOrThrow({ where: { id: player.id } })).characterId,
            enemy: (await tx.combatant.findUniqueOrThrow({ where: { id: enemy.id } })).characterId,
          });
          const before = await links();

          // Why the migration adds the CHECK after the backfill (design spec
          // §3): Postgres validates a new CHECK against every existing row, so
          // added now it meets this still-unlinked player row and fails — in
          // `migrate deploy`, failing the whole migration.
          await tx.$executeRawUnsafe("SAVEPOINT check_before_backfill");
          const checkBeforeBackfill = await tx
            .$executeRawUnsafe(PLAYER_LINK_CHECK_SQL)
            .then(
              () => null,
              (error: unknown) => error
            );
          await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT check_before_backfill");

          // Unscoped, exactly as the migration runs it. Every committed player
          // row already satisfies the CHECK, so this row is the only one the
          // UPDATE can fill.
          const firstRun = await tx.$executeRawUnsafe(BACKFILL_SQL);
          const afterFirst = await links();

          // A retried `migrate deploy` re-runs the UPDATE: characterId IS NULL
          // in its WHERE makes that a no-op, not an error.
          const secondRun = await tx.$executeRawUnsafe(BACKFILL_SQL);
          const afterSecond = await links();

          // The migration's next statement. Postgres validates it against every
          // row, so getting past this line proves the backfill left no player
          // row unlinked.
          await tx.$executeRawUnsafe(PLAYER_LINK_CHECK_SQL);

          throw new BackfillProofRolledBack({
            before,
            checkBeforeBackfill,
            firstRun,
            afterFirst,
            secondRun,
            afterSecond,
          });
        },
        { maxWait: 10_000, timeout: 30_000 }
      )
      .then(
        (): BackfillObservation => {
          throw new Error("The backfill proof transaction must never commit.");
        },
        (error: unknown): BackfillObservation => {
          if (error instanceof BackfillProofRolledBack) return error.observed;
          throw error;
        }
      );

    expect(observed.before).toEqual({ player: null, enemy: null });
    expect(
      isRawCheckViolation(observed.checkBeforeBackfill, "Combatant_player_has_character_id"),
      describeError(observed.checkBeforeBackfill)
    ).toBe(true);
    expect(observed.firstRun).toBe(1);
    expect(observed.afterFirst).toEqual({ player: created.characterId, enemy: null });
    expect(observed.secondRun).toBe(0);
    expect(observed.afterSecond).toEqual({ player: created.characterId, enemy: null });

    // The rollback restored the constraint and kept none of the proof's rows.
    const constraint = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM pg_constraint
      WHERE conname = 'Combatant_player_has_character_id'
    `;
    expect(Number(constraint[0]?.count ?? 0)).toBe(1);
    expect(await prisma.encounter.count({ where: { campaignId: created.campaignId! } })).toBe(0);
  } finally {
    // Only reachable with rows if the proof transaction wrongly committed;
    // without this, that failure would also leave the campaign undeletable.
    if (created.campaignId) {
      const campaignId = created.campaignId;
      await prisma.combatant.deleteMany({ where: { encounter: { campaignId } } });
      await prisma.encounter.deleteMany({ where: { campaignId } });
    }
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

test("one encounter cannot link the same characterId twice, while unlinked enemies and later encounters are unconstrained", async ({
  request,
}) => {
  test.setTimeout(60_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();
  const unique = randomUUID().slice(0, 8);
  const encounterIds: string[] = [];

  try {
    await createCharacterAndCampaign(request, created, `Combatant link pair ${unique}`);

    const encounter = await prisma.encounter.create({
      data: { campaignId: created.campaignId! },
    });
    encounterIds.push(encounter.id);
    const shared = { encounterId: encounter.id, hp: 10, maxHp: 10, initiativeTotal: 15 };

    await prisma.combatant.create({
      data: {
        ...shared,
        name: "Player",
        isPlayer: true,
        initiativeOrder: 0,
        characterId: created.characterId,
      },
    });
    // NULLs are distinct in a Postgres unique index: unlinked enemies never collide.
    await prisma.combatant.create({
      data: { ...shared, name: "Goblin A", isPlayer: false, initiativeOrder: 1 },
    });
    await prisma.combatant.create({
      data: { ...shared, name: "Goblin B", isPlayer: false, initiativeOrder: 2 },
    });

    // A second row linked to the same Character. isPlayer:false, so neither
    // Combatant_one_player_per_encounter_key nor the CHECK can see it — the
    // shape a future companion path could produce by mistake, which would
    // make the player's (encounterId, characterId)-scoped writes hit two rows.
    const duplicate = await prisma.combatant
      .create({
        data: {
          ...shared,
          name: "Same character again",
          isPlayer: false,
          initiativeOrder: 3,
          characterId: created.characterId,
        },
      })
      .catch((e: unknown) => e);
    expect(isUniqueViolation(duplicate, ["encounterId", "characterId"]), describeError(duplicate)).toBe(
      true
    );
    expect(await prisma.combatant.count({ where: { encounterId: encounter.id } })).toBe(3);

    // The pair is per encounter: the same Character is linked again in its
    // next one (resolved here, since a campaign has at most one active).
    const later = await prisma.encounter.create({
      data: { campaignId: created.campaignId!, status: "resolved" },
    });
    encounterIds.push(later.id);
    await prisma.combatant.create({
      data: {
        encounterId: later.id,
        name: "Player",
        isPlayer: true,
        hp: 10,
        maxHp: 10,
        initiativeTotal: 15,
        initiativeOrder: 0,
        characterId: created.characterId,
      },
    });
    expect(await prisma.combatant.count({ where: { characterId: created.characterId } })).toBe(2);
  } finally {
    await prisma.combatant.deleteMany({ where: { encounterId: { in: encounterIds } } });
    await prisma.encounter.deleteMany({ where: { id: { in: encounterIds } } });
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});

test("an isPlayer:true Combatant without a characterId is rejected by the database", async ({
  request,
}) => {
  test.setTimeout(60_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();
  const unique = randomUUID().slice(0, 8);
  let encounterId: string | undefined;

  try {
    await createCharacterAndCampaign(request, created, `Combatant link required ${unique}`);

    const encounter = await prisma.encounter.create({
      data: { campaignId: created.campaignId! },
    });
    encounterId = encounter.id;
    const shared = { encounterId: encounter.id, hp: 10, maxHp: 10, initiativeTotal: 15 };

    // The shape a creation path that forgets the link would write. Before
    // Combatant_player_has_character_id it inserted fine, and every player
    // write scoped by characterId then silently matched zero rows.
    const unlinked = await prisma.combatant
      .create({ data: { ...shared, name: "Unlinked player", isPlayer: true, initiativeOrder: 0 } })
      .catch((e: unknown) => e);
    expect(isCheckViolation(unlinked, "Combatant_player_has_character_id"), describeError(unlinked)).toBe(
      true
    );
    expect(await prisma.combatant.count({ where: { encounterId: encounter.id } })).toBe(0);

    // The constraint targets only the missing link: the linked player and an
    // enemy without any characterId both insert.
    const player = await prisma.combatant.create({
      data: {
        ...shared,
        name: "Linked player",
        isPlayer: true,
        initiativeOrder: 0,
        characterId: created.characterId,
      },
    });
    await prisma.combatant.create({
      data: { ...shared, name: "Goblin", isPlayer: false, initiativeOrder: 1 },
    });
    expect(await prisma.combatant.count({ where: { encounterId: encounter.id } })).toBe(2);

    // A later write cannot unlink the player either.
    const cleared = await prisma.combatant
      .update({ where: { id: player.id }, data: { characterId: null } })
      .catch((e: unknown) => e);
    expect(isCheckViolation(cleared, "Combatant_player_has_character_id"), describeError(cleared)).toBe(
      true
    );
    const stored = await prisma.combatant.findUniqueOrThrow({ where: { id: player.id } });
    expect(stored.characterId).toBe(created.characterId);
  } finally {
    if (encounterId) await prisma.combatant.deleteMany({ where: { encounterId } });
    if (encounterId) await prisma.encounter.deleteMany({ where: { id: encounterId } });
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});
