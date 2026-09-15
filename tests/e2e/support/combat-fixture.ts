import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { expect, type APIRequestContext, type APIResponse } from "@playwright/test";

import { profileMonster } from "@/lib/rules/monster-attack-profile";
import { cleanupE2ERecords, type E2ECreatedRecords } from "./database";

/**
 * One player and one goblin on real PostgreSQL, shared by the enemy-turn and
 * death-save smoke specs. By default the player has 200 HP, so a critical hit
 * can never down them and turn a smoke test into a coin flip. The goblin's
 * profile comes from the same SRD file prisma/seed-srd.ts loads, through the
 * production recognizer.
 */
const GOBLIN = (
  JSON.parse(
    readFileSync(join(process.cwd(), "data", "srd-es", "monsters.json"), "utf8"),
  ) as Array<Record<string, unknown>>
).find((m) => m.index === "goblin")!;

export interface ActionSseFrame {
  t: string;
  e?: { type?: string; payload?: Record<string, unknown> };
}

export function parseSseFrames(body: string): ActionSseFrame[] {
  return body
    .split(/\n\n/)
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice(6)) as ActionSseFrame);
}

export async function createdId(response: APIResponse): Promise<string> {
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { id?: unknown };
  expect(typeof body.id).toBe("string");
  return body.id as string;
}

export function postAction(
  request: APIRequestContext,
  campaignId: string,
  action: string,
  extra: Record<string, unknown> = {},
): Promise<APIResponse> {
  return request.post(`/api/campaign/${campaignId}/action`, {
    data: { requestId: `combat-e2e-${randomUUID()}`, action, ...extra },
  });
}

export interface GoblinFixture {
  created: E2ECreatedRecords;
  encounterId: string;
  playerId: string;
  goblinId: string;
}

export interface FixturePlayerState {
  hp?: number;
  deathSaveSuccesses?: number;
  deathSaveFailures?: number;
  stableWakeRound?: number | null;
}

export async function createGoblinFixture(
  request: APIRequestContext,
  prisma: PrismaClient,
  options: {
    goblinAt: { x: number; y: number };
    withProfile: boolean;
    currentTurnIndex: number;
    /** The player's starting death-save state (death-saves spec §4). */
    player?: FixturePlayerState;
  },
): Promise<GoblinFixture> {
  const created: E2ECreatedRecords = {};
  const suffix = randomUUID().slice(0, 8);
  created.characterId = await createdId(
    await request.post("/api/character", {
      data: {
        name: `Combat e2e ${suffix}`,
        race: "human",
        class: "fighter",
        stats: { STR: 16, DEX: 14, CON: 14, INT: 10, WIS: 12, CHA: 8 },
      },
    }),
  );
  created.campaignId = await createdId(
    await request.post("/api/campaign", {
      data: { characterId: created.characterId, title: `Combat e2e ${suffix}` },
    }),
  );
  const playerHp = options.player?.hp ?? 200;
  // Character.hp is canonical and the Combatant mirrors it (enemy-turns §6.3).
  await prisma.character.update({
    where: { id: created.characterId },
    data: { hp: playerHp, maxHp: 200 },
  });

  const profile = profileMonster(GOBLIN);
  expect(profile).not.toBeNull();

  const encounter = await prisma.encounter.create({
    data: {
      campaignId: created.campaignId,
      status: "active",
      round: 1,
      currentTurnIndex: options.currentTurnIndex,
      currentTurnMovementSpentFt: 0,
      currentTurnObjectInteractionUsed: false,
      totalDamageDealt: 0,
      combatants: {
        create: [
          {
            name: "Combat E2E Hero",
            isPlayer: true,
            hp: playerHp,
            maxHp: 200,
            ac: 16,
            initiativeTotal: 20,
            initiativeOrder: 0,
            stats: { STR: 16, DEX: 14, CON: 14, INT: 10, WIS: 12, CHA: 8 },
            conditions: [],
            x: 5,
            y: 5,
            deathSaveSuccesses: options.player?.deathSaveSuccesses ?? 0,
            deathSaveFailures: options.player?.deathSaveFailures ?? 0,
            stableWakeRound: options.player?.stableWakeRound ?? null,
          },
          {
            name: "Goblin",
            isPlayer: false,
            hp: 7,
            maxHp: 7,
            ac: 15,
            initiativeTotal: 10,
            initiativeOrder: 1,
            stats: { STR: 8, DEX: 14, CON: 10, INT: 10, WIS: 8, CHA: 8 },
            conditions: [],
            size: "Small",
            x: options.goblinAt.x,
            y: options.goblinAt.y,
            ...(options.withProfile
              ? { attackProfile: profile as unknown as Prisma.InputJsonValue }
              : {}),
          },
        ],
      },
    },
    include: { combatants: true },
  });

  return {
    created,
    encounterId: encounter.id,
    playerId: encounter.combatants.find((c) => c.isPlayer)!.id,
    goblinId: encounter.combatants.find((c) => !c.isPlayer)!.id,
  };
}

export async function cleanupFixture(prisma: PrismaClient, fixture: GoblinFixture | undefined) {
  if (fixture) {
    await prisma.combatant.deleteMany({ where: { encounterId: fixture.encounterId } });
    await prisma.encounter.deleteMany({ where: { id: fixture.encounterId } });
  }
  await prisma.$disconnect();
  if (fixture) await cleanupE2ERecords(fixture.created);
}

export function holdCharacterLock(prisma: PrismaClient, characterId: string) {
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

export async function waitForBlockedCharacterLocks(prisma: PrismaClient, minimum: number) {
  // Prisma interactive transactions default to 5 seconds; both requests reach
  // the Character lock in milliseconds.
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
