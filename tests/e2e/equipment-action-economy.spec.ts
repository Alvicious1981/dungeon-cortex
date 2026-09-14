import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";

import { finalizeEncounterTurn } from "../../lib/rules/combat-pipeline";
import {
  assertSafeE2EDatabase,
  cleanupE2ERecords,
  type E2ECreatedRecords,
} from "./support/database";

/**
 * Real-PostgreSQL coverage of the combat equipment action economy
 * (`lib/rules/combat-equipment.ts`, `lib/db/equipment-transition.ts`): the
 * turn's free object interaction, the action an equip falls back to, the
 * refusals that must write nothing, and the races between equips, End Turn and
 * Attack — all through the real action route.
 *
 * Concurrency contract: `persistEquipmentTransition` takes the Character row
 * lock and then re-reads the item, the slot's occupant and the turn's
 * interaction budget before deciding. A request that waited on the lock is
 * therefore decided against the state its predecessor committed, never against
 * the snapshot it started from. The three equip-versus-equip races assert that
 * contract; which of the two requests wins the lock is left open.
 */

interface ActionSseFrame {
  t: string;
  e?: {
    type?: string;
    payload?: Record<string, unknown>;
  };
}

interface EquipmentFixture {
  created: E2ECreatedRecords;
  encounterId: string;
  playerCombatantId: string;
  enemyCombatantId: string;
}

interface ItemSeed {
  name: string;
  type: string;
  equippedSlot?: string | null;
  properties: Prisma.InputJsonValue;
}

function parseSseFrames(body: string): ActionSseFrame[] {
  return body
    .split(/\n\n/)
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice(6)) as ActionSseFrame);
}

async function eventTypes(response: APIResponse): Promise<string[]> {
  return parseSseFrames(await response.text())
    .filter((frame) => frame.t === "evt" && typeof frame.e?.type === "string")
    .map((frame) => frame.e!.type!);
}

async function createdId(response: APIResponse): Promise<string> {
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { id?: unknown };
  expect(typeof body.id).toBe("string");
  return body.id as string;
}

async function createEquipmentFixture(
  request: APIRequestContext,
  prisma: PrismaClient,
  options: {
    objectInteractionUsed: boolean | null;
    items: readonly ItemSeed[];
  },
): Promise<EquipmentFixture> {
  const created: E2ECreatedRecords = {};
  created.characterId = await createdId(
    await request.post("/api/character", {
      data: {
        name: `Equipment E2E ${randomUUID().slice(0, 8)}`,
        race: "human",
        class: "fighter",
        stats: { STR: 16, DEX: 14, CON: 14, INT: 10, WIS: 12, CHA: 8 },
      },
    }),
  );
  created.campaignId = await createdId(
    await request.post("/api/campaign", {
      data: {
        characterId: created.characterId,
        title: `Equipment policy ${randomUUID().slice(0, 8)}`,
      },
    }),
  );

  for (const item of options.items) {
    await prisma.inventoryItem.create({
      data: {
        characterId: created.characterId,
        name: item.name,
        type: item.type,
        quantity: 1,
        equippedSlot: item.equippedSlot ?? null,
        properties: item.properties,
      },
    });
  }

  const encounter = await prisma.encounter.create({
    data: {
      campaignId: created.campaignId,
      status: "active",
      round: 1,
      currentTurnIndex: 0,
      currentTurnMovementSpentFt: 0,
      currentTurnObjectInteractionUsed: options.objectInteractionUsed,
      totalDamageDealt: 0,
      combatants: {
        create: [
          {
            name: "Equipment Hero",
            isPlayer: true,
            hp: 30,
            maxHp: 30,
            ac: 16,
            initiativeTotal: 20,
            initiativeOrder: 0,
            stats: { STR: 16, DEX: 14, CON: 14, INT: 10, WIS: 12, CHA: 8 },
            conditions: [],
          },
          {
            name: "Equipment Target",
            isPlayer: false,
            hp: 40,
            maxHp: 40,
            ac: 12,
            initiativeTotal: 10,
            initiativeOrder: 1,
            stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
            conditions: [],
          },
        ],
      },
    },
    include: { combatants: true },
  });

  return {
    created,
    encounterId: encounter.id,
    playerCombatantId: encounter.combatants.find((row) => row.isPlayer)!.id,
    enemyCombatantId: encounter.combatants.find((row) => !row.isPlayer)!.id,
  };
}

