/**
 * Model E progression contract.
 *
 * `Character.level` is the last MECHANICALLY APPLIED level. XP may run ahead
 * of it by any number of levels; `applyLevelUp` closes that gap one level at a
 * time, moving `level` and `hitDiceTotal` together in a single conditional
 * write.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { xpForLevel } from "@/lib/rules/progression";

type CharacterFixture = {
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
};

function character(overrides: Partial<CharacterFixture> = {}): CharacterFixture {
  return {
    id: "character-1",
    campaignId: "campaign-1",
    xp: 0,
    level: 1,
    class: "fighter",
    stats: { STR: 14, DEX: 12, CON: 14, INT: 10, WIS: 11, CHA: 8 },
    hp: 12,
    maxHp: 12,
    hitDiceTotal: 1,
    hitDiceRemaining: 1,
    ...overrides,
  };
}

/**
 * Fake DB whose `updateMany` honours the compare-and-set predicate exactly the
 * way PostgreSQL would: it only matches rows that still satisfy every field in
 * `where`, and reports how many it changed.
 */
function createTx(
  characters: CharacterFixture[],
  options?: {
    /**
     * Holds every `character.findUnique` until this many callers have arrived,
     * so a concurrency test races on the state both readers actually saw
     * instead of on incidental microtask ordering.
     */
    readBarrier?: number;
  }
) {
  const rows = characters.map((c) => ({ ...c, stats: { ...c.stats } }));

  let arrived = 0;
  let releaseBarrier: () => void = () => {};
  const barrier = new Promise<void>((resolve) => {
    releaseBarrier = resolve;
  });

  async function waitForBarrier(): Promise<void> {
    if (!options?.readBarrier) return;
    arrived += 1;
    if (arrived >= options.readBarrier) releaseBarrier();
    await barrier;
  }

  const tx = {
    campaign: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const owned = rows.find((r) => r.campaignId === where.id);
        return owned ? { id: where.id, characterId: owned.id } : null;
      }),
    },
    character: {
      findFirst: vi.fn(async ({ where }: { where: { id?: string; campaignId?: string } }) => {
        const found = rows.find(
          (r) =>
            (where.id === undefined || r.id === where.id) &&
            (where.campaignId === undefined || r.campaignId === where.campaignId)
        );
        return found ? { ...found, stats: { ...found.stats } } : null;
      }),
      // Returns a snapshot copy, as Prisma does. Handing back the live row
      // would let a second reader observe the first writer's mutation and
      // silently defeat the compare-and-set this suite exists to prove.
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        await waitForBarrier();
        const found = rows.find((r) => r.id === where.id);
        return found ? { ...found, stats: { ...found.stats } } : null;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<CharacterFixture>;
        }) => {
          const row = rows.find((r) => r.id === where.id);
          if (!row) throw new Error(`Missing character ${where.id}`);
          Object.assign(row, data);
          return { ...row };
        }
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; level?: number; hitDiceTotal?: number };
          data: Partial<CharacterFixture>;
        }) => {
          const row = rows.find(
            (r) =>
              r.id === where.id &&
              (where.level === undefined || r.level === where.level) &&
              (where.hitDiceTotal === undefined || r.hitDiceTotal === where.hitDiceTotal)
          );
          if (!row) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        }
      ),
    },
    gameLog: { create: vi.fn(async () => ({ id: "log-1" })) },
  };

  return { rows, tx };
}

type AnyFn = (input: Record<string, unknown>) => Promise<Record<string, unknown>>;

async function loadServices(): Promise<{
  applyExperienceAward: AnyFn;
  applyLevelUp: AnyFn;
}> {
  const progression = await import("../../lib/rules/progression-service");
  const levelUp = await import("../../lib/rules/level-up-service");
  return {
    applyExperienceAward: progression.applyExperienceAward as unknown as AnyFn,
    applyLevelUp: levelUp.applyLevelUp as unknown as AnyFn,
  };
}

function row(rows: CharacterFixture[], id = "character-1"): CharacterFixture {
  const found = rows.find((r) => r.id === id);
  if (!found) throw new Error(`Missing character ${id}`);
  return found;
}

