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

async function waitForBlockedConcentrationWrite(
  prisma: PrismaClient
): Promise<void> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const blocked = await prisma.$queryRaw<Array<{ query: string }>>`
      SELECT query
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
        AND query ILIKE '%concentrationSpellId%'
        AND (
          query ILIKE '%Character%'
          OR query ILIKE '%Combatant%'
        )
    `;

    if (blocked.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(
    "Timed out waiting for a Character or Combatant concentration write to block"
  );
}

test("@smoke concentration break and replacement do not deadlock", async ({ request }) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();
  let encounterId: string | undefined;
  let damageAction: Promise<CombatOutcome> | undefined;
  let replacementAction: Promise<CombatOutcome> | undefined;

  let firstCombatantLocked!: () => void;
  const firstHasCombatantLock = new Promise<void>((resolve) => {
    firstCombatantLocked = resolve;
  });

  let resumeDamageWrite!: () => void;
  const damageWriteMayResume = new Promise<void>((resolve) => {
    resumeDamageWrite = resolve;
  });

  const originalRandom = Math.random;

  try {
    created.characterId = await createdId(
      await request.post("/api/character", {
        data: {
          name: `Concentration race ${randomUUID().slice(0, 8)}`,
          race: "human",
          class: "wizard",
          stats: { STR: 8, DEX: 14, CON: 10, INT: 16, WIS: 10, CHA: 10 },
        },
      })
    );

    created.campaignId = await createdId(
      await request.post("/api/campaign", {
        data: {
          characterId: created.characterId,
          title: `Concentration race ${randomUUID().slice(0, 8)}`,
        },
      })
    );

    await prisma.character.update({
      where: { id: created.characterId },
      data: { concentrationSpellId: "Bless" },
    });

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
              name: "Concentrating Player",
              isPlayer: true,
              hp: 20,
              maxHp: 20,
              ac: 12,
              initiativeTotal: 20,
              stats: { STR: 8, DEX: 14, CON: 10, INT: 16, WIS: 10, CHA: 10 },
              conditions: [],
              concentrationSpellId: "Bless",
            },
            {
              name: "Damage Caster",
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

    const playerRow = encounter.combatants.find((combatant) => combatant.isPlayer);
    const enemyRow = encounter.combatants.find((combatant) => !combatant.isPlayer);
    expect(playerRow).toBeDefined();
    expect(enemyRow).toBeDefined();

    const combatants = encounter.combatants.map(toPipelineCombatant);
    const player = toPipelineCombatant(playerRow!);
    const enemy = toPipelineCombatant(enemyRow!);

    const damagePayload: CombatActionPayload = {
      actionType: "cast_spell",
      encounter: {
        id: encounter.id,
        round: encounter.round,
        currentTurnIndex: encounter.currentTurnIndex,
        totalDamageDealt: encounter.totalDamageDealt,
        status: "active",
        combatants,
      },
      actorId: enemy.id,
      actorName: enemy.name,
      actorConditions: [],
      targetCombatants: [player],
      spellName: "Concurrency Bolt",
      spellLevel: 0,
      spellEffect: {
        type: "damage",
        dice: "1d6",
        damageType: "force",
        hasSavingThrow: false,
      },
      playerCharacterId: created.characterId,
      collectEvents: false,
    };

    const replacementPayload: CombatActionPayload = {
      actionType: "cast_spell",
      encounter: {
        id: encounter.id,
        round: encounter.round,
        currentTurnIndex: encounter.currentTurnIndex,
        totalDamageDealt: encounter.totalDamageDealt,
        status: "active",
        combatants,
      },
      actorId: player.id,
      actorName: player.name,
      actorConditions: [],
      targetCombatants: [],
      spellName: "Haste",
      spellLevel: 0,
      spellEffect: {
        type: "utility",
        concentration: true,
      },
      playerCharacterId: created.characterId,
      actorConcentrationSpellId: "Bless",
      collectEvents: false,
    };

    // Damage=6, hit location=head, CON save=1. The replacement action rolls
    // nothing, so this queue is deterministic across the forced interleaving.
    const randomValues = [0.99, 0.0, 0.0];
    let randomIndex = 0;
    Math.random = () => randomValues[randomIndex++] ?? 0.0;

    // Transaction A pauses immediately after the real HP decrement. Under the
    // corrected order it already owns Character before Combatant; under the old
    // order it owns only Combatant at this point.
    damageAction = prisma.$transaction(async (realTx) => {
      let paused = false;
      const instrumentedTx = {
        combatant: {
          update: async (args: unknown) => {
            const result = await realTx.combatant.update(
              args as Prisma.CombatantUpdateArgs
            );
            if (!paused) {
              paused = true;
              firstCombatantLocked();
              await damageWriteMayResume;
            }
            return result;
          },
        },
        character: {
          update: (args: unknown) =>
            realTx.character.update(args as Prisma.CharacterUpdateArgs),
        },
        encounter: {
          update: (args: unknown) =>
            realTx.encounter.update(args as Prisma.EncounterUpdateArgs),
        },
      } as unknown as Prisma.TransactionClient;

      return executeCombatAction(damagePayload, instrumentedTx);
    });

    await firstHasCombatantLock;

    // Transaction B now reaches whichever concentration write the lock order
    // makes wait: Combatant on the old inverse order, Character on the canonical
    // order. Releasing A only after PostgreSQL reports that blocked write keeps
    // the regression deterministic without assuming which implementation is
    // under test. The old order forms a cycle and remains RED; the canonical
    // order serializes both operations.
    replacementAction = prisma.$transaction((realTx) =>
      executeCombatAction(replacementPayload, realTx)
    );

    await waitForBlockedConcentrationWrite(prisma);
    resumeDamageWrite();

    const [damageResult, replacementResult] = await Promise.allSettled([
      damageAction,
      replacementAction,
    ]);

    // Both mechanically valid operations must serialize. A raw PostgreSQL
    // deadlock means one accepted action is aborted by lock ordering rather than
    // by a domain rule or an explicit optimistic-concurrency conflict.
    expect([damageResult.status, replacementResult.status]).toEqual([
      "fulfilled",
      "fulfilled",
    ]);

    const [persistedCharacter, persistedPlayer] = await Promise.all([
      prisma.character.findUniqueOrThrow({
        where: { id: created.characterId },
        select: { concentrationSpellId: true },
      }),
      prisma.combatant.findUniqueOrThrow({
        where: { id: player.id },
        select: { concentrationSpellId: true },
      }),
    ]);

    // Concentration is mirrored on Character and the active player Combatant;
    // whichever operation serializes last, the committed pair must agree.
    expect(persistedCharacter.concentrationSpellId).toBe("Haste");
    expect(persistedPlayer.concentrationSpellId).toBe("Haste");
  } finally {
    Math.random = originalRandom;
    resumeDamageWrite();
    await Promise.allSettled([
      damageAction ?? Promise.resolve(undefined),
      replacementAction ?? Promise.resolve(undefined),
    ]);

    if (encounterId) {
      await prisma.combatant.deleteMany({ where: { encounterId } });
      await prisma.encounter.deleteMany({ where: { id: encounterId } });
    }

    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});