async function cleanupFixture(
  prisma: PrismaClient,
  fixture: EquipmentFixture | undefined,
): Promise<void> {
  if (fixture) {
    await prisma.combatant.deleteMany({
      where: { encounterId: fixture.encounterId },
    });
    await prisma.encounter.deleteMany({ where: { id: fixture.encounterId } });
  }
  await prisma.$disconnect();
  if (fixture) await cleanupE2ERecords(fixture.created);
}

function postAction(
  request: APIRequestContext,
  campaignId: string,
  action: string,
  extra: Record<string, unknown> = {},
): Promise<APIResponse> {
  return request.post(`/api/campaign/${campaignId}/action`, {
    data: {
      requestId: `equipment-${randomUUID()}`,
      action,
      ...extra,
    },
  });
}

async function expectCode(response: APIResponse, code: string): Promise<void> {
  expect(response.status()).toBe(409);
  const body = (await response.json()) as { code?: unknown; error?: unknown };
  expect(body.code).toBe(code);
  expect(typeof body.error).toBe("string");
}

async function userLogCount(
  prisma: PrismaClient,
  campaignId: string,
  content: string | string[],
): Promise<number> {
  return prisma.gameLog.count({
    where: {
      campaignId,
      role: "user",
      content: Array.isArray(content) ? { in: content } : content,
    },
  });
}

async function receiptEventCount(
  prisma: PrismaClient,
  campaignId: string,
  eventType: string,
): Promise<number> {
  const receipts = await prisma.actionRequestReceipt.findMany({
    where: { campaignId },
    select: { replayEvents: true },
  });
  return receipts.reduce((count, receipt) => {
    const events = Array.isArray(receipt.replayEvents)
      ? (receipt.replayEvents as Array<{ type?: unknown }>)
      : [];
    return count + events.filter((event) => event.type === eventType).length;
  }, 0);
}

async function waitForBlockedCharacterLocks(
  prisma: PrismaClient,
  minimum: number,
): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
        AND query ILIKE '%Character%'
        AND query ILIKE '%FOR UPDATE%'
    `;
    if (Number(rows[0]?.count ?? 0) >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${minimum} blocked Character lock(s).`);
}

async function waitForBlockedEncounterUpdates(
  prisma: PrismaClient,
  minimum: number,
): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
        AND query ILIKE 'UPDATE%'
        AND query ILIKE '%Encounter%'
    `;
    if (Number(rows[0]?.count ?? 0) >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${minimum} blocked Encounter update(s).`);
}

function holdCharacterLock(prisma: PrismaClient, characterId: string) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held!: () => void;
  const isHeld = new Promise<void>((resolve) => {
    held = resolve;
  });
  const transaction = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Character" WHERE "id" = ${characterId} FOR UPDATE
      `;
      held();
      await released;
    },
    { timeout: 15_000 },
  );
  return { release, isHeld, transaction };
}

function holdEncounterLock(prisma: PrismaClient, encounterId: string) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held!: () => void;
  const isHeld = new Promise<void>((resolve) => {
    held = resolve;
  });
  const transaction = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Encounter" WHERE "id" = ${encounterId} FOR UPDATE
      `;
      held();
      await released;
    },
    { timeout: 15_000 },
  );
  return { release, isHeld, transaction };
}

