import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { POST as resolveSocialRoute } from "../../app/api/campaign/[id]/social/route";
import { prisma as routePrisma } from "../../lib/db/prisma";
import {
  generateNPCPersonality,
  initialAttitudeFor,
  INITIAL_DISPOSITION,
  shiftDisposition,
} from "../../lib/rules/social-logic";
import {
  assertSafeE2EDatabase,
  cleanupE2ERecords,
  type E2ECreatedRecords,
} from "./support/database";

type RouteNpcDelegate = {
  findUnique(
    args: Prisma.NPCFindUniqueArgs
  ): Promise<Prisma.NPCGetPayload<Record<string, never>> | null>;
  update(args: Prisma.NPCUpdateArgs): Promise<unknown>;
};

type SocialRouteResult = {
  ok?: boolean;
  success?: boolean;
  dispositionBefore?: number;
  dispositionAfter?: number;
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

function socialRequest(
  campaignId: string,
  npcId: string,
  intent: string
): Request {
  return new Request(
    `http://test/api/campaign/${campaignId}/social`,
    {
      method: "POST",
      body: JSON.stringify({
        npcId,
        approach: "persuade",
        intent,
      }),
      headers: { "Content-Type": "application/json" },
    }
  );
}

async function waitForDispositionToLeave(
  prisma: PrismaClient,
  npcId: string,
  initialDisposition: number
): Promise<void> {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    const row = await prisma.nPC.findUnique({
      where: { id: npcId },
      select: { disposition: true },
    });

    if (row?.disposition !== initialDisposition) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(
    "Timed out waiting for the first social check to move disposition."
  );
}

test("@smoke concurrent first-contact social actions preserve both accepted disposition shifts", async ({
  request,
}) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const observer = new PrismaClient();
  const routeNpc = routePrisma.nPC as unknown as RouteNpcDelegate;

  const originalFindUnique = routeNpc.findUnique.bind(routePrisma.nPC);
  const originalUpdate = routeNpc.update.bind(routePrisma.nPC);
  const originalRandom = Math.random;

  let npcId: string | undefined;
  let releaseBothRouteReads!: () => void;
  const bothRouteReads = new Promise<void>((resolve) => {
    releaseBothRouteReads = resolve;
  });
  let staleFirstContactReads = 0;
  let firstContactWrites = 0;

  try {
    created.characterId = await createdId(
      await request.post("/api/character", {
        data: {
          name: `First-contact race ${randomUUID().slice(0, 8)}`,
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
          title: `First-contact race ${randomUUID().slice(0, 8)}`,
        },
      })
    );

    const npcSeed = `first-contact-race-${randomUUID()}`;
    const npcResponse = await request.post(
      `/api/campaign/${created.campaignId}/npc`,
      {
        data: {
          seed: npcSeed,
          role: "commoner",
        },
      }
    );
    expect(npcResponse.status()).toBe(200);

    const npcBody = (await npcResponse.json()) as { id?: unknown };
    expect(typeof npcBody.id).toBe("string");
    npcId = npcBody.id as string;

    const initialDisposition =
      INITIAL_DISPOSITION[initialAttitudeFor(npcSeed, "commoner")];

    const before = await observer.nPC.findUniqueOrThrow({
      where: { id: npcId },
      select: {
        disposition: true,
        hasMetPlayer: true,
        personalityTags: true,
      },
    });

    expect(before.disposition).toBeNull();
    expect(before.hasMetPlayer).toBe(false);
    expect(before.personalityTags).toBeNull();

    // Force both production route calls to observe the same never-met snapshot
    // before either is allowed to run the unconditional first-contact update.
    routeNpc.findUnique = async (
      args: Prisma.NPCFindUniqueArgs
    ): Promise<any> => {
      const row = await originalFindUnique(args);
      const select = args.select as Record<string, unknown> | undefined;

      const isRouteFirstContactRead =
        args.where.id === npcId &&
        select?.role === true &&
        select?.hasMetPlayer === true &&
        select?.disposition !== true &&
        row?.hasMetPlayer === false;

      if (isRouteFirstContactRead) {
        staleFirstContactReads += 1;
        if (staleFirstContactReads === 2) {
          releaseBothRouteReads();
        }
        await bothRouteReads;
      }

      return row;
    };

    // Let one stale initializer through. Hold the other until the first request
    // has completed its real social CAS and moved disposition away from the
    // deterministic initial value. The delayed production update then executes
    // with its stale hasMetPlayer=false decision.
    routeNpc.update = async (args: Prisma.NPCUpdateArgs): Promise<any> => {
      const data = args.data as Record<string, unknown>;
      const isFirstContactWrite =
        args.where.id === npcId && data.hasMetPlayer === true;

      if (isFirstContactWrite) {
        firstContactWrites += 1;
        if (firstContactWrites === 2) {
          await waitForDispositionToLeave(
            observer,
            npcId!,
            initialDisposition
          );
        }
      }

      return originalUpdate(args);
    };

    // Natural 1 plus CHA -1 fails every initial commoner attitude DC. Keeping
    // both rolls deterministic makes the expected sequential disposition exact.
    Math.random = () => 0;

    const params = Promise.resolve({ id: created.campaignId });
    const [firstResponse, secondResponse] = await Promise.all([
      resolveSocialRoute(
        socialRequest(
          created.campaignId,
          npcId,
          "first concurrent first-contact attempt"
        ) as never,
        { params }
      ),
      resolveSocialRoute(
        socialRequest(
          created.campaignId,
          npcId,
          "second concurrent first-contact attempt"
        ) as never,
        { params }
      ),
    ]);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);

    const results = [
      (await firstResponse.json()) as SocialRouteResult,
      (await secondResponse.json()) as SocialRouteResult,
    ];

    expect(results.every((result) => result.ok === true)).toBe(true);
    expect(results.every((result) => result.success === false)).toBe(true);

    const after = await observer.nPC.findUniqueOrThrow({
      where: { id: npcId },
      select: {
        disposition: true,
        hasMetPlayer: true,
        personalityTags: true,
      },
    });

    expect(after.hasMetPlayer).toBe(true);
    expect(after.personalityTags).toEqual(generateNPCPersonality(npcSeed));

    const afterOneFailure = shiftDisposition(initialDisposition, false);
    const afterTwoFailures = shiftDisposition(afterOneFailure, false);

    // Contract under audit: two accepted social checks must compose. Exactly
    // one check may begin from the deterministic first-contact disposition;
    // the other must observe/rebase onto the first committed shift.
    const checksStartingFromInitial = results.filter(
      (result) => result.dispositionBefore === initialDisposition
    ).length;

    expect.soft(checksStartingFromInitial).toBe(1);
    expect.soft(after.disposition).toBe(afterTwoFailures);
  } finally {
    releaseBothRouteReads();

    routeNpc.findUnique = originalFindUnique;
    routeNpc.update = originalUpdate;
    Math.random = originalRandom;

    if (created.campaignId) {
      await observer.nPC.deleteMany({
        where: { campaignId: created.campaignId },
      });
    }

    await observer.$disconnect();
    await cleanupE2ERecords(created);
  }
});
