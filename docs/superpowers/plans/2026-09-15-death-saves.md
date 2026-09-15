# Death Saving Throws Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution rule (this repository):** test-driven. Do not write production
> code for a task until its named RED test has failed for the expected missing
> behaviour. Deliberately falsify each important new guard before calling it
> covered.

**Goal:** A player at 0 HP falls unconscious and rolls death saves on their
own turn instead of losing the encounter; three failures (or massive damage)
kill the character permanently.

**Architecture:**
- **One pure rules module**, `lib/rules/death-save.ts`, owns every rule:
  - the death save;
  - massive damage;
  - the stable wake clock;
  - the derived life state.
- **Database transition code** owns the conditional writes:
  - `lib/db/player-downed.ts` handles the downing blow;
  - `lib/db/death-save-transition.ts` handles one `Death Save`;
  - `lib/db/campaign-guard.ts` holds the write-route guards.
- **Every player HP write resets the death state** through the existing mirror
  in `lib/db/player-hp.ts`.
- **`finalizeEncounterTurn`'s enemy chain** keeps running past a downed player
  and wakes a stable one.
- **The action route** gains:
  - one refusal (`playerConditionRefusal`);
  - a `Death Save` branch;
  - `Wait`, which joins the `End Turn` branch.

**Tech Stack:** Next.js App Router, TypeScript, Prisma, PostgreSQL 16 with
pgvector, Vitest, Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-15-death-saves-design.md`, approved
2026-09-15, with §4, §6.1, §6.3, §6.5, §7.1 and §7.4 corrected during
planning (Stage 0 commits them). Read it before any task. This plan argues
from it and does not restate its rationale.

## Global Constraints

- **Commands.** Use `pnpm`. Run unit suites with
  `pnpm exec vitest run --maxWorkers=2`, never `pnpm test`. A test that *times
  out* is machine contention: re-run that file alone. A test that fails an
  *assertion* is real.
- **Migrations.** Write them by hand and leave them unapplied on the private
  save. Apply one only to a verified disposable database with
  `E2E_TEST_MODE=true`, and **ask the maintainer before applying it even
  there** (AGENTS.md). CI applies migrations with `pnpm prisma migrate deploy`.
  After any schema edit, run `pnpm prisma generate` from inside the worktree
  (`pnpm --dir` fails on Windows).
- **Lock order** is `Character → Combatant → Encounter`. Every new write path
  takes the Character lock (`lockCharacterForCombatAction`) before any
  Combatant or Encounter write.
- **Fail-closed finalizer calls in the action route: exactly seven after
  Stage 2** — the six of `tests/architecture/player-turn-spending-actions.test.ts`
  plus `Death Save`. `Wait` shares the `End Turn` call; it never adds one.
- **`status: "resolved"` is written only in `lib/rules/combat-pipeline.ts`.**
- **`Character.diedAt` has one writer**, `resolveEncounterIfEnded` (Stage 3).
- **Events are published only after commit.** Every `GameLog` row inside a
  combat transaction is written through `tx`.
- **Rules baseline:** D&D 5e SRD 2014. A death save has no modifier; a natural
  20 revives with 1 HP; a natural 1 counts as two failures; 10 or more
  succeeds; three of either ends it; massive damage is leftover damage `>=`
  max HP.
- **PRs.** One PR per stage, squash-merged. Pushing and opening a PR require
  the maintainer's go-ahead. Wait for pre-merge and post-merge "Verify" and
  "E2E smoke", then sync local `master`.
- **CI runs only `@smoke`**, so every new Playwright test is tagged `@smoke`;
  an E2E that needs a monster inserts its own data (CI does not seed the SRD).
- **Deploy ordering for Stage 2: apply the migration, then deploy.** The PR
  body opens with the warning (spec §8.2).
- **Recommended models:** Stage 1, Sonnet 5 at `high`. Stages 2 and 3, Opus 5
  at `high`; Task 6 (the `Death Save` transition and route) at `xhigh`.

## File map

| File | Stage | Responsibility |
| --- | --- | --- |
| `lib/rules/death-save.ts` (new) | 1 | `resolveDeathSave`, `resolveDownedBlow`, `stabilize`, `shouldWake`, `derivePlayerLifeState`, `DeathSaveInvariantError`, `DEATH_SAVE_LIMIT` |
| `lib/rules/enemy-turn.ts` | 1 | `EnemyTurnInput.playerDowned` → hold |
| `prisma/schema.prisma`, `prisma/migrations/20260916120000_add_death_save_state/` | 2 | `Combatant.stableWakeRound`, `Character.diedAt`, CHECK constraints |
| `lib/memory/context.ts` | 2 | Death-save fields on `ContextCombatant` |
| `lib/db/player-hp.ts` | 2 | The mirror resets the death state on every HP write |
| `lib/db/player-downed.ts` (new) | 2 | `applyPlayerDowned` |
| `lib/events/game-events.ts`, `lib/narrative/combat-fact-adapter.ts` | 2 | Five new event types |
| `lib/rules/combat.ts` | 2 | `resolveEncounterEnd` reads `deathSaveFailures` |
| `lib/db/enemy-turn-transition.ts` | 2 | Downed player: hold, `applyPlayerDowned`, `playerDied` |
| `lib/rules/combat-pipeline.ts` | 2, 3 | Chain continues, wakes (2); `diedAt` writer (3) |
| `lib/db/death-save-transition.ts` (new) | 2 | `rollPlayerDeathSave` |
| `lib/db/campaign-guard.ts` (new) | 2, 3 | `campaignPlayableRefusal` (2); `characterAliveRefusal` (3) |
| `app/api/campaign/[id]/action/route.ts` | 2 | `playerConditionRefusal`, `Death Save`, `Wait`, error mapping |
| `app/api/campaign/[id]/*/route.ts` (9 write routes) | 2 | The guard |
| `app/api/character/**/route.ts` (6 write routes), `app/api/campaign/route.ts` | 3 | `characterAliveRefusal` |
| `components/combat/MacroDeck.tsx`, `components/combat/InitiativeTracker.tsx`, `app/campaign/[id]/page.tsx`, `app/campaigns/page.tsx` | 3 | UI |
| `lib/narrative/combat-narrative-types.ts`, `lib/narrative/narrative-validator.ts` | 3 | Death facts and the player-death rule |
| `docs/SYSTEM_STATE.md`, `MASTER_ARCH_GUIDE.md` | 3 | The record |

---

# Stage 0 — Docs PR

**Branch:** `claude/death-saves-spec` (it carries the spec commit `0240859`).

- [ ] **Step 1:** Commit the spec corrections and this plan:

```bash
git add docs/superpowers/specs/2026-09-15-death-saves-design.md docs/superpowers/plans/2026-09-15-death-saves.md
git commit -m "docs(plan): plan death saving throws in three stages"
```

- [ ] **Step 2:** With the maintainer's go-ahead, push with
  `git push -u origin claude/death-saves-spec`, open "docs(spec): design and
  plan death saves (death saves 0/3)" against `master`, wait for green
  checks, squash-merge. Every later stage branches from the resulting
  `master`.

---

# Stage 1 — Pure rules

**Branch:** `claude/death-saves-1-rules`. **Schema impact:** none.
**Behaviour change in the game:** none; nothing calls the new code yet.

### Task 1: The death-save rules module

**Files:**
- Create: `lib/rules/death-save.ts`
- Test: `tests/rules/death-save.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `DEATH_SAVE_LIMIT = 3`;
  - `class DeathSaveInvariantError extends Error`;
  - `interface DeathSaveCounters { successes: number; failures: number }`;
  - `type DeathSaveResult = { outcome: "revived" } | { outcome: "dying" | "stable" | "dead"; successes: number; failures: number }`;
  - `resolveDeathSave(state: DeathSaveCounters, natural: number): DeathSaveResult`;
  - `resolveDownedBlow(input: { hpBefore: number; damage: number; maxHp: number }): "instant_death" | "dying"`;
  - `stabilize(round: number, d4: number): number`;
  - `shouldWake(state: { hp: number; stableWakeRound?: number | null }, round: number): boolean`;
  - `type PlayerLifeState = "conscious" | "dying" | "stable" | "dead"`;
  - `derivePlayerLifeState(row: { hp: number; deathSaveSuccesses?: number | null; deathSaveFailures?: number | null; stableWakeRound?: number | null }): PlayerLifeState`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/rules/death-save.test.ts
import { describe, expect, it } from "vitest";
import {
  DEATH_SAVE_LIMIT,
  DeathSaveInvariantError,
  derivePlayerLifeState,
  resolveDeathSave,
  resolveDownedBlow,
  shouldWake,
  stabilize,
} from "@/lib/rules/death-save";

describe("resolveDeathSave (SRD 2014)", () => {
  it("revives on a natural 20 whatever the counters", () => {
    expect(resolveDeathSave({ successes: 0, failures: 2 }, 20)).toEqual({ outcome: "revived" });
  });

  it("counts a natural 1 as two failures", () => {
    expect(resolveDeathSave({ successes: 1, failures: 0 }, 1)).toEqual({
      outcome: "dying", successes: 1, failures: 2,
    });
  });

  it("succeeds on exactly 10 and fails on 9", () => {
    expect(resolveDeathSave({ successes: 0, failures: 0 }, 10)).toEqual({
      outcome: "dying", successes: 1, failures: 0,
    });
    expect(resolveDeathSave({ successes: 0, failures: 0 }, 9)).toEqual({
      outcome: "dying", successes: 0, failures: 1,
    });
  });

  it("stabilises on the third success", () => {
    expect(resolveDeathSave({ successes: 2, failures: 1 }, 15)).toEqual({
      outcome: "stable", successes: 3, failures: 1,
    });
  });

  it("dies on the third failure", () => {
    expect(resolveDeathSave({ successes: 1, failures: 2 }, 5)).toEqual({
      outcome: "dead", successes: 1, failures: 3,
    });
  });

  it("caps a natural 1 at three failures", () => {
    expect(resolveDeathSave({ successes: 0, failures: 2 }, 1)).toEqual({
      outcome: "dead", successes: 0, failures: DEATH_SAVE_LIMIT,
    });
  });

  it("rejects impossible input", () => {
    expect(() => resolveDeathSave({ successes: 3, failures: 0 }, 12)).toThrow(DeathSaveInvariantError);
    expect(() => resolveDeathSave({ successes: 0, failures: -1 }, 12)).toThrow(DeathSaveInvariantError);
    expect(() => resolveDeathSave({ successes: 0, failures: 0 }, 0)).toThrow(RangeError);
    expect(() => resolveDeathSave({ successes: 0, failures: 0 }, 21)).toThrow(RangeError);
  });
});

describe("resolveDownedBlow", () => {
  it("kills when leftover damage equals max HP exactly", () => {
    expect(resolveDownedBlow({ hpBefore: 5, damage: 25, maxHp: 20 })).toBe("instant_death");
  });

  it("leaves the player dying one point short", () => {
    expect(resolveDownedBlow({ hpBefore: 5, damage: 24, maxHp: 20 })).toBe("dying");
  });
});

describe("stabilize and shouldWake", () => {
  it("schedules the wake round from the d4", () => {
    expect(stabilize(4, 3)).toBe(7);
    expect(() => stabilize(4, 5)).toThrow(RangeError);
    expect(() => stabilize(4, 0)).toThrow(RangeError);
  });

  it("wakes a stable player from the scheduled round on", () => {
    expect(shouldWake({ hp: 0, stableWakeRound: 7 }, 6)).toBe(false);
    expect(shouldWake({ hp: 0, stableWakeRound: 7 }, 7)).toBe(true);
    expect(shouldWake({ hp: 0, stableWakeRound: 7 }, 8)).toBe(true);
  });

  it("never wakes a dying or conscious player", () => {
    expect(shouldWake({ hp: 0, stableWakeRound: null }, 99)).toBe(false);
    expect(shouldWake({ hp: 0 }, 99)).toBe(false);
    expect(shouldWake({ hp: 1, stableWakeRound: null }, 99)).toBe(false);
  });
});

describe("derivePlayerLifeState", () => {
  it("derives every state from the persisted fields", () => {
    expect(derivePlayerLifeState({ hp: 5 })).toBe("conscious");
    expect(derivePlayerLifeState({ hp: 0, deathSaveFailures: 2, stableWakeRound: null })).toBe("dying");
    expect(derivePlayerLifeState({ hp: 0, deathSaveSuccesses: 3, stableWakeRound: 6 })).toBe("stable");
    expect(derivePlayerLifeState({ hp: 0, deathSaveFailures: 3 })).toBe("dead");
  });

  it("rejects a conscious player carrying death-save state", () => {
    expect(() => derivePlayerLifeState({ hp: 5, stableWakeRound: 3 })).toThrow(DeathSaveInvariantError);
    expect(() => derivePlayerLifeState({ hp: 5, deathSaveFailures: 1 })).toThrow(DeathSaveInvariantError);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm exec vitest run tests/rules/death-save.test.ts`
Expected: FAIL, "Failed to resolve import "@/lib/rules/death-save"".

- [ ] **Step 3: Implement**

```ts
// lib/rules/death-save.ts
/**
 * Death saving throws, D&D 5e SRD 2014
 * (docs/superpowers/specs/2026-09-15-death-saves-design.md §5).
 *
 * @pure — dice are injected; nothing here reads or writes state.
 */

export const DEATH_SAVE_LIMIT = 3;

/** A state the death-save rules must never see. Mapped to 500 DEATH_SAVE_INVARIANT. */
export class DeathSaveInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeathSaveInvariantError";
  }
}

export interface DeathSaveCounters {
  successes: number;
  failures: number;
}

export type DeathSaveResult =
  | { outcome: "revived" }
  | { outcome: "dying" | "stable" | "dead"; successes: number; failures: number };

function assertCounter(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value >= DEATH_SAVE_LIMIT) {
    throw new DeathSaveInvariantError(`${name} ${value} is outside 0..${DEATH_SAVE_LIMIT - 1}.`);
  }
}

function assertDie(faces: number, value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > faces) {
    throw new RangeError(`d${faces} roll ${value} is outside 1..${faces}.`);
  }
}

