import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { castSpell } from "../../lib/rules/magic-service";
import {
  assertSafeE2EDatabase,
  cleanupE2ERecords,
  type E2ECreatedRecords,
} from "./support/database";

type MagicTx = NonNullable<Parameters<typeof castSpell>[0]["tx"]>;

async function createdId(response: {
  status(): number;
  json(): Promise<unknown>;
}): Promise<string> {
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { id?: unknown };
  expect(typeof body.id).toBe("string");
  return body.id as string;
}

test("@smoke concurrent spell casts consume two slots without a lost update", async ({ request }) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();

  let characterRead!: () => void;
  const characterWasRead = new Promise<void>((resolve) => {
    characterRead = resolve;
  });

  let resumeFirstCast!: () => void;
  const secondCastCommitted = new Promise<void>((resolve) => {
    resumeFirstCast = resolve;
  });

  try {
    created.characterId = await createdId(
      await request.post("/api/character", {
        data: {
          name: `Magic race ${randomUUID().slice(0, 8)}`,
          race: "human",
          class: "wizard",
          stats: { STR: 8, DEX: 14, CON: 12, INT: 16, WIS: 10, CHA: 10 },
        },
      })
    );

    created.campaignId = await createdId(
      await request.post("/api/campaign", {
        data: {
          characterId: created.characterId,
          title: `Magic race ${randomUUID().slice(0, 8)}`,
        },
      })
    );

    await prisma.character.update({
      where: { id: created.characterId },
      data: { spellSlots: { "1": { current: 2, max: 2 } } },
    });

    const firstCast = prisma.$transaction(async (realTx) => {
      let paused = false;
      const instrumentedTx = {
        campaign: {
          findUnique: (args: unknown) =>
            realTx.campaign.findUnique(args as Prisma.CampaignFindUniqueArgs),
        },
        character: {
          findUnique: async (args: unknown) => {
            const row = await realTx.character.findUnique(args as Prisma.CharacterFindUniqueArgs);
            if (!paused) {
              paused = true;
              characterRead();
              await secondCastCommitted;
            }
            return row;
          },
          update: (args: unknown) =>
            realTx.character.update(args as Prisma.CharacterUpdateArgs),
        },
      } as unknown as MagicTx;

      return castSpell({
        campaignId: created.campaignId!,
        characterId: created.characterId!,
        spellLevel: 1,
        slotLevel: 1,
        tx: instrumentedTx,
      });
    });

    await characterWasRead;

    const secondResult = await castSpell({
      campaignId: created.campaignId,
      characterId: created.characterId,
      spellLevel: 1,
      slotLevel: 1,
    });
    expect(secondResult.facts.slotConsumed).toBe(true);

    resumeFirstCast();
    const firstResult = await firstCast;
    expect(firstResult.facts.slotConsumed).toBe(true);

    const after = await prisma.character.findUniqueOrThrow({
      where: { id: created.characterId },
      select: { spellSlots: true },
    });

    expect(after.spellSlots).toEqual({
      "1": { current: 0, max: 2 },
    });
  } finally {
    resumeFirstCast();
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});