const WEAPON = {
  damageDice: "1d8",
  damageBonus: 0,
  damageType: "slashing",
  weaponCategory: "Martial",
  weaponRange: "Melee",
};

test("@smoke first interaction stays on turn and the next eligible equip spends the action", async ({
  request,
}) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();
  const prisma = new PrismaClient();
  let fixture: EquipmentFixture | undefined;
  try {
    fixture = await createEquipmentFixture(request, prisma, {
      objectInteractionUsed: false,
      items: [
        { name: "Free Interaction Blade", type: "weapon", properties: WEAPON },
        { name: "Second Interaction Charm", type: "misc", properties: {} },
      ],
    });
    const campaignId = fixture.created.campaignId!;

    const first = await postAction(
      request,
      campaignId,
      "I equip the Free Interaction Blade",
    );
    expect(first.status()).toBe(200);
    expect(await eventTypes(first)).toEqual(["EQUIP_ITEM"]);
    const afterFirst = await prisma.encounter.findUniqueOrThrow({
      where: { id: fixture.encounterId },
      select: {
        round: true,
        currentTurnIndex: true,
        currentTurnObjectInteractionUsed: true,
      },
    });
    expect(afterFirst).toEqual({
      round: 1,
      currentTurnIndex: 0,
      currentTurnObjectInteractionUsed: true,
    });

    const second = await postAction(
      request,
      campaignId,
      "I equip the Second Interaction Charm",
    );
    expect(second.status()).toBe(200);
    expect(await eventTypes(second)).toEqual(["EQUIP_ITEM", "TURN_ADVANCE"]);
    const afterSecond = await prisma.encounter.findUniqueOrThrow({
      where: { id: fixture.encounterId },
      select: {
        round: true,
        currentTurnIndex: true,
        currentTurnObjectInteractionUsed: true,
      },
    });
    expect(afterSecond).toEqual({
      round: 1,
      currentTurnIndex: 1,
      currentTurnObjectInteractionUsed: false,
    });
    const equipped = await prisma.inventoryItem.findMany({
      where: {
        characterId: fixture.created.characterId,
        name: { in: ["Free Interaction Blade", "Second Interaction Charm"] },
      },
      orderBy: { name: "asc" },
      select: { name: true, equippedSlot: true },
    });
    expect(equipped).toEqual([
      { name: "Free Interaction Blade", equippedSlot: "MAIN_HAND" },
      { name: "Second Interaction Charm", equippedSlot: "ACCESSORY" },
    ]);
    expect(
      await userLogCount(prisma, campaignId, [
        "I equip the Free Interaction Blade",
        "I equip the Second Interaction Charm",
      ]),
    ).toBe(2);
  } finally {
    await cleanupFixture(prisma, fixture);
  }
});

test("@smoke a complete player-enemy-player cycle restores the free interaction", async ({
  request,
}) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();
  const prisma = new PrismaClient();
  let fixture: EquipmentFixture | undefined;
  try {
    fixture = await createEquipmentFixture(request, prisma, {
      objectInteractionUsed: true,
      items: [
        { name: "Cycle Blade", type: "weapon", properties: WEAPON },
        { name: "Cycle Charm", type: "misc", properties: {} },
      ],
    });
    const campaignId = fixture.created.campaignId!;

    const playerAction = await postAction(
      request,
      campaignId,
      "I equip the Cycle Blade",
    );
    expect(playerAction.status()).toBe(200);
    expect(await eventTypes(playerAction)).toEqual(["EQUIP_ITEM", "TURN_ADVANCE"]);

    await prisma.encounter.update({
      where: { id: fixture.encounterId },
      data: { currentTurnObjectInteractionUsed: true },
    });
    const enemyAdvance = await prisma.$transaction((tx) =>
      finalizeEncounterTurn({
        tx,
        encounterId: fixture!.encounterId,
        currentTurnIndex: 1,
        round: 1,
        failOnStaleTurn: true,
      }),
    );
    expect(enemyAdvance.turnAdvanceConflict).toBe(false);
    const returnedToPlayer = await prisma.encounter.findUniqueOrThrow({
      where: { id: fixture.encounterId },
      select: {
        round: true,
        currentTurnIndex: true,
        currentTurnObjectInteractionUsed: true,
      },
    });
    expect(returnedToPlayer).toEqual({
      round: 2,
      currentTurnIndex: 0,
      currentTurnObjectInteractionUsed: false,
    });

    const restoredInteraction = await postAction(
      request,
      campaignId,
      "I equip the Cycle Charm",
    );
    expect(restoredInteraction.status()).toBe(200);
    expect(await eventTypes(restoredInteraction)).toEqual(["EQUIP_ITEM"]);
    const after = await prisma.encounter.findUniqueOrThrow({
      where: { id: fixture.encounterId },
      select: { currentTurnIndex: true, currentTurnObjectInteractionUsed: true },
    });
    expect(after).toEqual({
      currentTurnIndex: 0,
      currentTurnObjectInteractionUsed: true,
    });
  } finally {
    await cleanupFixture(prisma, fixture);
  }
});

