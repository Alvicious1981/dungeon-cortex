# Area Saving-Throw Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution rule (this repository):** test-driven. Do not write production
> code for a task until its named RED test has failed for the expected missing
> behaviour. Deliberately falsify each important new guard before calling it
> covered.

**Goal:** Enemies with an SRD breath-weapon-style action (a saving throw,
area damage, half on success, limited by recharge) use it. An adult red
dragon's Fire Breath fires; a goblin is unaffected.

**Architecture:**
- **`lib/rules/monster-attack-profile.ts`** gains a second, independent
  recogniser, `recogniseAreaSaveAttack`, living beside the existing weapon
  recogniser in the same file — it needs the same private `damageEntry`
  helper and the same "verbatim, cross-checked" philosophy.
- **`lib/rules/enemy-turn.ts`** gains two planner tiers, ahead of every
  existing one, mutually exclusive with weapon attacks for that turn.
- **`lib/db/enemy-turn-transition.ts`** gains the recharge roll and the save
  resolution, reusing the existing player-HP write path and downed/died
  handling built for weapon attacks.
- **A new file, `lib/rules/saving-throw-proficiency.ts`**, is the SRD's fixed
  class → two-saves table, in the pattern of `class-skills.ts`.

**Tech Stack:** Next.js App Router, TypeScript, Prisma, PostgreSQL 16, Vitest,
Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-16-area-save-actions-design.md`,
approved 2026-09-16, corrected during planning (commit `9cba17a`): recognition
cross-checks the prose clause against the action's own structured `dc`/
`damage`/`usage` JSON fields rather than trusting either alone, which found
defects in both directions and landed the recognised count at 28, not 32.
Read the spec before any task; this plan argues from it and does not restate
its rationale.

## Global Constraints

- **Commands.** Use `pnpm`. Run unit suites with
  `pnpm exec vitest run --maxWorkers=2`, never `pnpm test`. A test that
  *times out* is machine contention: re-run that file alone. A test that
  fails an *assertion* is real.
- **Migrations.** Write them by hand and leave them unapplied on the private
  save. Apply one only to a verified disposable database with
  `E2E_TEST_MODE=true`, and **ask the maintainer before applying it even
  there** (AGENTS.md). CI applies migrations with `pnpm prisma migrate
  deploy`. After any schema edit, run `pnpm prisma generate` from inside the
  worktree (`pnpm --dir` fails on Windows).
- **Lock order** is `Character → Combatant → Encounter`. This spec adds no
  new lock: the save resolution runs inside the same `resolveEnemyTurn`
  transaction that already holds the Character lock (taken by
  `finalizeEncounterTurn` before the enemy chain starts).
- **Recognition is verbatim, never a grammar, and cross-checked where a
  structured field exists for the same fact** (spec decisions 5, 6). An
  unrecognised or disagreeing action is not parsed; that monster never uses
  it.
- **`status: "resolved"` is written only in `lib/rules/combat-pipeline.ts`.**
  Unaffected by this spec.
- **Events are published only after commit.** Every `GameLog` row inside a
  combat transaction is written through `tx`. This spec adds no new
  `GameEventType` — it reuses `COMBAT_CONSEQUENCE` and `DAMAGE_DEALT`.
- **PRs.** One PR per stage, squash-merged. Pushing and opening a PR require
  the maintainer's go-ahead. Wait for pre-merge and post-merge "Verify" and
  "E2E smoke" to go green, then sync local `master`.
- **CI runs only `@smoke`**, so every new Playwright test is tagged `@smoke`;
  it does not seed the SRD, so the E2E spec inserts its own `SrdMonster` row.
- **Deploy ordering for Stage 2: apply the migration, then deploy.** The PR
  body opens with the warning (spec §7).
- **Recommended models:** Stage 1, Sonnet 5 at `high`. Stage 2, Opus 5 at
  `high` (Task 6, the transition, at `xhigh`). Stage 3, Sonnet 5 at `medium`.

## File map

| File | Stage | Responsibility |
| --- | --- | --- |
| `lib/rules/monster-attack-profile.ts` | 1 | `recogniseAreaSaveAttack`, `ProfiledAreaSaveAttack`, `MonsterAttackProfileV1.areaSaveAttack` |
| `lib/rules/saving-throw-proficiency.ts` (new) | 1 | `CLASS_SAVING_THROW_PROFICIENCIES`, `isProficientInSave` |
| `lib/rules/enemy-turn.ts` | 1 | Tiers 0/0a, `EnemyTurnPlan.areaSaveAttack` |
| `prisma/schema.prisma`, `prisma/migrations/20260917120000_add_combatant_breath_available/` | 2 | `Combatant.breathAvailable Boolean?` |
| `app/api/campaign/[id]/encounter/route.ts` | 2 | Writes `breathAvailable: true` alongside `attackProfile` |
| `lib/db/enemy-turn-transition.ts` | 2 | The recharge roll; resolving the save and the damage |
| `tests/e2e/death-saves-and-breath.spec.ts` → renamed below | 2 | (see Task 7) |
| `MASTER_ARCH_GUIDE.md` | 3 | §4.4 contract bullets |

---

# Stage 0 — Docs PR

**Branch:** `claude/area-save-actions-spec` (it already carries the spec
commits `887a135` and `9cba17a`).

- [ ] **Step 1:** Commit this plan:

```bash
git add docs/superpowers/plans/2026-09-16-area-save-actions.md
git commit -m "docs(plan): plan area saving-throw actions in three stages"
```

- [ ] **Step 2:** With the maintainer's go-ahead, push, open the PR
  ("docs(spec): design and plan area saving-throw actions (area saves
  0/3)") against `master`, wait for green checks, squash-merge. Every later
  stage branches from the resulting `master`.

---

# Stage 1 — Pure rules

**Branch:** `claude/area-save-actions-1-rules`. **Schema impact:** none.
**Behaviour change in the game:** none. Nothing calls the new code yet.

### Task 1: Recognise the area-save attack

**Files:**
- Modify: `lib/rules/monster-attack-profile.ts`
- Test: `tests/rules/monster-attack-profile.test.ts`

**Interfaces:**
- Consumes: the file's own private `asRecord`, `damageEntry`, `DAMAGE_TYPES`
  (already imported); adds an import of `ABILITIES`, `type Ability` from
  `@/lib/rules/ability-check`.
- Produces:
  - `export interface ProfiledAreaSaveAttack { name: string; reachFt: number; saveAbility: Ability; saveDC: number; damage: ProfiledDamage[]; rechargeMin: 4 | 5 | 6 }`;
  - `MonsterAttackProfileV1.areaSaveAttack: ProfiledAreaSaveAttack | null` (a
    required key, never optional — every already-persisted row without it
    reads via `!= null`, spec §4.4);
  - `recogniseAreaSaveAttack(action: unknown): ProfiledAreaSaveAttack | null`;
  - `profileMonster` and `isMonsterAttackProfile` updated to read/validate
    the new field, and to accept a monster whose only capability is an area
    attack.

- [ ] **Step 1: Write the failing test.** Append to
  `tests/rules/monster-attack-profile.test.ts`:

```ts
// at the top, alongside the existing imports
import {
  averageDamage, isMonsterAttackProfile, profileMonster, recogniseAttack,
  recogniseAreaSaveAttack, RECOGNISED_RANGES, RECOGNISED_WALK_SPEEDS,
} from "@/lib/rules/monster-attack-profile";

// alongside UNRECOGNISED, at module scope
function areaSaveActions(): Array<{ key: string; action: unknown }> {
  return MONSTERS.flatMap((m) =>
    ((m.actions as Array<Record<string, unknown>> | undefined) ?? [])
      .filter((a) => a.attack_bonus === undefined && a.dc !== undefined)
      .map((a) => ({ key: `${m.index as string}:${a.name as string}`, action: a })),
  );
}

/**
 * Every action with no attack_bonus but a dc field, that is NOT one of the 28
 * recognised area-save attacks (spec §2). Includes the 44 condition-only
 * actions, the metallic dragons' choice-based "Breath Weapons" wrapper, and
 * the 4 measured defects — every one of them a real, checked exclusion, not
 * an oversight.
 */
const RECOGNISED_AREA_SAVE = [
  "adult-black-dragon:Acid Breath", "adult-blue-dragon:Lightning Breath",
  "adult-green-dragon:Poison Breath", "adult-red-dragon:Fire Breath",
  "adult-white-dragon:Cold Breath", "ancient-black-dragon:Acid Breath",
  "ancient-blue-dragon:Lightning Breath", "ancient-green-dragon:Poison Breath",
  "ancient-red-dragon:Fire Breath", "ankheg:Acid Spray", "behir:Lightning Breath",
  "chimera:Fire Breath", "dragon-turtle:Steam Breath",
  "green-dragon-wyrmling:Poison Breath", "half-red-dragon-veteran:Fire Breath",
  "hell-hound:Fire Breath", "ice-mephit:Frost Breath", "iron-golem:Poison Breath",
  "magma-mephit:Fire Breath", "steam-mephit:Steam Breath",
  "storm-giant:Lightning Strike", "white-dragon-wyrmling:Cold Breath",
  "winter-wolf:Cold Breath", "young-black-dragon:Acid Breath",
  "young-blue-dragon:Lightning Breath", "young-green-dragon:Poison Breath",
  "young-red-dragon:Fire Breath", "young-white-dragon:Cold Breath",
];