describe("Model E — applyExperienceAward", () => {
  let applyExperienceAward: AnyFn;

  beforeEach(async () => {
    ({ applyExperienceAward } = await loadServices());
  });

  it("1. XP below the next threshold leaves level untouched", async () => {
    const { rows, tx } = createTx([character({ xp: 0, level: 1 })]);
    const result = await applyExperienceAward({
      campaignId: "campaign-1",
      characterId: "character-1",
      xpAmount: 100,
      tx,
    });

    expect(row(rows).xp).toBe(100);
    expect(row(rows).level).toBe(1);
    expect(result.targetLevel).toBe(1);
    expect(result.pendingLevels).toBe(0);
  });

  it("2. crossing exactly one threshold changes XP but never level", async () => {
    const { rows, tx } = createTx([character({ xp: 0, level: 1 })]);
    const result = await applyExperienceAward({
      campaignId: "campaign-1",
      characterId: "character-1",
      xpAmount: xpForLevel(2),
      tx,
    });

    expect(row(rows).xp).toBe(xpForLevel(2));
    expect(row(rows).level).toBe(1);
    expect(row(rows).hitDiceTotal).toBe(1);
    expect(result.targetLevel).toBe(2);
    expect(result.pendingLevels).toBe(1);
  });

  it("3. a 1 -> 5 award leaves xp 6500, level 1, total 1, pendingLevels 4", async () => {
    const { rows, tx } = createTx([character({ xp: 0, level: 1 })]);
    const result = await applyExperienceAward({
      campaignId: "campaign-1",
      characterId: "character-1",
      xpAmount: xpForLevel(5),
      tx,
    });

    expect(row(rows).xp).toBe(6500);
    expect(row(rows).level).toBe(1);
    expect(row(rows).hitDiceTotal).toBe(1);
    expect(row(rows).maxHp).toBe(12);
    expect(result.targetLevel).toBe(5);
    expect(result.pendingLevels).toBe(4);
  });

  it("4. XP is never lost across successive awards", async () => {
    const { rows, tx } = createTx([character({ xp: 0, level: 1 })]);
    for (const amount of [500, 500, 900]) {
      await applyExperienceAward({
        campaignId: "campaign-1",
        characterId: "character-1",
        xpAmount: amount,
        tx,
      });
    }
    expect(row(rows).xp).toBe(1900);
  });

  it("Caso A: an award that does not cross a new threshold still reports the existing pending ascension", async () => {
    // level 2 applied, XP already supports target 5 -> 3 pending. A further
    // +50 XP (nowhere near the level-6 threshold) must not erase that signal:
    // levelUpAvailable is derived from level vs targetLevel, not from whether
    // *this* award crossed anything.
    const { rows, tx } = createTx([
      character({ xp: xpForLevel(5), level: 2, hitDiceTotal: 2, hitDiceRemaining: 2 }),
    ]);
    const result = await applyExperienceAward({
      campaignId: "campaign-1",
      characterId: "character-1",
      xpAmount: 50,
      tx,
    });

    expect(row(rows).level).toBe(2);
    expect(result.targetLevel).toBe(5);
    expect(result.pendingLevels).toBe(3);
    expect(result.levelUpAvailable).toMatchObject({
      characterId: "character-1",
      fromLevel: 2,
      toLevel: 3,
      pendingLevels: 3,
    });
  });

  it("Caso B: an award that raises targetLevel further still only ever offers the single next level", async () => {
    // level 2 applied, XP previously supported target 5. An award that pushes
    // targetLevel to 6 must not jump the character straight there: level
    // stays 2, all XP is kept, and the only offer is fromLevel 2 -> toLevel 3.
    const { rows, tx } = createTx([
      character({ xp: xpForLevel(5), level: 2, hitDiceTotal: 2, hitDiceRemaining: 2 }),
    ]);
    const xpAmount = xpForLevel(6) - xpForLevel(5);

    const result = await applyExperienceAward({
      campaignId: "campaign-1",
      characterId: "character-1",
      xpAmount,
      tx,
    });

    expect(row(rows).xp).toBe(xpForLevel(6));
    expect(row(rows).level).toBe(2);
    expect(result.targetLevel).toBe(6);
    expect(result.pendingLevels).toBe(4);
    expect(result.levelUpAvailable).toMatchObject({
      characterId: "character-1",
      fromLevel: 2,
      toLevel: 3,
      pendingLevels: 4,
    });
  });

  it("5. XP accumulates past level 20 without exceeding the level cap", async () => {
    const { rows, tx } = createTx([
      character({ xp: xpForLevel(20), level: 20, hitDiceTotal: 20, hitDiceRemaining: 20 }),
    ]);
    const result = await applyExperienceAward({
      campaignId: "campaign-1",
      characterId: "character-1",
      xpAmount: 50_000,
      tx,
    });

    expect(row(rows).xp).toBe(xpForLevel(20) + 50_000);
    expect(row(rows).level).toBe(20);
    expect(result.targetLevel).toBe(20);
    expect(result.pendingLevels).toBe(0);
  });
});