test("@smoke legacy null fails closed for weapon equipment but permits an empty-hand shield action", async ({
  request,
}) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();
  const prisma = new PrismaClient();
  let fixture: EquipmentFixture | undefined;
  try {
    fixture = await createEquipmentFixture(request, prisma, {
      objectInteractionUsed: null,
      items: [
        { name: "Legacy Budget Blade", type: "weapon", properties: WEAPON },
        {
          name: "Legacy Budget Shield",
          type: "armor",
          properties: { baseAC: 2, armorClass: "shield" },
        },
      ],
    });
    const campaignId = fixture.created.campaignId!;

    await expectCode(
      await postAction(request, campaignId, "I equip the Legacy Budget Blade"),
      "OBJECT_INTERACTION_BUDGET_UNAVAILABLE",
    );
    const shield = await postAction(
      request,
      campaignId,
      "I equip the Legacy Budget Shield",
    );
    expect(shield.status()).toBe(200);
    expect(await eventTypes(shield)).toEqual(["EQUIP_ITEM", "TURN_ADVANCE"]);

    const rows = await prisma.inventoryItem.findMany({
      where: {
        characterId: fixture.created.characterId,
        name: { in: ["Legacy Budget Blade", "Legacy Budget Shield"] },
      },
      orderBy: { name: "asc" },
      select: { name: true, equippedSlot: true },
    });
    expect(rows).toEqual([
      { name: "Legacy Budget Blade", equippedSlot: null },
      { name: "Legacy Budget Shield", equippedSlot: "OFF_HAND" },
    ]);
    const encounter = await prisma.encounter.findUniqueOrThrow({
      where: { id: fixture.encounterId },
      select: { currentTurnIndex: true, currentTurnObjectInteractionUsed: true },
    });
    expect(encounter).toEqual({
      currentTurnIndex: 1,
      currentTurnObjectInteractionUsed: false,
    });
    expect(
      await userLogCount(prisma, campaignId, [
        "I equip the Legacy Budget Blade",
        "I equip the Legacy Budget Shield",
      ]),
    ).toBe(1);
    expect(await receiptEventCount(prisma, campaignId, "EQUIP_ITEM")).toBe(1);
  } finally {
    await cleanupFixture(prisma, fixture);
  }
});