describe("area-save attack recognition (docs/superpowers/specs/2026-09-16-area-save-actions-design.md)", () => {
  it("recognises the adult red dragon's Fire Breath exactly", () => {
    expect(recogniseAreaSaveAttack(
      monster("adult-red-dragon").actions as unknown as Array<Record<string, unknown>>
        extends never ? never : (monster("adult-red-dragon").actions as unknown[])
          .find((a) => (a as Record<string, unknown>).name === "Fire Breath"),
    )).toEqual({
      name: "Fire Breath", reachFt: 60, saveAbility: "DEX", saveDC: 21,
      damage: [{ dice: "18d6", type: "fire" }], rechargeMin: 5,
    });
  });

  it("recognises every reach-shape template", () => {
    const action = (idx: string, name: string) =>
      (monster(idx).actions as unknown[]).find((a) => (a as Record<string, unknown>).name === name);
    expect(recogniseAreaSaveAttack(action("adult-black-dragon", "Acid Breath")))
      .toMatchObject({ reachFt: 60 }); // "…in a 60-foot line that is 5 feet wide."
    expect(recogniseAreaSaveAttack(action("ice-mephit", "Frost Breath")))
      .toMatchObject({ reachFt: 15 }); // "exhales a 15-foot cone of cold air."
    expect(recogniseAreaSaveAttack(action("ankheg", "Acid Spray")))
      .toMatchObject({ reachFt: 30 }); // "spits acid in a line that is 30 ft. long…"
    expect(recogniseAreaSaveAttack(action("behir", "Lightning Breath")))
      .toMatchObject({ reachFt: 20 }); // "exhales a line of lightning that is 20 ft. long…"
    expect(recogniseAreaSaveAttack(action("storm-giant", "Lightning Strike")))
      .toMatchObject({ reachFt: 500 }); // "…within 500 feet of it."
    expect(recogniseAreaSaveAttack(action("young-blue-dragon", "Lightning Breath")))
      .toMatchObject({ reachFt: 60 }); // the "an 60-foot line" article typo
  });

  it("leaves exactly the pinned actions unrecognised", () => {
    const recognised = areaSaveActions()
      .filter(({ action }) => recogniseAreaSaveAttack(action) !== null)
      .map(({ key }) => key)
      .sort();
    expect(recognised).toEqual([...RECOGNISED_AREA_SAVE].sort());
  });

  it("rejects a prose/structured mismatch even when the clause parses", () => {
    // black-dragon-wyrmling's Acid Breath: prose damage reads "Sd8" for "5d8".
    const action = (monster("black-dragon-wyrmling").actions as unknown[])
      .find((a) => (a as Record<string, unknown>).name === "Acid Breath");
    expect(recogniseAreaSaveAttack(action)).toBeNull();
  });

  it("never claims a weapon attack's own rider", () => {
    // The aboleth's Tentacle carries a `dc` (the disease rider) but also an
    // attack_bonus: it belongs to recogniseAttack, never to this recogniser.
    const action = (monster("aboleth").actions as unknown[])
      .find((a) => (a as Record<string, unknown>).name === "Tentacle");
    expect(recogniseAreaSaveAttack(action)).toBeNull();
    expect(recogniseAttack(action)).not.toBeNull();
  });

  it("profiles a dragon with both weapon attacks and an area-save attack", () => {
    const profile = profileMonster(monster("adult-red-dragon"));
    expect(profile?.areaSaveAttack).toEqual({
      name: "Fire Breath", reachFt: 60, saveAbility: "DEX", saveDC: 21,
      damage: [{ dice: "18d6", type: "fire" }], rechargeMin: 5,
    });
    expect(profile?.attacks.length).toBeGreaterThan(0); // Bite/Claw, unaffected
  });

  it("carries an area-save-only monster that has no weapon attack", () => {
    // No monster in the current 334 needs this, but a profile must not
    // silently disappear if a future SRD monster has only an area attack.
    const breathOnly = {
      name: "Solitary Wyrm",
      speed: { walk: "30 ft." },
      actions: [
        {
          name: "Fire Breath",
          desc: "The wyrm exhales fire in a 30-foot cone. Each creature in that area must make a DC 15 Dexterity saving throw, taking 24 (7d6) fire damage on a failed save, or half as much damage on a successful one.",
          usage: { type: "recharge on roll", dice: "1d6", min_value: 5 },
          dc: { dc_type: { index: "dex" }, dc_value: 15, success_type: "half" },
          damage: [{ damage_type: { index: "fire" }, damage_dice: "7d6" }],
        },
      ],
    };
    const profile = profileMonster(breathOnly);
    expect(profile).not.toBeNull();
    expect(profile?.attacks).toEqual([]);
    expect(profile?.areaSaveAttack?.name).toBe("Fire Breath");
    expect(isMonsterAttackProfile(profile)).toBe(true);
  });

  it("keeps recognising every already-persisted profile with no areaSaveAttack key at all", () => {
    // Backward compatibility: a profile written before this field existed.
    expect(
      isMonsterAttackProfile({
        version: 1, walkSpeedFt: 30,
        attacks: [{ name: "Bite", attackBonus: 4, melee: { reachFt: 5 }, ranged: null, damage: [{ dice: "1d6", type: "piercing" }] }],
        multiattack: null,
      }),
    ).toBe(true);
  });
});
```

  The first test's fixture-lookup expression is deliberately awkward
  (`extends never ? never : …`) only to keep this plan's code block
  self-contained without redeclaring a helper twice; write it as a small
  local helper instead:

```ts
function action(idx: string, name: string): unknown {
  return (monster(idx).actions as Array<Record<string, unknown>>).find((a) => a.name === name);
}
```

  and use `action("adult-red-dragon", "Fire Breath")` in every test above
  (replace every `(monster(idx).actions as unknown[]).find(...)` call with
  this helper, including in the awkward first test).

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm exec vitest run tests/rules/monster-attack-profile.test.ts`
Expected: FAIL — `recogniseAreaSaveAttack` is not exported.

- [ ] **Step 3: Implement.** In `lib/rules/monster-attack-profile.ts`:

```ts
// Add to the existing import line
import { ABILITIES, type Ability } from "@/lib/rules/ability-check";
```

```ts
// After ProfiledAttack / before MultiattackPart
export interface ProfiledAreaSaveAttack {
  name: string;
  /** Reduced from the SRD's cone/line/point shape to a maximum distance — the
   * grid has one possible target, so no real geometry is modelled (spec §1). */
  reachFt: number;
  saveAbility: Ability;
  saveDC: number;
  damage: ProfiledDamage[];
  /** 1d6; this roll or higher recharges the action (spec §2). */
  rechargeMin: 4 | 5 | 6;
}
```

```ts
// MonsterAttackProfileV1 gains one field, after multiattack:
  multiattack: MultiattackPart[] | null;
  /** NULL for every monster without a recognised area-save action, and for
   * any profile persisted before this field existed (spec §4.4). */
  areaSaveAttack: ProfiledAreaSaveAttack | null;
}
```

```ts
// Below RECOGNISED_ATTACK_HEADERS' HEADERS constant, new tables:
const ABILITY_INDEX: Record<string, Ability> = {
  str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA",
};
const ABILITY_WORD_TO_INDEX: Record<string, string> = {
  strength: "str", dexterity: "dex", constitution: "con",
  intelligence: "int", wisdom: "wis", charisma: "cha",
};

/**
 * Verbatim, up to numeric and named slots (spec §4.2). Matching alone is not
 * enough: every slot is cross-checked against the action's own structured
 * dc/damage fields (decision 6) before any of it is trusted.
 */
const AREA_SAVE_CLAUSE =
  /must (?:make|succeed on) a DC (?<dc>\d+) (?<ability>Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw, taking \d+ \((?<dice>[^)]+)\) (?<type>[a-z]+) damage on a failed save, or half as much damage on a successful one\./;

/**
 * The shape/size sentence has no structured counterpart, so it is the one
 * fact read from prose alone (spec §4.3). `a`/`an` is accepted either way —
 * the source data has at least one "an 60-foot line" typo.
 */
const AREA_SAVE_REACH: readonly RegExp[] = [
  /in an? (\d+)-foot cone\./,
  /in an? (\d+)-foot line that is \d+ (?:feet|ft\.) wide\./,
  /a (\d+)-foot cone of [a-z ]+\./,
  /spits [a-z ]+ in a line that is (\d+) ft\. long and \d+ ft\. wide/,
  /exhales a line of [a-z]+ that is (\d+) ft\. long and \d+ ft\. wide/,
  /within (\d+) feet of it\./,
];

function recogniseAreaSaveReach(desc: string): number | null {
  for (const pattern of AREA_SAVE_REACH) {
    const match = pattern.exec(desc);
    if (match) return Number(match[1]);
  }
  return null;
}
```

```ts
// After recogniseAttack:
/**
 * One SRD action as a resolvable area-save attack, or null when it is not
 * recognised (spec §4). An action with an `attack_bonus` belongs to
 * recogniseAttack, never to this one, even if it also carries a `dc` (the
 * aboleth's Tentacle rider).
 */
export function recogniseAreaSaveAttack(action: unknown): ProfiledAreaSaveAttack | null {
  const a = asRecord(action);
  if (!a || "attack_bonus" in a || typeof a.name !== "string" || typeof a.desc !== "string") {
    return null;
  }

  const dc = asRecord(a.dc);
  const ability = asRecord(dc?.dc_type)?.index;
  const dcValue = dc?.dc_value;
  if (typeof ability !== "string" || !(ability in ABILITY_INDEX) || typeof dcValue !== "number") {
    return null;
  }

  if (!Array.isArray(a.damage) || a.damage.length === 0) return null;
  const damage = a.damage.map(damageEntry);
  if (damage.some((entry) => entry === null)) return null;

  const usage = asRecord(a.usage);
  if (usage?.type !== "recharge on roll" || usage.dice !== "1d6") return null;
  const rechargeMin = usage.min_value;
  if (rechargeMin !== 4 && rechargeMin !== 5 && rechargeMin !== 6) return null;

  const clause = AREA_SAVE_CLAUSE.exec(a.desc)?.groups;
  if (!clause) return null;
  if (Number(clause.dc) !== dcValue) return null;
  if (ABILITY_WORD_TO_INDEX[clause.ability!.toLowerCase()] !== ability) return null;
  const first = (damage as ProfiledDamage[])[0]!;
  if (clause.dice !== first.dice || clause.type !== first.type) return null;

  const reachFt = recogniseAreaSaveReach(a.desc);
  if (reachFt === null) return null;

  return {
    name: a.name,
    reachFt,
    saveAbility: ABILITY_INDEX[ability]!,
    saveDC: dcValue,
    damage: damage as ProfiledDamage[],
    rechargeMin,
  };
}
```