describe("Model E — applyLevelUp", () => {
  let applyLevelUp: AnyFn;

  beforeEach(async () => {
    ({ applyLevelUp } = await loadServices());
  });

  function levelUp(tx: unknown) {
    return applyLevelUp({
      campaignId: "campaign-1",
      characterId: "character-1",
      useAverage: true,
      source: "test",
      tx,
    });
  }

  it("6. xp-target 5 / level 1 / total 1 applies level 2", async () => {
    const { rows, tx } = createTx([character({ xp: xpForLevel(5), level: 1 })]);
    const result = await levelUp(tx);

    expect(result.previousLevel).toBe(1);
    expect(result.newLevel).toBe(2);
    expect(row(rows).level).toBe(2);
    expect(row(rows).hitDiceTotal).toBe(2);
  });

  it("7-9. successive calls apply 3, then 4, then 5", async () => {
    const { rows, tx } = createTx([character({ xp: xpForLevel(5), level: 1 })]);

    for (const expected of [2, 3, 4, 5]) {
      const result = await levelUp(tx);
      expect(result.newLevel).toBe(expected);
      expect(row(rows).level).toBe(expected);
      expect(row(rows).hitDiceTotal).toBe(expected);
    }
  });

  it("10. a fifth call is rejected without any write", async () => {
    const { rows, tx } = createTx([character({ xp: xpForLevel(5), level: 1 })]);
    for (let i = 0; i < 4; i++) await levelUp(tx);

    const before = { ...row(rows) };
    await expect(levelUp(tx)).rejects.toMatchObject({ code: "INVALID_LEVEL_UP_STATE" });

    expect(row(rows)).toEqual(before);
  });

  it("11. resumes from xp-target 5 / level 3 / total 3 and applies 4", async () => {
    const { rows, tx } = createTx([
      character({ xp: xpForLevel(5), level: 3, hitDiceTotal: 3, hitDiceRemaining: 3 }),
    ]);
    const result = await levelUp(tx);

    expect(result.newLevel).toBe(4);
    expect(row(rows).level).toBe(4);
    expect(row(rows).hitDiceTotal).toBe(4);
  });

  it("12. a single pending level still works", async () => {
    const { rows, tx } = createTx([
      character({ xp: xpForLevel(2), level: 1, hitDiceTotal: 1, hitDiceRemaining: 1 }),
    ]);
    const result = await levelUp(tx);

    expect(result.newLevel).toBe(2);
    expect(row(rows).level).toBe(2);
  });

  it("13. a settled level-20 character is rejected", async () => {
    const { rows, tx } = createTx([
      character({
        xp: xpForLevel(20) + 10_000,
        level: 20,
        hitDiceTotal: 20,
        hitDiceRemaining: 20,
      }),
    ]);
    const before = { ...row(rows) };

    await expect(levelUp(tx)).rejects.toMatchObject({ code: "INVALID_LEVEL_UP_STATE" });
    expect(row(rows)).toEqual(before);
  });

  it("rejects a state whose hitDiceTotal disagrees with level", async () => {
    const { tx } = createTx([
      character({ xp: xpForLevel(5), level: 3, hitDiceTotal: 2, hitDiceRemaining: 2 }),
    ]);
    await expect(levelUp(tx)).rejects.toMatchObject({ code: "INVALID_LEVEL_UP_STATE" });
  });

  it("never modifies XP", async () => {
    const { rows, tx } = createTx([character({ xp: xpForLevel(5), level: 1 })]);
    await levelUp(tx);
    expect(row(rows).xp).toBe(xpForLevel(5));
  });
});

describe("Model E — HP policy", () => {
  let applyLevelUp: AnyFn;

  beforeEach(async () => {
    ({ applyLevelUp } = await loadServices());
  });

  function levelUp(tx: unknown) {
    return applyLevelUp({
      campaignId: "campaign-1",
      characterId: "character-1",
      useAverage: true,
      source: "test",
      tx,
    });
  }

  it("14. maxHp increases by exactly hpGained", async () => {
    const { rows, tx } = createTx([
      character({ xp: xpForLevel(2), level: 1, hp: 12, maxHp: 12 }),
    ]);
    const result = await levelUp(tx);

    expect(row(rows).maxHp).toBe(12 + (result.hpGained as number));
    expect(result.previousMaxHp).toBe(12);
  });

  it("15. hp increases by exactly hpGained", async () => {
    const { rows, tx } = createTx([
      character({ xp: xpForLevel(2), level: 1, hp: 12, maxHp: 12 }),
    ]);
    const result = await levelUp(tx);

    expect(row(rows).hp).toBe(12 + (result.hpGained as number));
  });

  it("16. previously suffered damage is preserved", async () => {
    const { rows, tx } = createTx([
      character({ xp: xpForLevel(2), level: 1, hp: 4, maxHp: 12 }),
    ]);
    const result = await levelUp(tx);
    const gained = result.hpGained as number;

    expect(row(rows).hp).toBe(4 + gained);
    expect(row(rows).maxHp).toBe(12 + gained);
    // The 8 points of damage are still there.
    expect(row(rows).maxHp - row(rows).hp).toBe(8);
  });

  it("17. hp never exceeds the new maxHp", async () => {
    const { rows, tx } = createTx([
      character({ xp: xpForLevel(5), level: 1, hp: 12, maxHp: 12 }),
    ]);
    for (let i = 0; i < 4; i++) await levelUp(tx);

    expect(row(rows).hp).toBeLessThanOrEqual(row(rows).maxHp);
  });

  it("18. hitDiceRemaining increases by at most 1 per level-up", async () => {
    const { rows, tx } = createTx([
      character({ xp: xpForLevel(5), level: 1, hitDiceTotal: 1, hitDiceRemaining: 0 }),
    ]);

    let previous = 0;
    for (let i = 0; i < 4; i++) {
      await levelUp(tx);
      const now = row(rows).hitDiceRemaining;
      expect(now - previous).toBeLessThanOrEqual(1);
      expect(now).toBeLessThanOrEqual(row(rows).hitDiceTotal);
      previous = now;
    }
  });
});

