import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { resolveSocialCheck } from "../../lib/rules/social-service";
import { shiftDisposition } from "../../lib/rules/social-logic";
import {
  assertSafeE2EDatabase,
  cleanupE2ERecords,
  type E2ECreatedRecords,
} from "./support/database";

type SocialTx = NonNullable<Parameters<typeof resolveSocialCheck>[0]["tx"]>;

async function createdId(response: {
  status(): number;
  json(): Promise<unknown>;
}): Promise<string> {
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { id?: unknown };
  expect(typeof body.id).toBe("string");
  return body.id as string;
}

test("@smoke concurrent social checks preserve both disposition shifts", async ({ request }) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();
  let npcId: string | undefined;

  let npcRead!: () => void;
  const npcWasRead = new Promise<void>((resolve) => {
    npcRead = resolve;
  });

  let resumeFirstCheck!: () => void;
  const secondCheckCommitted = new Promise<void>((resolve) => {
    resumeFirstCheck = resolve;
  });

  try {
    created.characterId = await createdId(
      await request.post("/api/character", {
        data: {
          name: `Social race ${randomUUID().slice(0, 8)}`,
          race: "human",
          class: "wizard",
          stats: { STR: 8, DEX: 14, CON: 12, INT: 16, WIS: 10, CHA: 16 },
        },
      })
    );

    created.campaignId = await createdId(
      await request.post("/api/campaign", {
        data: {
          characterId: created.characterId,
          title: `Social race ${randomUUID().slice(0, 8)}`,
        },
      })
    );

    const npcResponse = await request.post(`/api/campaign/${created.campaignId}/npc`, {
      data: {
        seed: `social-race-${randomUUID()}`,
        role: "commoner",
      },
    });
    expect(npcResponse.status()).toBe(200);
    const npcBody = (await npcResponse.json()) as { id?: unknown };
    expect(typeof npcBody.id).toBe("string");
    npcId = npcBody.id as string;

    await prisma.nPC.update({
      where: { id: npcId },
      data: { disposition: 0, hasMetPlayer: true },
    });

    const firstCheck = prisma.$transaction(async (realTx) => {
      let paused = false;
      const instrumentedTx = {
        campaign: {
          findUnique: (args: unknown) =>
            realTx.campaign.findUnique(args as Prisma.CampaignFindUniqueArgs),
        },
        character: {
          findUnique: (args: unknown) =>
            realTx.character.findUnique(args as Prisma.CharacterFindUniqueArgs),
        },
        nPC: {
          findUnique: async (args: unknown) => {
            const row = await realTx.nPC.findUnique(args as Prisma.NPCFindUniqueArgs);
            if (!paused) {
              paused = true;
              npcRead();
              await secondCheckCommitted;
            }
            return row;
          },
          update: (args: unknown) => realTx.nPC.update(args as Prisma.NPCUpdateArgs),
          updateMany: (args: unknown) =>
            realTx.nPC.updateMany(args as Prisma.NPCUpdateManyArgs),
        },
      } as unknown as SocialTx;

      return resolveSocialCheck({
        campaignId: created.campaignId!,
        npcId: npcId!,
        approach: "persuade",
        intent: "first concurrent attempt",
        tx: instrumentedTx,
      });
    });

    await npcWasRead;

    const secondResult = await resolveSocialCheck({
      campaignId: created.campaignId,
      npcId,
      approach: "persuade",
      intent: "second concurrent attempt",
    });

    expect(secondResult.dispositionBefore).toBe(0);
    resumeFirstCheck();
    const firstResult = await firstCheck;

    // The paused request must detect that disposition 0 is stale and rebase
    // the same already-rolled check onto the value committed by the second
    // request. It must not silently overwrite that earlier accepted shift.
    expect(firstResult.dispositionBefore).toBe(secondResult.dispositionAfter);
    expect(firstResult.dispositionAfter).toBe(
      shiftDisposition(secondResult.dispositionAfter, firstResult.success)
    );

    const after = await prisma.nPC.findUniqueOrThrow({
      where: { id: npcId },
      select: { disposition: true },
    });

    expect(after.disposition).toBe(firstResult.dispositionAfter);
  } finally {
    resumeFirstCheck();
    if (created.campaignId) {
      await prisma.nPC.deleteMany({ where: { campaignId: created.campaignId } });
    }
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});