```ts
// profileMonster: compute areaSaveAttack, widen the null-guard, add the field.
export function profileMonster(monster: unknown): MonsterAttackProfileV1 | null {
  const m = asRecord(monster);
  const actions = Array.isArray(m?.actions) ? (m!.actions as unknown[]) : [];
  const attacks = actions
    .map(recogniseAttack)
    .filter((attack): attack is ProfiledAttack => attack !== null);
  const areaSaveAttack =
    actions.map(recogniseAreaSaveAttack).find((a): a is ProfiledAreaSaveAttack => a !== null) ?? null;
  if (attacks.length === 0 && areaSaveAttack === null) return null;

  const walk = asRecord(m!.speed)?.walk;
  const walkSpeedFt = typeof walk === "string" ? (RECOGNISED_WALK_SPEEDS.get(walk) ?? 0) : 0;

  return {
    version: 1,
    walkSpeedFt,
    attacks,
    multiattack: resolveMultiattack(actions, attacks),
    areaSaveAttack,
  };
}
```

```ts
// New type guard, placed after isProfiledAttack:
function isProfiledAreaSaveAttack(value: unknown): value is ProfiledAreaSaveAttack {
  const a = asRecord(value);
  if (!a || typeof a.name !== "string" || typeof a.reachFt !== "number") return false;
  if (typeof a.saveDC !== "number") return false;
  if (!(ABILITIES as readonly string[]).includes(a.saveAbility as string)) return false;
  if (a.rechargeMin !== 4 && a.rechargeMin !== 5 && a.rechargeMin !== 6) return false;
  return (
    Array.isArray(a.damage) &&
    a.damage.length > 0 &&
    a.damage.every((d) => {
      const entry = asRecord(d);
      return (
        typeof entry?.dice === "string" &&
        (DAMAGE_TYPES as readonly string[]).includes(entry.type as string)
      );
    })
  );
}
```

```ts
// isMonsterAttackProfile: accept an area-save-only profile; validate the new field.
export function isMonsterAttackProfile(value: unknown): value is MonsterAttackProfileV1 {
  const v = asRecord(value);
  if (!v || v.version !== 1 || typeof v.walkSpeedFt !== "number") return false;
  if (!Array.isArray(v.attacks) || !v.attacks.every(isProfiledAttack)) return false;

  // `!= null` on purpose: a profile persisted before this field existed omits
  // the key entirely (undefined), which must read exactly like an explicit
  // null — "no area attack" (spec §4.4).
  const hasAreaSaveAttack = v.areaSaveAttack != null;
  if (hasAreaSaveAttack && !isProfiledAreaSaveAttack(v.areaSaveAttack)) return false;
  if (v.attacks.length === 0 && !hasAreaSaveAttack) return false;

  if (v.multiattack === null) return true;
  return (
    Array.isArray(v.multiattack) &&
    v.multiattack.every((p) => {
      const part = asRecord(p);
      return typeof part?.attack === "string" && Number.isInteger(part.count);
    })
  );
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `pnpm exec vitest run tests/rules/monster-attack-profile.test.ts`
Expected: PASS, all tests including the pre-existing ones (the "profiles the
goblin exactly" test's `toEqual` must now include `areaSaveAttack: null`; **fix
that test's three `toEqual`/full-profile-equality assertions** — "profiles
the goblin exactly", and any other exact `toEqual` of a full profile object —
by adding `areaSaveAttack: null` to the expected object).

- [ ] **Step 5: Falsify.** Apply each mutation, confirm at least one test
  fails, revert:
  - drop the `Number(clause.dc) !== dcValue` cross-check — the
    "prose/structured mismatch" test fails to reject `black-dragon-wyrmling`... 
    actually that one is caught by the *dice* check; instead falsify
    `if (clause.dice !== first.dice || clause.type !== first.type) return null;`
    → drop the whole line — the mismatch test fails;
  - drop the `"attack_bonus" in a` guard — the "never claims a weapon
    attack's own rider" test fails;
  - drop the reach-template loop (`return null;` unconditionally from
    `recogniseAreaSaveReach`) — the "recognises every reach-shape template"
    test fails;
  - change `attacks.length === 0 && areaSaveAttack === null` to
    `attacks.length === 0` alone — the "area-save-only monster" test fails;
  - change `v.areaSaveAttack != null` to `v.areaSaveAttack !== undefined` —
    the "already-persisted profile" backward-compatibility test fails (a
    profile with the key entirely absent has `v.areaSaveAttack === undefined`,
    which `!== undefined` treats as "has one," then fails
    `isProfiledAreaSaveAttack(undefined)`).

- [ ] **Step 6: Validate and commit**

Run `pnpm typecheck` and `pnpm exec vitest run --maxWorkers=2` — a full run
catches any other exact-`toEqual` fixture across the suite that now needs
`areaSaveAttack: null` added (search: `grep -rn "multiattack: null" tests/`
finds every such literal).

```bash
git add lib/rules/monster-attack-profile.ts tests/rules/monster-attack-profile.test.ts
git commit -m "feat(rules): recognise area saving-throw attacks, cross-checked against structured fields"
```

### Task 2: Saving-throw proficiency by class

**Files:**
- Create: `lib/rules/saving-throw-proficiency.ts`
- Test: `tests/rules/saving-throw-proficiency.test.ts`

**Interfaces:**
- Consumes: `type Ability` from `@/lib/rules/ability-check`; `type
  CharacterClass` from `@/lib/rules/proficiency`.
- Produces:
  - `export const CLASS_SAVING_THROW_PROFICIENCIES: Record<CharacterClass, readonly [Ability, Ability]>`;
  - `export function isProficientInSave(characterClass: string, ability: Ability): boolean` —
    case/whitespace-insensitive on `characterClass`, `false` for an unknown
    class (fail closed, the same rule `defaultSkillProficiencies` follows).

- [ ] **Step 1: Write the failing test**

```ts
// tests/rules/saving-throw-proficiency.test.ts
import { describe, expect, it } from "vitest";
import { ABILITIES } from "@/lib/rules/ability-check";
import type { CharacterClass } from "@/lib/rules/proficiency";
import {
  CLASS_SAVING_THROW_PROFICIENCIES,
  isProficientInSave,
} from "@/lib/rules/saving-throw-proficiency";

const CLASSES: CharacterClass[] = [
  "barbarian", "bard", "cleric", "druid", "fighter", "monk",
  "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard",
];