test("@smoke body armour and shield replacement refuse without state, log, or event", async ({
  request,
}) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();
  const prisma = new PrismaClient();
  let fixture: EquipmentFixture | undefined;
  try {
    fixture = await createEquipmentFixture(request, prisma, {
      objectInteractionUsed: false,
      items: [
        {
          name: "Policy Chain Mail",
          type: "armor",
          properties: { baseAC: 16, armorClass: "heavy", addDexModifier: false },
        },
        {
          name: "Oak Guard",
          type: "armor",
          equippedSlot: "OFF_HAND",
          properties: { baseAC: 2, armorClass: "shield" },
        },
        {
          name: "Steel Ward",
          type: "armor",
          properties: { baseAC: 2, armorClass: "shield" },
        },
      ],
    });
    const campaignId = fixture.created.campaignId!;
    const armorAction = "I equip the Policy Chain Mail";
    const shieldAction = "I equip the Steel Ward";

    await expectCode(
      await postAction(request, campaignId, armorAction),
      "EQUIP_REQUIRES_OUT_OF_COMBAT",
    );
    await expectCode(
      await postAction(request, campaignId, shieldAction),
      "EQUIPMENT_CHANGE_REQUIRES_MULTIPLE_TURNS",
    );

    const rows = await prisma.inventoryItem.findMany({
      where: {
        characterId: fixture.created.characterId,
        name: { in: ["Policy Chain Mail", "Oak Guard", "Steel Ward"] },
      },
      orderBy: { name: "asc" },
      select: { name: true, equippedSlot: true },
    });
    expect(rows).toEqual([
      { name: "Oak Guard", equippedSlot: "OFF_HAND" },
      { name: "Policy Chain Mail", equippedSlot: null },
      { name: "Steel Ward", equippedSlot: null },
    ]);
    const encounter = await prisma.encounter.findUniqueOrThrow({
      where: { id: fixture.encounterId },
      select: { currentTurnIndex: true, currentTurnObjectInteractionUsed: true },
    });
    expect(encounter).toEqual({
      currentTurnIndex: 0,
      currentTurnObjectInteractionUsed: false,
    });
    expect(await userLogCount(prisma, campaignId, [armorAction, shieldAction])).toBe(0);
    expect(await receiptEventCount(prisma, campaignId, "EQUIP_ITEM")).toBe(0);
  } finally {
    await cleanupFixture(prisma, fixture);
  }
});

// Both requests queue on the Character row lock, so the second is decided only
// after the first has committed. Re-reading under the lock, the loser finds the
// slot taken and the free interaction spent, and is refused as a replacement
// that needs more than one turn: decided from committed state, not from the
// "slot empty, interaction unused" snapshot it started from.
test("@smoke concurrent equips into the same slot re-decide the loser under the Character lock", async ({
  request,
}) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();
  const prisma = new PrismaClient();
  let fixture: EquipmentFixture | undefined;
  let lock: ReturnType<typeof holdCharacterLock> | undefined;
  try {
    fixture = await createEquipmentFixture(request, prisma, {
      objectInteractionUsed: false,
      items: [
        { name: "Race Blade Alpha", type: "weapon", properties: WEAPON },
        { name: "Race Blade Beta", type: "weapon", properties: WEAPON },
      ],
    });
    const campaignId = fixture.created.campaignId!;
    lock = holdCharacterLock(prisma, fixture.created.characterId!);
    await lock.isHeld;

    const first = postAction(request, campaignId, "I equip the Race Blade Alpha");
    const second = postAction(request, campaignId, "I equip the Race Blade Beta");
    await waitForBlockedCharacterLocks(prisma, 2);
    lock.release();
    await lock.transaction;
    const responses = await Promise.all([first, second]);
    expect(responses.map((response) => response.status()).sort()).toEqual([200, 409]);

    const success = responses.find((response) => response.status() === 200)!;
    const loser = responses.find((response) => response.status() === 409)!;
    expect(await eventTypes(success)).toEqual(["EQUIP_ITEM"]);
    await expectCode(loser, "EQUIPMENT_CHANGE_REQUIRES_MULTIPLE_TURNS");
    const owners = await prisma.inventoryItem.findMany({
      where: {
        characterId: fixture.created.characterId,
        equippedSlot: "MAIN_HAND",
        name: { in: ["Race Blade Alpha", "Race Blade Beta"] },
      },
      select: { id: true },
    });
    expect(owners).toHaveLength(1);
    const encounter = await prisma.encounter.findUniqueOrThrow({
      where: { id: fixture.encounterId },
      select: { currentTurnIndex: true, currentTurnObjectInteractionUsed: true },
    });
    expect(encounter).toEqual({
      currentTurnIndex: 0,
      currentTurnObjectInteractionUsed: true,
    });
    expect(
      await userLogCount(prisma, campaignId, [
        "I equip the Race Blade Alpha",
        "I equip the Race Blade Beta",
      ]),
    ).toBe(1);
    expect(await receiptEventCount(prisma, campaignId, "EQUIP_ITEM")).toBe(1);
  } finally {
    lock?.release();
    await lock?.transaction.catch(() => undefined);
    await cleanupFixture(prisma, fixture);
  }
});

