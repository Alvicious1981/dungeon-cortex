import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { resolveRest } from "../../lib/rules/rest-service";
import {
  assertSafeE2EDatabase,
  cleanupE2ERecords,
  type E2ECreatedRecords,
} from "./support/database";

type RestTx = NonNullable<Parameters<typeof resolveRest>[0]["tx"]>;
type RestResult = Awaited<ReturnType<typeof resolveRest>>;

async function createdId(response: {
  status(): number;
  json(): Promise<unknown>;
}): Promise<string> {
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { id?: unknown };
  expect(typeof body.id).toBe("string");
  return body.id as string;
}

/** Sessions PostgreSQL reports as blocked on a lock while touching Character. */
async function characterLockWaiters(prisma: PrismaClient): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ waiting: bigint }>>`
    SELECT count(*) AS waiting
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND wait_event_type = 'Lock'
      AND query ILIKE '%"Character"%'
  `;
  return Number(rows[0]?.waiting ?? 0);
}

async function waitUntil(
  condition: () => Promise<boolean> | boolean,
  timeoutMs: number,
  label: string
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${label}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * DC-AUD-024 — regression for the stale-write risk that #143 left open.
 *
 * #143 stopped a short rest that spends no Hit Die from writing its snapshot
 * back. A short rest that DOES heal still computes `hp` and `hitDiceRemaining`
 * as absolute values from an unlocked read and writes them by id, so a long
 * rest that commits between that read and that write is silently erased.
 *
 * The short rest reads the character and pauses. A real long rest is then
 * started without being awaited, and the short rest is released as soon as the
 * long rest has either committed (no row lock: the race this test exposes) or
 * is observed waiting on a Character lock (a serialising fix). Awaiting the
 * long rest before releasing would deadlock the test once such a lock exists.
 *
 * The invariant is serialisability: the final row must be what one of the two
 * committed rests would leave after the other, never a mix of both.
 */
test("@smoke a healing short rest cannot overwrite a concurrent long-rest recovery", async ({
  request,
}) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();

  let characterRead!: () => void;
  const characterWasRead = new Promise<void>((resolve) => {
    characterRead = resolve;
  });

  let resumeShortRest!: () => void;
  const shortRestReleased = new Promise<void>((resolve) => {
    resumeShortRest = resolve;
  });

  let shortRest: Promise<RestResult> | undefined;
  let longRest: Promise<RestResult> | undefined;

  try {
    created.characterId = await createdId(
      await request.post("/api/character", {
        data: {
          name: `Rest heal race ${randomUUID().slice(0, 8)}`,
          race: "human",
          class: "fighter",
          stats: { STR: 14, DEX: 12, CON: 14, INT: 10, WIS: 10, CHA: 10 },
        },
      })
    );

    created.campaignId = await createdId(
      await request.post("/api/campaign", {
        data: {
          characterId: created.characterId,
          title: `Rest heal race ${randomUUID().slice(0, 8)}`,
        },
      })
    );

    // Wounded with one Hit Die left, so an implicit short rest really heals.
    // A level-2 fighter recovers one Hit Die on a long rest, and the long rest
    // also reduces exhaustion — a field the short rest never writes.
    await prisma.character.update({
      where: { id: created.characterId },
      data: {
        level: 2,
        hp: 5,
        maxHp: 20,
        hitDiceTotal: 2,
        hitDiceRemaining: 1,
        exhaustionLevel: 1,
      },
    });

    shortRest = prisma.$transaction(
      async (realTx) => {
        const instrumentedTx = {
          // Passed through so a fix that locks the row can take its lock in
          // this real transaction instead of silently skipping it.
          $queryRaw: (query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) =>
            realTx.$queryRaw(query as TemplateStringsArray, ...values),
          campaign: {
            findUnique: (args: unknown) =>
              realTx.campaign.findUnique(args as Prisma.CampaignFindUniqueArgs),
          },
          character: {
            findUnique: async (args: unknown) => {
              const row = await realTx.character.findUnique(
                args as Prisma.CharacterFindUniqueArgs
              );
              characterRead();
              await shortRestReleased;
              return row;
            },
            update: (args: unknown) =>
              realTx.character.update(args as Prisma.CharacterUpdateArgs),
          },
          encounter: {
            findFirst: (args: unknown) =>
              realTx.encounter.findFirst(args as Prisma.EncounterFindFirstArgs),
          },
        } as unknown as RestTx;

        return resolveRest({
          campaignId: created.campaignId!,
          characterId: created.characterId!,
          restType: "short",
          // 1d10 reads 5; with CON +2 the short rest heals 7 (5 -> 12).
          roll: () => ({ total: 5 }),
          tx: instrumentedTx,
        });
      },
      { maxWait: 10_000, timeout: 60_000 }
    );

    // The short rest now holds hp=5, hitDiceRemaining=1 from PostgreSQL.
    await characterWasRead;

    let longRestSettled = false;
    longRest = resolveRest({
      campaignId: created.campaignId,
      characterId: created.characterId,
      restType: "long",
    });
    longRest.then(
      () => {
        longRestSettled = true;
      },
      () => {
        longRestSettled = true;
      }
    );

    await waitUntil(
      async () => longRestSettled || (await characterLockWaiters(prisma)) > 0,
      15_000,
      "the long rest to commit or to wait on the short rest's lock"
    );

    resumeShortRest();
    const [shortResult] = await Promise.all([shortRest, longRest]);

    // The short rest ran its healing branch, not the no-op #143 covers.
    expect(shortResult.facts.hitDiceSpent).toBe(1);

    const after = await prisma.character.findUniqueOrThrow({
      where: { id: created.characterId },
      select: { hp: true, hitDiceRemaining: true, exhaustionLevel: true },
    });

    // Either serial order is a legal history. A stale short-rest write leaves
    // { hp: 12, hitDiceRemaining: 0, exhaustionLevel: 0 }: the long rest's HP
    // and Hit Die erased while its exhaustion reduction survives.
    const serialOutcomes = [
      // short rest, then long rest
      { hp: 20, hitDiceRemaining: 1, exhaustionLevel: 0 },
      // long rest, then short rest (at full HP it spends no Hit Die)
      { hp: 20, hitDiceRemaining: 2, exhaustionLevel: 0 },
    ];
    expect(serialOutcomes).toContainEqual(after);
  } finally {
    // Never leave the paused transaction hanging if a step before the release
    // fails; releasing twice is harmless for a resolved Promise.
    resumeShortRest();
    await Promise.allSettled([shortRest, longRest].filter(Boolean));
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});