/** One death save. A save is only rolled while dying, so neither counter is at 3. */
export function resolveDeathSave(state: DeathSaveCounters, natural: number): DeathSaveResult {
  assertCounter("successes", state.successes);
  assertCounter("failures", state.failures);
  assertDie(20, natural);

  if (natural === 20) return { outcome: "revived" };

  let { successes, failures } = state;
  if (natural === 1) failures += 2;
  else if (natural >= 10) successes += 1;
  else failures += 1;

  if (failures >= DEATH_SAVE_LIMIT) return { outcome: "dead", successes, failures: DEATH_SAVE_LIMIT };
  if (successes >= DEATH_SAVE_LIMIT) return { outcome: "stable", successes: DEATH_SAVE_LIMIT, failures };
  return { outcome: "dying", successes, failures };
}

/** The blow that brings the player to 0 HP: massive damage kills outright. */
export function resolveDownedBlow(input: {
  hpBefore: number;
  damage: number;
  maxHp: number;
}): "instant_death" | "dying" {
  const leftover = input.damage - Math.max(0, input.hpBefore);
  return leftover >= input.maxHp ? "instant_death" : "dying";
}

/** The round a stabilised player wakes: the SRD's 1d4 hours, scaled to rounds. */
export function stabilize(round: number, d4: number): number {
  assertDie(4, d4);
  return round + d4;
}

export function shouldWake(
  state: { hp: number; stableWakeRound?: number | null },
  round: number
): boolean {
  if (state.hp > 0) return false;
  const wake = state.stableWakeRound ?? null;
  return wake !== null && round >= wake;
}

export type PlayerLifeState = "conscious" | "dying" | "stable" | "dead";

/**
 * The player's state, derived from persisted fields (spec §4). Missing fields
 * (reduced test doubles, pre-migration rows) read as 0 / NULL.
 */
export function derivePlayerLifeState(row: {
  hp: number;
  deathSaveSuccesses?: number | null;
  deathSaveFailures?: number | null;
  stableWakeRound?: number | null;
}): PlayerLifeState {
  const successes = row.deathSaveSuccesses ?? 0;
  const failures = row.deathSaveFailures ?? 0;
  const wake = row.stableWakeRound ?? null;

  if (row.hp > 0) {
    // Every player HP write resets these (lib/db/player-hp.ts); anything else
    // is a writer that bypassed the single write path.
    if (successes !== 0 || failures !== 0 || wake !== null) {
      throw new DeathSaveInvariantError("A conscious player carries death-save state.");
    }
    return "conscious";
  }
  if (failures >= DEATH_SAVE_LIMIT) return "dead";
  if (wake !== null) return "stable";
  return "dying";
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `pnpm exec vitest run tests/rules/death-save.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Falsify.** Apply each mutation, confirm at least one test
  fails, revert:
  - `natural >= 10` → `natural > 10`;
  - `failures += 2` → `failures += 1`;
  - `leftover >= input.maxHp` → `leftover > input.maxHp`;
  - `round >= wake` → `round > wake`;
  - drop the `row.hp > 0` invariant block.

- [ ] **Step 6: Commit**

```bash
git add lib/rules/death-save.ts tests/rules/death-save.test.ts
git commit -m "feat(rules): pure death saving throw rules"
```

### Task 2: Enemies hold against a downed player

**Files:**
- Modify: `lib/rules/enemy-turn.ts` (`EnemyTurnInput`, `planEnemyTurn:140-143`)
- Test: `tests/rules/enemy-turn-downed-player.test.ts`

**Interfaces:**
- Consumes: `planEnemyTurn`, `EnemyTurnInput` (existing).
- Produces: `EnemyTurnInput.playerDowned?: boolean`. When `true`,
  `planEnemyTurn` returns `{ move: null, mode: null, attacks: [] }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/rules/enemy-turn-downed-player.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planEnemyTurn } from "@/lib/rules/enemy-turn";
import { toSizeCategory } from "@/lib/rules/geometry";
import { profileMonster } from "@/lib/rules/monster-attack-profile";

const GOBLIN = (
  JSON.parse(readFileSync(join(process.cwd(), "data", "srd-es", "monsters.json"), "utf8")) as Array<
    Record<string, unknown>
  >
).find((m) => m.index === "goblin")!;

function input(playerDowned: boolean | undefined, goblinAt = { x: 5, y: 6 }) {
  return {
    enemy: {
      id: "g1", ...goblinAt, size: toSizeCategory("Small"),
      hp: 7, conditions: [], profile: profileMonster(GOBLIN),
    },
    player: { id: "p1", x: 5, y: 5, size: toSizeCategory("Medium") },
    others: [{ id: "p1", x: 5, y: 5, size: toSizeCategory("Medium") }],
    ...(playerDowned === undefined ? {} : { playerDowned }),
  };
}

