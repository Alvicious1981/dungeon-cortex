import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { expect, test } from "@playwright/test";

import {
  executeCombatAction,
  type CombatActionPayload,
  type CombatOutcome,
  type PipelineCombatant,
} from "../../lib/rules/combat-pipeline";
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

function toPipelineCombatant(row: {
  id: string;
  name: string;
  isPlayer: boolean;
  hp: number;
  maxHp: number;
  ac: number;
  conditions: Prisma.JsonValue;
  stats: Prisma.JsonValue;
  damageImmunities: string[];
  damageResistances: string[];
  damageVulnerabilities: string[];
  conditionImmunities: string[];
  concentrationSpellId: string | null;
}): PipelineCombatant {
  return {
    id: row.id,
    name: row.name,
    isPlayer: row.isPlayer,
    hp: row.hp,
    maxHp: row.maxHp,
    ac: row.ac,
    conditions: row.conditions,
    stats: row.stats,
    damageImmunities: row.damageImmunities,
    damageResistances: row.damageResistances,
    damageVulnerabilities: row.damageVulnerabilities,
    conditionImmunities: row.conditionImmunities,
    concentrationSpellId: row.concentrationSpellId,
  };
}

test("@smoke concurrent combat damage preserves both accepted hits", async ({ request }) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();
  let encounterId: string | undefined;
  let firstAction: Promise<CombatOutcome> | undefined;

  let firstReachedWrite!: () => void;
  const firstIsPaused = new Promise<void>((resolve) => {
    firstReachedWrite = resolve;
  });

  let resumeFirstWrite!: () => void;
  const secondActionCommitted = new Promise<void>((resolve) => {
    resumeFirstWrite = resolve;
  });

  try {
    created.characterId = await createdId(
      await request.post("/api/character", {
        data: {
          name: `Combat race ${randomUUID().slice(0, 8)}`,
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
          title: `Combat race ${randomUUID().slice(0, 8)}`,
        },
      })
    );

    const encounter = await prisma.encounter.create({
      data: {
        campaignId: created.campaignId,
        status: "active",
        round: 1,
        currentTurnIndex: 0,
        totalDamageDealt: 0,
        combatants: {
          create: [
            {
              name: "Concurrency Caster",
              isPlayer: true,
              hp: 20,
              maxHp: 20,
              ac: 12,
              initiativeTotal: 20,
              stats: { STR: 8, DEX: 14, CON: 12, INT: 16, WIS: 10, CHA: 10 },
              conditions: [],
            },
            {
              name: "Concurrency Target",
              isPlayer: false,
              hp: 20,
              maxHp: 20,
              ac: 10,
              initiativeTotal: 10,
              stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
              conditions: [],
            },
          ],
        },
      },
      include: {
        combatants: { orderBy: { initiativeTotal: "desc" } },
      },
    });
    encounterId = encounter.id;

    const actor = encounter.combatants.find((combatant) => combatant.isPlayer);
    const target = encounter.combatants.find((combatant) => !combatant.isPlayer);
    expect(actor).toBeDefined();
    expect(target).toBeDefined();

    const combatants = encounter.combatants.map(toPipelineCombatant);
    const staleTarget = toPipelineCombatant(target!);

    const payload: CombatActionPayload = {
      actionType: "cast_spell",
      encounter: {
        id: encounter.id,
        round: encounter.round,
        currentTurnIndex: encounter.currentTurnIndex,
        totalDamageDealt: encounter.totalDamageDealt,
        status: "active",
        combatants,
      },
      actorId: actor!.id,
      actorName: actor!.name,
      actorConditions: [],
      targetCombatants: [staleTarget],
      spellName: "Concurrency Bolt",
      spellLevel: 0,
      spellEffect: {
        type: "damage",
        dice: "1d1",
        damageType: "force",
        hasSavingThrow: false,
      },
      collectEvents: false,
    };

    firstAction = prisma.$transaction(async (realTx) => {
      let paused = false;
      const instrumentedTx = {
        combatant: {
          update: async (args: unknown) => {
            if (!paused) {
              paused = true;
              firstReachedWrite();
              await secondActionCommitted;
            }
            return realTx.combatant.update(args as Prisma.CombatantUpdateArgs);
          },
        },
        encounter: {
          update: (args: unknown) =>
            realTx.encounter.update(args as Prisma.EncounterUpdateArgs),
        },
      } as unknown as Prisma.TransactionClient;

      return executeCombatAction(payload, instrumentedTx);
    });

    await firstIsPaused;

    const secondAction = await prisma.$transaction((tx) =>
      executeCombatAction(payload, tx)
    );
    expect(secondAction.totalDamageDealt).toBe(1);

    resumeFirstWrite();
    const firstResult = await firstAction;
    expect(firstResult.totalDamageDealt).toBe(1);

    const [persistedTarget, persistedEncounter] = await Promise.all([
      prisma.combatant.findUniqueOrThrow({
        where: { id: target!.id },
        select: { hp: true },
      }),
      prisma.encounter.findUniqueOrThrow({
        where: { id: encounter.id },
        select: { totalDamageDealt: true },
      }),
    ]);

    // Both accepted actions report one point of damage and the encounter's
    // atomic counter records both. Target HP must therefore also preserve both
    // points. A final HP of 19 proves one absolute stale write overwrote the
    // other despite both actions committing.
    expect(persistedEncounter.totalDamageDealt).toBe(2);
    expect(persistedTarget.hp).toBe(18);
  } finally {
    resumeFirstWrite();
    await firstAction?.catch(() => undefined);

    if (encounterId) {
      await prisma.combatant.deleteMany({ where: { encounterId } });
      await prisma.encounter.deleteMany({ where: { id: encounterId } });
    }

    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});
