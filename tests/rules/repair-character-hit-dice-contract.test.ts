import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  runHitDiceRepair,
  type HitDiceCharacterRow,
  type HitDiceRepairDb,
  type HitDiceRepairTx,
} from "@/scripts/repair-character-hit-dice";

type UpdateCall = { id: string; data: Record<string, number> };

function createFakeDb(
  initialRows: HitDiceCharacterRow[],
  options?: { failOnUpdateNumber?: number }
) {
  let store = initialRows.map((row) => ({ ...row }));
  const topLevelUpdate = vi.fn();

  const findMany = vi.fn(async (args: { where?: { id?: string } }) => {
    return store
      .filter((row) => !args.where?.id || row.id === args.where.id)
      .map((row) => ({ ...row }));
  });

  let lastTxUpdates: UpdateCall[] = [];

  const db = {
    character: {
      findMany,
      update: topLevelUpdate,
    },
    $transaction: vi.fn(async (fn: (tx: HitDiceRepairTx) => Promise<unknown>) => {
      const snapshot = store.map((row) => ({ ...row }));
      const txUpdateCalls: UpdateCall[] = [];

      const txUpdate = vi.fn(
        async (args: { where: { id: string }; data: Record<string, number> }) => {
          txUpdateCalls.push({ id: args.where.id, data: args.data });
          if (
            options?.failOnUpdateNumber !== undefined &&
            txUpdateCalls.length === options.failOnUpdateNumber
          ) {
            throw new Error("simulated update failure");
          }
          const idx = store.findIndex((row) => row.id === args.where.id);
          if (idx === -1) throw new Error(`missing row ${args.where.id}`);
          store[idx] = { ...store[idx], ...args.data };
          return store[idx];
        }
      );

      const tx: HitDiceRepairTx = {
        character: { findMany, update: txUpdate },
      };

      try {
        const result = await fn(tx);
        return result;
      } catch (error) {
        store = snapshot; // rollback: discard any writes made during this transaction
        throw error;
      } finally {
        lastTxUpdates = txUpdateCalls;
      }
    }),
  } as unknown as HitDiceRepairDb;

  return {
    db,
    store: () => store.map((row) => ({ ...row })),
    topLevelUpdate,
    lastTxUpdateCalls: () => lastTxUpdates,
  };
}

const settled: HitDiceCharacterRow = {
  id: "settled-1",
  xp: 6500,
  level: 5,
  hitDiceTotal: 5,
  hitDiceRemaining: 5,
};

/**
 * Model E settled state with XP running ahead of the applied level: four
 * ascensions are pending, but the persisted hit dice agree with the level, so
 * there is nothing for this tool to repair.
 */
const pending: HitDiceCharacterRow = {
  id: "pending-1",
  xp: 6500,
  level: 1,
  hitDiceTotal: 1,
  hitDiceRemaining: 1,
};

/**
 * hitDiceTotal already agrees with level — the only remaining divergence with
 * a single correct value under Model E's fail-closed contract.
 */
const repairableRemaining: HitDiceCharacterRow = {
  id: "repairable-1",
  xp: 6500,
  level: 5,
  hitDiceTotal: 5,
  hitDiceRemaining: 9,
};

const ambiguous: HitDiceCharacterRow = {
  id: "ambiguous-1",
  xp: 6500,
  level: 5,
  hitDiceTotal: 1,
  hitDiceRemaining: 1,
};

/** hitDiceTotal above level — AMBIGUOUS, never auto-repaired under Model E. */
const ambiguousExcessTotal: HitDiceCharacterRow = {
  id: "ambiguous-excess-1",
  xp: 6500,
  level: 5,
  hitDiceTotal: 7,
  hitDiceRemaining: 7,
};

const ambiguousWithBadRemaining: HitDiceCharacterRow = {
  id: "ambiguous-2",
  xp: 6500,
  level: 5,
  hitDiceTotal: 1,
  hitDiceRemaining: -3,
};

const invalidProgression: HitDiceCharacterRow = {
  id: "invalid-1",
  xp: 0,
  level: 5,
  hitDiceTotal: 5,
  hitDiceRemaining: 5,
};