// The first request claims the turn's free object interaction and stays on
// turn. The second is re-decided after that claim commits: its slot is still
// empty but the interaction is spent, so it is a legal equip that costs the
// action and ends the turn. The interaction is claimed exactly once and the
// turn ends exactly once — the second request is never decided from its stale
// "interaction unused" read. Note the product consequence this pins: a second
// free equip that arrives while the first is in flight ends the player's turn.
test("@smoke concurrent free equips in different slots claim the interaction once and the action once", async ({
  request,
}) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();
  const prisma = new PrismaClient();
  let fixture: EquipmentFixture | undefined;
  let lock: ReturnType<typeof holdCharacterLock> | undefined;
  try {
    fixture = await createEquipmentFixture(request, prisma, {
      objectInteractionUsed: false,
      items: [
        { name: "CAS Blade", type: "weapon", properties: WEAPON },
        { name: "CAS Charm", type: "misc", properties: {} },
      ],
    });
    const campaignId = fixture.created.campaignId!;
    lock = holdCharacterLock(prisma, fixture.created.characterId!);
    await lock.isHeld;

    const bladeRequest = postAction(request, campaignId, "I equip the CAS Blade");
    const charmRequest = postAction(request, campaignId, "I equip the CAS Charm");
    await waitForBlockedCharacterLocks(prisma, 2);
    lock.release();
    await lock.transaction;
    const responses = await Promise.all([bladeRequest, charmRequest]);
    expect(responses.map((response) => response.status())).toEqual([200, 200]);

    const eventLists = await Promise.all(responses.map(eventTypes));
    expect(eventLists.map((events) => events.join(",")).sort()).toEqual([
      "EQUIP_ITEM",
      "EQUIP_ITEM,TURN_ADVANCE",
    ]);
    const items = await prisma.inventoryItem.findMany({
      where: {
        characterId: fixture.created.characterId,
        name: { in: ["CAS Blade", "CAS Charm"] },
      },
      orderBy: { name: "asc" },
      select: { name: true, equippedSlot: true },
    });
    expect(items).toEqual([
      { name: "CAS Blade", equippedSlot: "MAIN_HAND" },
      { name: "CAS Charm", equippedSlot: "ACCESSORY" },
    ]);
    const encounter = await prisma.encounter.findUniqueOrThrow({
      where: { id: fixture.encounterId },
      select: { round: true, currentTurnIndex: true, currentTurnObjectInteractionUsed: true },
    });
    expect(encounter).toEqual({
      round: 1,
      currentTurnIndex: 1,
      currentTurnObjectInteractionUsed: false,
    });
    expect(
      await userLogCount(prisma, campaignId, [
        "I equip the CAS Blade",
        "I equip the CAS Charm",
      ]),
    ).toBe(2);
    expect(await receiptEventCount(prisma, campaignId, "EQUIP_ITEM")).toBe(2);
  } finally {
    lock?.release();
    await lock?.transaction.catch(() => undefined);
    await cleanupFixture(prisma, fixture);
  }
});

