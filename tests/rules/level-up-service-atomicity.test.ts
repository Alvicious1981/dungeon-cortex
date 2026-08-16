/**
 * Concurrency contract for applyLevelUp (Model E).
 *
 * The read-then-write guards inside the service (assertValidProgressionState,
 * resolveNextLevel) evaluate a row that a second caller can change before either
 * writes. They are not the defense. The defense is the conditional write itself:
 * `updateMany` repeats the pre-ascension state (`level`, `hitDiceTotal`) in its own
 * WHERE clause, so only the request whose predicate still matches the committed
 * row can move it.
 *
 * The store below simulates that serialization the way a row lock does: a
 * `readGate` holds every read open until released, forcing both callers to
 * observe the same pre-ascension row before either reaches its write, and
 * `updateMany` re-checks the live row (not a stale snapshot) before deciding
 * whether its predicate still matches.
 *
 * This is a mock of the service's own logic, not an integration test against
 * PostgreSQL. It proves `applyLevelUp` emits and honors the correct compare-
 * and-set; the final concurrency guarantee under real concurrent transactions
 * still rests on PostgreSQL's row-lock and READ COMMITTED re-evaluation
 * semantics, which this test does not and cannot exercise.
 */
import { describe, expect, it, vi } from "vitest";
import { applyLevelUp, LevelUpServiceError } from "@/lib/rules/level-up-service";
import { xpForLevel } from "@/lib/rules/progression";

interface Row {
  id: string;
  campaignId: string;
  xp: number;
  level: number;
  class: string;
  stats: Record<string, number>;
  hp: number;
  maxHp: number;
  hitDiceTotal: number;
  hitDiceRemaining: number;
}

// Model E settled state: `level` is the last mechanically applied level and
// `hitDiceTotal` agrees with it (hitDiceTotal === level). XP already supports
// level 2, so exactly one ascension (1 -> 2) is pending.
function pendingRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "character-1",
    campaignId: "campaign-1",
    xp: xpForLevel(2),
    level: 1,
    class: "fighter",
    stats: { CON: 14 },
    hp: 4,
    maxHp: 10,
    hitDiceTotal: 1,
    hitDiceRemaining: 0,
    ...overrides,
  };
}

/**
 * A tiny store that serialises conditional writes the way a row lock does:
 * each updateMany checks the live row (not a stale read), exactly as the
 * compare-and-set relies on PostgreSQL doing under READ COMMITTED.
 */
function makeStore(row: Row) {
  const writes: Array<Record<string, unknown>> = [];
  let readGate: Promise<void> | null = null;

  const db = {
    campaign: {
      findUnique: vi.fn(async () => ({ id: row.campaignId, characterId: row.id })),
    },
    character: {
      findUnique: vi.fn(async () => {
        if (readGate) await readGate;
        return { ...row };
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; level: number; hitDiceTotal: number };
          data: Record<string, number>;
        }) => {
          const matches =
            where.id === row.id &&
            where.level === row.level &&
            where.hitDiceTotal === row.hitDiceTotal;
          if (!matches) return { count: 0 };
          Object.assign(row, data);
          writes.push({ ...data });
          return { count: 1 };
        }
      ),
    },
  };

  return {
    db,
    writes,
    row,
    /** Holds every read open until released, forcing both callers to overlap. */
    openReadGate() {
      let release!: () => void;
      readGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        readGate = null;
        release();
      };
    },
  };
}

function call(store: ReturnType<typeof makeStore>) {
  return applyLevelUp({
    campaignId: "campaign-1",
    characterId: "character-1",
    source: "test",
    // Deterministic HP gain so concurrency assertions don't depend on rolls.
    useAverage: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: store.db as any,
  });
}

