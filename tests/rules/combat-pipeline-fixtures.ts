/**
 * tests/rules/combat-pipeline-fixtures.ts
 *
 * Shared, non-executing test builders for `lib/rules/combat-pipeline.ts`.
 *
 * Pulled out of `combat-pipeline.test.ts` so `damage-modifiers-both-paths.test.ts`
 * can drive the same mock transaction and combatant fixtures without importing
 * a `.test.ts` module — importing a test file for its exports also re-registers
 * every `describe`/`it` in it under the importing file, which would silently
 * double-run this suite's ~40 cases on every run of the agreement test.
 */
import { vi } from "vitest";
import type {
  PipelineCombatant,
  PipelineEncounterState,
} from "@/lib/rules/combat-pipeline";
import type { Prisma } from "@prisma/client";

/** Build a minimal mock Prisma.TransactionClient with vi.fn() on every method
 *  used by the pipeline. Override characterHp / characterMaxHp to test healing. */
export function buildMockTx(opts: { characterHp?: number; characterMaxHp?: number } = {}) {
  const { characterHp = 20, characterMaxHp = 20 } = opts;
  return {
    character: {
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue({
        id: "char-1",
        hp: characterHp,
        maxHp: characterMaxHp,
        concentrationSpellId: null,
      }),
    },
    combatant: {
      update: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
    encounter: {
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      // Select-aware on purpose. Prisma returns only the fields the `select`
      // asked for; a mock that returns a fixed superset lets a call site read
      // a field its own query never requested and still go green.
      findUnique: vi.fn().mockImplementation((args?: { select?: Record<string, unknown> }) => {
        const select = args?.select ?? {};
        const row: Record<string, unknown> = {};
        if (select.campaignId) row.campaignId = "camp-1";
        if (select.campaign) row.campaign = { characterId: "char-1" };
        return Promise.resolve(row);
      }),
    },
    inventoryItem: {
      delete: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
  } as unknown as Prisma.TransactionClient;
}

export function buildEnemy(overrides: Partial<PipelineCombatant> = {}): PipelineCombatant {
  return {
    id: "enemy-1",
    name: "Goblin",
    isPlayer: false,
    hp: 15,
    maxHp: 15,
    ac: 10,
    conditions: [],
    stats: { STR: 8, DEX: 10, CON: 10, INT: 8, WIS: 8, CHA: 8 },
    concentrationSpellId: null,
    ...overrides,
  };
}

export function buildPlayer(overrides: Partial<PipelineCombatant> = {}): PipelineCombatant {
  return {
    id: "player-1",
    name: "Aldric",
    isPlayer: true,
    hp: 20,
    maxHp: 20,
    ac: 15,
    conditions: [],
    stats: { STR: 16, DEX: 12, CON: 10, INT: 10, WIS: 10, CHA: 8 },
    concentrationSpellId: null,
    ...overrides,
  };
}

export function buildEncounter(combatants: PipelineCombatant[]): PipelineEncounterState {
  return {
    id: "enc-1",
    round: 1,
    currentTurnIndex: 0,
    totalDamageDealt: 0,
    status: "active",
    combatants,
  };
}