// Out of combat there is no action economy: an equip swaps immediately. Two
// concurrent swaps into the same slot therefore both succeed, one after the
// other, because the route serialises them on the Character row lock. The slot
// can never end with two owners; the later swap simply replaces the earlier.
test("@smoke concurrent out-of-combat equips serialise on the Character lock and leave one slot owner", async ({
  request,
}) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();
  const prisma = new PrismaClient();
  let fixture: EquipmentFixture | undefined;
  let lock: ReturnType<typeof holdCharacterLock> | undefined;
  try {
    fixture = await createEquipmentFixture(request, prisma, {
      objectInteractionUsed: false,
      items: [
        { name: "Camp Blade Alpha", type: "weapon", properties: WEAPON },
        { name: "Camp Blade Beta", type: "weapon", properties: WEAPON },
      ],
    });
    await prisma.encounter.update({
      where: { id: fixture.encounterId },
      data: { status: "resolved" },
    });
    const campaignId = fixture.created.campaignId!;
    lock = holdCharacterLock(prisma, fixture.created.characterId!);
    await lock.isHeld;

    const first = postAction(request, campaignId, "I equip the Camp Blade Alpha");
    const second = postAction(request, campaignId, "I equip the Camp Blade Beta");
    await waitForBlockedCharacterLocks(prisma, 2);
    lock.release();
    await lock.transaction;
    const responses = await Promise.all([first, second]);
    expect(responses.map((response) => response.status())).toEqual([200, 200]);
    for (const response of responses) {
      expect(await eventTypes(response)).toEqual(["EQUIP_ITEM"]);
    }

    const blades = await prisma.inventoryItem.findMany({
      where: {
        characterId: fixture.created.characterId,
        name: { in: ["Camp Blade Alpha", "Camp Blade Beta"] },
      },
      select: { equippedSlot: true },
    });
    expect(blades.map((blade) => blade.equippedSlot).sort()).toEqual([
      "MAIN_HAND",
      null,
    ]);
    expect(
      await userLogCount(prisma, campaignId, [
        "I equip the Camp Blade Alpha",
        "I equip the Camp Blade Beta",
      ]),
    ).toBe(2);
    expect(await receiptEventCount(prisma, campaignId, "EQUIP_ITEM")).toBe(2);
  } finally {
    lock?.release();
    await lock?.transaction.catch(() => undefined);
    await cleanupFixture(prisma, fixture);
  }
});

test("@smoke concurrent shield equip and End Turn have exactly one turn-ending winner", async ({
  request,
}) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();
  const prisma = new PrismaClient();
  let fixture: EquipmentFixture | undefined;
  let lock: ReturnType<typeof holdEncounterLock> | undefined;
  try {
    fixture = await createEquipmentFixture(request, prisma, {
      objectInteractionUsed: false,
      items: [
        {
          name: "Turn Race Shield",
          type: "armor",
          properties: { baseAC: 2, armorClass: "shield" },
        },
      ],
    });
    const campaignId = fixture.created.campaignId!;
    lock = holdEncounterLock(prisma, fixture.encounterId);
    await lock.isHeld;

    const equip = postAction(request, campaignId, "I equip the Turn Race Shield");
    await waitForBlockedEncounterUpdates(prisma, 1);
    const endTurn = postAction(request, campaignId, "End Turn");
    await waitForBlockedEncounterUpdates(prisma, 2);
    lock.release();
    await lock.transaction;
    const [equipResponse, endTurnResponse] = await Promise.all([equip, endTurn]);

    expect(equipResponse.status()).toBe(200);
    expect(endTurnResponse.status()).toBe(409);
    expect(await eventTypes(equipResponse)).toEqual(["EQUIP_ITEM", "TURN_ADVANCE"]);
    await expectCode(endTurnResponse, "TURN_STATE_CONFLICT");
    const shield = await prisma.inventoryItem.findFirstOrThrow({
      where: { characterId: fixture.created.characterId, name: "Turn Race Shield" },
      select: { equippedSlot: true },
    });
    expect(shield.equippedSlot).toBe("OFF_HAND");
    const encounter = await prisma.encounter.findUniqueOrThrow({
      where: { id: fixture.encounterId },
      select: { round: true, currentTurnIndex: true, currentTurnObjectInteractionUsed: true },
    });
    expect(encounter).toEqual({
      round: 1,
      currentTurnIndex: 1,
      currentTurnObjectInteractionUsed: false,
    });
    expect(
      await userLogCount(prisma, campaignId, [
        "I equip the Turn Race Shield",
        "End Turn",
      ]),
    ).toBe(1);
    expect(await receiptEventCount(prisma, campaignId, "EQUIP_ITEM")).toBe(1);
  } finally {
    lock?.release();
    await lock?.transaction.catch(() => undefined);
    await cleanupFixture(prisma, fixture);
  }
});