describe("Model E — compare-and-set concurrency", () => {
  let applyLevelUp: AnyFn;

  beforeEach(async () => {
    ({ applyLevelUp } = await loadServices());
  });

  function levelUp(tx: unknown) {
    return applyLevelUp({
      campaignId: "campaign-1",
      characterId: "character-1",
      useAverage: false,
      source: "test",
      tx,
    });
  }

  it("19-21. two concurrent calls on the same fromLevel: exactly one wins", async () => {
    const { rows, tx } = createTx(
      [character({ xp: xpForLevel(5), level: 1, hp: 12, maxHp: 12, hitDiceRemaining: 1 })],
      { readBarrier: 2 }
    );

    const settled = await Promise.allSettled([levelUp(tx), levelUp(tx)]);
    const fulfilled = settled.filter((s) => s.status === "fulfilled");
    const rejected = settled.filter((s) => s.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "LEVEL_UP_ALREADY_APPLIED",
    });

    // 20. level / hit dice / HP moved exactly once.
    const winner = (fulfilled[0] as PromiseFulfilledResult<Record<string, unknown>>).value;
    expect(row(rows).level).toBe(2);
    expect(row(rows).hitDiceTotal).toBe(2);
    expect(row(rows).maxHp).toBe(12 + (winner.hpGained as number));
    expect(row(rows).hp).toBe(12 + (winner.hpGained as number));

    // 21. the loser persisted nothing: exactly one updateMany matched.
    const matched = tx.character.updateMany.mock.results.length;
    expect(matched).toBe(2);
    const counts = await Promise.all(
      tx.character.updateMany.mock.results.map(
        (r) => r.value as Promise<{ count: number }>
      )
    );
    expect(counts.filter((c) => c.count === 1)).toHaveLength(1);
    expect(counts.filter((c) => c.count === 0)).toHaveLength(1);
  });
});

describe("Model E — hit dice integrity contract", () => {
  it("22. targetLevel > level with hitDiceTotal === level is valid", async () => {
    const { classifyHitDiceIntegrity } = await import("../../lib/rules/hit-dice-integrity");
    const result = classifyHitDiceIntegrity({
      xp: xpForLevel(5),
      level: 3,
      hitDiceTotal: 3,
      hitDiceRemaining: 3,
    });
    expect(result.status).toBe("VALID_SETTLED");
    expect(result.patch).toBeUndefined();
  });

  it("23. targetLevel < level is invalid", async () => {
    const { classifyHitDiceIntegrity } = await import("../../lib/rules/hit-dice-integrity");
    const result = classifyHitDiceIntegrity({
      xp: 0,
      level: 5,
      hitDiceTotal: 5,
      hitDiceRemaining: 5,
    });
    expect(result.status).toBe("INVALID_PROGRESSION");
  });

  it("24. hitDiceTotal !== level is not a settled state", async () => {
    const { classifyHitDiceIntegrity } = await import("../../lib/rules/hit-dice-integrity");
    const lagging = classifyHitDiceIntegrity({
      xp: xpForLevel(5),
      level: 5,
      hitDiceTotal: 4,
      hitDiceRemaining: 4,
    });
    expect(lagging.status).toBe("AMBIGUOUS");
    expect(lagging.patch).toBeUndefined();
  });

  it("25. the real current row xp0 / level1 / total1 / remaining1 stays valid", async () => {
    const { classifyHitDiceIntegrity } = await import("../../lib/rules/hit-dice-integrity");
    const result = classifyHitDiceIntegrity({
      xp: 0,
      level: 1,
      hitDiceTotal: 1,
      hitDiceRemaining: 1,
    });
    expect(result.status).toBe("VALID_SETTLED");
    expect(result.patch).toBeUndefined();
  });
});
