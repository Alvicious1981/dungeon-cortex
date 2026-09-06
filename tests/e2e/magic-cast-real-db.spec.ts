import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

import {
  assertSafeE2EDatabase,
  cleanupE2ERecords,
  type E2ECreatedRecords,
} from "./support/database";

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
 * Real-Prisma regression for the direct spell-cast endpoint.
 *
 * Unit tests inject a hand-written Prisma facade, so they cannot prove that a
 * `select` only names fields that exist on the generated Character model. This
 * journey crosses the authenticated route, magic-service, generated Prisma
 * Client, and disposable PostgreSQL used by CI, then reads the persisted slot
 * count back from the database.
 */
test("@smoke spell cast consumes one slot through the direct route and real Prisma", async ({
  request,
}) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();

  try {
    created.characterId = await createdId(
      await request.post("/api/character", {
        data: {
          name: `Magic E2E ${randomUUID().slice(0, 8)}`,
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
          title: `Magic regression ${randomUUID().slice(0, 8)}`,
        },
      })
    );

    // Fixture only: make slot persistence deterministic. The endpoint still
    // owns the subsequent read, validation, consumption, and write.
    const initialSlots = {
      "1": { current: 2, max: 2 },
      "2": { current: 1, max: 1 },
    };
    await prisma.character.update({
      where: { id: created.characterId },
      data: { spellSlots: initialSlots },
    });

    const before = await prisma.character.findUniqueOrThrow({
      where: { id: created.characterId },
      select: { spellSlots: true },
    });
    expect(before.spellSlots).toEqual(initialSlots);

    const response = await request.post(
      `/api/campaign/${created.campaignId}/magic/cast`,
      { data: { spellLevel: 1, slotLevel: 1 } }
    );

    expect(response.status()).not.toBe(500);
    expect(response.status()).toBe(200);

    const body = (await response.json()) as {
      ok?: boolean;
      facts?: {
        type?: string;
        campaignId?: string;
        characterId?: string;
        spellLevel?: number;
        slotLevel?: number | null;
        slotConsumed?: boolean;
      };
    };
    expect(body).toMatchObject({
      ok: true,
      facts: {
        type: "spell_cast",
        campaignId: created.campaignId,
        characterId: created.characterId,
        spellLevel: 1,
        slotLevel: 1,
        slotConsumed: true,
      },
    });

    const after = await prisma.character.findUniqueOrThrow({
      where: { id: created.characterId },
      select: { spellSlots: true },
    });
    expect(after.spellSlots).toEqual({
      "1": { current: 1, max: 2 },
      "2": { current: 1, max: 1 },
    });
  } finally {
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});
