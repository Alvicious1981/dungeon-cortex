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

async function waitForBlockedEquipRequests(
  prisma: PrismaClient,
  expected: number
): Promise<void> {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
        AND (
          (query ILIKE '%InventoryItem%' AND query ILIKE 'UPDATE%')
          OR
          (query ILIKE '%Character%' AND query ILIKE 'SELECT%' AND query ILIKE '%FOR UPDATE%')
        )
    `;

    if (Number(rows[0]?.count ?? 0) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(
    `Timed out waiting for ${expected} equip requests to reach lock contention.`
  );
}

test("@smoke concurrent equips preserve one-item-per-slot invariant", async ({ request }) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();

  let locksHeld!: () => void;
  const inventoryLocksHeld = new Promise<void>((resolve) => {
    locksHeld = resolve;
  });

  let releaseLocks!: () => void;
  const mayReleaseLocks = new Promise<void>((resolve) => {
    releaseLocks = resolve;
  });

  try {
    created.characterId = await createdId(
      await request.post("/api/character", {
        data: {
          name: `Equip race ${randomUUID().slice(0, 8)}`,
          race: "human",
          class: "fighter",
          stats: { STR: 16, DEX: 14, CON: 14, INT: 10, WIS: 12, CHA: 8 },
        },
      })
    );

    created.campaignId = await createdId(
      await request.post("/api/campaign", {
        data: {
          characterId: created.characterId,
          title: `Equip race ${randomUUID().slice(0, 8)}`,
        },
      })
    );

    const firstItem = await prisma.inventoryItem.create({
      data: {
        characterId: created.characterId,
        name: `Race Blade A ${randomUUID().slice(0, 8)}`,
        type: "weapon",
        quantity: 1,
        properties: {
          damageDice: "1d8",
          damageBonus: 0,
          damageType: "slashing",
          weaponCategory: "Martial",
          weaponRange: "Melee",
        },
      },
    });

    const secondItem = await prisma.inventoryItem.create({
      data: {
        characterId: created.characterId,
        name: `Race Blade B ${randomUUID().slice(0, 8)}`,
        type: "weapon",
        quantity: 1,
        properties: {
          damageDice: "1d8",
          damageBonus: 0,
          damageType: "slashing",
          weaponCategory: "Martial",
          weaponRange: "Melee",
        },
      },
    });

    // Hold both target rows. On the vulnerable implementation, both LIVE equip
    // transactions clear the empty MAIN_HAND slot and then block on these rows.
    // With character-level serialization, one reaches the inventory row while
    // the other blocks earlier on Character FOR UPDATE. Either way, observing
    // two blocked requests proves both submissions are genuinely overlapping
    // before the external locks are released.
    const lockTransaction = prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "InventoryItem"
        WHERE "id" IN (${firstItem.id}, ${secondItem.id})
        FOR UPDATE
      `;
      locksHeld();
      await mayReleaseLocks;
    });

    await inventoryLocksHeld;

    const firstEquip = request.post(`/api/campaign/${created.campaignId}/action`, {
      data: { action: `equip ${firstItem.name}` },
    });
    const secondEquip = request.post(`/api/campaign/${created.campaignId}/action`, {
      data: { action: `equip ${secondItem.name}` },
    });

    await waitForBlockedEquipRequests(prisma, 2);
    releaseLocks();
    await lockTransaction;

    const [firstResponse, secondResponse] = await Promise.all([
      firstEquip,
      secondEquip,
    ]);

    expect(firstResponse.status()).toBe(200);
    expect(secondResponse.status()).toBe(200);

    const equipped = await prisma.inventoryItem.findMany({
      where: {
        characterId: created.characterId,
        equippedSlot: "MAIN_HAND",
      },
      select: { id: true, name: true },
      orderBy: { id: "asc" },
    });

    // Domain invariant: a character has at most one occupant per equipment slot.
    expect(equipped).toHaveLength(1);
  } finally {
    releaseLocks();
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});