describe("planEnemyTurn against a downed player (death-saves spec §5)", () => {
  it("holds an adjacent enemy that would otherwise strike", () => {
    expect(planEnemyTurn(input(false)).attacks).not.toHaveLength(0);
    expect(planEnemyTurn(input(true))).toEqual({ move: null, mode: null, attacks: [] });
  });

  it("holds a distant enemy that would otherwise close", () => {
    expect(planEnemyTurn(input(false, { x: 5, y: 9 })).move).not.toBeNull();
    expect(planEnemyTurn(input(true, { x: 5, y: 9 }))).toEqual({ move: null, mode: null, attacks: [] });
  });

  it("keeps today's behaviour when the flag is absent", () => {
    expect(planEnemyTurn(input(undefined))).toEqual(planEnemyTurn(input(false)));
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm exec vitest run tests/rules/enemy-turn-downed-player.test.ts`
Expected: FAIL. The first two tests plan attacks or a move with
`playerDowned: true`, and TypeScript flags the unknown property.

- [ ] **Step 3: Implement.** Add the field to `EnemyTurnInput` and the hold at
  the top of `planEnemyTurn`:

```ts
// lib/rules/enemy-turn.ts — in interface EnemyTurnInput
  /**
   * The player is at 0 HP. A downed player is no threat, so every enemy holds
   * (docs/superpowers/specs/2026-09-15-death-saves-design.md §1, §5).
   */
  playerDowned?: boolean;
```

```ts
// lib/rules/enemy-turn.ts — planEnemyTurn, first line of the body
  if (input.playerDowned) return noAction();
```

- [ ] **Step 4: Run it and the planner suite**

Run: `pnpm exec vitest run tests/rules/enemy-turn-downed-player.test.ts tests/rules/enemy-turn.test.ts`
Expected: PASS.

- [ ] **Step 5: Falsify.** Delete the hold line; the first two tests fail.
  Revert.

- [ ] **Step 6: Validate and commit.** Run `pnpm typecheck` and
  `pnpm exec vitest run --maxWorkers=2`.

```bash
git add lib/rules/enemy-turn.ts tests/rules/enemy-turn-downed-player.test.ts
git commit -m "feat(rules): enemies hold against a downed player"
```

- [ ] **Step 7: PR 1/3.** With the maintainer's go-ahead, push and open
  "feat(rules): death save rules and the downed-player hold (death saves
  1/3)". There is no deploy warning, because the schema does not change.
  Merge after green checks.

---

# Stage 2 — Migration, flow and barriers

**Branch:** `claude/death-saves-2-flow`. **Schema impact:** two nullable
columns and three CHECK constraints. **Behaviour change:**
- 0 HP no longer ends combat;
- `Death Save` and `Wait` exist;
- the write routes refuse an unconscious player.

Until Stage 3, three failures resolve `player_dead` without writing `diedAt`,
so there is no permanent death yet.

### Task 3: Schema, migration and context fields

**Files:**
- Modify: `prisma/schema.prisma` (`Character` after `exhaustionLevel`;
  `Combatant` after `deathSaveFailures`)
- Create: `prisma/migrations/20260916120000_add_death_save_state/migration.sql`
- Modify: `lib/memory/context.ts` (`ContextCombatant:84-113`, the combatant
  select at `:413-433`)
- Test: `tests/architecture/death-save-schema.test.ts`

**Interfaces:**
- Produces:
  - `Combatant.stableWakeRound: number | null` and
    `Character.diedAt: Date | null` in the Prisma client;
  - `ContextCombatant.deathSaveSuccesses: number`,
    `ContextCombatant.deathSaveFailures: number` and
    `ContextCombatant.stableWakeRound: number | null`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/architecture/death-save-schema.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const SCHEMA = read("prisma", "schema.prisma");
const MIGRATION = read("prisma", "migrations", "20260916120000_add_death_save_state", "migration.sql");
const CONTEXT = read("lib", "memory", "context.ts");

describe("death-save schema (spec §8.1)", () => {
  it("declares both columns nullable with no default", () => {
    expect(SCHEMA).toMatch(/\n\s+stableWakeRound\s+Int\?\s*\n/);
    expect(SCHEMA).toMatch(/\n\s+diedAt\s+DateTime\?\s*\n/);
  });

  it("adds the columns idempotently and pins the ranges", () => {
    expect(MIGRATION).toContain('ADD COLUMN IF NOT EXISTS "stableWakeRound" INTEGER');
    expect(MIGRATION).toContain('ADD COLUMN IF NOT EXISTS "diedAt" TIMESTAMP(3)');
    expect(MIGRATION).toContain('CHECK ("deathSaveSuccesses" BETWEEN 0 AND 3)');
    expect(MIGRATION).toContain('CHECK ("deathSaveFailures" BETWEEN 0 AND 3)');
    expect(MIGRATION).toContain('CHECK ("stableWakeRound" IS NULL OR "stableWakeRound" >= 1)');
    expect(MIGRATION).not.toMatch(/\bDEFAULT\b/);
  });

  it("selects the death-save fields into the campaign context", () => {
    for (const field of ["deathSaveSuccesses", "deathSaveFailures", "stableWakeRound"]) {
      expect(CONTEXT).toContain(`${field}: true`);
    }
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm exec vitest run tests/architecture/death-save-schema.test.ts`
Expected: FAIL with ENOENT on the migration file.

- [ ] **Step 3: Schema.** In `Character`, after `exhaustionLevel`:

```prisma
  /// When the character died (docs/superpowers/specs/2026-09-15-death-saves-design.md §9).
  /// NULL = alive. Written once, by the winner of the player_dead encounter
  /// claim; never cleared. Every write route refuses a character with it set.
  diedAt               DateTime?
```

  In `Combatant`, after `deathSaveFailures`:

```prisma
  /// The round a stabilised player wakes with 1 HP (death-saves spec §4).
  /// NULL = not stable. Cleared by every player HP write.
  stableWakeRound      Int?
```

- [ ] **Step 4: Migration**

```sql
-- prisma/migrations/20260916120000_add_death_save_state/migration.sql
-- Estado de las tiradas de muerte y de la muerte permanente
-- (docs/superpowers/specs/2026-09-15-death-saves-design.md §4, §8, §9).
--
-- ADITIVA. Añade "Combatant"."stableWakeRound" y "Character"."diedAt",
-- ambas NULLABLE y SIN DEFAULT: NULL significa "no estable" y "vivo". Un DEFAULT
-- inventaría un estado.
--
-- Añade tres CHECK como segunda defensa junto a DEATH_SAVE_INVARIANT: ningún
-- escritor futuro puede guardar un contador imposible. Las columnas de
-- contadores nunca tuvieron escritor, así que toda fila vale 0; aun así se
-- cuentan antes las filas fuera de rango y se aborta con un mensaje claro.
--
-- ORDEN DE DESPLIEGUE: aplicar ANTES de desplegar el código. Prisma selecciona
-- todas las columnas escalares; el código nuevo sin estas columnas rompe toda
-- consulta sobre "Combatant" y "Character". El código anterior las ignora.
--
-- ─── Por qué un bloque DO ────────────────────────────────────────────────────
-- Misma razón que 20260814120000: una sola sentencia atómica que revierte con su
-- DDL si algo falla.
DO $add_death_save_state$
DECLARE
  out_of_range integer;
BEGIN
  SELECT count(*) INTO out_of_range
  FROM "Combatant"
  WHERE "deathSaveSuccesses" NOT BETWEEN 0 AND 3
     OR "deathSaveFailures" NOT BETWEEN 0 AND 3;
  IF out_of_range > 0 THEN
    RAISE EXCEPTION 'add_death_save_state: % Combatant rows hold death-save counters outside 0..3', out_of_range;
  END IF;

  EXECUTE 'ALTER TABLE "Combatant" ADD COLUMN IF NOT EXISTS "stableWakeRound" INTEGER';
  EXECUTE 'ALTER TABLE "Character" ADD COLUMN IF NOT EXISTS "diedAt" TIMESTAMP(3)';

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Combatant_deathSaveSuccesses_range') THEN
    EXECUTE 'ALTER TABLE "Combatant" ADD CONSTRAINT "Combatant_deathSaveSuccesses_range" CHECK ("deathSaveSuccesses" BETWEEN 0 AND 3)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Combatant_deathSaveFailures_range') THEN
    EXECUTE 'ALTER TABLE "Combatant" ADD CONSTRAINT "Combatant_deathSaveFailures_range" CHECK ("deathSaveFailures" BETWEEN 0 AND 3)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Combatant_stableWakeRound_min') THEN
    EXECUTE 'ALTER TABLE "Combatant" ADD CONSTRAINT "Combatant_stableWakeRound_min" CHECK ("stableWakeRound" IS NULL OR "stableWakeRound" >= 1)';
  END IF;
END
$add_death_save_state$;
```

- [ ] **Step 5: Context.** Add to `ContextCombatant`, after `size`:

```ts
  /** Death saves while at 0 HP (death-saves spec §4). */
  deathSaveSuccesses: number;
  deathSaveFailures: number;
  /** Round a stable player wakes; null when not stable. */
  stableWakeRound: number | null;
```

  Add `deathSaveSuccesses: true`, `deathSaveFailures: true` and
  `stableWakeRound: true` to the combatant `select` after `size: true`.

- [ ] **Step 6: Generate and verify**

Run, from inside the worktree:
- `pnpm prisma generate`
- `pnpm prisma validate`
- `pnpm typecheck`
- `pnpm exec vitest run tests/architecture/death-save-schema.test.ts`

Expected: the test passes. If typecheck flags a `ContextCombatant` literal in
a test double, add the three fields there with `0, 0, null`.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260916120000_add_death_save_state lib/memory/context.ts tests/architecture/death-save-schema.test.ts
git commit -m "feat(schema): death-save state and Character.diedAt"
```

### Task 4: Falling to 0 HP no longer ends combat

**Files:**
- Modify:
  - `lib/db/player-hp.ts` (`mirrorPlayerCombatantHp`);
  - `lib/events/game-events.ts` (`GameEventType`);
  - `lib/narrative/combat-fact-adapter.ts:224-242`;
  - `lib/rules/combat.ts:806-833`;
  - `lib/db/enemy-turn-transition.ts`;
  - `lib/rules/combat-pipeline.ts` (`runEnemyChain:1030-1059`, self-damage
    block `:759-767`).
- Create: `lib/db/player-downed.ts`
- Tests:
  - `tests/db/player-downed.test.ts`;
  - `tests/db/enemy-turn-transition.test.ts`;
  - `tests/rules/combat.test.ts:144-151`;
  - `tests/rules/combat-turn-transition-atomicity.test.ts:243-274`;
  - `tests/rules/player-hp-write-path.test.ts:52-55, 89-92`.

**Interfaces:**
- Consumes (Task 1): `resolveDownedBlow`, `DEATH_SAVE_LIMIT`. Consumes
  (Task 2): `EnemyTurnInput.playerDowned`.
- Produces:
  - `DEATH_STATE_RESET = { deathSaveSuccesses: 0, deathSaveFailures: 0, stableWakeRound: null }`
    (exported from `lib/db/player-hp.ts`);
  - `applyPlayerDowned(tx, input: { encounterId: string; hpBefore: number; damage: number; maxHp: number; collectEvents: boolean; events: GameEvent[] }): Promise<"dying" | "dead">`;
  - `EnemyTurnOutcome.playerDied: boolean`;
  - the event types `DEATH_SAVE_ROLLED`, `PLAYER_STABILIZED`,
    `PLAYER_REVIVED`, `PLAYER_WOKE` and `PLAYER_DIED`;
  - `resolveEncounterEnd` accepting `deathSaveFailures?: number | null`.

- [ ] **Step 1: Write the failing tests.**

```ts
// tests/db/player-downed.test.ts
import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import type { GameEvent } from "@/lib/events/game-events";
import { applyPlayerDowned } from "@/lib/db/player-downed";

function tx() {
  return {
    combatant: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  } as unknown as Prisma.TransactionClient;
}

describe("applyPlayerDowned (death-saves spec §6.1)", () => {
  it("leaves the player dying and says so", async () => {
    const t = tx();
    const events: GameEvent[] = [];
    const fall = await applyPlayerDowned(t, {
      encounterId: "enc-1", hpBefore: 5, damage: 8, maxHp: 20, collectEvents: true, events,
    });
    expect(fall).toBe("dying");
    expect(events).toEqual([{ type: "PLAYER_DOWNED", payload: {} }]);
    expect(t.combatant.updateMany).not.toHaveBeenCalled();
  });

  it("kills outright on massive damage by writing the canonical death marker", async () => {
    const t = tx();
    const events: GameEvent[] = [];
    const fall = await applyPlayerDowned(t, {
      encounterId: "enc-1", hpBefore: 5, damage: 25, maxHp: 20, collectEvents: true, events,
    });
    expect(fall).toBe("dead");
    expect(t.combatant.updateMany).toHaveBeenCalledWith({
      where: { encounterId: "enc-1", isPlayer: true },
      data: { deathSaveFailures: 3 },
    });
    expect(events).toEqual([{ type: "PLAYER_DIED", payload: { cause: "massive_damage" } }]);
  });
});
```

  In `tests/db/enemy-turn-transition.test.ts`:
  - Expect the mirror in the first test to be
    `data: { hp: 14, deathSaveSuccesses: 0, deathSaveFailures: 0, stableWakeRound: null }`.
  - Rename "stops and reports the player downed at 0 HP" to "reports the
    player downed and alive at 0 HP" and add
    `expect(outcome.playerDied).toBe(false);`.
  - Append:

```ts
  it("kills outright when the blow's leftover damage reaches max HP", async () => {
    const tx = buildTx();
    (tx.character.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      hp: 1, maxHp: 5, stats: { DEX: 10 }, inventory: [],
    });
    mockRandom([0.75, 0.5, 0.3]); // 6 damage: leftover 5 = max HP
    const outcome = await resolveEnemyTurn(tx, CTX);

    expect(outcome).toMatchObject({ playerDowned: true, playerDied: true });
    expect(outcome.events.map((e) => e.type)).toContain("PLAYER_DIED");
  });

  it("holds against a player already at 0 HP", async () => {
    const tx = buildTx(rows());
    (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      rows().map((r) => (r.isPlayer ? { ...r, hp: 0 } : r)),
    );
    const outcome = await resolveEnemyTurn(tx, CTX);

    expect(outcome).toEqual({ events: [], playerDowned: false, playerDied: false });
    expect(tx.character.update).not.toHaveBeenCalled();
    expect(tx.gameLog.create).not.toHaveBeenCalled();
  });
```

  In `tests/rules/combat.test.ts`, replace the `player_dead` test:

```ts
    it("returns player_dead only for the canonical death marker", () => {
      expect(
        resolveEncounterEnd([
          { isPlayer: true, hp: 0, deathSaveFailures: 3 },
          { isPlayer: false, hp: 0 },
        ])
      ).toEqual({ shouldEnd: true, reason: "player_dead" });
    });

    it("keeps a downed but living player in the fight", () => {
      expect(
        resolveEncounterEnd([
          { isPlayer: true, hp: 0, deathSaveFailures: 2 },
          { isPlayer: false, hp: 5 },
        ])
      ).toEqual({ shouldEnd: false, reason: "ongoing" });
    });
```

  In `tests/rules/combat-turn-transition-atomicity.test.ts`:
  - Default mock (`beforeEach`):
    `{ events: [], playerDowned: false, playerDied: false }`.
  - Replace the test at `:243`:

```ts
  it("keeps the chain going when an enemy downs the player", async () => {
    const tx = buildCasTx();
    (tx.encounter.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
    vi.mocked(resolveEnemyTurn).mockResolvedValueOnce({
      events: [{ type: "PLAYER_DOWNED", payload: {} }],
      playerDowned: true,
      playerDied: false,
    });

    const result = await finalizeEncounterTurn({
      tx, encounterId: "enc-1", currentTurnIndex: 0, round: 1, failOnStaleTurn: true,
    });

    expect(result).toMatchObject({ encounterResolved: false, nextTurnIndex: 0, nextRound: 2 });
    expect(resolveEnemyTurn).toHaveBeenCalledTimes(2);
    expect(tx.encounter.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "resolved" } }),
    );
  });

  it("resolves player_dead when an enemy kills the player outright", async () => {
    const tx = buildCasTx();
    (tx.encounter.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
    vi.mocked(resolveEnemyTurn).mockResolvedValueOnce({
      events: [{ type: "PLAYER_DIED", payload: { cause: "massive_damage" } }],
      playerDowned: true,
      playerDied: true,
    });
    (tx.combatant.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(ongoingCombatants()) // finalizer entry
      .mockResolvedValueOnce(ongoingCombatants()) // chain: slot ownership
      .mockResolvedValue([
        { id: "player-1", isPlayer: true, hp: 0, deathSaveFailures: 3 },
        { id: "enemy-1", isPlayer: false, hp: 10 },
        { id: "enemy-2", isPlayer: false, hp: 10 },
      ]);

    const result = await finalizeEncounterTurn({
      tx, encounterId: "enc-1", currentTurnIndex: 0, round: 1, failOnStaleTurn: true,
    });

    expect(result.encounterResolved).toBe(true);
    expect(tx.encounter.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { status: "resolved" } }),
    );
    expect(resolveEnemyTurn).toHaveBeenCalledTimes(1);
  });
```

  In `tests/rules/player-hp-write-path.test.ts:52-55` and `:89-92`, expect
  `data: { hp: newHp, deathSaveSuccesses: 0, deathSaveFailures: 0, stableWakeRound: null }`.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run tests/db/player-downed.test.ts tests/db/enemy-turn-transition.test.ts tests/rules/combat.test.ts tests/rules/combat-turn-transition-atomicity.test.ts tests/rules/player-hp-write-path.test.ts`
Expected: FAIL. `player-downed` is missing; the mirror data lacks the reset;
`resolveEncounterEnd` still reads HP; the chain still resolves on
`playerDowned`.

- [ ] **Step 3: The mirror resets the death state.** In `lib/db/player-hp.ts`:

```ts
/**
 * Every player HP write clears the death state: falling to 0 starts a fresh
 * dying state, and any HP above 0 (a natural 20, waking, healing) ends it
 * (docs/superpowers/specs/2026-09-15-death-saves-design.md §4).
 */
export const DEATH_STATE_RESET = {
  deathSaveSuccesses: 0,
  deathSaveFailures: 0,
  stableWakeRound: null,
} as const;
```

  In `mirrorPlayerCombatantHp`, change `data: { hp }` to
  `data: { hp, ...DEATH_STATE_RESET }`.

- [ ] **Step 4: Events.** Append to `GameEventType`:

```ts
  | "DEATH_SAVE_ROLLED"    // One death save: { natural, successes, failures, outcome }
  | "PLAYER_STABILIZED"    // Third success: { wakeRound }
  | "PLAYER_REVIVED"       // Natural 20 on a death save: back at 1 HP
  | "PLAYER_WOKE"          // A stable player wakes with 1 HP
  | "PLAYER_DIED"          // { cause: "death_saves" | "massive_damage" }
```

  Add the same five names to the no-op `.with(...)` list in
  `lib/narrative/combat-fact-adapter.ts`. Task 10 maps them to facts.

- [ ] **Step 5: `applyPlayerDowned`**

```ts
// lib/db/player-downed.ts
import type { Prisma } from "@prisma/client";
import type { GameEvent } from "@/lib/events/game-events";
import { DEATH_SAVE_LIMIT, resolveDownedBlow } from "@/lib/rules/death-save";

/**
 * The blow that brought the player to 0 HP (death-saves spec §6.1). Runs after
 * setPlayerHp, whose mirror already reset the death state to "dying"; only
 * massive damage writes more — the canonical death marker.
 */
export async function applyPlayerDowned(
  tx: Prisma.TransactionClient,
  input: {
    encounterId: string;
    hpBefore: number;
    damage: number;
    maxHp: number;
    collectEvents: boolean;
    events: GameEvent[];
  }
): Promise<"dying" | "dead"> {
  const fall = resolveDownedBlow(input);
  if (fall === "instant_death") {
    await tx.combatant.updateMany({
      where: { encounterId: input.encounterId, isPlayer: true },
      data: { deathSaveFailures: DEATH_SAVE_LIMIT },
    });
    if (input.collectEvents) {
      input.events.push({ type: "PLAYER_DIED", payload: { cause: "massive_damage" } });
    }
    return "dead";
  }
  if (input.collectEvents) input.events.push({ type: "PLAYER_DOWNED", payload: {} });
  return "dying";
}
```

- [ ] **Step 6: `resolveEncounterEnd`**

```ts
// lib/rules/combat.ts
export function resolveEncounterEnd(
  combatants: Array<{ isPlayer: boolean; hp: number; deathSaveFailures?: number | null }>
): EncounterResolution {
  const player = combatants.find((c) => c.isPlayer);
  // 0 HP is dying, not dead: only the canonical marker — three failed saves or
  // massive damage — ends the encounter (death-saves spec §6.2).
  if (player && (player.deathSaveFailures ?? 0) >= DEATH_SAVE_LIMIT) {
    return { shouldEnd: true, reason: "player_dead" };
  }
  const allEnemiesDead = combatants
    .filter((c) => !c.isPlayer)
    .every((c) => checkDeath(c.hp));
  if (allEnemiesDead) {
    return { shouldEnd: true, reason: "all_enemies_dead" };
  }
  return { shouldEnd: false, reason: "ongoing" };
}
```

  Import `DEATH_SAVE_LIMIT` from `@/lib/rules/death-save`. Update the JSDoc
  "Priority" line to "player death (the canonical marker) is checked before
  enemy death".

- [ ] **Step 7: `resolveEnemyTurn`.** In `lib/db/enemy-turn-transition.ts`:
  - `EnemyTurnOutcome` gains `playerDied: boolean`, and every `return`
    returns it: `false` unless stated.
  - Pass `playerDowned: player.hp <= 0` to `planEnemyTurn`.
  - After `planEnemyTurn`, add the defence in depth:

```ts
  if (player.hp <= 0 && (plan.move !== null || plan.attacks.length > 0)) {
    throw new EnemyTurnInvariantError(`Enemy ${enemy.id} planned to act against a downed player.`);
  }
```

  - Replace the tail of the attack loop, `if (hp <= 0) { ... }`:

```ts
    if (hp <= 0) {
      const fall = await applyPlayerDowned(tx, {
        encounterId: ctx.encounterId,
        hpBefore: hpBeforeHit,
        damage,
        maxHp: character.maxHp,
        collectEvents: ctx.collectEvents,
        events,
      });
      // The remaining multiattack attacks are not rolled (spec §6.1).
      return { events, playerDowned: true, playerDied: fall === "dead" };
    }
```

  - Declare `const hpBeforeHit = hp;` at the top of each loop iteration,
    before `resolveAttackRoll`.
  - Import `applyPlayerDowned` from `@/lib/db/player-downed`.

- [ ] **Step 8: The chain continues.** In `runEnemyChain`, replace the
  `if (outcome.playerDowned) { ... }` block with:

```ts
    if (outcome.playerDied) {
      // Massive damage: the same conditional active → resolved claim as any
      // other ending, bound to this turn (death-saves spec §6.1).
      const fresh = await tx.combatant.findMany({ where: { encounterId } });
      const ended = await resolveEncounterIfEnded({
        tx,
        encounterId,
        currentTurnIndex: turnIndex,
        round,
        failOnStaleTurn: true,
        events,
        allCombatants: fresh,
      });
      if (!ended) {
        throw new EnemyTurnInvariantError(
          `The player died but encounter ${encounterId} did not end.`
        );
      }
      return ended;
    }
    // A downed but living player: the chain runs on and later enemies hold.
```

- [ ] **Step 9: Self-damage.** In `executeCombatAction`, replace the
  `setPlayerHp` block at `:761-767`:

```ts
      if (target.isPlayer && playerCharacterId) {
        const hpBeforeHit = persistedHp + damage;
        newHp = await setPlayerHp(tx, {
          characterId: playerCharacterId,
          encounterId: encounter.id || null,
          hp: newHp,
        });
        // The player's own area spell can down them too: one rule for the fall.
        if (newHp === 0 && hpBeforeHit > 0 && encounter.id) {
          await applyPlayerDowned(tx, {
            encounterId: encounter.id,
            hpBefore: hpBeforeHit,
            damage,
            maxHp: target.maxHp,
            collectEvents,
            events,
          });
        }
      }
```

  Import `applyPlayerDowned`. If `events` or `collectEvents` are named
  differently in that scope, use the names `executeCombatAction` already
  pushes other events with (line `:391` declares `events`).

- [ ] **Step 10: Run the tests from Step 2**

Expected: PASS.

- [ ] **Step 11: Falsify.**
  - `>= DEATH_SAVE_LIMIT` → `> DEATH_SAVE_LIMIT` in `resolveEncounterEnd`;
  - drop `...DEATH_STATE_RESET` from the mirror;
  - `fall === "dead"` → `true` in `resolveEnemyTurn`;
  - delete the `playerDowned:` argument to `planEnemyTurn`.

  Each mutation must fail a test; revert each one.

- [ ] **Step 12: Full suite and commit.** Run `pnpm typecheck` and
  `pnpm exec vitest run --maxWorkers=2`. A failure that asserts
  `data: { hp: N }` on the player's `combatant.updateMany` is the contract
  change of Step 3: add the three reset fields and note the file for the PR
  body.

```bash
git add lib/db/player-hp.ts lib/db/player-downed.ts lib/events/game-events.ts lib/narrative/combat-fact-adapter.ts lib/rules/combat.ts lib/db/enemy-turn-transition.ts lib/rules/combat-pipeline.ts tests
git commit -m "feat(combat): falling to 0 HP leaves the player dying, not defeated"
```

### Task 5: A stable player wakes

**Files:**
- Modify: `lib/rules/combat-pipeline.ts` (`runEnemyChain:1009-1028`)
- Test: `tests/rules/combat-turn-transition-atomicity.test.ts`

**Interfaces:**
- Consumes (Task 1): `shouldWake`. Consumes: `setPlayerHp`.
- Produces: `PLAYER_WOKE` with the payload `{ hp: 1 }`.

- [ ] **Step 1: Write the failing test.** Append to the atomicity suite:

```ts
  it("wakes a stable player when the chain returns on the wake round", async () => {
    const tx = buildCasTx();
    (tx.encounter.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
    (tx as unknown as { character: unknown }).character = { update: vi.fn() };
    (tx.combatant as unknown as { updateMany: unknown }).updateMany = vi.fn();
    const stable = [
      { id: "player-1", isPlayer: true, hp: 0, stableWakeRound: 2 },
      { id: "enemy-1", isPlayer: false, hp: 10 },
      { id: "enemy-2", isPlayer: false, hp: 10 },
    ];
    (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(stable);

    const result = await finalizeEncounterTurn({
      tx, encounterId: "enc-1", currentTurnIndex: 0, round: 1, failOnStaleTurn: true,
    });

    expect(result).toMatchObject({ nextTurnIndex: 0, nextRound: 2 });
    expect(result.events.map((e) => e.type)).toContain("PLAYER_WOKE");
    expect((tx as unknown as { character: { update: ReturnType<typeof vi.fn> } }).character.update)
      .toHaveBeenCalledWith({ where: { id: "char-1" }, data: { hp: 1 } });
  });

  it("does not wake a stable player a round early", async () => {
    const tx = buildCasTx();
    (tx.encounter.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
    (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "player-1", isPlayer: true, hp: 0, stableWakeRound: 3 },
      { id: "enemy-1", isPlayer: false, hp: 10 },
      { id: "enemy-2", isPlayer: false, hp: 10 },
    ]);

    const result = await finalizeEncounterTurn({
      tx, encounterId: "enc-1", currentTurnIndex: 0, round: 1, failOnStaleTurn: true,
    });

    expect(result.events.map((e) => e.type)).not.toContain("PLAYER_WOKE");
  });
```

  The `buildCasTx` double has no `gameLog`. Add
  `gameLog: { create: vi.fn() }` to `buildCasTx` so the wake log can be
  written.

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm exec vitest run tests/rules/combat-turn-transition-atomicity.test.ts`
Expected: FAIL, because `PLAYER_WOKE` is missing.

- [ ] **Step 3: Implement.** In `runEnemyChain`, widen the `ordered` select
  to `{ id: true, isPlayer: true, hp: true, stableWakeRound: true }`. The
  snapshot is exact for this purpose: enemies never act against a downed
  player, so neither field changes during the chain. Then replace the
  `if (active.isPlayer)` block:

```ts
    if (active.isPlayer) {
      // The player's turn begins: a stable player wakes on the scheduled round
      // (death-saves spec §6.5). setPlayerHp's mirror clears the death state.
      if (shouldWake({ hp: active.hp ?? 1, stableWakeRound: active.stableWakeRound ?? null }, round)) {
        await setPlayerHp(tx, { characterId: owner.characterId, encounterId, hp: 1 });
        await tx.gameLog.create({
          data: {
            campaignId: owner.campaignId,
            role: "system",
            content: "The player regains consciousness with 1 HP.",
          },
        });
        if (collectEvents) events.push({ type: "PLAYER_WOKE", payload: { hp: 1 } });
      }
      return {
        events,
        encounterResolved: false,
        turnAdvanceConflict: false,
        nextTurnIndex: turnIndex,
        nextRound: round,
      };
    }
```

  Import `shouldWake` from `@/lib/rules/death-save`.

- [ ] **Step 4: Run it, falsify, commit.** The tests pass. Falsify
  `round >= wake` → `round > wake` in `shouldWake`: the first test fails.
  Revert.

```bash
git add lib/rules/combat-pipeline.ts tests/rules/combat-turn-transition-atomicity.test.ts
git commit -m "feat(combat): a stable player wakes with 1 HP on the scheduled round"
```

### Task 6: `Death Save` and `Wait`

**Files:**
- Create: `lib/db/death-save-transition.ts`
- Modify:
  - `app/api/campaign/[id]/action/route.ts`: `MACRO_ACTIONS:518`, the
    `End Turn` branch `:536`, a new `Death Save` branch before `Attack`, and
    the error mapping in `POST`;
  - `tests/architecture/player-turn-spending-actions.test.ts`.
- Tests:
  - `tests/db/death-save-transition.test.ts`;
  - `tests/api/action.test.ts`.

**Interfaces:**
- Consumes:
  - from Task 1: `resolveDeathSave`, `stabilize`, `derivePlayerLifeState`,
    `DeathSaveInvariantError`;
  - existing: `lockCharacterForCombatAction`, `setPlayerHp`, `rollDie`,
    `TurnStateConflictError`.
- Produces:
  - `interface DeathSaveContext { campaignId: string; encounterId: string; characterId: string; round: number; turnIndex: number; collectEvents: boolean }`;
  - `interface DeathSaveDice { d20(): number; d4(): number }`;
  - `rollPlayerDeathSave(tx, ctx: DeathSaveContext, dice?: DeathSaveDice): Promise<{ events: GameEvent[]; outcome: "revived" | "dying" | "stable" | "dead"; endsTurn: boolean }>`.

- [ ] **Step 1: Write the failing transition test**

```ts
// tests/db/death-save-transition.test.ts
import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { rollPlayerDeathSave } from "@/lib/db/death-save-transition";
import { TurnStateConflictError } from "@/lib/db/turn-state-conflict";

const CTX = {
  campaignId: "camp-1", encounterId: "enc-1", characterId: "char-1",
  round: 4, turnIndex: 0, collectEvents: true,
};

function buildTx(player: Record<string, unknown>, touched = 1) {
  const order: string[] = [];
  const tx = {
    $queryRaw: vi.fn(async () => { order.push("Character"); return []; }),
    combatant: {
      findFirst: vi.fn().mockResolvedValue({
        id: "p1", hp: 0, deathSaveSuccesses: 0, deathSaveFailures: 0, stableWakeRound: null,
        ...player,
      }),
      updateMany: vi.fn(async () => { order.push("Combatant"); return { count: 1 }; }),
    },
    character: { update: vi.fn(async () => { order.push("Character"); return {}; }) },
    encounter: { updateMany: vi.fn(async () => { order.push("Encounter"); return { count: touched }; }) },
    gameLog: { create: vi.fn() },
  } as unknown as Prisma.TransactionClient;
  return { tx, order };
}

const dice = (d20: number, d4 = 2) => ({ d20: () => d20, d4: () => d4 });

describe("rollPlayerDeathSave (death-saves spec §6.3)", () => {
  it("records a success and ends the turn", async () => {
    const { tx, order } = buildTx({});
    const out = await rollPlayerDeathSave(tx, CTX, dice(14));
    expect(out).toMatchObject({ outcome: "dying", endsTurn: true });
    expect(tx.combatant.updateMany).toHaveBeenCalledWith({
      where: { encounterId: "enc-1", isPlayer: true },
      data: { deathSaveSuccesses: 1, deathSaveFailures: 0 },
    });
    expect(order).toEqual(["Character", "Combatant", "Encounter"]);
    expect(out.events[0]).toEqual({
      type: "DEATH_SAVE_ROLLED",
      payload: { natural: 14, successes: 1, failures: 0, outcome: "dying" },
    });
  });

  it("revives on a natural 20 and keeps the turn", async () => {
    const { tx } = buildTx({ deathSaveFailures: 2 });
    const out = await rollPlayerDeathSave(tx, CTX, dice(20));
    expect(out).toMatchObject({ outcome: "revived", endsTurn: false });
    expect(tx.character.update).toHaveBeenCalledWith({ where: { id: "char-1" }, data: { hp: 1 } });
    expect(out.events.map((e) => e.type)).toEqual(["DEATH_SAVE_ROLLED", "PLAYER_REVIVED"]);
  });

  it("stabilises on the third success and schedules the wake", async () => {
    const { tx } = buildTx({ deathSaveSuccesses: 2 });
    const out = await rollPlayerDeathSave(tx, CTX, dice(11, 3));
    expect(out.outcome).toBe("stable");
    expect(tx.combatant.updateMany).toHaveBeenCalledWith({
      where: { encounterId: "enc-1", isPlayer: true },
      data: { deathSaveSuccesses: 3, deathSaveFailures: 0, stableWakeRound: 7 },
    });
    expect(out.events.map((e) => e.type)).toEqual(["DEATH_SAVE_ROLLED", "PLAYER_STABILIZED"]);
  });

  it("dies on the third failure", async () => {
    const { tx } = buildTx({ deathSaveFailures: 2 });
    const out = await rollPlayerDeathSave(tx, CTX, dice(3));
    expect(out).toMatchObject({ outcome: "dead", endsTurn: true });
    expect(tx.combatant.updateMany).toHaveBeenCalledWith({
      where: { encounterId: "enc-1", isPlayer: true },
      data: { deathSaveSuccesses: 0, deathSaveFailures: 3 },
    });
    expect(out.events).toContainEqual({ type: "PLAYER_DIED", payload: { cause: "death_saves" } });
  });

  it("refuses a player who is no longer dying", async () => {
    const { tx } = buildTx({ hp: 1 });
    await expect(rollPlayerDeathSave(tx, CTX, dice(14))).rejects.toBeInstanceOf(TurnStateConflictError);
    expect(tx.combatant.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a stale turn after writing nothing that survives", async () => {
    const { tx } = buildTx({}, 0);
    await expect(rollPlayerDeathSave(tx, CTX, dice(14))).rejects.toBeInstanceOf(TurnStateConflictError);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm exec vitest run tests/db/death-save-transition.test.ts`
Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement the transition**

```ts
// lib/db/death-save-transition.ts
import type { Prisma } from "@prisma/client";
import type { GameEvent } from "@/lib/events/game-events";
import { lockCharacterForCombatAction } from "@/lib/db/character-lock";
import { setPlayerHp } from "@/lib/db/player-hp";
import { TurnStateConflictError } from "@/lib/db/turn-state-conflict";
import { rollDie } from "@/lib/rules/dice";
import {
  DeathSaveInvariantError,
  derivePlayerLifeState,
  resolveDeathSave,
  stabilize,
} from "@/lib/rules/death-save";

export interface DeathSaveContext {
  campaignId: string;
  encounterId: string;
  characterId: string;
  round: number;
  turnIndex: number;
  collectEvents: boolean;
}

export interface DeathSaveDice {
  d20(): number;
  d4(): number;
}

const LIVE_DICE: DeathSaveDice = { d20: () => rollDie(20), d4: () => rollDie(4) };

/**
 * One death save on the dying player's turn (death-saves spec §6.3).
 *
 * Lock order Character → Combatant → Encounter: the Character lock first, the
 * Combatant write, then the conditional touch that binds the save to the
 * observed turn. Any lost race throws and rolls the whole transaction back.
 * The caller finalizes the turn when `endsTurn` is true.
 */
export async function rollPlayerDeathSave(
  tx: Prisma.TransactionClient,
  ctx: DeathSaveContext,
  dice: DeathSaveDice = LIVE_DICE
): Promise<{ events: GameEvent[]; outcome: "revived" | "dying" | "stable" | "dead"; endsTurn: boolean }> {
  await lockCharacterForCombatAction(tx, ctx.characterId);

  const player = await tx.combatant.findFirst({
    where: { encounterId: ctx.encounterId, isPlayer: true },
    select: {
      id: true, hp: true, deathSaveSuccesses: true, deathSaveFailures: true, stableWakeRound: true,
    },
  });
  if (!player) {
    throw new DeathSaveInvariantError(`Encounter ${ctx.encounterId} has no player combatant.`);
  }
  // Under the lock: a concurrent save that already revived, stabilised or
  // killed the player owns this turn.
  if (derivePlayerLifeState(player) !== "dying") throw new TurnStateConflictError();

  const natural = dice.d20();
  const result = resolveDeathSave(
    { successes: player.deathSaveSuccesses, failures: player.deathSaveFailures },
    natural
  );
  const where = { encounterId: ctx.encounterId, isPlayer: true };

  if (result.outcome === "revived") {
    await setPlayerHp(tx, { characterId: ctx.characterId, encounterId: ctx.encounterId, hp: 1 });
  } else if (result.outcome === "stable") {
    await tx.combatant.updateMany({
      where,
      data: {
        deathSaveSuccesses: result.successes,
        deathSaveFailures: result.failures,
        stableWakeRound: stabilize(ctx.round, dice.d4()),
      },
    });
  } else {
    await tx.combatant.updateMany({
      where,
      data: { deathSaveSuccesses: result.successes, deathSaveFailures: result.failures },
    });
  }

  const touch = await tx.encounter.updateMany({
    where: { id: ctx.encounterId, status: "active", currentTurnIndex: ctx.turnIndex, round: ctx.round },
    data: { currentTurnMovementSpentFt: 0 },
  });
  if (touch.count !== 1) throw new TurnStateConflictError();

  const successes = result.outcome === "revived" ? 0 : result.successes;
  const failures = result.outcome === "revived" ? 0 : result.failures;
  const verdict = natural === 20 ? "natural 20" : natural >= 10 ? "success" : "failure";
  await tx.gameLog.create({
    data: {
      campaignId: ctx.campaignId,
      role: "system",
      content: `Death save: ${natural} — ${verdict} (${successes}/3 successes, ${failures}/3 failures).`,
    },
  });

  const events: GameEvent[] = [];
  if (ctx.collectEvents) {
    events.push({
      type: "DEATH_SAVE_ROLLED",
      payload: { natural, successes, failures, outcome: result.outcome },
    });
    if (result.outcome === "revived") events.push({ type: "PLAYER_REVIVED", payload: { hp: 1 } });
    if (result.outcome === "stable") events.push({ type: "PLAYER_STABILIZED", payload: {} });
    if (result.outcome === "dead") events.push({ type: "PLAYER_DIED", payload: { cause: "death_saves" } });
  }

  return { events, outcome: result.outcome, endsTurn: result.outcome !== "revived" };
}
```

- [ ] **Step 4: Run the transition test**

Run: `pnpm exec vitest run tests/db/death-save-transition.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing route tests.** Append to
  `tests/api/action.test.ts`, following the "resumes enemy turns…" test at
  `:753`: set `(prisma as any).$queryRaw` and the owner `findUnique`, and
  restore both in `finally`.

```ts
  it("rolls a death save for a dying player and finalizes the turn", async () => {
    const combatants = [
      { id: "p1", name: "Hero", ...NO_MODIFIERS, isPlayer: true, hp: 0, maxHp: 20,
        initiativeTotal: 20, initiativeOrder: 0,
        deathSaveSuccesses: 0, deathSaveFailures: 0, stableWakeRound: null },
      { id: "t1", name: "Goblin", ...NO_MODIFIERS, isPlayer: false, hp: 10, maxHp: 10,
        initiativeTotal: 10, initiativeOrder: 1 },
    ];
    (buildCampaignContext as any).mockResolvedValue({
      character: { id: "char-1", name: "Hero", class: "fighter", level: 1, stats: {}, inventory: [] },
      relevantMemories: [], recentLogs: [], quests: [], currentExploration: null,
      activeEncounter: { id: "enc_123", status: "active", currentTurnIndex: 0, round: 2,
        totalDamageDealt: 0, combatants },
    });
    (prisma.combatant.findMany as any).mockResolvedValue(combatants);
    (prisma.combatant as any).findFirst = vi.fn().mockResolvedValue(combatants[0]);
    (prisma.encounter.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma as any).$queryRaw = vi.fn(async () => []);
    (prisma.encounter.findUnique as any).mockImplementation(
      async (args: { select?: Record<string, unknown> }) =>
        args?.select?.campaign ? { campaignId, campaign: { characterId: "char-1" } } : null
    );
    vi.spyOn(Math, "random").mockReturnValue(0.7); // d20 = 15: success

    try {
      const res = await POST(
        new NextRequest(`http://localhost/api/campaign/${campaignId}/action`, {
          method: "POST", body: JSON.stringify({ action: "Death Save" }),
        }),
        { params: Promise.resolve({ id: campaignId }) }
      );
      expect(res.status).toBe(200);
      expect(prisma.combatant.updateMany).toHaveBeenCalledWith({
        where: { encounterId: "enc_123", isPlayer: true },
        data: { deathSaveSuccesses: 1, deathSaveFailures: 0 },
      });
      expect(canonicalUserLogWrites()).toHaveLength(1);
    } finally {
      delete (prisma as any).$queryRaw;
      delete (prisma.combatant as any).findFirst;
      (prisma.encounter.findUnique as any).mockReset();
      vi.restoreAllMocks();
    }
  });

  it.each([
    ["Attack", 0, null, "PLAYER_UNCONSCIOUS"],
    ["End Turn", 0, null, "PLAYER_UNCONSCIOUS"],
    ["Death Save", 0, 5, "PLAYER_UNCONSCIOUS"],
    ["Death Save", 12, null, "PLAYER_CONSCIOUS"],
    ["Wait", 12, null, "PLAYER_CONSCIOUS"],
  ])("refuses %s at hp %s (stableWakeRound %s) with %s", async (action, hp, wake, code) => {
    const combatants = [
      { id: "p1", name: "Hero", ...NO_MODIFIERS, isPlayer: true, hp, maxHp: 20,
        initiativeTotal: 20, initiativeOrder: 0,
        deathSaveSuccesses: wake === null ? 0 : 3, deathSaveFailures: 0, stableWakeRound: wake },
      { id: "t1", name: "Goblin", ...NO_MODIFIERS, isPlayer: false, hp: 10, maxHp: 10,
        initiativeTotal: 10, initiativeOrder: 1 },
    ];
    (buildCampaignContext as any).mockResolvedValue({
      character: { id: "char-1", name: "Hero", class: "fighter", level: 1, stats: {}, inventory: [] },
      relevantMemories: [], recentLogs: [], quests: [], currentExploration: null,
      activeEncounter: { id: "enc_123", status: "active", currentTurnIndex: 0, round: 2,
        totalDamageDealt: 0, combatants },
    });

    const res = await POST(
      new NextRequest(`http://localhost/api/campaign/${campaignId}/action`, {
        method: "POST", body: JSON.stringify({ action }),
      }),
      { params: Promise.resolve({ id: campaignId }) }
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe(code);
    expect(canonicalUserLogWrites()).toHaveLength(0);
  });

  it("refuses Death Save with no active encounter", async () => {
    (buildCampaignContext as any).mockResolvedValue({
      character: { id: "char-1", name: "Hero", class: "fighter", level: 1, stats: {}, inventory: [] },
      relevantMemories: [], recentLogs: [], quests: [], currentExploration: null,
      activeEncounter: null,
    });
    const res = await POST(
      new NextRequest(`http://localhost/api/campaign/${campaignId}/action`, {
        method: "POST", body: JSON.stringify({ action: "Death Save" }),
      }),
      { params: Promise.resolve({ id: campaignId }) }
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("NO_ACTIVE_ENCOUNTER");
  });
```

- [ ] **Step 6: Run them and see them fail**

Run: `pnpm exec vitest run tests/api/action.test.ts`
Expected: FAIL. `Death Save` falls through to intent parsing, and no 409 codes
exist yet.

- [ ] **Step 7: The route.**

  (a) **Refusal.** After `const context = await buildCampaignContext(campaignId);`:

```ts
  // An unconscious player acts only through the death-save actions (death-saves
  // spec §7.1). Runs after receipt acquisition like every refusal here: the
  // receipt records the 4xx and no game state or log is written.
  const conditionRefusal = playerConditionRefusal(context.activeEncounter, trimmedAction);
  if (conditionRefusal) return conditionRefusal;
```

  Next to `playerTurnRefusal`:

```ts
const DEATH_SAVE_ACTION = { dying: "Death Save", stable: "Wait" } as const;

function playerConditionRefusal(
  encounter: Awaited<ReturnType<typeof buildCampaignContext>>["activeEncounter"],
  action: string
): Response | null {
  const deathAction = action === "Death Save" || action === "Wait";
  const refuse = (code: string, error: string, extra: Record<string, unknown> = {}) =>
    NextResponse.json({ error, code, ...extra }, { status: 409 });

  if (!encounter) {
    return deathAction ? refuse("NO_ACTIVE_ENCOUNTER", "There is no active encounter.") : null;
  }
  const player = encounter.combatants.find((c) => c.isPlayer);
  if (!player) return null; // playerTurnRefusal reports INVALID_PLAYER_COMBATANT.

  const state = derivePlayerLifeState(player);
  if (state === "conscious") {
    return deathAction ? refuse("PLAYER_CONSCIOUS", "Only an unconscious player rolls death saves.") : null;
  }
  if (state === "dead") {
    throw new DeathSaveInvariantError(`Encounter ${encounter.id} is active with a dead player.`);
  }

  const allowedAction = DEATH_SAVE_ACTION[state];
  if (action === allowedAction) return null;
  // End Turn still resumes an encounter parked on an enemy slot (enemy-turns §6.6).
  const authority = resolveEncounterTurnAuthority(encounter);
  if (action === "End Turn" && authority.ok && !authority.playerOwnsTurn) return null;
  return refuse("PLAYER_UNCONSCIOUS", "The player is unconscious.", { allowedAction });
}
```

  (b) **Macros.** Set `const MACRO_ACTIONS = ["Attack", "End Turn", "Wait", "Death Save", "Move"];`,
  and change the `End Turn` branch head to
  `if (trimmedAction === "End Turn" || trimmedAction === "Wait") {`. The branch
  body is unchanged: `Wait` is `End Turn` for a stable player, and its
  canonical user log reads "Wait".

  (c) **`Death Save` branch**, placed directly after the `End Turn` branch and
  before `if (trimmedAction === "Attack")`:

```ts
    if (trimmedAction === "Death Save") {
      let finalizeOutcome: Awaited<ReturnType<typeof finalizeEncounterTurn>> | null = null;
      try {
        await prisma.$transaction(async (tx) => {
          const save = await rollPlayerDeathSave(tx as Prisma.TransactionClient, {
            campaignId,
            encounterId: context.activeEncounter!.id,
            characterId: context.character.id,
            round: context.activeEncounter!.round,
            turnIndex: context.activeEncounter!.currentTurnIndex,
            collectEvents: true,
          });
          gameEvents.push(...save.events);

          if (save.endsTurn) {
            finalizeOutcome = await finalizeEncounterTurn({
              tx: tx as Prisma.TransactionClient,
              encounterId: context.activeEncounter!.id,
              currentTurnIndex: context.activeEncounter!.currentTurnIndex,
              round: context.activeEncounter!.round,
              failOnStaleTurn: true,
            });
            if (finalizeOutcome.turnAdvanceConflict) {
              throw new TurnStateConflictError();
            }
          }

          await tx.gameLog.create({
            data: { campaignId, role: "user", content: trimmedAction },
          });
        });
      } catch (error) {
        if (error instanceof TurnStateConflictError) {
          gameEvents.length = 0;
          return NextResponse.json(
            {
              error: "The encounter turn changed before this death save could be applied. Refresh state and try again.",
              code: "TURN_STATE_CONFLICT",
            },
            { status: 409 }
          );
        }
        throw error;
      }

      playerActionLogged = true;
      if (finalizeOutcome) gameEvents.push(...finalizeOutcome.events);
    }
```

  Import `rollPlayerDeathSave`, `derivePlayerLifeState` and
  `DeathSaveInvariantError`.

  (d) **Error mapping.** In `POST`, next to the existing
  `EnemyTurnInvariantError` clause, add:

```ts
    if (error instanceof DeathSaveInvariantError) {
      return NextResponse.json(
        { error: "The death-save state is inconsistent.", code: "DEATH_SAVE_INVARIANT" },
        { status: 500 }
      );
    }
```

- [ ] **Step 8: The architecture test.** In
  `tests/architecture/player-turn-spending-actions.test.ts`, replace the first
  entry of `TURN_ENDING_BRANCHES` with the two entries below. Now seven
  branches carry seven `failOnStaleTurn: true` calls.

```ts
  {
    label: "End Turn / Wait",
    start: 'if (trimmedAction === "End Turn" || trimmedAction === "Wait")',
    end: 'if (trimmedAction === "Death Save")',
    abortsTransaction: false,
  },
  {
    label: "Death Save",
    start: 'if (trimmedAction === "Death Save")',
    end: 'if (trimmedAction === "Attack")',
    abortsTransaction: true,
  },
```

- [ ] **Step 9: Run and falsify.** Run
  `pnpm exec vitest run tests/api/action.test.ts tests/architecture/player-turn-spending-actions.test.ts tests/db/death-save-transition.test.ts`.
  Expected: PASS. Falsify:
  - remove `if (action === allowedAction) return null;` — the Death Save
    test fails;
  - swap the touch before the Combatant write — the lock-order test fails;
  - drop the `derivePlayerLifeState(...) !== "dying"` check — the
    "no longer dying" test fails.

- [ ] **Step 10: Commit**

```bash
git add lib/db/death-save-transition.ts app/api/campaign/[id]/action/route.ts tests/db/death-save-transition.test.ts tests/api/action.test.ts tests/architecture/player-turn-spending-actions.test.ts
git commit -m "feat(action): Death Save and Wait for an unconscious player"
```

### Task 7: The write-route guard

**Files:**
- Create: `lib/db/campaign-guard.ts`
- Modify (each after its ownership check), with `campaignPlayableRefusal`
  replacing any `campaign.status !== "active"` check:
  - `app/api/campaign/[id]/action/route.ts:334-336`;
  - `encounter/route.ts:90`;
  - `rest/route.ts:63`;
  - `social/route.ts:76`;
  - `social/rumors/route.ts:70`;
  - `npc/route.ts:85`;
  - `quest/route.ts:17`;
  - `quest/[questId]/route.ts:63`;
  - `magic/cast/route.ts`, after `:71`;
  - `level-up/route.ts`, after its campaign lookup.
- Tests:
  - `tests/db/campaign-guard.test.ts`;
  - `tests/architecture/write-route-guards.test.ts`.

**Interfaces:**
- Produces:
  - `type GuardRefusal = { code: "CAMPAIGN_NOT_ACTIVE" | "CHARACTER_DEAD" | "PLAYER_UNCONSCIOUS" | "CHARACTER_AT_ZERO_HP"; error: string }`;
  - `campaignPlayableRefusal(db, campaignId: string, options?: { unconscious?: "refuse" | "delegate" }): Promise<GuardRefusal | null>`;
  - `guardResponse(refusal: GuardRefusal): Response`, which returns 409 with
    `{ error, code }`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/db/campaign-guard.test.ts
import { describe, expect, it, vi } from "vitest";
import { campaignPlayableRefusal } from "@/lib/db/campaign-guard";

function db(row: unknown) {
  return { campaign: { findUnique: vi.fn().mockResolvedValue(row) } } as never;
}
const alive = { diedAt: null };
const fight = (hp: number) => [{ combatants: [{ hp }] }];

describe("campaignPlayableRefusal (death-saves spec §7.2)", () => {
  it("lets a playable campaign through", async () => {
    expect(await campaignPlayableRefusal(db({ status: "active", character: alive, encounters: [] }), "c")).toBeNull();
    expect(await campaignPlayableRefusal(db({ status: "active", character: alive, encounters: fight(5) }), "c")).toBeNull();
  });

  it("refuses an inactive campaign", async () => {
    expect(await campaignPlayableRefusal(db({ status: "archived", character: alive, encounters: [] }), "c"))
      .toMatchObject({ code: "CAMPAIGN_NOT_ACTIVE", error: "Campaign is not active." });
  });

  it("refuses a dead character before anything else", async () => {
    expect(
      await campaignPlayableRefusal(db({ status: "active", character: { diedAt: new Date() }, encounters: fight(0) }), "c")
    ).toMatchObject({ code: "CHARACTER_DEAD" });
  });

  it("refuses an unconscious player unless the caller delegates 0 HP", async () => {
    const row = { status: "active", character: alive, encounters: fight(0) };
    expect(await campaignPlayableRefusal(db(row), "c")).toMatchObject({ code: "PLAYER_UNCONSCIOUS" });
    expect(await campaignPlayableRefusal(db(row), "c", { unconscious: "delegate" })).toBeNull();
  });
});
```

```ts
// tests/architecture/write-route-guards.test.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const WRITE = /export\s+(?:async\s+)?function\s+(POST|PATCH|PUT|DELETE)\b/;

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routes(full);
    return name === "route.ts" ? [full] : [];
  });
}

/** Write handlers that answer without touching campaign state. */
const CAMPAIGN_EXEMPT = new Set(["app/api/campaign/[id]/encounter/turn/route.ts"]); // 410 Gone

describe("every campaign write route calls the playable guard (spec §7.2)", () => {
  const files = routes(join(ROOT, "app", "api", "campaign", "[id]"))
    .map((f) => relative(ROOT, f).replace(/\\/g, "/"))
    .filter((f) => WRITE.test(readFileSync(join(ROOT, f), "utf8")));

  it("finds the write routes", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it.each(files.filter((f) => !CAMPAIGN_EXEMPT.has(f)))("%s", (file) => {
    expect(readFileSync(join(ROOT, file), "utf8")).toContain("campaignPlayableRefusal(");
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run tests/db/campaign-guard.test.ts tests/architecture/write-route-guards.test.ts`
Expected: FAIL. The module is missing, and no route calls the guard.

- [ ] **Step 3: Implement the guard**

```ts
// lib/db/campaign-guard.ts
import { NextResponse } from "next/server";
import type { Prisma, PrismaClient } from "@prisma/client";

export type GuardRefusal = {
  code: "CAMPAIGN_NOT_ACTIVE" | "CHARACTER_DEAD" | "PLAYER_UNCONSCIOUS" | "CHARACTER_AT_ZERO_HP";
  error: string;
};

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * One refusal for every campaign write route (death-saves spec §7.2):
 * an inactive campaign, a dead character, or an unconscious player. The
 * action route passes `unconscious: "delegate"` and leaves 0 HP to its own
 * playerConditionRefusal, which lets Death Save and Wait through.
 * Returns null for a missing campaign: every route already answers 404 first.
 */
export async function campaignPlayableRefusal(
  db: Db,
  campaignId: string,
  options: { unconscious?: "refuse" | "delegate" } = {}
): Promise<GuardRefusal | null> {
  const row = await db.campaign.findUnique({
    where: { id: campaignId },
    select: {
      status: true,
      character: { select: { diedAt: true } },
      encounters: {
        where: { status: "active" },
        select: { combatants: { where: { isPlayer: true }, select: { hp: true } } },
        take: 1,
      },
    },
  });
  if (!row) return null;
  if (row.character?.diedAt) return { code: "CHARACTER_DEAD", error: "The character is dead." };
  if (row.status !== "active") return { code: "CAMPAIGN_NOT_ACTIVE", error: "Campaign is not active." };
  const player = row.encounters[0]?.combatants[0];
  if (options.unconscious !== "delegate" && player && player.hp <= 0) {
    return { code: "PLAYER_UNCONSCIOUS", error: "The player is unconscious." };
  }
  return null;
}

export function guardResponse(refusal: GuardRefusal): Response {
  return NextResponse.json({ error: refusal.error, code: refusal.code }, { status: 409 });
}
```

- [ ] **Step 4: Wire the routes.** In each route listed above, insert after
  the ownership check:

```ts
  const playable = await campaignPlayableRefusal(prisma, campaignId);
  if (playable) return guardResponse(playable);
```

  Delete the route's own `campaign.status !== "active"` block, which the
  guard now covers.
  - **Action route:** passes `{ unconscious: "delegate" }` and keeps its
    placement before receipt acquisition.
  - **Encounter route:** after the guard, refuse a character at 0 HP:

```ts
  if (campaign.character.hp <= 0) {
    return guardResponse({
      code: "CHARACTER_AT_ZERO_HP",
      error: "The character is at 0 HP. Rest before starting an encounter.",
    });
  }
```

- [ ] **Step 5: Run the full suite.** Run
  `pnpm exec vitest run --maxWorkers=2`. Route tests whose Prisma mock
  `campaign.findUnique` returns a row without `character` or `encounters`
  still pass: a missing `character` reads as alive, and missing `encounters`
  would crash. Two fixes are acceptable: make the mock return
  `encounters: []`, or use `row.encounters?.[0]` in the guard. **Prefer the
  guard change**, so legacy doubles keep working, and add a guard test for a
  row without `encounters`. Tests that asserted the old 409 body with no
  `code` now receive `code: "CAMPAIGN_NOT_ACTIVE"`; update them and list them
  in the PR body.

- [ ] **Step 6: Falsify.**
  - Remove the guard from `magic/cast`: the architecture test fails.
  - Swap the `diedAt` and `status` checks: the "before anything else" test
    fails.

  Revert both.

- [ ] **Step 7: Commit**

```bash
git add lib/db/campaign-guard.ts app/api/campaign tests
git commit -m "feat(api): one playable-campaign guard on every campaign write route"
```

### Task 8: Real-PostgreSQL smoke and PR 2/3

**Files:**
- Create:
  - `tests/e2e/support/combat-fixture.ts`;
  - `tests/e2e/death-saves.spec.ts`.
- Modify: `tests/e2e/enemy-turns.spec.ts`, which imports the moved helpers.

- [ ] **Step 1: Extract the fixture.** Move these from
  `tests/e2e/enemy-turns.spec.ts` into `tests/e2e/support/combat-fixture.ts`,
  exported and unchanged:
  - `parseSseFrames`, `ActionSseFrame`, `createdId`, `postAction`;
  - `GoblinFixture`, `createGoblinFixture`, `cleanupFixture`;
  - `holdCharacterLock`, `waitForBlockedCharacterLocks`.

  Then import them back. Extend `createGoblinFixture`'s options with an
  optional `player?: { hp?: number; deathSaveSuccesses?: number; deathSaveFailures?: number; stableWakeRound?: number | null }`,
  spread into the player combatant. When `player.hp` is given, set
  `Character.hp` to the same value.
  Run `pnpm exec playwright test --list enemy-turns`; the four tests are still
  listed.

- [ ] **Step 2: Write the smoke spec**

```ts
// tests/e2e/death-saves.spec.ts
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { assertSafeE2EDatabase } from "./support/database";
import {
  cleanupFixture,
  createGoblinFixture,
  holdCharacterLock,
  parseSseFrames,
  postAction,
  waitForBlockedCharacterLocks,
  type GoblinFixture,
} from "./support/combat-fixture";

/** Death saves on real PostgreSQL (death-saves spec §10.5). */

function types(body: string): string[] {
  return parseSseFrames(body)
    .filter((f) => f.t === "evt" && typeof f.e?.type === "string")
    .map((f) => f.e!.type!);
}

test("@smoke a dying player's death save runs the chain and no enemy strikes", async ({ request }) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();
  const prisma = new PrismaClient();
  let fixture: GoblinFixture | undefined;
  try {
    fixture = await createGoblinFixture(request, prisma, {
      goblinAt: { x: 5, y: 6 }, withProfile: true, currentTurnIndex: 0,
      player: { hp: 0 },
    });
    const campaignId = fixture.created.campaignId!;

    const res = await postAction(request, campaignId, "Death Save");
    expect(res.status()).toBe(200);
    expect(types(await res.text())).toContain("DEATH_SAVE_ROLLED");
    expect(
      await prisma.gameLog.count({
        where: { campaignId, role: "system", content: { startsWith: "Goblin —" } },
      }),
    ).toBe(0);
  } finally {
    await cleanupFixture(prisma, fixture);
  }
});

test("@smoke a terminal death save lands in exactly one consistent state", async ({ request }) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();
  const prisma = new PrismaClient();
  let fixture: GoblinFixture | undefined;
  try {
    fixture = await createGoblinFixture(request, prisma, {
      goblinAt: { x: 5, y: 6 }, withProfile: true, currentTurnIndex: 0,
      player: { hp: 0, deathSaveSuccesses: 2, deathSaveFailures: 2 },
    });
    const res = await postAction(request, fixture.created.campaignId!, "Death Save");
    expect(res.status()).toBe(200);
    const events = types(await res.text());

    const [player, encounter] = await Promise.all([
      prisma.combatant.findUniqueOrThrow({ where: { id: fixture.playerId } }),
      prisma.encounter.findUniqueOrThrow({ where: { id: fixture.encounterId } }),
    ]);
    if (events.includes("PLAYER_REVIVED")) {
      expect(player).toMatchObject({ hp: 1, deathSaveSuccesses: 0, deathSaveFailures: 0, stableWakeRound: null });
      expect(encounter.status).toBe("active");
    } else if (events.includes("PLAYER_STABILIZED")) {
      expect(player).toMatchObject({ hp: 0, deathSaveSuccesses: 3 });
      expect(player.stableWakeRound).toBeGreaterThanOrEqual(2);
      expect(encounter.status).toBe("active");
    } else {
      expect(events).toContain("PLAYER_DIED");
      expect(player.deathSaveFailures).toBe(3);
      expect(encounter.status).toBe("resolved");
    }
  } finally {
    await cleanupFixture(prisma, fixture);
  }
});

test("@smoke concurrent death saves roll once", async ({ request }) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();
  const prisma = new PrismaClient();
  let fixture: GoblinFixture | undefined;
  let lock: ReturnType<typeof holdCharacterLock> | undefined;
  try {
    fixture = await createGoblinFixture(request, prisma, {
      goblinAt: { x: 5, y: 6 }, withProfile: true, currentTurnIndex: 0,
      player: { hp: 0 },
    });
    const campaignId = fixture.created.campaignId!;
    lock = holdCharacterLock(prisma, fixture.created.characterId!);
    await lock.isHeld;
    const first = postAction(request, campaignId, "Death Save");
    const second = postAction(request, campaignId, "Death Save");
    await waitForBlockedCharacterLocks(prisma, 2);
    lock.release();
    await lock.transaction;

    const statuses = (await Promise.all([first, second])).map((r) => r.status()).sort();
    expect(statuses).toEqual([200, 409]);
    expect(
      await prisma.gameLog.count({ where: { campaignId, role: "system", content: { startsWith: "Death save:" } } }),
    ).toBe(1);
  } finally {
    lock?.release();
    await lock?.transaction.catch(() => undefined);
    await cleanupFixture(prisma, fixture);
  }
});

test("@smoke Wait wakes a stable player on the scheduled round", async ({ request }) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();
  const prisma = new PrismaClient();
  let fixture: GoblinFixture | undefined;
  try {
    fixture = await createGoblinFixture(request, prisma, {
      goblinAt: { x: 5, y: 6 }, withProfile: true, currentTurnIndex: 0,
      player: { hp: 0, deathSaveSuccesses: 3, stableWakeRound: 2 },
    });
    const res = await postAction(request, fixture.created.campaignId!, "Wait");
    expect(res.status()).toBe(200);
    expect(types(await res.text())).toContain("PLAYER_WOKE");
    await expect(
      prisma.character.findUniqueOrThrow({ where: { id: fixture.created.characterId! }, select: { hp: true } }),
    ).resolves.toEqual({ hp: 1 });
  } finally {
    await cleanupFixture(prisma, fixture);
  }
});

test("@smoke PostgreSQL rejects an impossible death-save counter", async ({ request }) => {
  test.setTimeout(60_000);
  assertSafeE2EDatabase();
  const prisma = new PrismaClient();
  let fixture: GoblinFixture | undefined;
  try {
    fixture = await createGoblinFixture(request, prisma, {
      goblinAt: { x: 5, y: 6 }, withProfile: false, currentTurnIndex: 0,
    });
    await expect(
      prisma.combatant.update({ where: { id: fixture.playerId }, data: { deathSaveFailures: 4 } }),
    ).rejects.toThrow(/Combatant_deathSaveFailures_range|check constraint/i);
  } finally {
    await cleanupFixture(prisma, fixture);
  }
});
```

- [ ] **Step 3: Verify locally what can be verified.** E2E cannot run here
  (no `.env`, by design). Run `pnpm typecheck` and
  `pnpm exec playwright test --list`: `death-saves.spec.ts` lists five tests,
  and the four from `enemy-turns.spec.ts` are still listed.

- [ ] **Step 4: Full validation.** Run `pnpm typecheck`,
  `pnpm exec vitest run --maxWorkers=2`, `pnpm build` and `pnpm check-retro`.
  Record the results.

- [ ] **Step 5: Commit, then PR 2/3.**

```bash
git add tests/e2e
git commit -m "test(e2e): death saves on real PostgreSQL"
```

  With the maintainer's go-ahead, push and open "feat(combat): death saving
  throws (death saves 2/3)". The body **must** begin with:

```markdown
> **Deploy ordering: apply `20260916120000_add_death_save_state` before
> deploying this code.** Prisma selects every scalar column, so the new code
> without the columns breaks every `Combatant` and `Character` query — combat
> and the character sheet first. The migration is additive (two nullable
> columns, three CHECK constraints); the old code ignores it. Rollback is
> reverting the code.
```

  Then list the contract-changed tests by file (Task 4 Step 12, Task 7
  Step 5). Wait for green checks and squash-merge.

---

# Stage 3 — Permanent death, UI and the record

**Branch:** `claude/death-saves-3-death`. **Schema impact:** none (the columns
shipped in Stage 2). **Behaviour change:** death is permanent; the UI shows
the dying state.

### Task 9: `diedAt` and the dead-character refusals

**Files:**
- Modify: `lib/rules/combat-pipeline.ts` (`resolveEncounterIfEnded:879-884`)
- Modify: `lib/db/campaign-guard.ts` (add `characterAliveRefusal`)
- Modify: `app/api/campaign/route.ts` and the six character write routes:
  - `app/api/character/[id]/route.ts` (PATCH);
  - `history/[auditId]/undo`;
  - `pdf/import`;
  - `proposals` (POST);
  - `proposals/[proposalId]/accept`;
  - `proposals/[proposalId]/reject`.
- Tests:
  - `tests/rules/combat-turn-transition-atomicity.test.ts`;
  - `tests/db/campaign-guard.test.ts`;
  - `tests/architecture/write-route-guards.test.ts`;
  - `tests/architecture/died-at-single-writer.test.ts`.

**Interfaces:**
- Produces:
  - `characterAliveRefusal(db, characterId: string): Promise<GuardRefusal | null>`;
  - `diedAt` written in the `player_dead` winner branch.

- [ ] **Step 1: Write the failing tests.** Atomicity suite: extend the
  "resolves player_dead when an enemy kills the player outright" test with a
  `character: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }` on the
  double, then assert:

```ts
    expect((tx as any).character.updateMany).toHaveBeenCalledWith({
      where: { id: "char-1", diedAt: null },
      data: { diedAt: expect.any(Date) },
    });
```

  Guard suite:

```ts
import { characterAliveRefusal } from "@/lib/db/campaign-guard";

describe("characterAliveRefusal", () => {
  it("refuses a dead character and passes a living one", async () => {
    const dead = { character: { findUnique: vi.fn().mockResolvedValue({ diedAt: new Date() }) } } as never;
    const alive = { character: { findUnique: vi.fn().mockResolvedValue({ diedAt: null }) } } as never;
    expect(await characterAliveRefusal(dead, "x")).toMatchObject({ code: "CHARACTER_DEAD" });
    expect(await characterAliveRefusal(alive, "x")).toBeNull();
  });
});
```

  Architecture: add a character-routes block to `write-route-guards.test.ts`
  that mirrors the campaign block. It walks `app/api/character/[id]` and adds
  `app/api/campaign/route.ts`, expects `characterAliveRefusal(` in each, and
  exempts nothing. Then:

```ts
// tests/architecture/died-at-single-writer.test.ts
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("Character.diedAt has one writer (death-saves spec §9)", () => {
  it("is written only by resolveEncounterIfEnded", () => {
    const hits = execSync('git grep -l -E "diedAt:\\s*(new Date|now)" -- lib app', { encoding: "utf8" })
      .trim().split("\n").filter(Boolean);
    expect(hits).toEqual(["lib/rules/combat-pipeline.ts"]);
  });
});
```

- [ ] **Step 2: Run them and see them fail.**

- [ ] **Step 3: Implement.** In `resolveEncounterIfEnded`, inside
  `if (claim.count === 1)`, before the XP branch:

```ts
    if (resolution.reason === "player_dead") {
      // Permanent death (death-saves spec §9). The winner of the active →
      // resolved claim is the only writer; `diedAt: null` makes a retry a no-op.
      const owner = await tx.encounter.findUnique({
        where: { id: encounterId },
        select: { campaign: { select: { characterId: true } } },
      });
      if (owner) {
        await tx.character.updateMany({
          where: { id: owner.campaign.characterId, diedAt: null },
          data: { diedAt: new Date() },
        });
      }
    }
```

  In `lib/db/campaign-guard.ts`:

```ts
/** Refuses every write to a dead character (death-saves spec §7.2, §9). */
export async function characterAliveRefusal(db: Db, characterId: string): Promise<GuardRefusal | null> {
  const row = await db.character.findUnique({ where: { id: characterId }, select: { diedAt: true } });
  return row?.diedAt ? { code: "CHARACTER_DEAD", error: "The character is dead." } : null;
}
```

  Wire it into each character write route after the ownership check, and into
  `POST /api/campaign` after its ownership check:

```ts
  const alive = await characterAliveRefusal(prisma, characterId);
  if (alive) return guardResponse(alive);
```

  The variable is `character.id` in `app/api/campaign/route.ts`; in the
  character routes, use the route's `id` parameter.

- [ ] **Step 4: Run, falsify, commit.**
  - Drop `diedAt: null` from the `where`: the idempotency assertion fails.
  - Remove the refusal from `accept`: the architecture test fails.

  Revert both, then run the full suite.

```bash
git add lib app tests
git commit -m "feat(combat): death is permanent — diedAt and the dead-character refusals"
```

### Task 10: Narration facts and the player-death rule

**Files:**
- Modify:
  - `lib/narrative/combat-narrative-types.ts` (the fact-type union and the
    list at `:32-47`);
  - `lib/narrative/combat-fact-adapter.ts`;
  - `lib/narrative/narrative-validator.ts:198-211`.
- Tests: `tests/narrative/death-save-facts.test.ts`

**Interfaces:**
- Produces the fact types `player_died`, `player_downed`,
  `death_save_rolled`, `player_stabilized`, `player_revived` and
  `player_woke`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/narrative/death-save-facts.test.ts
import { describe, expect, it } from "vitest";
import { adaptCombatEventsToNarrativeContext } from "@/lib/narrative/combat-fact-adapter";
import { validateNarrativeText } from "@/lib/narrative/narrative-validator";

describe("death-save narration (death-saves spec §6.6)", () => {
  it("turns each death event into a fact", () => {
    const { facts } = adaptCombatEventsToNarrativeContext([
      { type: "DEATH_SAVE_ROLLED", payload: { natural: 14, successes: 1, failures: 0, outcome: "dying" } },
      { type: "PLAYER_DIED", payload: { cause: "death_saves" } },
    ]);
    expect(facts.map((f) => f.type)).toEqual(["death_save_rolled", "player_died"]);
  });

  it("refuses prose that kills the player without the fact", () => {
    const { issues } = validateNarrativeText("Caes al suelo y mueres.", { facts: [] } as never);
    expect(issues.map((i) => i.code)).toContain("unconfirmed_player_death");
  });

  it("accepts the player's death when the backend confirms it", () => {
    const { issues } = validateNarrativeText("Caes al suelo y mueres.", {
      facts: [{ type: "player_died", description: "", payload: {} }],
    } as never);
    expect(issues.map((i) => i.code)).not.toContain("unconfirmed_player_death");
    expect(issues.map((i) => i.code)).not.toContain("unconfirmed_death");
  });
});
```

- [ ] **Step 2: Run it and see it fail.**

- [ ] **Step 3: Implement.**
  - Add the six fact types to the union and to the list.
  - In the adapter, move `PLAYER_DOWNED` and the five new events out of the
    no-op list into their own `.with(...)` cases, each `addFact({ type, description, payload })`
    with the event's payload.
  - In the validator, add the player-death rule after rule 7, and let rule 7
    accept `player_died` too:

```ts
  // 7b. Muerte del jugador no confirmada
  const playerDeathWords = /\b(?:mueres|has\s+muerto|estás\s+muert[oa]|you\s+die|you\s+are\s+dead)\b/i;
  if (playerDeathWords.test(assertedDeathText)) {
    const hasPlayerDied = context?.facts.some(f => f.type === 'player_died') ?? false;
    if (!hasPlayerDied) {
      issues.push({
        code: 'unconfirmed_player_death',
        message: "Text describes the player's death, but the backend has not confirmed it.",
        severity: 'error'
      });
    }
  }
```

  In rule 7, the fact check becomes
  `f.type === 'enemy_defeated' || f.type === 'player_died'`.

- [ ] **Step 4: Run, falsify, commit.** Remove rule 7b: the second test
  fails. Revert.

```bash
git add lib/narrative tests/narrative/death-save-facts.test.ts
git commit -m "feat(narrative): death-save facts and the player-death rule"
```

### Task 11: The UI

**Files:**
- Modify:
  - `components/combat/MacroDeck.tsx` (`Props`, `COMBAT_ACTIONS`,
    `CANONICAL_ACTION_REQUESTS`, the render);
  - `app/campaign/[id]/page.tsx:865` and `:886`;
  - `components/combat/InitiativeTracker.tsx`;
  - `lib/rules/combat.ts` (`InitiativeEntry`);
  - `app/campaigns/page.tsx:112-118` and `CampaignCard`.
- Test: `tests/components/macro-deck-death-saves.test.tsx`

**Interfaces:**
- Produces:
  - `MacroDeck` props `{ inCombat: boolean; lifeState?: PlayerLifeState; deathSaves?: { successes: number; failures: number } }`;
  - `InitiativeEntry.unconscious?: boolean`.

- [ ] **Step 1: Write the failing test.** This follows the jsdom pattern of
  `tests/components/ActionInput.test.tsx`.

```tsx
// tests/components/macro-deck-death-saves.test.tsx
/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import MacroDeck from "@/components/combat/MacroDeck";

afterEach(() => cleanup());

describe("MacroDeck while the player is down (death-saves spec §7.4)", () => {
  it("offers only the death save while dying, with the counters", () => {
    render(<MacroDeck inCombat lifeState="dying" deathSaves={{ successes: 2, failures: 1 }} />);
    expect(screen.getByRole("button", { name: "Tirada de muerte" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Atacar con arma" })).toBeNull();
    expect(screen.getByLabelText("Éxitos 2 de 3, fallos 1 de 3")).toBeTruthy();
  });

  it("offers only Esperar while stable", () => {
    render(<MacroDeck inCombat lifeState="stable" deathSaves={{ successes: 3, failures: 0 }} />);
    expect(screen.getByRole("button", { name: "Esperar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Tirada de muerte" })).toBeNull();
  });

  it("keeps the ordinary combat actions when conscious", () => {
    render(<MacroDeck inCombat />);
    expect(screen.getByRole("button", { name: "Atacar con arma" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and see it fail.**

- [ ] **Step 3: Implement.**
  - **`CANONICAL_ACTION_REQUESTS`:** add `"Tirada de muerte": "Death Save"`
    and `"Esperar": "Wait"`.
  - **`MacroDeck`:** in combat, the rendered action list is
    `lifeState === "dying" ? ["Tirada de muerte"] : lifeState === "stable" ? ["Esperar"] : COMBAT_ACTIONS`.
  - **Counters:** when `deathSaves` is set, render a
    `<p aria-label={\`Éxitos ${s} de 3, fallos ${f} de 3\`}>` holding
    `●`/`○` for the successes and `✕`/`○` for the failures.
  - **`page.tsx`:** derive the player's state from the active encounter:

```tsx
  const playerCombatant = activeEncounter?.combatants.find((c) => c.isPlayer) ?? null;
  const lifeState = playerCombatant ? derivePlayerLifeState(playerCombatant) : undefined;
```

  - **Pass the props:**
    `<MacroDeck inCombat={!!activeEncounter && !character.diedAt} lifeState={lifeState} deathSaves={playerCombatant ? { successes: playerCombatant.deathSaveSuccesses, failures: playerCombatant.deathSaveFailures } : undefined} />`.
  - **`InitiativeEntry`:** add `unconscious: c.isPlayer && c.hp <= 0` to each
    entry. `InitiativeTracker` renders an "Inconsciente" badge next to that
    entry's name, in the same element style as its existing HP text.
  - **Epitaph:** when `character.diedAt` is set, replace the `#commands`
    section's content with:

```tsx
<div role="status" className="space-y-2 text-center">
  <p className="text-lg">{character.name} ha caído.</p>
  <Link href="/character/create" className={buttonClassName()}>Crear otro personaje</Link>
</div>
```

  - **`app/campaigns/page.tsx`:** add `diedAt: true` to the character select.
    `CampaignCard` shows "Caída" in place of the status label when
    `campaign.character.diedAt` is set.

- [ ] **Step 4: Run, typecheck, commit.** Run the test, then `pnpm typecheck`
  and `pnpm build`.

```bash
git add components app lib/rules/combat.ts tests/components/macro-deck-death-saves.test.tsx
git commit -m "feat(ui): death-save actions, the unconscious badge and the epitaph"
```

### Task 12: The record, the dead-campaign smoke, PR 3/3

**Files:**
- Modify:
  - `docs/SYSTEM_STATE.md:77-9x` (the "LAW-04 — Death Saving Throws"
    section);
  - `MASTER_ARCH_GUIDE.md` §4.4;
  - `tests/e2e/death-saves.spec.ts`.

- [ ] **Step 1: Correct the record.** Replace the LAW-04 section's status
  table with a note:
  - the 2026-05-05 entry described code that never reached any branch
    (`git log -S resolveDeathSave --all`);
  - death saves shipped in the three PRs of
    `docs/superpowers/specs/2026-09-15-death-saves-design.md`;
  - list those PRs by title.

- [ ] **Step 2: Contract docs.** Append to `MASTER_ARCH_GUIDE.md` §4.4:

```markdown
- A player at 0 HP is dying, not defeated. `resolveEncounterEnd` decides
  `player_dead` from `Combatant.deathSaveFailures >= 3` (three failed saves or
  massive damage), never from HP. Enemies hold against a downed player —
  docs/superpowers/specs/2026-09-15-death-saves-design.md.
- Every player HP write (`setPlayerHp`, healing's mirror) resets the death
  state; `unconscious` is derived from HP 0 and never persisted.
- A dying player's only action is `Death Save`; a stable one's is `Wait`
  (409 `PLAYER_UNCONSCIOUS` otherwise). A stable player wakes with 1 HP on
  `stableWakeRound`.
- Death is permanent: `Character.diedAt`, written once by the `player_dead`
  claim winner. Every campaign write route calls `campaignPlayableRefusal`;
  every character write route calls `characterAliveRefusal`.
```

- [ ] **Step 3: Dead-campaign smoke.** Append to
  `tests/e2e/death-saves.spec.ts`:

```ts
test("@smoke a dead character's campaign refuses every write and still reads", async ({ request }) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();
  const prisma = new PrismaClient();
  let fixture: GoblinFixture | undefined;
  try {
    fixture = await createGoblinFixture(request, prisma, {
      goblinAt: { x: 5, y: 6 }, withProfile: false, currentTurnIndex: 0,
    });
    const campaignId = fixture.created.campaignId!;
    const characterId = fixture.created.characterId!;
    await prisma.character.update({ where: { id: characterId }, data: { diedAt: new Date() } });

    const writes = [
      postAction(request, campaignId, "End Turn"),
      request.post(`/api/campaign/${campaignId}/rest`, { data: { type: "short" } }),
      request.post("/api/campaign", { data: { characterId, title: "Otra vez" } }),
      request.patch(`/api/character/${characterId}`, { data: {} }),
    ];
    for (const res of await Promise.all(writes)) {
      expect(res.status()).toBe(409);
      expect(((await res.json()) as { code?: unknown }).code).toBe("CHARACTER_DEAD");
    }
    expect((await request.get(`/api/campaign/${campaignId}/logs`)).status()).toBe(200);
  } finally {
    await cleanupFixture(prisma, fixture);
  }
});
```

  If `PATCH /api/character/[id]` validates its body before the guard, move
  the guard above body validation. A dead character is refused whatever the
  body.

- [ ] **Step 4: Full validation.** Run `pnpm typecheck`,
  `pnpm exec vitest run --maxWorkers=2`, `pnpm build`, `pnpm check-retro` and
  `pnpm exec playwright test --list`.

- [ ] **Step 5: Commit, then PR 3/3.**

```bash
git add docs/SYSTEM_STATE.md MASTER_ARCH_GUIDE.md tests/e2e/death-saves.spec.ts
git commit -m "docs: correct the death-save record and the §4.4 contract"
```

  With the maintainer's go-ahead, push and open "feat(combat): permanent death
  and the death-save UI (death saves 3/3)". There is no deploy warning: the
  schema shipped in 2/3. Wait for green checks, squash-merge and sync
  `master`.

---

## Self-review record

**Spec coverage:**

| Spec section | Where |
| --- | --- |
| §1 decisions 1–5 | Tasks 2, 6, 5, 9, 4 |
| §4 state model | Tasks 1, 3, 4 (reset via mirror) |
| §5 pure rules | Task 1; planner hold Task 2 |
| §6.1 downing blow | Task 4 |
| §6.2 `resolveEncounterEnd` | Task 4 |
| §6.3 `Death Save` | Task 6 |
| §6.4 `Wait` | Task 6 (joins `End Turn`) |
| §6.5 waking | Task 5 |
| §6.6 events and narration | Tasks 4, 10 |
| §6.7 idempotency | Task 6 (ordinary receipt path; CAS touch) |
| §7.1 action barrier | Task 6 |
| §7.2 guards | Tasks 7, 9 |
| §7.3 races and invariants | Tasks 1, 4, 6; E2E race Task 8 |
| §7.4 UI | Task 11 |
| §8 migration, deploy, data | Tasks 3, 7 (`CHARACTER_AT_ZERO_HP`), 8 (PR warning) |
| §9 permanent death | Task 9 |
| §10 testing | Every task; E2E Tasks 8, 12 |
| §11 delivery | Stages 0–3 |
| §12 the record | Task 12 |

**Corrections made to the spec during planning:**
- **§4, §6.1, §6.3, §6.5:** `unconscious` is derived from HP 0, not
  persisted. Every player HP write resets the death state through the
  mirror, so no second source of truth can drift.
- **§7.1:** the refusal runs after receipt acquisition, like every refusal in
  the route. `End Turn` stays allowed to resume an enemy slot.
- **§7.4:** no character picker exists (character creation opens its first
  campaign), so the API refusal is the whole barrier.

**Type consistency:** these names are identical wherever they appear:
- `PlayerLifeState`, `DeathSaveResult["outcome"]`,
  `EnemyTurnOutcome.playerDied`;
- `applyPlayerDowned`, `rollPlayerDeathSave`;
- `campaignPlayableRefusal`, `characterAliveRefusal`, `guardResponse`;
- `DEATH_STATE_RESET`, `DEATH_SAVE_LIMIT`.