describe("runHitDiceRepair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. dry-run with REPAIRABLE rows -> zero updates, resultCode 2", async () => {
    const { db, topLevelUpdate } = createFakeDb([settled, repairableRemaining]);
    const report = await runHitDiceRepair({ db, apply: false });

    expect(report.resultCode).toBe(2);
    expect(report.applied).toBe(false);
    expect(report.updatedCount).toBe(0);
    expect(topLevelUpdate).not.toHaveBeenCalled();
  });

  it("2. dry-run with everything valid -> zero updates, resultCode 0", async () => {
    const { db, topLevelUpdate } = createFakeDb([settled, pending]);
    const report = await runHitDiceRepair({ db, apply: false });

    expect(report.resultCode).toBe(0);
    expect(report.updatedCount).toBe(0);
    expect(topLevelUpdate).not.toHaveBeenCalled();
  });

  it("3. dry-run with AMBIGUOUS -> zero updates, resultCode 1", async () => {
    const { db, topLevelUpdate } = createFakeDb([settled, ambiguous]);
    const report = await runHitDiceRepair({ db, apply: false });

    expect(report.resultCode).toBe(1);
    expect(report.blocked).toBe(true);
    expect(topLevelUpdate).not.toHaveBeenCalled();
  });

  it("4. apply with one AMBIGUOUS among several rows -> zero updates", async () => {
    const { db, lastTxUpdateCalls } = createFakeDb([settled, repairableRemaining, ambiguous]);
    const report = await runHitDiceRepair({ db, apply: true });

    expect(report.blocked).toBe(true);
    expect(report.applied).toBe(false);
    expect(report.updatedCount).toBe(0);
    expect(lastTxUpdateCalls()).toEqual([]);
  });

  it("5. apply with INVALID_PROGRESSION -> zero updates", async () => {
    const { db, lastTxUpdateCalls } = createFakeDb([settled, invalidProgression]);
    const report = await runHitDiceRepair({ db, apply: true });

    expect(report.blocked).toBe(true);
    expect(report.updatedCount).toBe(0);
    expect(lastTxUpdateCalls()).toEqual([]);
  });

  it("6. report includes all rows in scope before blocking", async () => {
    const { db } = createFakeDb([settled, repairableRemaining, ambiguous, invalidProgression]);
    const report = await runHitDiceRepair({ db, apply: true });

    expect(report.rows.map((r) => r.characterId).sort()).toEqual(
      ["settled-1", "repairable-1", "ambiguous-1", "invalid-1"].sort()
    );
    expect(report.counts).toEqual({
      VALID_SETTLED: 1,
      REPAIRABLE: 1,
      AMBIGUOUS: 1,
      INVALID_PROGRESSION: 1,
    });
  });

  it("7. apply with all repairable -> updates happen inside a single transaction", async () => {
    const { db, lastTxUpdateCalls } = createFakeDb([repairableRemaining]);
    const report = await runHitDiceRepair({ db, apply: true });

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(report.applied).toBe(true);
    expect(report.updatedCount).toBe(1);
    expect(lastTxUpdateCalls()).toEqual([
      { id: "repairable-1", data: { hitDiceRemaining: 5 } },
    ]);
  });

  it("8. update payloads contain exclusively fields from the classifier's patch", async () => {
    const { db, lastTxUpdateCalls } = createFakeDb([repairableRemaining]);
    await runHitDiceRepair({ db, apply: true });

    const calls = lastTxUpdateCalls();
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0].data).sort()).toEqual(["hitDiceRemaining"]);
    expect(calls[0].data).not.toHaveProperty("xp");
    expect(calls[0].data).not.toHaveProperty("level");
  });

  it("9. a simulated failure on the second update rolls back everything", async () => {
    const repairableA: HitDiceCharacterRow = { ...repairableRemaining, id: "repairable-a" };
    const repairableB: HitDiceCharacterRow = { ...repairableRemaining, id: "repairable-b" };
    const { db, store } = createFakeDb([repairableA, repairableB], { failOnUpdateNumber: 2 });

    await expect(runHitDiceRepair({ db, apply: true })).rejects.toThrow(
      "simulated update failure"
    );

    const finalStore = store();
    expect(finalStore.find((r) => r.id === "repairable-a")).toEqual(repairableA);
    expect(finalStore.find((r) => r.id === "repairable-b")).toEqual(repairableB);
  });

  it("10. a second run after a successful repair is a no-op", async () => {
    const { db, store } = createFakeDb([repairableRemaining]);
    await runHitDiceRepair({ db, apply: true });

    const second = await runHitDiceRepair({ db, apply: true });

    expect(second.updatedCount).toBe(0);
    expect(second.applied).toBe(false);
    expect(second.resultCode).toBe(0);
    expect(store().find((r) => r.id === "repairable-1")).toEqual({
      id: "repairable-1",
      xp: 6500,
      level: 5,
      hitDiceTotal: 5,
      hitDiceRemaining: 5,
    });
  });

  it("11. --character-id scopes the operation to a single row", async () => {
    const { db, lastTxUpdateCalls } = createFakeDb([repairableRemaining, settled]);
    const report = await runHitDiceRepair({ db, apply: true, characterId: "repairable-1" });

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].characterId).toBe("repairable-1");
    expect(lastTxUpdateCalls()).toEqual([
      { id: "repairable-1", data: { hitDiceRemaining: 5 } },
    ]);
  });

  it("12. VALID_SETTLED rows never receive an update", async () => {
    const { db, lastTxUpdateCalls } = createFakeDb([settled, pending]);
    await runHitDiceRepair({ db, apply: true });

    expect(lastTxUpdateCalls()).toEqual([]);
  });

  it("13. an AMBIGUOUS row with an out-of-range remaining gets no partial repair", async () => {
    const { db, lastTxUpdateCalls } = createFakeDb([ambiguousWithBadRemaining]);
    const report = await runHitDiceRepair({ db, apply: true });

    expect(report.rows[0].status).toBe("AMBIGUOUS");
    expect(report.rows[0].patch).toBeUndefined();
    expect(lastTxUpdateCalls()).toEqual([]);
  });

  it("15. hitDiceTotal above level is AMBIGUOUS, not auto-lowered, and blocks the run", async () => {
    const { db, lastTxUpdateCalls } = createFakeDb([settled, ambiguousExcessTotal]);
    const report = await runHitDiceRepair({ db, apply: true });

    expect(report.resultCode).toBe(1);
    expect(report.blocked).toBe(true);
    expect(report.counts.AMBIGUOUS).toBe(1);
    expect(report.rows.find((r) => r.characterId === "ambiguous-excess-1")).toMatchObject({
      status: "AMBIGUOUS",
      patch: undefined,
    });
    expect(lastTxUpdateCalls()).toEqual([]);
  });

  it("14. importing the module does not open a real Prisma connection", async () => {
    expect((globalThis as unknown as { prisma?: unknown }).prisma).toBeUndefined();
    await import("@/scripts/repair-character-hit-dice");
    expect((globalThis as unknown as { prisma?: unknown }).prisma).toBeUndefined();
  });
});
