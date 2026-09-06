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

async function createdId(response: {
  status(): number;
  json(): Promise<unknown>;
}): Promise<string> {
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { id?: unknown };
  expect(typeof body.id).toBe("string");
  return body.id as string;
}

/**
 * Regression for the stale-write risk identified in the review of PR #139.
 *
 * The short rest deliberately reads the character and then pauses. While it is
 * paused, a real long rest commits a Hit Die recovery through a separate real
 * Prisma transaction. The short rest then resumes from its stale snapshot.
 *
 * A true no-op must not write that snapshot back. The historical behaviour did
 * an unconditional character.update({ hp: oldHp, hitDiceRemaining: oldDice })
 * and therefore erased the committed recovery. Every query in this test reaches
 * CI's disposable PostgreSQL; the small transaction adapter only gives the test
 * a deterministic pause immediately after the real character SELECT.
 */
test("@smoke a no-op short rest cannot overwrite a concurrent long-rest recovery", async ({
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
  const concurrentRestCommitted = new Promise<void>((resolve) => {
    resumeShortRest = resolve;
  });

  try {
    created.characterId = await createdId(
      await request.post("/api/character", {
        data: {
          name: `Rest race ${randomUUID().slice(0, 8)}`,
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
          title: `Rest race ${randomUUID().slice(0, 8)}`,
        },
      })
    );

    // Full HP + zero remaining Hit Dice makes an implicit short rest a genuine
    // mechanical no-op. A level-2 fighter recovers one Hit Die on a long rest.
    await prisma.character.update({
      where: { id: created.characterId },
      data: {
        level: 2,
        hp: 20,
        maxHp: 20,
        hitDiceTotal: 2,
        hitDiceRemaining: 0,
        exhaustionLevel: 0,
      },
    });

    const shortRest = prisma.$transaction(async (realTx) => {
      const instrumentedTx = {
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
            await concurrentRestCommitted;
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
        tx: instrumentedTx,
      });
    });

    // The short rest has captured hitDiceRemaining=0 from PostgreSQL but has
    // not yet been allowed to continue into its no-op branch.
    await characterWasRead;

    const longResult = await resolveRest({
      campaignId: created.campaignId,
      characterId: created.characterId,
      restType: "long",
    });
    expect(longResult.facts.hitDiceRecovered).toBe(1);
    expect(longResult.facts.hitDiceRemainingAfter).toBe(1);

    resumeShortRest();
    const shortResult = await shortRest;
    expect(shortResult.facts.hitDiceSpent).toBe(0);
    expect(shortResult.facts.hpRecovered).toBe(0);

    const after = await prisma.character.findUniqueOrThrow({
      where: { id: created.characterId },
      select: { hp: true, hitDiceRemaining: true },
    });

    // The committed recovery is the invariant. A stale no-op write turns this
    // back into zero and makes the test fail.
    expect(after).toEqual({ hp: 20, hitDiceRemaining: 1 });
  } finally {
    // Never leave the paused transaction hanging if an assertion before resume
    // fails; releasing twice is harmless for a resolved Promise.
    resumeShortRest();
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});