describe("applyLevelUp — concurrent confirmations (Model E)", () => {
  it("lets exactly one of two overlapping requests win", async () => {
    const store = makeStore(pendingRow());
    const release = store.openReadGate();

    // Both requests read the same pending row before either writes.
    const both = Promise.allSettled([call(store), call(store)]);
    release();
    const [first, second] = await both;

    const fulfilled = [first, second].filter((r) => r.status === "fulfilled");
    const rejected = [first, second].filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it("reports the loser as LEVEL_UP_ALREADY_APPLIED, not as a success", async () => {
    const store = makeStore(pendingRow());
    const release = store.openReadGate();
    const both = Promise.allSettled([call(store), call(store)]);
    release();
    const results = await both;

    const rejection = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejection.reason).toBeInstanceOf(LevelUpServiceError);
    expect(rejection.reason.code).toBe("LEVEL_UP_ALREADY_APPLIED");
  });

  it("performs exactly one winning transition write", async () => {
    const store = makeStore(pendingRow());
    const release = store.openReadGate();
    const both = Promise.allSettled([call(store), call(store)]);
    release();
    await both;

    // Two calls attempted the conditional write, but only one matched.
    expect(store.db.character.updateMany).toHaveBeenCalledTimes(2);
    expect(store.writes).toHaveLength(1);
  });

  it("applies the mechanical gain (hit dice, max HP) exactly once", async () => {
    const store = makeStore(pendingRow());
    const release = store.openReadGate();
    const both = Promise.allSettled([call(store), call(store)]);
    release();
    await both;

    // fighter (1d10) + CON 14 (+2), useAverage: hpRoll = ceil(10/2)+1 = 6, hpGained = 8.
    expect(store.row.hitDiceTotal).toBe(2);
    expect(store.row.maxHp).toBe(10 + 8);
  });

  it("does not add hit points twice", async () => {
    const store = makeStore(pendingRow());
    const release = store.openReadGate();
    const both = Promise.allSettled([call(store), call(store)]);
    release();
    const results = await both;

    const winner = results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{
      newMaxHp: number;
      hpGained: number;
    }>;

    // Final persisted maximum equals the single winning roll, never the sum of both.
    expect(store.row.maxHp).toBe(winner.value.newMaxHp);
    expect(store.row.maxHp).toBe(10 + winner.value.hpGained);
    expect(store.row.maxHp).toBeLessThan(10 + winner.value.hpGained * 2);
  });

  it("advances level and hitDiceTotal together, from 1 to 2", async () => {
    const store = makeStore(pendingRow());
    const release = store.openReadGate();
    const both = Promise.allSettled([call(store), call(store)]);
    release();
    await both;

    expect(store.row.level).toBe(2);
    expect(store.row.hitDiceTotal).toBe(2);
    expect(store.row.hitDiceTotal).toBe(store.row.level);
  });

  it("the winning write updates level, hitDiceTotal, hitDiceRemaining, maxHp, and hp coherently", async () => {
    const store = makeStore(pendingRow());
    const release = store.openReadGate();
    const both = Promise.allSettled([call(store), call(store)]);
    release();
    await both;

    const write = store.writes[0];
    expect(Object.keys(write).sort()).toEqual(
      ["hitDiceRemaining", "hitDiceTotal", "hp", "maxHp", "level"].sort()
    );

    // Model E HP policy: a level-up is not a rest. Damage already suffered
    // (hp=4 of maxHp=10, i.e. 6 points of damage) is preserved, not healed away.
    expect(store.row.maxHp).toBe(10 + 8);
    expect(store.row.hp).toBe(Math.min(4 + 8, store.row.maxHp));
    expect(store.row.hp).toBe(12);
    expect(store.row.hitDiceRemaining).toBe(1);
  });

  it("scopes the conditional write to the Model E pre-ascension predicate", async () => {
    const store = makeStore(pendingRow());
    const release = store.openReadGate();
    const both = Promise.allSettled([call(store), call(store)]);
    release();
    await both;

    expect(store.db.character.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "character-1", level: 1, hitDiceTotal: 1 },
      })
    );
  });

  it("rejects a sequential second confirmation of the same ascension too", async () => {
    const store = makeStore(pendingRow());

    await expect(call(store)).resolves.toMatchObject({ newLevel: 2 });

    // The second call is not racing the first: it reads the already-updated
    // row (level 2, hitDiceTotal 2) fresh, with no readGate held open. Under
    // Model E the pre-write guard (resolveNextLevel) rejects it before the CAS
    // is ever attempted — there is no XP support for level 3 yet, so this is
    // reported as "no pending level-up", not LEVEL_UP_ALREADY_APPLIED. That
    // code is reserved for the interleaved/racing case exercised above, where
    // the guards pass on stale state and only the CAS write catches it. Either
    // way, the transition from level 1 to 2 is never re-applied.
    await expect(call(store)).rejects.toBeInstanceOf(LevelUpServiceError);
    expect(store.writes).toHaveLength(1);
    expect(store.row.level).toBe(2);
  });
});