describe("CLASS_SAVING_THROW_PROFICIENCIES (SRD 2014, fixed per class)", () => {
  it("covers every class with exactly two distinct, real abilities", () => {
    for (const cls of CLASSES) {
      const saves = CLASS_SAVING_THROW_PROFICIENCIES[cls];
      expect(saves).toHaveLength(2);
      expect(new Set(saves).size).toBe(2);
      for (const ability of saves) expect(ABILITIES).toContain(ability);
    }
  });

  it.each([
    ["fighter", "STR", true], ["fighter", "CON", true], ["fighter", "WIS", false],
    ["wizard", "INT", true], ["wizard", "WIS", true], ["wizard", "STR", false],
    ["rogue", "DEX", true], ["rogue", "INT", true], ["rogue", "CHA", false],
  ] as const)("%s is proficient in %s: %s", (cls, ability, expected) => {
    expect(isProficientInSave(cls, ability)).toBe(expected);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(isProficientInSave("  Fighter ", "STR")).toBe(true);
  });

  it("never grants an unearned bonus for an unknown class", () => {
    expect(isProficientInSave("necromancer", "INT")).toBe(false);
    expect(isProficientInSave("", "STR")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm exec vitest run tests/rules/saving-throw-proficiency.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

```ts
// lib/rules/saving-throw-proficiency.ts
/**
 * Saving-throw proficiency by class, D&D 5e SRD 2014
 * (docs/superpowers/specs/2026-09-16-area-save-actions-design.md §4.5).
 *
 * Unlike `class-skills.ts`, this is not an approximation of a player choice:
 * the SRD fixes exactly two saves per class, always the same two.
 *
 * @pure — a static table and a lookup, no I/O.
 */
import type { Ability } from "@/lib/rules/ability-check";
import type { CharacterClass } from "@/lib/rules/proficiency";

export const CLASS_SAVING_THROW_PROFICIENCIES: Record<CharacterClass, readonly [Ability, Ability]> = {
  barbarian: ["STR", "CON"],
  bard: ["DEX", "CHA"],
  cleric: ["WIS", "CHA"],
  druid: ["INT", "WIS"],
  fighter: ["STR", "CON"],
  monk: ["STR", "DEX"],
  paladin: ["WIS", "CHA"],
  ranger: ["STR", "DEX"],
  rogue: ["DEX", "INT"],
  sorcerer: ["CON", "CHA"],
  warlock: ["WIS", "CHA"],
  wizard: ["INT", "WIS"],
};

/**
 * Whether a class is proficient in a given saving throw.
 *
 * Matching is case- and whitespace-insensitive, mirroring
 * `defaultSkillProficiencies`. An unrecognised class is never proficient —
 * an unearned bonus would silently inflate every save that class makes.
 */
export function isProficientInSave(characterClass: string, ability: Ability): boolean {
  const key = characterClass.trim().toLowerCase() as CharacterClass;
  const saves = CLASS_SAVING_THROW_PROFICIENCIES[key];
  return saves !== undefined && saves.includes(ability);
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `pnpm exec vitest run tests/rules/saving-throw-proficiency.test.ts`
Expected: PASS, 7 tests (2 + 3 table-driven + 1 + 1).

- [ ] **Step 5: Falsify.** Remove `.trim().toLowerCase()`: the case/whitespace
  test fails. Change `saves !== undefined && saves.includes(ability)` to
  `saves?.includes(ability) ?? true`: the unknown-class test fails. Revert
  both.

- [ ] **Step 6: Commit**

```bash
git add lib/rules/saving-throw-proficiency.ts tests/rules/saving-throw-proficiency.test.ts
git commit -m "feat(rules): saving-throw proficiency by class"
```

### Task 3: Two new planner tiers

**Files:**
- Modify: `lib/rules/enemy-turn.ts`
- Test: `tests/rules/enemy-turn.test.ts`

**Interfaces:**
- Consumes (Task 1): `ProfiledAreaSaveAttack`, `MonsterAttackProfileV1.areaSaveAttack`.
- Produces:
  - `EnemyTurnPlan.areaSaveAttack: string | null` (new field, alongside `attacks`);
  - `EnemyTurnInput.enemy` gains no new field — availability is passed via a
    new top-level input field: `EnemyTurnInput.breathAvailable?: boolean`.

- [ ] **Step 1: Write the failing test.** Append to `tests/rules/enemy-turn.test.ts`,
  after the existing profile fixtures near the top:

```ts
const BREATHING_DRAKE: MonsterAttackProfileV1 = {
  version: 1, walkSpeedFt: 30, multiattack: null,
  attacks: [{
    name: "Bite", attackBonus: 5, melee: { reachFt: 5 }, ranged: null,
    damage: [{ dice: "2d6+3", type: "piercing" }],
  }],
  areaSaveAttack: {
    name: "Fire Breath", reachFt: 30, saveAbility: "DEX", saveDC: 15,
    damage: [{ dice: "7d6", type: "fire" }], rechargeMin: 5,
  },
};
```

  and, inside `describe("planEnemyTurn", ...)`:

```ts
describe("area-save attack tiers (death-saves spec 3, §6.2)", () => {
  it("breathes from here over melee, when charged and in range", () => {
    const plan = planEnemyTurn({
      ...input(BREATHING_DRAKE, { x: 5, y: 5 }, medium("p1", 8, 5)),
      breathAvailable: true,
    });
    expect(plan).toEqual({ move: null, mode: "area-save", attacks: [], areaSaveAttack: "Fire Breath" });
  });

  it("moves, then breathes, when only reachable after moving", () => {
    const plan = planEnemyTurn({
      ...input(BREATHING_DRAKE, { x: 0, y: 0 }, medium("p1", 8, 0)),
      breathAvailable: true,
    });
    expect(plan.mode).toBe("area-save");
    expect(plan.areaSaveAttack).toBe("Fire Breath");
    expect(plan.move).not.toBeNull();
  });

  it("falls back to melee when the breath is spent", () => {
    const plan = planEnemyTurn({
      ...input(BREATHING_DRAKE, { x: 5, y: 5 }, medium("p1", 6, 5)),
      breathAvailable: false,
    });
    expect(plan).toEqual({ move: null, mode: "melee", attacks: ["Bite"], areaSaveAttack: null });
  });

  it("falls back to melee when the monster has no area-save attack", () => {
    const plan = planEnemyTurn({
      ...input(BITER, { x: 5, y: 5 }, medium("p1", 6, 5)),
      breathAvailable: true,
    });
    expect(plan.areaSaveAttack).toBeNull();
  });

  it("holds against a downed player even when charged and in range", () => {
    const plan = planEnemyTurn({
      ...input(BREATHING_DRAKE, { x: 5, y: 5 }, medium("p1", 8, 5)),
      breathAvailable: true,
      playerDowned: true,
    });
    expect(plan).toEqual({ move: null, mode: null, attacks: [], areaSaveAttack: null });
  });

  it("does not breathe out of range with no path to close it", () => {
    // 30 ft reach, 30 ft walk speed, starting 13 squares (65 ft) away: even
    // moving its full speed cannot put the player within reach.
    const plan = planEnemyTurn({
      ...input(BREATHING_DRAKE, { x: 0, y: 0 }, medium("p1", 13, 0)),
      breathAvailable: true,
    });
    expect(plan.areaSaveAttack).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm exec vitest run tests/rules/enemy-turn.test.ts`
Expected: FAIL — `breathAvailable` and `areaSaveAttack` do not exist on the
relevant types, and every existing `toEqual` of a full plan object (e.g.
`{ move: null, mode: "melee", attacks: [...] }`) now needs `areaSaveAttack:
null` added — this is Step 6 below, not yet.

- [ ] **Step 3: Implement.** In `lib/rules/enemy-turn.ts`:

```ts
// EnemyTurnInput gains one field, after playerDowned:
  playerDowned?: boolean;
  /** The enemy's areaSaveAttack, if it has one, is off recharge and ready
   * (docs/superpowers/specs/2026-09-16-area-save-actions-design.md §5, §6.2). */
  breathAvailable?: boolean;
}
```

```ts
// EnemyTurnPlan gains one field, after attacks:
  attacks: string[];
  /** The area-save attack's name when the plan uses it; attacks is then
   * empty — the two are mutually exclusive within a turn. */
  areaSaveAttack: string | null;
}
```

```ts
// noAction() gains the new field:
function noAction(): EnemyTurnPlan {
  return { move: null, mode: null, attacks: [], areaSaveAttack: null };
}
```

```ts
// New helper, near `usable`:
function withinAreaSaveReach(
  attack: { reachFt: number },
  from: GridCombatant,
  player: GridCombatant,
): boolean {
  return minFootprintDistanceFt(from, player) <= attack.reachFt;
}
```

```ts
// planEnemyTurn: insert the two new tiers before "1. Melee from here.", and
// compute `destination`/`moved`/`atDestination` before tier 0a needs them
// (tiers 2 and 4 already compute and reuse the same values further down —
// move that one block up, unchanged, and delete it from its old position).
export function planEnemyTurn(input: EnemyTurnInput): EnemyTurnPlan {
  if (input.playerDowned) return noAction();
  const { enemy, player } = input;
  const profile = enemy.profile;
  if (enemy.hp <= 0 || profile === null || isIncapacitated(enemy.conditions)) return noAction();

  const destination = bestDestination(input);
  const moved = destination.x !== enemy.x || destination.y !== enemy.y;
  const atDestination = { ...enemy, x: destination.x, y: destination.y };

  // 0. Breathe from here, if charged and in range (spec §6.2, decision 3:
  // preferred over multiattack whenever it applies).
  const areaSave = profile.areaSaveAttack;
  if (areaSave && input.breathAvailable && withinAreaSaveReach(areaSave, enemy, player)) {
    return { move: null, mode: "area-save", attacks: [], areaSaveAttack: areaSave.name };
  }

  // 0a. Move, then breathe, if reach only covers the player after moving.
  if (areaSave && input.breathAvailable && moved && withinAreaSaveReach(areaSave, atDestination, player)) {
    return { move: destination, mode: "area-save", attacks: [], areaSaveAttack: areaSave.name };
  }

  // 1. Melee from here.
  const meleeHere = chooseAttacks(profile, enemy, player, "melee");
  if (meleeHere.length > 0) return { move: null, mode: "melee", attacks: meleeHere, areaSaveAttack: null };

  // 2. Close and strike.
  const meleeThere = chooseAttacks(profile, atDestination, player, "melee");
  if (moved && meleeThere.length > 0) {
    return { move: destination, mode: "melee", attacks: meleeThere, areaSaveAttack: null };
  }

  // 3. Shoot from here.
  const rangedHere = chooseAttacks(profile, enemy, player, "ranged");
  if (rangedHere.length > 0) return { move: null, mode: "ranged", attacks: rangedHere, areaSaveAttack: null };

  // 4. Advance, and shoot if that brings the player into range.
  if (moved) {
    const rangedThere = chooseAttacks(profile, atDestination, player, "ranged");
    return rangedThere.length > 0
      ? { move: destination, mode: "ranged", attacks: rangedThere, areaSaveAttack: null }
      : { move: destination, mode: null, attacks: [], areaSaveAttack: null };
  }

  // 5. Nothing: a ranged-only enemy adjacent to the player (known limitation).
  return noAction();
}
```

  Every other existing `return { move: ..., mode: ..., attacks: ... }` in
  the function (there are none left outside what is shown above — the
  rewrite above is the complete function body) must include
  `areaSaveAttack: null`, as shown.

- [ ] **Step 4: Fix the existing exact-equality tests.** Every pre-existing
  `expect(plan).toEqual({ move: ..., mode: ..., attacks: [...] })` in
  `tests/rules/enemy-turn.test.ts` (there are several, covering melee/ranged/
  advance/nothing) now needs `areaSaveAttack: null` added to the expected
  object.

- [ ] **Step 5: Run it and see it pass**

Run: `pnpm exec vitest run tests/rules/enemy-turn.test.ts`
Expected: PASS.

- [ ] **Step 6: Falsify.**
  - Swap the tier order (move tier 0/0a below tier 1): the "breathes from
    here over melee" test fails.
  - Drop `input.breathAvailable` from the tier-0 condition (always attempt
    breath when in range regardless of availability): the "falls back to
    melee when the breath is spent" test fails.
  - Drop `if (input.playerDowned) return noAction();`'s early return (or,
    since that line is unchanged from before this task, instead falsify by
    removing `attacks: [], areaSaveAttack: null` from `noAction()`'s
    return and see the "holds against a downed player" test fail on the
    `areaSaveAttack` field specifically).

  Revert each mutation after confirming the failure.

- [ ] **Step 7: Full suite, typecheck, commit**

```bash
pnpm typecheck
pnpm exec vitest run --maxWorkers=2
```

A failure elsewhere in the suite asserting an exact `EnemyTurnPlan` shape
(check `tests/rules/enemy-turn-downed-player.test.ts`) needs the same
`areaSaveAttack: null` addition.

```bash
git add lib/rules/enemy-turn.ts tests/rules/enemy-turn.test.ts tests/rules/enemy-turn-downed-player.test.ts
git commit -m "feat(rules): plan breathing before melee, ahead of every other tier"
```

- [ ] **Step 8: PR 1/3.** With the maintainer's go-ahead, push and open
  "feat(rules): area saving-throw recognition, proficiency, and the breath
  planner tiers (area saves 1/3)". No deploy warning — the schema is
  unchanged. Merge after green checks.

---

# Stage 2 — Migration and turn flow

**Branch:** `claude/area-save-actions-2-flow`. **Schema impact:** one
nullable column. **Behaviour change:** enemies with a recognised area-save
attack use it; the recharge roll appears in the log.

### Task 4: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma` (`Combatant`, after `stableWakeRound`)
- Create: `prisma/migrations/20260917120000_add_combatant_breath_available/migration.sql`
- Test: `tests/architecture/area-save-schema.test.ts`

**Interfaces:**
- Produces: `Combatant.breathAvailable: boolean | null` in the Prisma client.

- [ ] **Step 1: Write the failing test**

```ts
// tests/architecture/area-save-schema.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const SCHEMA = read("prisma", "schema.prisma");
const MIGRATION = read(
  "prisma", "migrations", "20260917120000_add_combatant_breath_available", "migration.sql",
);

describe("breathAvailable schema (area-save-actions spec §5, §7)", () => {
  it("declares the column nullable with no default", () => {
    expect(SCHEMA).toMatch(/\n\s+breathAvailable\s+Boolean\?\s*\r?\n/);
  });

  it("adds the column idempotently, with no default and no backfill", () => {
    expect(MIGRATION).toContain('ADD COLUMN IF NOT EXISTS "breathAvailable" BOOLEAN');
    expect(MIGRATION).not.toMatch(/\bDEFAULT\b/);
    expect(MIGRATION).not.toMatch(/\bUPDATE\b/);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm exec vitest run tests/architecture/area-save-schema.test.ts`
Expected: FAIL — ENOENT on the migration file.

- [ ] **Step 3: Schema.** In `Combatant`, after `stableWakeRound`:

```prisma
  /// Whether the monster's areaSaveAttack (if it has one) is off recharge and
  /// ready (docs/superpowers/specs/2026-09-16-area-save-actions-design.md §5).
  /// NULL = the monster has no such action. Written true at encounter
  /// creation when the profile carries one; false after use; true again on a
  /// successful recharge roll.
  breathAvailable      Boolean?
```

- [ ] **Step 4: Migration**

```sql
-- prisma/migrations/20260917120000_add_combatant_breath_available/migration.sql
-- Disponibilidad del ataque de salvación en área del enemigo (el aliento)
-- (docs/superpowers/specs/2026-09-16-area-save-actions-design.md §5, §7).
--
-- ADITIVA. Añade "Combatant"."breathAvailable", NULLABLE y SIN valor por
-- omisión: NULL significa "este monstruo no tiene esa acción". Un valor por
-- omisión inventaría disponibilidad para combatientes que nunca la tuvieron.
--
-- Sin UPDATE ni relleno: ningún combatiente existente necesita este campo, y
-- esta migración no decide el estado de ningún encuentro en curso.
--
-- ORDEN DE DESPLIEGUE: aplicar ANTES de desplegar el código. Prisma
-- selecciona todas las columnas escalares; el código nuevo sin este campo
-- rompe toda consulta sobre "Combatant". El código anterior lo ignora.
--
-- ─── Por qué un bloque DO ────────────────────────────────────────────────────
-- Misma razón que las migraciones anteriores: una sola sentencia atómica que
-- revierte con su DDL si algo falla.
DO $add_combatant_breath_available$
BEGIN
  EXECUTE 'ALTER TABLE "Combatant" ADD COLUMN IF NOT EXISTS "breathAvailable" BOOLEAN';
END
$add_combatant_breath_available$;
```

- [ ] **Step 5: Generate and verify**

Run, from inside the worktree:
- `pnpm prisma generate`
- `pnpm prisma validate`
- `pnpm typecheck`
- `pnpm exec vitest run tests/architecture/area-save-schema.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260917120000_add_combatant_breath_available tests/architecture/area-save-schema.test.ts
git commit -m "feat(schema): Combatant.breathAvailable"
```

### Task 5: Write `breathAvailable` at encounter creation

**Files:**
- Modify: `app/api/campaign/[id]/encounter/route.ts`
- Test: `tests/api/encounter-route-attack-profile.test.ts`

**Interfaces:**
- Consumes (Task 1): `MonsterAttackProfileV1.areaSaveAttack`.

- [ ] **Step 1: Write the failing test.** Append to
  `tests/api/encounter-route-attack-profile.test.ts`, reusing its existing
  `GOBLIN` fixture and adding a dragon one:

```ts
const ADULT_RED_DRAGON = (
  JSON.parse(readFileSync(join(process.cwd(), "data", "srd-es", "monsters.json"), "utf8")) as Array<
    Record<string, unknown>
  >
).find((m) => m.index === "adult-red-dragon")!;

describe("POST /api/campaign/[id]/encounter — Combatant.breathAvailable", () => {
  it("starts true for an enemy with a recognised area-save attack", async () => {
    const { createMany } = mockTransaction();
    (prisma.srdMonster.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "srd-dragon", xp: 18000, data: ADULT_RED_DRAGON,
    });

    const res = await post({
      enemies: [{ name: "Adult Red Dragon", hp: 256, maxHp: 256, dexModifier: 1, monsterIndex: "srd-dragon" }],
    });

    expect(res.status).toBe(201);
    const enemy = persisted(createMany).find((c) => !c.isPlayer)!;
    expect(enemy.breathAvailable).toBe(true);
  });

  it("leaves the column unset for an enemy with no area-save attack", async () => {
    const { createMany } = mockTransaction();
    (prisma.srdMonster.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "srd-goblin", xp: 50, data: GOBLIN,
    });

    const res = await post({
      enemies: [{ name: "Goblin", hp: 7, maxHp: 7, dexModifier: 2, monsterIndex: "srd-goblin" }],
    });

    expect(res.status).toBe(201);
    const enemy = persisted(createMany).find((c) => !c.isPlayer)!;
    expect(enemy).not.toHaveProperty("breathAvailable");
  });

  it("never gives the player breathAvailable", async () => {
    const { createMany } = mockTransaction();
    (prisma.srdMonster.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "srd-dragon", xp: 18000, data: ADULT_RED_DRAGON,
    });

    const res = await post({
      enemies: [{ name: "Adult Red Dragon", hp: 256, maxHp: 256, dexModifier: 1, monsterIndex: "srd-dragon" }],
    });

    expect(res.status).toBe(201);
    const player = persisted(createMany).find((c) => c.isPlayer)!;
    expect(player).not.toHaveProperty("breathAvailable");
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm exec vitest run tests/api/encounter-route-attack-profile.test.ts`
Expected: FAIL — `breathAvailable` is never set.

- [ ] **Step 3: Implement.** Find the line
  `...(enemy.srdAttackProfile ? { attackProfile: enemy.srdAttackProfile as unknown as Prisma.InputJsonValue } : {}),`
  in `app/api/campaign/[id]/encounter/route.ts` and add, immediately after it:

```ts
          ...(enemy.srdAttackProfile?.areaSaveAttack
            ? { breathAvailable: true }
            : {}),
```

- [ ] **Step 4: Run it and see it pass**

Run: `pnpm exec vitest run tests/api/encounter-route-attack-profile.test.ts`
Expected: PASS.

- [ ] **Step 5: Falsify.** Change the guard to
  `enemy.srdAttackProfile ? { breathAvailable: true } : {}` (drop the
  `?.areaSaveAttack` check): the "leaves the column unset" test fails
  (the goblin would get `breathAvailable: true` too). Revert.

- [ ] **Step 6: Commit**

```bash
git add "app/api/campaign/[id]/encounter/route.ts" tests/api/encounter-route-attack-profile.test.ts
git commit -m "feat(encounter): start an enemy's breath weapon available"
```

### Task 6: The recharge roll and the save resolution

**Files:**
- Modify: `lib/db/enemy-turn-transition.ts`
- Test: `tests/db/enemy-turn-transition.test.ts`

**Interfaces:**
- Consumes: (Task 1) `ProfiledAreaSaveAttack`; (Task 2) `isProficientInSave`;
  (Task 3) `EnemyTurnPlan.areaSaveAttack`, `EnemyTurnInput.breathAvailable`;
  existing `resolveSavingThrow`, `rollDamage`, `rollDie`, `abilityModifier`,
  `proficiencyBonus`.
- Produces: no new exports — this task only changes `resolveEnemyTurn`'s
  internal behaviour. `EnemyTurnOutcome`'s shape is unchanged.

- [ ] **Step 1: Write the failing tests.** Append to
  `tests/db/enemy-turn-transition.test.ts`:

```ts
const DRAGON_PROFILE = {
  version: 1, walkSpeedFt: 40, multiattack: null,
  attacks: [{
    name: "Bite", attackBonus: 10, melee: { reachFt: 10 }, ranged: null,
    damage: [{ dice: "2d10+6", type: "piercing" }],
  }],
  areaSaveAttack: {
    name: "Fire Breath", reachFt: 60, saveAbility: "DEX", saveDC: 21,
    damage: [{ dice: "18d6", type: "fire" }], rechargeMin: 5,
  },
};

function dragonRows(overrides: Partial<Record<string, unknown>> = {}) {
  return [
    {
      id: "p1", name: "Aldric", isPlayer: true, hp: 200, maxHp: 200, x: 5, y: 5,
      size: "Medium", conditions: [], initiativeOrder: 0, attackProfile: null,
    },
    {
      id: "d1", name: "Adult Red Dragon", isPlayer: false, hp: 256, maxHp: 256,
      x: 5, y: 5, size: "Huge", conditions: [], initiativeOrder: 1,
      attackProfile: DRAGON_PROFILE, breathAvailable: true,
      ...overrides,
    },
  ];
}

function buildDragonTx(combatants = dragonRows()) {
  return {
    combatant: {
      findMany: vi.fn().mockResolvedValue(combatants),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    encounter: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    character: {
      findUnique: vi.fn().mockResolvedValue({
        // Rogue: proficient in DEX and INT — Fire Breath's save is DEX, so the
        // default fixture exercises the proficiency bonus everywhere it isn't
        // deliberately turned off (the "no proficiency" test below overrides
        // this with a class NOT proficient in DEX).
        hp: 200, maxHp: 200, stats: { DEX: 14, CON: 12 }, class: "rogue", level: 5, inventory: [],
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    gameLog: { create: vi.fn().mockResolvedValue({}) },
  } as unknown as Prisma.TransactionClient;
}

const DRAGON_CTX = {
  campaignId: "camp-1", encounterId: "enc-1", characterId: "char-1",
  round: 1, turnIndex: 1, collectEvents: true,
};

describe("resolveEnemyTurn — area-save attacks (area-save-actions spec §6)", () => {
  it("breathes when charged and in range: a failed save takes full damage", async () => {
    const tx = buildDragonTx();
    // Rogue DEX 14 (+2) + proficiency (level 5 = +3) = +5. d20 = 15 (0.7) + 5 = 20 vs DC 21: fails.
    // 18d6 damage: each die 0.5 -> 4, total 72.
    mockRandom([0.7, ...Array(18).fill(0.5)]);
    const outcome = await resolveEnemyTurn(tx, DRAGON_CTX);

    expect(tx.character.update).toHaveBeenCalledWith({ where: { id: "char-1" }, data: { hp: 128 } });
    expect(tx.combatant.updateMany).toHaveBeenCalledWith({
      where: { id: "d1" }, data: { breathAvailable: false },
    });
    expect(outcome.playerDowned).toBe(false);
    expect(tx.gameLog.create).toHaveBeenCalledWith({
      data: {
        campaignId: "camp-1", role: "system",
        content: "Adult Red Dragon — Fire Breath: DC 21 Dexterity save, Aldric rolls 20 — fails, 72 fire damage.",
      },
    });
  });

  it("halves and rounds down on a successful save", async () => {
    const tx = buildDragonTx();
    // d20 = 20 (0.95) + 5 = 25 vs DC 21: succeeds. 18d6 average roll -> 72 raw, halved to 36.
    mockRandom([0.95, ...Array(18).fill(0.5)]);
    await resolveEnemyTurn(tx, DRAGON_CTX);

    expect(tx.character.update).toHaveBeenCalledWith({ where: { id: "char-1" }, data: { hp: 164 } });
    expect(tx.gameLog.create).toHaveBeenCalledWith({
      data: {
        campaignId: "camp-1", role: "system",
        content: "Adult Red Dragon — Fire Breath: DC 21 Dexterity save, Aldric rolls 25 — succeeds, 36 fire damage.",
      },
    });
  });

  it("prefers breath over melee when both are usable", async () => {
    const tx = buildDragonTx();
    mockRandom([0.7, ...Array(18).fill(0.5)]);
    await resolveEnemyTurn(tx, DRAGON_CTX);

    // Bite's attack roll (resolveAttackRoll) is never reached: no "vs AC" log line.
    const calls = (tx.gameLog.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some(([{ data }]) => data.content.includes("vs AC"))).toBe(false);
  });

  it("falls back to melee when breathAvailable is false and stays spent", async () => {
    const tx = buildDragonTx({ breathAvailable: false });
    // A spent breath still rolls to recharge first (1d6 = 4, 0.5 -> fails,
    // stays false), then the melee attack-roll/damage/hit-location sequence.
    mockRandom([0.5, 0.75, 0.5, 0.3]);
    await resolveEnemyTurn(tx, DRAGON_CTX);

    const calls = (tx.gameLog.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some(([{ data }]) => data.content.includes("Bite:"))).toBe(true);
    expect(calls.some(([{ data }]) => data.content.includes("Fire Breath:"))).toBe(false);
  });

  it("kills outright when a failed save's damage reaches max HP", async () => {
    const tx = buildDragonTx();
    (tx.character.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      hp: 10, maxHp: 10, stats: { DEX: 14, CON: 12 }, class: "rogue", level: 5, inventory: [],
    });
    mockRandom([0.05, ...Array(18).fill(0.9)]); // a low roll fails; high damage dice
    const outcome = await resolveEnemyTurn(tx, DRAGON_CTX);

    expect(outcome.playerDied).toBe(true);
    expect(tx.gameLog.create).toHaveBeenLastCalledWith({
      data: { campaignId: "camp-1", role: "system", content: "Aldric dies from massive damage." },
    });
  });

  it("recharges and immediately breathes that same turn on success", async () => {
    // A recharge roll that succeeds makes the breath available for THIS
    // turn's planning, not only from the next turn on — the same real 5e
    // rule a dragon plays by: roll recharge at the start of your turn, then
    // take your action, breath included, same turn.
    const tx = buildDragonTx({ breathAvailable: false });
    // Recharge: 1d6 = 5 (0.7), succeeds. Then the save (d20 = 15, 0.7) and
    // 18 damage dice (all 0.5 -> 4 each = 72), the same sequence as the
    // "breathes when charged" test above.
    mockRandom([0.7, 0.7, ...Array(18).fill(0.5)]);
    await resolveEnemyTurn(tx, DRAGON_CTX);

    expect(tx.combatant.updateMany).toHaveBeenCalledWith({
      where: { id: "d1" }, data: { breathAvailable: true },
    });
    expect(tx.gameLog.create).toHaveBeenCalledWith({
      data: { campaignId: "camp-1", role: "system", content: "Adult Red Dragon recharges its Fire Breath (5)." },
    });
    const calls = (tx.gameLog.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some(([{ data }]) => data.content.includes("Fire Breath:"))).toBe(true);
    expect(calls.some(([{ data }]) => data.content.includes("Bite:"))).toBe(false);
    // Used this turn, so it is spent again by the time the turn ends.
    expect(tx.combatant.updateMany).toHaveBeenCalledWith({
      where: { id: "d1" }, data: { breathAvailable: false },
    });
  });

  it("logs a failed recharge and does not touch breathAvailable", async () => {
    const tx = buildDragonTx({ breathAvailable: false });
    mockRandom([0.2, 0.75, 0.5, 0.3]); // 1d6 = 2 (0.2 -> 2): fails
    await resolveEnemyTurn(tx, DRAGON_CTX);

    expect(tx.combatant.updateMany).not.toHaveBeenCalledWith({
      where: { id: "d1" }, data: { breathAvailable: true },
    });
    expect(tx.gameLog.create).toHaveBeenCalledWith({
      data: { campaignId: "camp-1", role: "system", content: "Adult Red Dragon fails to recharge its Fire Breath (2)." },
    });
  });

  it("does not roll to recharge an already-available breath", async () => {
    const tx = buildDragonTx({ breathAvailable: true });
    mockRandom([0.7, ...Array(18).fill(0.5)]);
    await resolveEnemyTurn(tx, DRAGON_CTX);

    const calls = (tx.gameLog.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some(([{ data }]) => data.content.includes("recharge"))).toBe(false);
  });

  it("applies no proficiency bonus for a class not proficient in the save", async () => {
    const tx = buildDragonTx();
    (tx.character.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      hp: 200, maxHp: 200, stats: { DEX: 14, CON: 12 }, class: "wizard", level: 5, inventory: [],
    });
    // Wizard: DEX +2 only, no proficiency (wizard saves are INT/WIS). d20 = 18 (0.85) + 2 = 20 vs DC 21: fails.
    mockRandom([0.85, ...Array(18).fill(0.5)]);
    await resolveEnemyTurn(tx, DRAGON_CTX);

    expect(tx.gameLog.create).toHaveBeenCalledWith({
      data: {
        campaignId: "camp-1", role: "system",
        content: "Adult Red Dragon — Fire Breath: DC 21 Dexterity save, Aldric rolls 20 — fails, 72 fire damage.",
      },
    });
  });

  it("holds the breath against a downed player", async () => {
    const tx = buildDragonTx(
      dragonRows().map((r) => (r.isPlayer ? { ...r, hp: 0 } : r)),
    );
    const outcome = await resolveEnemyTurn(tx, DRAGON_CTX);
    expect(outcome).toEqual({ events: [], playerDowned: false, playerDied: false });
  });
});
```

  `mockRandom` and `Prisma`/`vi`/`describe`/`it`/`expect` are already
  imported at the top of this file; no new imports are needed for the test
  file itself.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run tests/db/enemy-turn-transition.test.ts`
Expected: FAIL — `resolveEnemyTurn` never looks at `areaSaveAttack` or
`breathAvailable`, so every new test either times out on an unmatched log
assertion or falls through to the melee path regardless of what the mocked
dice imply.

- [ ] **Step 3: Implement.** In `lib/db/enemy-turn-transition.ts`:

```ts
// New imports, alongside the existing ones:
import { rollDie } from "@/lib/rules/dice";
import { proficiencyBonus } from "@/lib/rules/proficiency";
import { isProficientInSave } from "@/lib/rules/saving-throw-proficiency";
```

```ts
// CombatantRow gains one field:
interface CombatantRow {
  id: string;
  name: string;
  isPlayer: boolean;
  hp: number;
  x: number;
  y: number;
  size: string;
  conditions: unknown;
  attackProfile?: unknown;
  breathAvailable?: boolean | null;
}
```

Immediately after the existing `const profile = rawProfile as
MonsterAttackProfileV1 | null;` line and before `const enemyGrid =
grid(enemy);`, insert the recharge roll:

```ts
  // The recharge roll happens at the start of the turn, whether or not the
  // action ends up used this turn (spec §6.1).
  let breathAvailable = enemy.breathAvailable ?? undefined;
  if (profile?.areaSaveAttack && breathAvailable === false) {
    const roll = rollDie(6);
    if (roll >= profile.areaSaveAttack.rechargeMin) {
      breathAvailable = true;
      await tx.combatant.updateMany({ where: { id: enemy.id }, data: { breathAvailable: true } });
      await tx.gameLog.create({
        data: {
          campaignId: ctx.campaignId, role: "system",
          content: `${enemy.name} recharges its ${profile.areaSaveAttack.name} (${roll}).`,
        },
      });
    } else {
      await tx.gameLog.create({
        data: {
          campaignId: ctx.campaignId, role: "system",
          content: `${enemy.name} fails to recharge its ${profile.areaSaveAttack.name} (${roll}).`,
        },
      });
    }
  }
```

Update the `planEnemyTurn` call to pass the (possibly just-recharged)
availability:

```ts
  const plan = planEnemyTurn({
    enemy: {
      ...enemyGrid,
      hp: enemy.hp,
      conditions: extractConditions(enemy.conditions),
      profile,
    },
    player: grid(player),
    others: combatants.filter((c) => c.id !== enemy.id).map(grid),
    playerDowned: player.hp <= 0,
    breathAvailable,
  });
```

Extend the invariant guard right after the plan is built:

```ts
  if (
    player.hp <= 0 &&
    (plan.move !== null || plan.attacks.length > 0 || plan.areaSaveAttack !== null)
  ) {
    throw new EnemyTurnInvariantError(`Enemy ${enemy.id} planned to act against a downed player.`);
  }
```

Change the early-return guard (today `if (plan.attacks.length === 0 ||
!profile) return { events, playerDowned: false, playerDied: false };`) to
also fall through for an area-save plan:

```ts
  if ((plan.attacks.length === 0 && plan.areaSaveAttack === null) || !profile) {
    return { events, playerDowned: false, playerDied: false };
  }
```

Widen the `character` query's `select` to add `class` and `level`, needed
for proficiency:

```ts
  const character = (await tx.character.findUnique({
    where: { id: ctx.characterId },
    select: {
      hp: true,
      maxHp: true,
      stats: true,
      class: true,
      level: true,
      inventory: { select: { type: true, equippedSlot: true, properties: true } },
    },
  })) as {
    hp: number; maxHp: number; stats: unknown; class: string; level: number;
    inventory: ArmorInventoryRow[];
  } | null;
```

Immediately after the existing weapon-attack loop (`for (const name of
plan.attacks) { … }`, which now only runs when `plan.attacks` is non-empty —
unchanged otherwise), add the area-save branch. Both branches return from
inside themselves today (the weapon loop already `return`s on a downing hit,
and falls through to the function's final `return` otherwise), so append
this as a new top-level `if` after the weapon loop, guarded so it only runs
for an area-save plan:

```ts
  if (plan.areaSaveAttack && profile.areaSaveAttack) {
    const attack = profile.areaSaveAttack;
    const saveStats = (character.stats ?? {}) as Record<string, number>;
    const saveModifier =
      abilityModifier(saveStats[attack.saveAbility] ?? 10) +
      (isProficientInSave(character.class, attack.saveAbility) ? proficiencyBonus(character.level) : 0);
    const save = resolveSavingThrow(saveModifier, attack.saveDC);

    const rolled = attack.damage.reduce(
      (sum, part) => sum + Math.max(0, rollDamage(part.dice, false).total),
      0,
    );
    const damage = save.success ? Math.floor(rolled / 2) : rolled;
    const hpBeforeHit = hp;
    hp = await setPlayerHp(tx, { characterId: ctx.characterId, encounterId: ctx.encounterId, hp: hp - damage });

    await tx.combatant.updateMany({ where: { id: enemy.id }, data: { breathAvailable: false } });

    const abilityName = ABILITY_FULL_NAME[attack.saveAbility];
    await tx.gameLog.create({
      data: {
        campaignId: ctx.campaignId,
        role: "system",
        content:
          `${enemy.name} — ${attack.name}: DC ${attack.saveDC} ${abilityName} save, ${player.name} rolls ` +
          `${save.total} — ${save.success ? "succeeds" : "fails"}, ${damage} ${attack.damage[0]!.type} damage.`,
      },
    });

    if (ctx.collectEvents) {
      const consequence: SingleTargetConsequence = {
        targetName: player.name, targetId: player.id, damage,
        naturalRoll: save.roll, isCrit: false, isFumble: false,
        hitLocation: "chest", narrativeTags: [], hpAfter: hp,
        targetMaxHp: character.maxHp, isKill: hp <= 0, conditionsApplied: [],
      };
      events.push({
        type: "COMBAT_CONSEQUENCE",
        payload: { attackerName: enemy.name, targets: [consequence] },
      });
      if (damage > 0) {
        events.push({ type: "DAMAGE_DEALT", payload: { damage, naturalRoll: save.roll, targetName: player.name } });
      }
    }

    if (hp <= 0) {
      const fall = await applyPlayerDowned(tx, {
        encounterId: ctx.encounterId, hpBefore: hpBeforeHit, damage,
        maxHp: character.maxHp, collectEvents: ctx.collectEvents, events,
      });
      await tx.gameLog.create({
        data: {
          campaignId: ctx.campaignId, role: "system",
          content:
            fall === "dead"
              ? `${player.name} dies from massive damage.`
              : `${player.name} falls unconscious and is dying.`,
        },
      });
      return { events, playerDowned: true, playerDied: fall === "dead" };
    }
  }
```

Add the ability-name lookup near the top of the file, alongside the other
module-level constants:

```ts
const ABILITY_FULL_NAME: Record<string, string> = {
  STR: "Strength", DEX: "Dexterity", CON: "Constitution",
  INT: "Intelligence", WIS: "Wisdom", CHA: "Charisma",
};
```

- [ ] **Step 4: Run the tests from Step 2**

Run: `pnpm exec vitest run tests/db/enemy-turn-transition.test.ts`
Expected: PASS, all 32 tests in the file (23 pre-existing + 9 new — recount
against the file after editing; the number itself is not load-bearing).

- [ ] **Step 5: Falsify.**
  - Change `save.success ? Math.floor(rolled / 2) : rolled` to `rolled`
    always — the "halves and rounds down" test fails.
  - Drop the `isProficientInSave(...) ? proficiencyBonus(...) : 0` term
    (always add it) — the "no proficiency bonus" test fails.
  - Comment out the recharge `if (roll >= …rechargeMin)` branch entirely
    (never set `breathAvailable = true`) — the "recharges and immediately
    breathes" test fails.
  - Pass `enemy.breathAvailable` (the pre-roll value) to `planEnemyTurn`
    instead of the reassigned `breathAvailable` — the "recharges and
    immediately breathes" test fails differently: the dragon bites instead
    (this is the one that would silently defer a same-turn recharge to next
    turn, the bug this test exists to catch).
  - Drop `await tx.combatant.updateMany({ where: { id: enemy.id }, data: { breathAvailable: false } });`
    from the area-save branch — no test currently asserts this in isolation
    from the "breathes when charged" test's own assertion, so this
    mutation is caught by that same test already (confirming it is not an
    untested guard).

  Revert each mutation after confirming its failure.

- [ ] **Step 6: Full suite, typecheck, commit**

```bash
pnpm typecheck
pnpm exec vitest run --maxWorkers=2
```

```bash
git add lib/db/enemy-turn-transition.ts tests/db/enemy-turn-transition.test.ts
git commit -m "feat(combat): the enemy-turn chain recharges and resolves the breath attack"
```

### Task 7: Real-PostgreSQL smoke and PR 2/3

**Files:**
- Create: `tests/e2e/area-save-actions.spec.ts`

**Interfaces:**
- Consumes: `createdId`, `postAction`, `parseSseFrames` from
  `tests/e2e/support/combat-fixture.ts`; `assertSafeE2EDatabase`,
  `cleanupE2ERecords` from `tests/e2e/support/database.ts`.

- [ ] **Step 1: Write the smoke spec**

```ts
// tests/e2e/area-save-actions.spec.ts
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { profileMonster } from "@/lib/rules/monster-attack-profile";
import { assertSafeE2EDatabase, cleanupE2ERecords, type E2ECreatedRecords } from "./support/database";
import { createdId, parseSseFrames, postAction } from "./support/combat-fixture";

/**
 * Area saving-throw attacks (breath weapons) on real PostgreSQL
 * (docs/superpowers/specs/2026-09-16-area-save-actions-design.md §8).
 *
 * A young red dragon (small enough numbers for a smoke test) at full
 * recharge, and a fighter — proficient in DEX? no: STR/CON — so this fixture
 * deliberately uses a class with NO Dexterity proficiency, so the save
 * modifier is exactly the ability modifier and the scenario stays a real
 * coin flip either way; the assertions accept both outcomes.
 */
const YOUNG_RED_DRAGON = (
  JSON.parse(readFileSync(join(process.cwd(), "data", "srd-es", "monsters.json"), "utf8")) as Array<
    Record<string, unknown>
  >
).find((m) => m.index === "young-red-dragon")!;

function types(body: string): string[] {
  return parseSseFrames(body)
    .filter((frame) => frame.t === "evt" && typeof frame.e?.type === "string")
    .map((frame) => frame.e!.type!);
}

async function createDragonFixture(request: import("@playwright/test").APIRequestContext, prisma: PrismaClient) {
  const created: E2ECreatedRecords = {};
  const suffix = randomUUID().slice(0, 8);
  created.characterId = await createdId(
    await request.post("/api/character", {
      data: {
        name: `Breath e2e ${suffix}`, race: "human", class: "fighter",
        stats: { STR: 16, DEX: 12, CON: 14, INT: 10, WIS: 12, CHA: 8 },
      },
    }),
  );
  created.campaignId = await createdId(
    await request.post("/api/campaign", {
      data: { characterId: created.characterId, title: `Breath e2e ${suffix}` },
    }),
  );
  await prisma.character.update({ where: { id: created.characterId }, data: { hp: 200, maxHp: 200 } });

  const profile = profileMonster(YOUNG_RED_DRAGON);
  expect(profile?.areaSaveAttack).not.toBeNull();

  const encounter = await prisma.encounter.create({
    data: {
      campaignId: created.campaignId, status: "active", round: 1,
      currentTurnIndex: 0, currentTurnMovementSpentFt: 0,
      currentTurnObjectInteractionUsed: false, totalDamageDealt: 0,
      combatants: {
        create: [
          {
            name: "Breath E2E Hero", isPlayer: true, hp: 200, maxHp: 200, ac: 16,
            initiativeTotal: 20, initiativeOrder: 0,
            stats: { STR: 16, DEX: 12, CON: 14, INT: 10, WIS: 12, CHA: 8 },
            conditions: [], x: 5, y: 5,
          },
          {
            name: "Young Red Dragon", isPlayer: false, hp: 88, maxHp: 88, ac: 18,
            initiativeTotal: 10, initiativeOrder: 1,
            stats: { STR: 19, DEX: 10, CON: 21, INT: 10, WIS: 11, CHA: 15 },
            conditions: [], size: "Large", x: 5, y: 6,
            attackProfile: profile as unknown as Prisma.InputJsonValue,
            breathAvailable: true,
          },
        ],
      },
    },
    include: { combatants: true },
  });

  return {
    created, encounterId: encounter.id,
    playerId: encounter.combatants.find((c) => c.isPlayer)!.id,
    dragonId: encounter.combatants.find((c) => !c.isPlayer)!.id,
  };
}

async function cleanup(prisma: PrismaClient, fixture: Awaited<ReturnType<typeof createDragonFixture>> | undefined) {
  if (fixture) {
    await prisma.combatant.deleteMany({ where: { encounterId: fixture.encounterId } });
    await prisma.encounter.deleteMany({ where: { id: fixture.encounterId } });
  }
  await prisma.$disconnect();
  if (fixture) await cleanupE2ERecords(fixture.created);
}

test("@smoke a charged dragon breathes instead of biting, on real PostgreSQL", async ({ request }) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();
  const prisma = new PrismaClient();
  let fixture: Awaited<ReturnType<typeof createDragonFixture>> | undefined;
  try {
    fixture = await createDragonFixture(request, prisma);
    const campaignId = fixture.created.campaignId!;

    const res = await postAction(request, campaignId, "End Turn");
    expect(res.status()).toBe(200);
    const events = types(await res.text());
    expect(events).toContain("COMBAT_CONSEQUENCE");

    const logs = await prisma.gameLog.findMany({
      where: { campaignId, role: "system", content: { contains: "Fire Breath" } },
      select: { content: true },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.content).toMatch(/DC \d+ Dexterity save, .+ rolls \d+ — (fails|succeeds), \d+ fire damage\./);
    // Whichever way the save went, the breath is now spent.
    await expect(
      prisma.combatant.findUniqueOrThrow({ where: { id: fixture.dragonId }, select: { breathAvailable: true } }),
    ).resolves.toEqual({ breathAvailable: false });
    // Never the plain weapon-attack log line — the dragon did not bite this turn.
    expect(
      await prisma.gameLog.count({
        where: { campaignId, role: "system", content: { contains: "vs AC" } },
      }),
    ).toBe(0);
  } finally {
    await cleanup(prisma, fixture);
  }
});

test("@smoke a spent breath recharges or stays spent, and either way the dragon still acts", async ({ request }) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();
  const prisma = new PrismaClient();
  let fixture: Awaited<ReturnType<typeof createDragonFixture>> | undefined;
  try {
    fixture = await createDragonFixture(request, prisma);
    await prisma.combatant.update({ where: { id: fixture.dragonId }, data: { breathAvailable: false } });

    const res = await postAction(request, fixture.created.campaignId!, "End Turn");
    expect(res.status()).toBe(200);

    const logs = await prisma.gameLog.findMany({
      where: { campaignId: fixture.created.campaignId!, role: "system" },
      orderBy: { createdAt: "asc" }, select: { content: true },
    });
    const recharge = logs.find((l) => l.content.includes("recharge"));
    expect(recharge).toBeDefined();
    expect(recharge!.content).toMatch(/^Young Red Dragon (recharges|fails to recharge) its Fire Breath \(\d\)\.$/);

    // Whichever way the recharge roll went, the dragon still acted this turn
    // (breathed if it recharged, bit otherwise) — the turn always advances.
    await expect(
      prisma.encounter.findUniqueOrThrow({ where: { id: fixture.encounterId }, select: { currentTurnIndex: true } }),
    ).resolves.toEqual({ currentTurnIndex: 0 });
  } finally {
    await cleanup(prisma, fixture);
  }
});
```

- [ ] **Step 2: Verify what can be verified locally.** E2E cannot run here
  (no `.env`, by design). Run `pnpm typecheck` and
  `pnpm exec playwright test --list`: `area-save-actions.spec.ts` lists 2
  tests, and every previously-listed spec is still listed unchanged.

- [ ] **Step 3: Full validation**

```bash
pnpm typecheck
pnpm exec vitest run --maxWorkers=2
pnpm build
pnpm check-retro
```

Record the results.

- [ ] **Step 4: Commit, then PR 2/3**

```bash
git add tests/e2e/area-save-actions.spec.ts
git commit -m "test(e2e): breath weapons on real PostgreSQL"
```

With the maintainer's go-ahead, push and open "feat(combat): enemies use
their breath weapons (area saves 2/3)". The body **must** begin with:

```markdown
> **Deploy ordering: apply `20260917120000_add_combatant_breath_available`
> before deploying this code.** Prisma selects every scalar column, so the
> new code without the column breaks every `Combatant` query — combat and
> the character sheet first. The migration is additive (one nullable
> column); the old code ignores it. Rollback is reverting the code.
```

Then list the contract-changed tests by file (every exact-`toEqual` fixture
in `tests/rules/monster-attack-profile.test.ts` and
`tests/rules/enemy-turn.test.ts`/`enemy-turn-downed-player.test.ts` that
gained `areaSaveAttack: null`). Wait for green checks and squash-merge.

---

# Stage 3 — Docs and validation

**Branch:** `claude/area-save-actions-3-docs`. **Schema impact:** none.
**Behaviour change:** none — documentation only.

### Task 8: Contract docs and final validation

**Files:**
- Modify: `MASTER_ARCH_GUIDE.md` §4.4 (after the death-saves bullets)

- [ ] **Step 1: Document the contract.** Append to §4.4:

```markdown
- An enemy with a recognised area saving-throw attack (a breath weapon) uses
  it over its ordinary attacks whenever it is charged and the player is in
  range, moving first if needed. The action is recognised only when its
  prose clause and its structured `dc`/`damage`/`usage` fields agree — a
  mismatch, in either direction, leaves that monster without it —
  docs/superpowers/specs/2026-09-16-area-save-actions-design.md.
- `Combatant.breathAvailable` tracks whether that action is off recharge.
  The enemy-turn chain rolls to recharge a spent one at the start of that
  enemy's turn, whether or not it is used that turn, and logs the roll
  either way.
- The player's saving throw uses `CLASS_SAVING_THROW_PROFICIENCIES`
  (`lib/rules/saving-throw-proficiency.ts`) — the SRD's fixed, unchosen
  two-save table — alongside the existing ability modifier.
```

- [ ] **Step 2: Full validation.** Run each and record the result:
  - `pnpm typecheck`
  - `pnpm exec vitest run --maxWorkers=2`
  - `pnpm build`
  - `pnpm check-retro`
  - `pnpm exec playwright test --list`

- [ ] **Step 3: Commit, then open the PR with the handover.** With the
  maintainer's go-ahead, push and open "docs(arch): record the area
  saving-throw contract (area saves 3/3)". No deploy warning — the schema
  shipped in 2/3. Wait for green checks, squash-merge, and sync `master`.

---

## Self-review record

**Spec coverage:**

| Spec section | Where |
| --- | --- |
| §1 decisions 1–6 | Task 1 (5, 6), Task 3 (1, 3), Task 2 (4) |
| §2 measured figures (28 recognised, 4 defects) | Task 1's `RECOGNISED_AREA_SAVE` list and the four falsification/rejection tests |
| §3 scope In/Out | Tasks 1–6 implement In; nothing in this plan touches any Out item |
| §4.1–4.3 recognition | Task 1 |
| §4.4 persisted shape | Task 1 |
| §4.5 proficiency table | Task 2 |
| §5 `breathAvailable` | Task 4 (schema), Task 5 (write), Task 6 (read/mutate) |
| §6.1 recharge roll | Task 6 |
| §6.2 planner tiers | Task 3 |
| §6.3 save resolution | Task 6 |
| §7 migration/deploy | Task 4, Task 7's PR body |
| §8 testing | Every task; E2E in Task 7 |
| §9 delivery | Stages 0–3 |

**Placeholder scan:** no "TBD", no "add appropriate handling" — every step
above shows the literal code or test to write.

**Type consistency check:** `ProfiledAreaSaveAttack`, `EnemyTurnPlan.areaSaveAttack`,
`EnemyTurnInput.breathAvailable`, `Combatant.breathAvailable`, and
`isProficientInSave` are named and typed identically everywhere they appear
across Tasks 1, 3, 4, 5, and 6.

**Corrections made to the spec during planning:** none beyond the two
already committed to the spec file itself (`9cba17a`) before this plan was
written — the plan builds directly on the corrected §2/§4.
