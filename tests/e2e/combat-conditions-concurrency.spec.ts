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

function conditionPayload(input: {
  encounterId: string;
  combatants: PipelineCombatant[];
  actor: PipelineCombatant;
  target: PipelineCombatant;
  condition: string;
}): CombatActionPayload {
  return {
    actionType: "cast_spell",
    encounter: {
      id: input.encounterId,
      round: 1,
      currentTurnIndex: 0,
      totalDamageDealt: 0,
      status: "active",
      combatants: input.combatants,
    },
    actorId: input.actor.id,
    actorName: input.actor.name,
    actorConditions: [],
    targetCombatants: [input.target],
    spellName: `Concurrency ${input.condition}`,
    spellLevel: 0,
    spellEffect: {
      type: "utility",
      hasSavingThrow: false,
      condition: input.condition,
    },
    collectEvents: false,
  };
}

test("@smoke concurrent combat conditions preserve both accepted effects", async ({ request }) => {
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
          name: `Condition race ${randomUUID().slice(0, 8)}`,
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
          title: `Condition race ${randomUUID().slice(0, 8)}`,
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

    const actorRow = encounter.combatants.find((combatant) => combatant.isPlayer);
    const targetRow = encounter.combatants.find((combatant) => !combatant.isPlayer);
    expect(actorRow).toBeDefined();
    expect(targetRow).toBeDefined();

    const combatants = encounter.combatants.map(toPipelineCombatant);
    const actor = toPipelineCombatant(actorRow!);
    const staleTarget = toPipelineCombatant(targetRow!);

    const restrainedPayload = conditionPayload({
      encounterId: encounter.id,
      combatants,
      actor,
      target: staleTarget,
      condition: "restrained",
    });
    const poisonedPayload = conditionPayload({
      encounterId: encounter.id,
      combatants,
      actor,
      target: staleTarget,
      condition: "poisoned",
    });

    // Pause the first transaction after it has derived ["restrained"] from the
    // stale target snapshot but before PostgreSQL sees its absolute conditions
    // write. The second transaction then commits ["poisoned"] first. Resuming
    // the stale writer deterministically exposes whether condition composition
    // is based on persisted state or replaces it from the old snapshot.
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
      } as unknown as Prisma.TransactionClient;

      return executeCombatAction(restrainedPayload, instrumentedTx);
    });

    await firstIsPaused;

    const secondResult = await prisma.$transaction((tx) =>
      executeCombatAction(poisonedPayload, tx)
    );
    expect(secondResult.consequences).toHaveLength(1);
    expect(secondResult.consequences[0]?.conditionsApplied).toEqual(["poisoned"]);

    resumeFirstWrite();
    const firstResult = await firstAction;
    expect(firstResult.consequences).toHaveLength(1);
    expect(firstResult.consequences[0]?.conditionsApplied).toEqual(["restrained"]);

    const persistedTarget = await prisma.combatant.findUniqueOrThrow({
      where: { id: targetRow!.id },
      select: { hp: true, conditions: true },
    });

    // Both accepted actions report a distinct condition as applied. Because
    // Combatant.conditions is canonical state, the committed row must compose
    // both effects. A stale whole-array replacement instead leaves only the
    // condition written by whichever transaction commits last.
    expect(persistedTarget.hp).toBe(20);
    expect(persistedTarget.conditions).toEqual(
      expect.arrayContaining(["restrained", "poisoned"])
    );
    expect(persistedTarget.conditions).toHaveLength(2);
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
