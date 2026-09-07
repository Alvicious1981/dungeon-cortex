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

type BlockedEquipStage = "inventory" | "character";

async function waitForBlockedEquipStage(
  prisma: PrismaClient,
  stage: BlockedEquipStage
): Promise<void> {
  // Keep the deterministic barrier comfortably below Prisma's 5 s default
  // interactive-transaction timeout. A healthy local request reaches either
  // lock in a few milliseconds once the web server is running.
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
        AND (
          (${stage} = 'inventory'
            AND query ILIKE '%InventoryItem%'
            AND query ILIKE 'UPDATE%')
          OR
          (${stage} = 'character'
            AND query ILIKE '%Character%'
            AND query ILIKE '%FOR UPDATE%')
        )
    `;

    if (Number(rows[0]?.count ?? 0) >= 1) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  const activity = await prisma.$queryRaw<
    Array<{
      state: string | null;
      wait_event_type: string | null;
      wait_event: string | null;
      query: string;
    }>
  >`
    SELECT state, wait_event_type, wait_event, query
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND state <> 'idle'
    ORDER BY pid
  `;

  throw new Error(
    `Timed out waiting for blocked equip stage ${stage}. Active DB work: ${JSON.stringify(activity)}`
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

    // Hold both target rows so the first LIVE equip can acquire the canonical
    // Character lock, clear MAIN_HAND, and then stop on its target row. The
    // second request is launched only after that state is observed, which
    // makes the serialized ordering deterministic instead of relying on two
    // requests racing to the same barrier simultaneously.
    const lockTransaction = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "InventoryItem"
          WHERE "id" IN (${firstItem.id}, ${secondItem.id})
          FOR UPDATE
        `;
        locksHeld();
        await mayReleaseLocks;
      },
      { timeout: 15_000 }
    );

    await inventoryLocksHeld;

    // A must reach its InventoryItem UPDATE first. At this point its equip
    // transaction already owns Character FOR UPDATE.
    const firstEquip = request.post(`/api/campaign/${created.campaignId}/action`, {
      data: { action: `equip ${firstItem.name}` },
    });
    await waitForBlockedEquipStage(prisma, "inventory");

    // B is now guaranteed to overlap A and must stop at the Character lock,
    // before it can clear MAIN_HAND. This is the ordering the production fix
    // is intended to enforce across app instances.
    const secondEquip = request.post(`/api/campaign/${created.campaignId}/action`, {
      data: { action: `equip ${secondItem.name}` },
    });
    await waitForBlockedEquipStage(prisma, "character");

    // Release immediately once both stages are proven, keeping the application
    // transactions well inside Prisma's default 5 s interactive timeout.
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

    // Domain invariant: a character has at most one occupant per equipment
    // slot. Because B was observed waiting behind A's Character lock, B must
    // run second and become the sole final occupant.
    expect(equipped).toHaveLength(1);
    expect(equipped[0]?.id).toBe(secondItem.id);
  } finally {
    releaseLocks();
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});