test("@smoke concurrent action-cost equip and Attack cannot commit two turn endings", async ({
  request,
}) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();
  const prisma = new PrismaClient();
  let fixture: EquipmentFixture | undefined;
  let lock: ReturnType<typeof holdCharacterLock> | undefined;
  try {
    fixture = await createEquipmentFixture(request, prisma, {
      objectInteractionUsed: true,
      items: [{ name: "Attack Race Charm", type: "misc", properties: {} }],
    });
    const campaignId = fixture.created.campaignId!;
    await prisma.inventoryItem.updateMany({
      where: { characterId: fixture.created.characterId, name: "Longsword" },
      data: { equippedSlot: "MAIN_HAND" },
    });
    const enemyBefore = await prisma.combatant.findUniqueOrThrow({
      where: { id: fixture.enemyCombatantId },
      select: { hp: true },
    });
    lock = holdCharacterLock(prisma, fixture.created.characterId!);
    await lock.isHeld;

    const equip = postAction(request, campaignId, "I equip the Attack Race Charm");
    await waitForBlockedCharacterLocks(prisma, 1);
    const attack = postAction(request, campaignId, "Attack", {
      targetIds: [fixture.enemyCombatantId],
    });
    await waitForBlockedCharacterLocks(prisma, 2);
    lock.release();
    await lock.transaction;
    const [equipResponse, attackResponse] = await Promise.all([equip, attack]);

    expect(equipResponse.status()).toBe(200);
    expect(attackResponse.status()).toBe(409);
    expect(await eventTypes(equipResponse)).toEqual(["EQUIP_ITEM", "TURN_ADVANCE"]);
    await expectCode(attackResponse, "TURN_STATE_CONFLICT");
    const charm = await prisma.inventoryItem.findFirstOrThrow({
      where: { characterId: fixture.created.characterId, name: "Attack Race Charm" },
      select: { equippedSlot: true },
    });
    expect(charm.equippedSlot).toBe("ACCESSORY");
    const enemyAfter = await prisma.combatant.findUniqueOrThrow({
      where: { id: fixture.enemyCombatantId },
      select: { hp: true },
    });
    expect(enemyAfter.hp).toBe(enemyBefore.hp);
    const encounter = await prisma.encounter.findUniqueOrThrow({
      where: { id: fixture.encounterId },
      select: { currentTurnIndex: true, currentTurnObjectInteractionUsed: true },
    });
    expect(encounter).toEqual({
      currentTurnIndex: 1,
      currentTurnObjectInteractionUsed: false,
    });
    expect(
      await userLogCount(prisma, campaignId, [
        "I equip the Attack Race Charm",
        "Attack",
      ]),
    ).toBe(1);
    expect(await receiptEventCount(prisma, campaignId, "EQUIP_ITEM")).toBe(1);
  } finally {
    lock?.release();
    await lock?.transaction.catch(() => undefined);
    await cleanupFixture(prisma, fixture);
  }
});
