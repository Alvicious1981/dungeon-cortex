# Enemy Turns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution rule (this repository):** test-driven. Do not write production
> code for a task until its named RED test has failed for the expected missing
> behaviour. Deliberately falsify each important new guard before calling it
> covered.

**Goal:** Enemies take their turns. When the player's turn ends, the backend
resolves every enemy turn in the same transaction (move, then attack the
player) until the pointer returns to the player or the encounter ends.

**Architecture:**
- **Pure rules modules** own the policy: `monster-attack-profile.ts` recognises
  SRD attacks verbatim, and `enemy-turn.ts` plans one turn.
- **Database transition code** owns the conditional writes: `enemy-turn-transition.ts`
  resolves one planned turn, and `player-hp.ts` is the single write path for
  the player's HP.
- **`finalizeEncounterTurn`** owns the chain: it takes the `Character` lock at
  entry, loops over enemy turns and claims each turn edge.
- **The action route** only maps errors and allows one narrow `End Turn`
  resume.

**Tech Stack:** Next.js App Router, TypeScript, Prisma, PostgreSQL 16 with
pgvector, Vitest, Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-15-enemy-turns-design.md`, approved
2026-09-15, with §4 corrected during planning. Read it before any task. This
plan argues from it and does not restate its rationale.

## Global Constraints

- **Commands.** Use `pnpm`. Run unit suites with
  `pnpm exec vitest run --maxWorkers=2`, never `pnpm test`. A test that *times
  out* is machine contention: re-run that file alone. A test that fails an
  *assertion* is real.
- **Migrations.** Write them by hand and leave them unapplied on the private
  save. Apply one only to a verified disposable database with
  `E2E_TEST_MODE=true`, and **ask the maintainer before applying it even
  there** (AGENTS.md, "Commands requiring explicit approval"). CI applies
  migrations with `pnpm prisma migrate deploy`. After any schema edit, run
  `pnpm prisma generate`.
- **Lock order** is `Character → Combatant → Encounter`. Add no serializable
  transaction and no Encounter lock ahead of those rows.
- **The action route keeps exactly six `failOnStaleTurn: true` finalizer
  calls**, one per turn-ending branch
  (`tests/architecture/player-turn-spending-actions.test.ts`). The `End Turn`
  resume is the *same* call with a computed `mode`, never a second call.
- **`status: "resolved"` is written only in `lib/rules/combat-pipeline.ts`**
  (`tests/architecture/encounter-resolution-authority.test.ts`).
- **Events are published only after commit.** Every `GameLog` row inside a
  combat transaction is written through `tx`.
- **No SRD prose parsing** beyond the verbatim tables of spec §4.
- **PRs.** One PR per stage, squash-merged. Pushing and opening a PR require
  the maintainer's go-ahead. Validate the exact pushed head, wait for
  pre-merge and post-merge "Verify" and "E2E smoke" to go green, then sync
  local `master` to a clean 0/0 state.
- **CI runs only `@smoke`** (`pnpm test:e2e:smoke`), so every new Playwright
  test is tagged `@smoke`. CI does not seed the SRD: an E2E that needs a
  monster inserts its own `SrdMonster` row from `data/srd-es/monsters.json`.
- **Deploy ordering for Stage 3: apply the migration, then deploy.** State it
  in every handover (spec §7).
- **Recommended models:**
  - Stage 1: Sonnet 5, effort `high`.
  - Stages 2 and 3: Opus 5, effort `high`.
  - Task 6: Opus 5 at `xhigh`.

## File map

| File | Stage | Responsibility |
| --- | --- | --- |
| `lib/rules/monster-attack-profile.ts` (new) | 1 | Verbatim recognition of SRD attacks, walk speed and multiattack into `MonsterAttackProfileV1`; the persisted-shape guard |
| `lib/rules/enemy-turn.ts` (new) | 1 | `planEnemyTurn`: pure move-then-attack plan |
| `lib/rules/conditions.ts` | 1 | `isIncapacitated` |
| `lib/rules/geometry.ts` | 1 | `toSizeCategory`, moved from the route |
| `lib/db/character-lock.ts` (new) | 2 | `lockCharacterForCombatAction`, moved from the route |
| `lib/db/player-hp.ts` (new) | 2 | `setPlayerHp`, `mirrorPlayerCombatantHp` |
| `lib/rules/combat-pipeline.ts` | 2, 3 | Healing mirror and self-damage write (2); the chain in the finalizer (3) |
| `lib/db/turn-state-conflict.ts` (new) | 3 | `TurnStateConflictError`, moved from the route |
| `lib/db/move-transition.ts` | 3 | `claimMoveTransition` split out of `persistMoveTransition` |
| `lib/db/enemy-turn-transition.ts` (new) | 3 | `resolveEnemyTurn`, `EnemyTurnInvariantError` |
| `prisma/schema.prisma`, `prisma/migrations/20260915120000_add_combatant_attack_profile/` | 3 | `Combatant.attackProfile Json?` |
| `app/api/campaign/[id]/encounter/route.ts` | 3 | The column's only writer |
| `app/api/campaign/[id]/action/route.ts` | 1, 2, 3 | Imports, item-use lock, `End Turn` resume, error mapping |
| `MASTER_ARCH_GUIDE.md` | 3 | §4.4 contract |

---

# Stage 0 — Docs PR

**Branch:** `claude/enemy-turns-spec` (it already carries the spec commit
`d6ec196`).

- [ ] **Step 1:** Commit the spec's §4 corrections and this plan:

```bash
git add docs/superpowers/specs/2026-09-15-enemy-turns-design.md docs/superpowers/plans/2026-09-15-enemy-turns.md
git commit -m "docs(plan): plan enemy turns in three stages"
```

- [ ] **Step 2:** With the maintainer's go-ahead, push, open the PR against
  `master`, wait for green checks and squash-merge. Every later stage branches
  from the resulting `master`.

---

# Stage 1 — Pure rules

**Branch:** `claude/enemy-turns-1-rules`. **Schema impact:** none.
**Behaviour change in the game:** none. Nothing calls the new modules yet.

### Task 1: Recognise SRD attacks into a profile

**Files:**
- Create: `lib/rules/monster-attack-profile.ts`
- Test: `tests/rules/monster-attack-profile.test.ts`

**Interfaces:**
- Consumes: `DAMAGE_TYPES`, `DamageType` from `lib/rules/damage-modifiers.ts`.
- Produces:
  - the types `ProfiledDamage`, `ProfiledAttack`, `MultiattackPart` and
    `MonsterAttackProfileV1`;
  - `profileMonster(monster: unknown): MonsterAttackProfileV1 | null`;
  - `recogniseAttack(action: unknown): ProfiledAttack | null`;
  - `averageDamage(dice: string): number`;
  - `isMonsterAttackProfile(value: unknown): value is MonsterAttackProfileV1`;
  - the tables `RECOGNISED_ATTACK_HEADERS`, `RECOGNISED_REACH_FT`,
    `RECOGNISED_RANGES` and `RECOGNISED_WALK_SPEEDS`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/rules/monster-attack-profile.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  averageDamage,
  isMonsterAttackProfile,
  profileMonster,
  recogniseAttack,
  RECOGNISED_RANGES,
  RECOGNISED_WALK_SPEEDS,
} from "@/lib/rules/monster-attack-profile";

/**
 * Bound against the real file prisma/seed-srd.ts loads into SrdMonster.data,
 * the discipline of tests/rules/damage-clauses.test.ts: an unseen wording
 * fails here instead of passing unnoticed. Figures from spec §4.
 */
const MONSTERS = JSON.parse(
  readFileSync(join(process.cwd(), "data", "srd-es", "monsters.json"), "utf8"),
) as Array<Record<string, unknown>>;

function monster(index: string): Record<string, unknown> {
  const found = MONSTERS.find((m) => m.index === index);
  if (!found) throw new Error(`fixture monster ${index} missing`);
  return found;
}

function attackActions(): Array<{ key: string; action: unknown }> {
  return MONSTERS.flatMap((m) =>
    ((m.actions as Array<Record<string, unknown>> | undefined) ?? [])
      .filter((a) => typeof a.attack_bonus === "number")
      .map((a) => ({ key: `${m.index as string}:${a.name as string}`, action: a })),
  );
}

const UNRECOGNISED = [
  "ancient-black-dragon:Bite", "bandit:Light Crossbow", "behir:Constrict",
  "couatl:Constrict", "druid:Quarterstaff", "dryad:Club", "elephant:Stomp",
  "elk:Hooves", "ettercap:Web", "giant-crocodile:Tail", "giant-elk:Hooves",
  "giant-spider:Web", "gladiator:Spear", "guardian-naga:Spit Poison",
  "lamia:Intoxicating Touch", "mammoth:Stomp", "octopus:Ink Cloud",
  "pit-fiend:Claw", "pit-fiend:Mace", "pit-fiend:Tail", "roper:Tendril",
  "rug-of-smothering:Smother", "salamander:Spear", "scout:Longbow",
  "succubus-incubus:Draining Kiss", "swarm-of-bats:Bites",
  "swarm-of-beetles:Bites", "swarm-of-centipedes:Bites",
  "swarm-of-insects:Bites", "swarm-of-poisonous-snakes:Bites",
  "swarm-of-quippers:Bites", "swarm-of-rats:Bites", "swarm-of-ravens:Beaks",
  "swarm-of-spiders:Bites", "swarm-of-wasps:Bites", "triceratops:Stomp",
  "vampire-bat:Bite", "vampire-spawn:Bite", "vampire-vampire:Bite",
];

describe("monster attack profile", () => {
  it("profiles the goblin exactly", () => {
    expect(profileMonster(monster("goblin"))).toEqual({
      version: 1,
      walkSpeedFt: 30,
      attacks: [
        {
          name: "Scimitar", attackBonus: 4, melee: { reachFt: 5 }, ranged: null,
          damage: [{ dice: "1d6+2", type: "slashing" }],
        },
        {
          name: "Shortbow", attackBonus: 4, melee: null,
          ranged: { normalFt: 80, longFt: 320 },
          damage: [{ dice: "1d6+2", type: "piercing" }],
        },
      ],
      multiattack: null,
    });
  });

  it("resolves a structured multiattack into its parts", () => {
    expect(profileMonster(monster("brown-bear"))?.multiattack).toEqual([
      { attack: "Bite", count: 1 },
      { attack: "Claws", count: 1 },
    ]);
  });

  it("reduces a versatile choice to its lowest-average option", () => {
    const spear = profileMonster(monster("guard"))?.attacks.find((a) => a.name === "Spear");
    expect(spear?.damage).toEqual([{ dice: "1d6+1", type: "piercing" }]);
  });

  it("keeps flat damage as a fixed amount", () => {
    const bite = profileMonster(monster("badger"))?.attacks.find((a) => a.name === "Bite");
    expect(bite?.damage).toEqual([{ dice: "1", type: "piercing" }]);
  });

  it("breaks a damage-type tie by type name", () => {
    const scimitar = profileMonster(monster("djinni"))?.attacks.find((a) => a.name === "Scimitar");
    expect(scimitar?.damage).toHaveLength(2);
    expect(scimitar?.damage).toEqual(
      expect.arrayContaining([
        { dice: "2d6+5", type: "slashing" },
        { dice: "1d6", type: "lightning" },
      ]),
    );
  });

  it("falls back to one attack when a multiattack part is not an attack", () => {
    expect(profileMonster(monster("adult-red-dragon"))?.multiattack).toBeNull();
    expect(profileMonster(monster("bandit-captain"))?.multiattack).toBeNull();
  });

  it("leaves exactly the pinned attacks unrecognised", () => {
    const unrecognised = attackActions()
      .filter(({ action }) => recogniseAttack(action) === null)
      .map(({ key }) => key)
      .sort();
    expect(unrecognised).toEqual([...UNRECOGNISED].sort());
    expect(attackActions().length - unrecognised.length).toBe(496);
  });

  it("profiles 316 of the 334 monsters", () => {
    expect(MONSTERS).toHaveLength(334);
    expect(MONSTERS.filter((m) => profileMonster(m) !== null)).toHaveLength(316);
  });

  it("resolves multiattack for the measured monsters", () => {
    // 83, not the 85 first measured: that measurement did not check `count`.
    // The hydra ("Number of Heads") and the violet fungus ("1d4") attack a
    // variable number of times, which no fixed plan can represent, so both
    // fall back to a single attack like any other unresolvable multiattack.
    const withPlan = MONSTERS.filter((m) => profileMonster(m)?.multiattack != null);
    expect(withPlan).toHaveLength(83);
    expect(profileMonster(monster("hydra"))?.multiattack).toBeNull();
    expect(profileMonster(monster("violet-fungus"))?.multiattack).toBeNull();
  });

  it("holds no range or walk entry the data does not use", () => {
    const usedRanges = new Set<string>();
    const usedWalks = new Set<string>();
    for (const m of MONSTERS) {
      const profile = profileMonster(m);
      const walk = (m.speed as { walk?: unknown } | undefined)?.walk;
      if (typeof walk === "string") usedWalks.add(walk);
      for (const a of profile?.attacks ?? []) {
        if (a.ranged) {
          usedRanges.add(a.ranged.longFt === null ? `${a.ranged.normalFt}` : `${a.ranged.normalFt}/${a.ranged.longFt}`);
        }
      }
    }
    expect([...RECOGNISED_RANGES.keys()].filter((k) => !usedRanges.has(k))).toEqual([]);
    expect([...RECOGNISED_WALK_SPEEDS.keys()].filter((k) => !usedWalks.has(k))).toEqual([]);
  });

  it("refuses a reach of 0 even under a clean header", () => {
    // Every reach-0 attack in the SRD also fails on its header ("in the
    // swarm's space"), so the data alone never exercises this rule. A synthetic
    // action keeps it covered: footprints never overlap on the grid.
    expect(
      recogniseAttack({
        name: "Engulf",
        attack_bonus: 3,
        desc: "Melee Weapon Attack: +3 to hit, reach 0 ft., one target. Hit: 5 (1d6 + 2) bludgeoning damage.",
        damage: [{ damage_type: { index: "bludgeoning" }, damage_dice: "1d6+2" }],
      }),
    ).toBeNull();
  });

  it("averages dice and flat damage", () => {
    expect(averageDamage("1d6+2")).toBe(5.5);
    expect(averageDamage("2d6")).toBe(7);
    expect(averageDamage("1")).toBe(1);
  });

  it("accepts every produced profile and rejects malformed ones", () => {
    for (const m of MONSTERS) {
      const profile = profileMonster(m);
      if (profile) expect(isMonsterAttackProfile(profile)).toBe(true);
    }
    expect(isMonsterAttackProfile(null)).toBe(false);
    expect(isMonsterAttackProfile({ version: 2, walkSpeedFt: 30, attacks: [], multiattack: null })).toBe(false);
    expect(isMonsterAttackProfile({ version: 1, walkSpeedFt: 30, attacks: [], multiattack: null })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm exec vitest run tests/rules/monster-attack-profile.test.ts --maxWorkers=2`
Expected: FAIL, because `@/lib/rules/monster-attack-profile` does not resolve.

- [ ] **Step 3: Implement the module**

```ts
// lib/rules/monster-attack-profile.ts
/**
 * The SRD monster attacks this engine can resolve, recognised verbatim.
 *
 * @pure — no database, no I/O, no randomness, and never throws.
 *
 * The same discipline as damage-clauses.ts: exact header templates whose only
 * variable slots take measured values. An unseen wording is not parsed; it is
 * simply not an attack this engine resolves. Measured over the 334 monsters
 * in data/srd-es/monsters.json (spec §4): 496 attacks recognised, 39 not, and
 * 316 monsters carry a profile.
 */
import { DAMAGE_TYPES, type DamageType } from "@/lib/rules/damage-modifiers";

export interface ProfiledDamage {
  /** "XdY±Z" (dice.ts notation) or a bare integer for flat damage. */
  dice: string;
  type: DamageType;
}

export interface ProfiledAttack {
  name: string;
  attackBonus: number;
  melee: { reachFt: number } | null;
  ranged: { normalFt: number; longFt: number | null } | null;
  damage: ProfiledDamage[];
}

export interface MultiattackPart {
  attack: string;
  count: number;
}

export interface MonsterAttackProfileV1 {
  version: 1;
  walkSpeedFt: number;
  attacks: ProfiledAttack[];
  multiattack: MultiattackPart[] | null;
}

type HeaderMode = "melee" | "ranged" | "both";

export const RECOGNISED_ATTACK_HEADERS: ReadonlyArray<{ mode: HeaderMode; template: string }> = [
  { mode: "melee", template: "Melee Weapon Attack: +{b} to hit, reach {r} ft., one target." },
  { mode: "melee", template: "Melee Weapon Attack: +{b} to hit, reach {r} ft., one creature." },
  { mode: "ranged", template: "Ranged Weapon Attack: +{b} to hit, range {rng} ft., one target." },
  { mode: "both", template: "Melee or Ranged Weapon Attack: +{b} to hit, reach {r} ft. or range {rng} ft., one target." },
  { mode: "melee", template: "Melee Spell Attack: +{b} to hit, reach {r} ft., one creature." },
  { mode: "ranged", template: "Ranged Spell Attack: +{b} to hit, range {rng} ft., one target." },
  { mode: "ranged", template: "Ranged Weapon Attack: +{b} to hit, range {rng} ft., one creature." },
  { mode: "both", template: "Melee or Ranged Weapon Attack: +{b} to hit, reach {r} ft. or range {rng} ft., one creature." },
];

/** Reach 0 is excluded: footprints never overlap on the grid (spec §4.2). */
export const RECOGNISED_REACH_FT: readonly number[] = [5, 10, 15, 20, 30, 50];

export const RECOGNISED_RANGES: ReadonlyMap<string, { normalFt: number; longFt: number | null }> =
  new Map([
    ["20/60", { normalFt: 20, longFt: 60 }],
    ["25/50", { normalFt: 25, longFt: 50 }],
    ["30/120", { normalFt: 30, longFt: 120 }],
    ["40/160", { normalFt: 40, longFt: 160 }],
    ["50/100", { normalFt: 50, longFt: 100 }],
    ["60/180", { normalFt: 60, longFt: 180 }],
    ["60/240", { normalFt: 60, longFt: 240 }],
    ["80/320", { normalFt: 80, longFt: 320 }],
    ["100/200", { normalFt: 100, longFt: 200 }],
    ["100/400", { normalFt: 100, longFt: 400 }],
    ["120", { normalFt: 120, longFt: null }],
    ["150", { normalFt: 150, longFt: null }],
    ["150/600", { normalFt: 150, longFt: 600 }],
  ]);

export const RECOGNISED_WALK_SPEEDS: ReadonlyMap<string, number> = new Map([
  ["0 ft.", 0], ["5 ft.", 5], ["10 ft.", 10], ["15 ft.", 15], ["20 ft.", 20],
  ["25 ft.", 25], ["30 ft.", 30], ["40 ft.", 40], ["50 ft.", 50], ["60 ft.", 60],
]);

/** dice.ts NOTATION_RE. */
const DICE_NOTATION = /^(\d+)?d(\d+)([+-]\d+)?$/i;
const FLAT_DAMAGE = /^\d+$/;

function slotPattern(template: string): RegExp {
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^${escaped
      .replace("\\{b\\}", "(?<b>\\d+)")
      .replace("\\{r\\}", "(?<r>\\d+)")
      .replace("\\{rng\\}", "(?<rng>\\d+(?:/\\d+)?)")}$`,
  );
}

const HEADERS = RECOGNISED_ATTACK_HEADERS.map((h) => ({ mode: h.mode, pattern: slotPattern(h.template) }));

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function averageDamage(dice: string): number {
  if (FLAT_DAMAGE.test(dice)) return Number(dice);
  const match = DICE_NOTATION.exec(dice);
  if (!match) return 0;
  const count = match[1] ? Number(match[1]) : 1;
  const faces = Number(match[2]);
  const modifier = match[3] ? Number(match[3]) : 0;
  return (count * (faces + 1)) / 2 + modifier;
}

function damageEntry(raw: unknown): ProfiledDamage | null {
  const entry = asRecord(raw);
  if (!entry) return null;

  if ("choose" in entry) {
    if (entry.choose !== 1) return null;
    const options = asRecord(entry.from)?.options;
    if (!Array.isArray(options) || options.length === 0) return null;
    const parsed = options.map(damageEntry);
    if (parsed.some((option) => option === null)) return null;
    // Lowest average never overstates damage; ties break by type name.
    return [...(parsed as ProfiledDamage[])].sort(
      (a, b) => averageDamage(a.dice) - averageDamage(b.dice) || a.type.localeCompare(b.type),
    )[0]!;
  }

  const dice = typeof entry.damage_dice === "string" ? entry.damage_dice.trim() : "";
  const type = asRecord(entry.damage_type)?.index;
  if (!(DICE_NOTATION.test(dice) || FLAT_DAMAGE.test(dice))) return null;
  if (typeof type !== "string" || !(DAMAGE_TYPES as readonly string[]).includes(type)) return null;
  return { dice, type: type as DamageType };
}

export function recogniseAttack(action: unknown): ProfiledAttack | null {
  const a = asRecord(action);
  if (!a || typeof a.name !== "string" || typeof a.attack_bonus !== "number" || typeof a.desc !== "string") {
    return null;
  }
  const header = a.desc.split(" Hit:")[0]!.trim();

  for (const { mode, pattern } of HEADERS) {
    const groups = pattern.exec(header)?.groups;
    if (!groups) continue;
    if (Number(groups.b) !== a.attack_bonus) return null;

    let melee: ProfiledAttack["melee"] = null;
    let ranged: ProfiledAttack["ranged"] = null;
    if (mode !== "ranged") {
      const reachFt = Number(groups.r);
      if (!RECOGNISED_REACH_FT.includes(reachFt)) return null;
      melee = { reachFt };
    }
    if (mode !== "melee") {
      const range = RECOGNISED_RANGES.get(groups.rng ?? "");
      if (!range) return null;
      ranged = { ...range };
    }

    if (!Array.isArray(a.damage) || a.damage.length === 0) return null;
    const damage = a.damage.map(damageEntry);
    if (damage.some((d) => d === null)) return null;

    return { name: a.name, attackBonus: a.attack_bonus, melee, ranged, damage: damage as ProfiledDamage[] };
  }
  return null;
}

function resolveMultiattack(actions: unknown[], attacks: ProfiledAttack[]): MultiattackPart[] | null {
  const names = new Set(attacks.map((a) => a.name));
  for (const raw of actions) {
    const action = asRecord(raw);
    if (!action || typeof action.name !== "string") continue;
    if (!action.name.toLowerCase().startsWith("multiattack")) continue;
    if (action.action_options !== undefined) continue;
    if (!Array.isArray(action.actions) || action.actions.length === 0) continue;

    const parts: MultiattackPart[] = [];
    let resolvable = true;
    for (const rawPart of action.actions) {
      const part = asRecord(rawPart);
      const count = Number(part?.count);
      if (!part || typeof part.action_name !== "string" || !names.has(part.action_name) || !Number.isInteger(count) || count < 1) {
        resolvable = false;
        break;
      }
      parts.push({ attack: part.action_name, count });
    }
    if (resolvable) return parts;
  }
  return null;
}

export function profileMonster(monster: unknown): MonsterAttackProfileV1 | null {
  const m = asRecord(monster);
  const actions = Array.isArray(m?.actions) ? (m!.actions as unknown[]) : [];
  const attacks = actions.map(recogniseAttack).filter((a): a is ProfiledAttack => a !== null);
  if (attacks.length === 0) return null;

  const walk = asRecord(m!.speed)?.walk;
  const walkSpeedFt = typeof walk === "string" ? (RECOGNISED_WALK_SPEEDS.get(walk) ?? 0) : 0;

  return { version: 1, walkSpeedFt, attacks, multiattack: resolveMultiattack(actions, attacks) };
}

function isProfiledAttack(value: unknown): value is ProfiledAttack {
  const a = asRecord(value);
  if (!a || typeof a.name !== "string" || typeof a.attackBonus !== "number") return false;
  const melee = a.melee === null || typeof asRecord(a.melee)?.reachFt === "number";
  const rangedRecord = asRecord(a.ranged);
  const ranged = a.ranged === null || typeof rangedRecord?.normalFt === "number";
  const damage =
    Array.isArray(a.damage) &&
    a.damage.length > 0 &&
    a.damage.every((d) => {
      const entry = asRecord(d);
      return typeof entry?.dice === "string" && (DAMAGE_TYPES as readonly string[]).includes(entry.type as string);
    });
  return melee && ranged && damage && (a.melee !== null || a.ranged !== null);
}

/** Shape guard for the persisted JSON column (spec §8: a malformed profile is an invariant failure). */
export function isMonsterAttackProfile(value: unknown): value is MonsterAttackProfileV1 {
  const v = asRecord(value);
  if (!v || v.version !== 1 || typeof v.walkSpeedFt !== "number") return false;
  if (!Array.isArray(v.attacks) || v.attacks.length === 0 || !v.attacks.every(isProfiledAttack)) return false;
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

- [ ] **Step 4: Run it and confirm it passes**

Run: `pnpm exec vitest run tests/rules/monster-attack-profile.test.ts --maxWorkers=2`
Expected: PASS, 13 tests. Stage 1 was executed on 2026-09-15 and corrected
two figures against the real module: 13 ranges, not 15, and 83 multiattacks,
not 85. Both are recorded in the test and in spec §4.

- [ ] **Step 5: Falsify**

Make each change below, run the test, see the named test fail, and restore.

| Change | Test that must fail |
| --- | --- |
| Add `0` to `RECOGNISED_REACH_FT` | "refuses a reach of 0 even under a clean header" (the data alone never catches it) |
| Replace the lowest-average sort with `[0]` of `options` unsorted, reversed | the guard spear test |
| Make `damageEntry` reject `FLAT_DAMAGE` | the flat-damage test and the pinned remainder |
| Delete the `"150"` range entry | the pinned remainder |

- [ ] **Step 6: Commit**

```bash
git add lib/rules/monster-attack-profile.ts tests/rules/monster-attack-profile.test.ts
git commit -m "feat(rules): recognise SRD monster attacks verbatim"
```

### Task 2: Plan one enemy turn

**Files:**
- Create: `lib/rules/enemy-turn.ts`
- Modify: `lib/rules/conditions.ts` (add `isIncapacitated` after
  `isUnawareOfSurroundings`, around line 277)
- Modify: `lib/rules/geometry.ts` (add `toSizeCategory`)
- Modify: `app/api/campaign/[id]/action/route.ts:105-116` (delete the local
  `VALID_SIZES` and `toSizeCategory`, and import them from geometry)
- Test: `tests/rules/enemy-turn.test.ts`

**Interfaces:**
- Consumes (Task 1): `MonsterAttackProfileV1`, `ProfiledAttack`,
  `averageDamage`.
- Consumes (geometry): `chebyshevSquares`, `isFootprintWithinCombatGrid`,
  `isOccupied`, `minFootprintDistanceFt`, `sizeToSquares`, `GridCombatant`,
  `GridPoint`.
- Produces:
  - `planEnemyTurn(input: EnemyTurnInput): EnemyTurnPlan`;
  - `EnemyTurnInput`, `EnemyTurnPlan`, `EnemyAttackMode`;
  - `isIncapacitated(conditions: readonly string[]): boolean`;
  - `toSizeCategory(raw: unknown): SizeCategory`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/rules/enemy-turn.test.ts
import { describe, expect, it } from "vitest";
import { planEnemyTurn, type EnemyTurnInput } from "@/lib/rules/enemy-turn";
import { isIncapacitated } from "@/lib/rules/conditions";
import { toSizeCategory, type GridCombatant } from "@/lib/rules/geometry";
import type { MonsterAttackProfileV1 } from "@/lib/rules/monster-attack-profile";

const GOBLIN: MonsterAttackProfileV1 = {
  version: 1,
  walkSpeedFt: 30,
  attacks: [
    { name: "Scimitar", attackBonus: 4, melee: { reachFt: 5 }, ranged: null, damage: [{ dice: "1d6+2", type: "slashing" }] },
    { name: "Shortbow", attackBonus: 4, melee: null, ranged: { normalFt: 80, longFt: 320 }, damage: [{ dice: "1d6+2", type: "piercing" }] },
  ],
  multiattack: null,
};
const BITER: MonsterAttackProfileV1 = {
  version: 1, walkSpeedFt: 30, multiattack: null,
  attacks: [{ name: "Bite", attackBonus: 4, melee: { reachFt: 5 }, ranged: null, damage: [{ dice: "2d4+2", type: "piercing" }] }],
};
const ARCHER: MonsterAttackProfileV1 = {
  version: 1, walkSpeedFt: 30, multiattack: null,
  attacks: [{ name: "Shortbow", attackBonus: 4, melee: null, ranged: { normalFt: 80, longFt: 320 }, damage: [{ dice: "1d6+2", type: "piercing" }] }],
};
const SLINGER: MonsterAttackProfileV1 = {
  version: 1, walkSpeedFt: 30, multiattack: null,
  attacks: [{ name: "Sling", attackBonus: 3, melee: null, ranged: { normalFt: 20, longFt: 60 }, damage: [{ dice: "1d4+1", type: "bludgeoning" }] }],
};
const BEAR: MonsterAttackProfileV1 = {
  version: 1, walkSpeedFt: 40,
  attacks: [
    { name: "Bite", attackBonus: 5, melee: { reachFt: 5 }, ranged: null, damage: [{ dice: "1d8+4", type: "piercing" }] },
    { name: "Claws", attackBonus: 5, melee: { reachFt: 5 }, ranged: null, damage: [{ dice: "2d6+4", type: "slashing" }] },
  ],
  multiattack: [{ attack: "Bite", count: 1 }, { attack: "Claws", count: 1 }],
};
const LASHER: MonsterAttackProfileV1 = {
  version: 1, walkSpeedFt: 30,
  attacks: [
    { name: "Bite", attackBonus: 5, melee: { reachFt: 5 }, ranged: null, damage: [{ dice: "1d10+3", type: "piercing" }] },
    { name: "Tail", attackBonus: 5, melee: { reachFt: 15 }, ranged: null, damage: [{ dice: "1d8+3", type: "bludgeoning" }] },
  ],
  multiattack: [{ attack: "Bite", count: 1 }, { attack: "Tail", count: 1 }],
};

function medium(id: string, x: number, y: number): GridCombatant {
  return { id, x, y, size: "Medium" };
}

function input(
  profile: MonsterAttackProfileV1 | null,
  at: { x: number; y: number },
  player: GridCombatant,
  extra: GridCombatant[] = [],
  overrides: Partial<EnemyTurnInput["enemy"]> = {},
): EnemyTurnInput {
  return {
    enemy: { id: "e1", x: at.x, y: at.y, size: "Medium", hp: 7, conditions: [], profile, ...overrides },
    player,
    others: [player, ...extra],
  };
}

describe("planEnemyTurn", () => {
  it("attacks in melee without moving when already in reach", () => {
    expect(planEnemyTurn(input(GOBLIN, { x: 5, y: 6 }, medium("p", 5, 5)))).toEqual({
      move: null, mode: "melee", attacks: ["Scimitar"],
    });
  });

  it("closes to the square that moves least, then strikes", () => {
    // Adjacent squares on row 6 cost 3 moves from (5,9); ties break by y, then x.
    expect(planEnemyTurn(input(GOBLIN, { x: 5, y: 9 }, medium("p", 5, 5)))).toEqual({
      move: { x: 4, y: 6 }, mode: "melee", attacks: ["Scimitar"],
    });
  });

  it("skips an occupied square", () => {
    expect(planEnemyTurn(input(GOBLIN, { x: 5, y: 9 }, medium("p", 5, 5), [medium("ally", 4, 6)]))).toEqual({
      move: { x: 5, y: 6 }, mode: "melee", attacks: ["Scimitar"],
    });
  });

  it("shoots from where it stands when melee is out of reach this turn", () => {
    expect(planEnemyTurn(input(GOBLIN, { x: 5, y: 9 }, medium("p", 5, 0)))).toEqual({
      move: null, mode: "ranged", attacks: ["Shortbow"],
    });
  });

  it("only moves when nothing is usable", () => {
    expect(planEnemyTurn(input(BITER, { x: 9, y: 9 }, medium("p", 0, 0)))).toEqual({
      move: { x: 3, y: 3 }, mode: null, attacks: [],
    });
  });

  it("advances into range, then shoots", () => {
    expect(planEnemyTurn(input(SLINGER, { x: 9, y: 0 }, medium("p", 0, 0)))).toEqual({
      move: { x: 3, y: 0 }, mode: "ranged", attacks: ["Sling"],
    });
  });

  it("does nothing as a ranged-only enemy adjacent to the player (known limitation)", () => {
    expect(planEnemyTurn(input(ARCHER, { x: 5, y: 6 }, medium("p", 5, 5)))).toEqual({
      move: null, mode: null, attacks: [],
    });
  });

  it("uses a multiattack when every part is usable", () => {
    expect(planEnemyTurn(input(BEAR, { x: 5, y: 6 }, medium("p", 5, 5)))).toEqual({
      move: null, mode: "melee", attacks: ["Bite", "Claws"],
    });
  });

  it("falls back to the best usable attack when a multiattack part is out of reach", () => {
    expect(planEnemyTurn(input(LASHER, { x: 5, y: 7 }, medium("p", 5, 5)))).toEqual({
      move: null, mode: "melee", attacks: ["Tail"],
    });
  });

  it("keeps a Large footprint inside the grid and moves it least", () => {
    const plan = planEnemyTurn({
      enemy: { id: "e1", x: 8, y: 8, size: "Large", hp: 30, conditions: [], profile: { ...BITER, walkSpeedFt: 40 } },
      player: medium("p", 0, 0),
      others: [medium("p", 0, 0)],
    });
    expect(plan).toEqual({ move: { x: 1, y: 1 }, mode: "melee", attacks: ["Bite"] });
  });

  it.each([
    ["at 0 HP", { hp: 0 }],
    ["incapacitated", { conditions: ["Stunned"] }],
  ])("skips an enemy %s", (_label, overrides) => {
    expect(planEnemyTurn(input(GOBLIN, { x: 5, y: 6 }, medium("p", 5, 5), [], overrides))).toEqual({
      move: null, mode: null, attacks: [],
    });
  });

  it("skips an enemy with no profile", () => {
    expect(planEnemyTurn(input(null, { x: 5, y: 6 }, medium("p", 5, 5)))).toEqual({
      move: null, mode: null, attacks: [],
    });
  });
});

describe("isIncapacitated", () => {
  it("reads the registry flag case-insensitively", () => {
    expect(isIncapacitated(["stunned"])).toBe(true);
    expect(isIncapacitated(["Paralyzed"])).toBe(true);
    expect(isIncapacitated(["Prone", "Poisoned"])).toBe(false);
  });
});

describe("toSizeCategory", () => {
  it("keeps a known size and degrades anything else to Medium", () => {
    expect(toSizeCategory("Large")).toBe("Large");
    expect(toSizeCategory("huge")).toBe("Medium");
    expect(toSizeCategory(undefined)).toBe("Medium");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm exec vitest run tests/rules/enemy-turn.test.ts --maxWorkers=2`
Expected: FAIL, because `@/lib/rules/enemy-turn` does not resolve and
`isIncapacitated` and `toSizeCategory` are not exported.

- [ ] **Step 3: Add `isIncapacitated` to `lib/rules/conditions.ts`**, after
  `isUnawareOfSurroundings`:

```ts
/**
 * Whether any active condition bars actions (the registry's `incapacitated`
 * flag). An enemy for which this is true takes no turn (enemy-turns spec §5.1).
 */
export function isIncapacitated(conditions: readonly string[]): boolean {
  return conditions.some(
    (condId) => CONDITION_REGISTRY[condId.toLowerCase()]?.incapacitated === true
  );
}
```

- [ ] **Step 4: Move `toSizeCategory` into `lib/rules/geometry.ts`**, after
  `sizeToSquares`, and delete the route's copy (`route.ts:105-116`, both
  `VALID_SIZES` and the function). Add `toSizeCategory` to the route's existing
  `@/lib/rules/geometry` import (line 63).

```ts
const VALID_SIZES: readonly SizeCategory[] = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"]

/**
 * The column is a plain string, so an unrecognised value degrades to Medium
 * rather than throwing: a malformed row resolves as an ordinary creature, not
 * a failed turn. Shared by the Move gate, the spell gate and the enemy planner
 * so they cannot disagree about how big a creature is.
 */
export function toSizeCategory(raw: unknown): SizeCategory {
  return VALID_SIZES.includes(raw as SizeCategory) ? (raw as SizeCategory) : "Medium"
}
```

- [ ] **Step 5: Implement `lib/rules/enemy-turn.ts`**

```ts
/**
 * One enemy's turn, planned: move, then attack the player (spec §5).
 *
 * @pure — no database, no dice, never throws.
 */
import {
  chebyshevSquares,
  isFootprintWithinCombatGrid,
  isOccupied,
  minFootprintDistanceFt,
  sizeToSquares,
  type GridCombatant,
  type GridPoint,
} from "@/lib/rules/geometry";
import { isIncapacitated } from "@/lib/rules/conditions";
import {
  averageDamage,
  type MonsterAttackProfileV1,
  type ProfiledAttack,
} from "@/lib/rules/monster-attack-profile";

export type EnemyAttackMode = "melee" | "ranged";

export interface EnemyTurnInput {
  enemy: GridCombatant & {
    hp: number;
    conditions: readonly string[];
    profile: MonsterAttackProfileV1 | null;
  };
  player: GridCombatant;
  /** Every combatant except the acting enemy, the player included. */
  others: readonly GridCombatant[];
}

export interface EnemyTurnPlan {
  move: GridPoint | null;
  mode: EnemyAttackMode | null;
  /** Attack names in resolution order, multiattack parts expanded by count. */
  attacks: string[];
}

function noAction(): EnemyTurnPlan {
  return { move: null, mode: null, attacks: [] };
}

function usable(attack: ProfiledAttack, from: GridCombatant, player: GridCombatant, mode: EnemyAttackMode): boolean {
  const distance = minFootprintDistanceFt(from, player);
  if (mode === "melee") return attack.melee !== null && distance <= attack.melee.reachFt;
  // Never adjacent, never at long range (spec §3, "Out").
  return attack.ranged !== null && distance > 5 && distance <= attack.ranged.normalFt;
}

function totalAverage(attack: ProfiledAttack): number {
  return attack.damage.reduce((sum, d) => sum + averageDamage(d.dice), 0);
}

function chooseAttacks(
  profile: MonsterAttackProfileV1,
  from: GridCombatant,
  player: GridCombatant,
  mode: EnemyAttackMode,
): string[] {
  const candidates = profile.attacks.filter((a) => usable(a, from, player, mode));
  if (candidates.length === 0) return [];

  const usableNames = new Set(candidates.map((a) => a.name));
  if (profile.multiattack && profile.multiattack.every((part) => usableNames.has(part.attack))) {
    return profile.multiattack.flatMap((part) => Array<string>(part.count).fill(part.attack));
  }

  const best = [...candidates].sort(
    (a, b) => totalAverage(b) - totalAverage(a) || a.name.localeCompare(b.name),
  )[0]!;
  return [best.name];
}

type DestinationKey = [distanceFt: number, squaresMoved: number, y: number, x: number];

function isBefore(a: DestinationKey, b: DestinationKey): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i]! < b[i]!;
  }
  return false;
}

function bestDestination(input: EnemyTurnInput): GridPoint {
  const { enemy, player, others } = input;
  const reach = Math.floor((enemy.profile?.walkSpeedFt ?? 0) / 5);
  const side = sizeToSquares(enemy.size);
  const occupants = [...others];

  let best: GridPoint = { x: enemy.x, y: enemy.y };
  let bestKey: DestinationKey = [minFootprintDistanceFt(enemy, player), 0, enemy.y, enemy.x];

  for (let y = enemy.y - reach; y <= enemy.y + reach; y++) {
    for (let x = enemy.x - reach; x <= enemy.x + reach; x++) {
      if (x === enemy.x && y === enemy.y) continue;
      const anchor = { x, y };
      if (!isFootprintWithinCombatGrid(anchor, enemy.size)) continue;

      let free = true;
      for (let dy = 0; dy < side && free; dy++) {
        for (let dx = 0; dx < side && free; dx++) {
          if (isOccupied({ x: x + dx, y: y + dy }, occupants)) free = false;
        }
      }
      if (!free) continue;

      const key: DestinationKey = [
        minFootprintDistanceFt({ ...enemy, x, y }, player),
        chebyshevSquares(anchor, enemy),
        y,
        x,
      ];
      if (isBefore(key, bestKey)) {
        best = anchor;
        bestKey = key;
      }
    }
  }
  return best;
}

export function planEnemyTurn(input: EnemyTurnInput): EnemyTurnPlan {
  const { enemy, player } = input;
  const profile = enemy.profile;
  if (enemy.hp <= 0 || profile === null || isIncapacitated(enemy.conditions)) return noAction();

  // 1. Melee from here.
  const meleeHere = chooseAttacks(profile, enemy, player, "melee");
  if (meleeHere.length > 0) return { move: null, mode: "melee", attacks: meleeHere };

  // 2. Close and strike.
  const destination = bestDestination(input);
  const moved = destination.x !== enemy.x || destination.y !== enemy.y;
  const atDestination = { ...enemy, x: destination.x, y: destination.y };
  const meleeThere = chooseAttacks(profile, atDestination, player, "melee");
  if (moved && meleeThere.length > 0) return { move: destination, mode: "melee", attacks: meleeThere };

  // 3. Shoot from here.
  const rangedHere = chooseAttacks(profile, enemy, player, "ranged");
  if (rangedHere.length > 0) return { move: null, mode: "ranged", attacks: rangedHere };

  // 4. Advance, and shoot if that brings the player into range.
  if (moved) {
    const rangedThere = chooseAttacks(profile, atDestination, player, "ranged");
    return rangedThere.length > 0
      ? { move: destination, mode: "ranged", attacks: rangedThere }
      : { move: destination, mode: null, attacks: [] };
  }

  // 5. Nothing.
  return noAction();
}
```

- [ ] **Step 6: Run the new tests, then the files that touch the moved size
  helper**

Run: `pnpm exec vitest run tests/rules/enemy-turn.test.ts tests/rules/geometry.test.ts tests/api/action-move-macro.test.ts --maxWorkers=2`
Expected: PASS. Then run `pnpm typecheck`. Expected: 0 errors.

- [ ] **Step 7: Falsify**

Make each change below, run the test, see the named test fail, and restore.

| Change | Test that must fail |
| --- | --- |
| Drop `squaresMoved` from `DestinationKey` | "closes to the square that moves least" |
| Change `distance > 5` to `distance >= 5` | "does nothing as a ranged-only enemy adjacent" |
| Remove the `isIncapacitated` check | the incapacitated skip test |

- [ ] **Step 8: Commit, then run the Stage 1 validation**

```bash
git add lib/rules/enemy-turn.ts lib/rules/conditions.ts lib/rules/geometry.ts "app/api/campaign/[id]/action/route.ts" tests/rules/enemy-turn.test.ts
git commit -m "feat(rules): plan an enemy's move-then-attack turn"
```

Then run `pnpm exec vitest run --maxWorkers=2`, `pnpm typecheck` and
`pnpm check-retro`. With the maintainer's go-ahead, push, open the PR
"feat(rules): monster attack profiles and enemy turn planner (enemy turns 1/3)",
wait for green, squash-merge, and sync `master`.

---

# Stage 2 — One write path for the player's HP

**Branch:** `claude/enemy-turns-2-player-hp`. **Schema impact:** none.
**Behaviour change in the game:** the player's `Combatant.hp` now follows
`Character.hp` through in-combat healing and self-inflicted area damage. This
fixes the drift described in spec §2.

### Task 3: `setPlayerHp`, the shared `Character` lock, and the item-use lock

**Files:**
- Create: `lib/db/character-lock.ts`, `lib/db/player-hp.ts`
- Modify: `app/api/campaign/[id]/action/route.ts`:
  - delete the local `lockCharacterForCombatAction` (lines 142-163) and
    import it;
  - add the lock at the start of the item-use transaction (line 1576).
- Modify: `lib/rules/combat-pipeline.ts`:
  - `applyCharacterHealing` (line 237) and its two callers (lines 467 and 481);
  - the target HP write block (lines 713-730).
- Modify: `tests/rules/combat-pipeline-fixtures.ts` (add `combatant.updateMany`)
- Test: `tests/db/player-hp.test.ts` (new), `tests/rules/combat-pipeline.test.ts`,
  `tests/architecture/player-turn-spending-actions.test.ts`

**Interfaces:**
- Produces:
  - `lockCharacterForCombatAction(tx: Prisma.TransactionClient, characterId: string): Promise<void>`;
  - `setPlayerHp(tx, input: { characterId: string; encounterId: string | null; hp: number }): Promise<number>`,
    which returns the clamped HP written;
  - `mirrorPlayerCombatantHp(tx, encounterId: string | null, hp: number): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/db/player-hp.test.ts
import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { mirrorPlayerCombatantHp, setPlayerHp } from "@/lib/db/player-hp";

function tx() {
  return {
    character: { update: vi.fn().mockResolvedValue({}) },
    combatant: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  } as unknown as Prisma.TransactionClient;
}

describe("setPlayerHp", () => {
  it("writes Character first, then mirrors the player's Combatant", async () => {
    const t = tx();
    await expect(setPlayerHp(t, { characterId: "char-1", encounterId: "enc-1", hp: 7 })).resolves.toBe(7);
    expect(t.character.update).toHaveBeenCalledWith({ where: { id: "char-1" }, data: { hp: 7 } });
    expect(t.combatant.updateMany).toHaveBeenCalledWith({
      where: { encounterId: "enc-1", isPlayer: true },
      data: { hp: 7 },
    });
    const characterOrder = (t.character.update as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    const combatantOrder = (t.combatant.updateMany as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    expect(characterOrder).toBeLessThan(combatantOrder);
  });

  it("clamps below zero and skips the mirror outside an encounter", async () => {
    const t = tx();
    await expect(setPlayerHp(t, { characterId: "char-1", encounterId: null, hp: -4 })).resolves.toBe(0);
    expect(t.character.update).toHaveBeenCalledWith({ where: { id: "char-1" }, data: { hp: 0 } });
    expect(t.combatant.updateMany).not.toHaveBeenCalled();
  });

  it("mirrors nothing without an encounter", async () => {
    const t = tx();
    await mirrorPlayerCombatantHp(t, null, 5);
    expect(t.combatant.updateMany).not.toHaveBeenCalled();
  });
});
```

Add these two tests to `tests/rules/combat-pipeline.test.ts`, inside a new
`describe("player HP single write path", ...)`. First give the fixture's
`combatant` (`tests/rules/combat-pipeline-fixtures.ts:44-47`) an
`updateMany: vi.fn().mockResolvedValue({ count: 1 })`.

```ts
  describe("player HP single write path", () => {
    it("mirrors in-combat item healing onto the player's Combatant", async () => {
      const tx = buildMockTx({ characterHp: 10, characterMaxHp: 20 });
      mockRandom([0.5, 0.5]);

      const outcome = await executeCombatAction({
        actionType: "use_item",
        encounter: buildEncounter([buildPlayer({ hp: 10 }), buildEnemy()]),
        actorId: "player-1",
        actorName: "Aldric",
        actorConditions: [],
        targetCombatants: [],
        itemId: "item-1",
        itemName: "Potion of Healing",
        healingDice: "2d4",
        healingBonus: 2,
        playerCharacterId: "char-1",
        collectEvents: true,
      }, tx);

      const healed = outcome.events.find((e) => e.type === "HEALING_RECEIVED");
      expect(healed).toBeDefined();
      const newHp = (healed!.payload as { newHp: number }).newHp;
      expect(tx.combatant.updateMany).toHaveBeenCalledWith({
        where: { encounterId: "enc-1", isPlayer: true },
        data: { hp: newHp },
      });
    });

    it("writes Character when the player is caught in their own area spell", async () => {
      const tx = buildMockTx({ characterHp: 20, characterMaxHp: 20 });
      mockRandom([0.95, 0.5, 0.5, 0.5]);
      const player = buildPlayer({ hp: 20 });

      const outcome = await executeCombatAction({
        actionType: "cast_spell",
        encounter: buildEncounter([player, buildEnemy()]),
        actorId: "player-1",
        actorName: "Aldric",
        actorConditions: [],
        targetCombatants: [player],
        spellName: "Burning Hands",
        spellLevel: 1,
        spellEffect: { type: "damage", dice: "3d6", damageType: "fire", hasSavingThrow: false },
        rawSpellSlots: { "1": { current: 2, max: 4 } },
        playerCharacterId: "char-1",
        collectEvents: true,
      }, tx);

      const hpAfter = outcome.consequences[0]!.hpAfter;
      expect(tx.character.update).toHaveBeenCalledWith({ where: { id: "char-1" }, data: { hp: hpAfter } });
    });
  });
```

Add this test to `tests/architecture/player-turn-spending-actions.test.ts`,
inside the existing `describe`:

```ts
  it("takes the Character lock before resolving a combat item", () => {
    const source = branchSource(TURN_ENDING_BRANCHES.find((b) => b.label === "combat item")!);
    const lock = source.indexOf("lockCharacterForCombatAction(");
    const resolve = source.indexOf("executeCombatAction(");
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(resolve);
  });
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm exec vitest run tests/db/player-hp.test.ts tests/rules/combat-pipeline.test.ts tests/architecture/player-turn-spending-actions.test.ts --maxWorkers=2`
Expected: FAIL.
- `player-hp` does not resolve.
- The mirror and the Character write were never called.
- The item branch has no lock.

- [ ] **Step 3: Create `lib/db/character-lock.ts`.** Move the function
  unchanged, with its comment, from `route.ts:142-163`:

```ts
import type { Prisma } from "@prisma/client";

/**
 * A damaging action can update Combatant and then certify a victory whose XP
 * award updates Character in `finalizeEncounterTurn`. Actions that do not
 * already claim a spell slot or start concentration take this lock first, so
 * every transaction that can write both rows follows Character → Combatant.
 *
 * Reduced route-test doubles may omit Prisma's raw-query surface. Production
 * transactions always expose it and therefore always take this lock.
 */
export async function lockCharacterForCombatAction(
  tx: Prisma.TransactionClient,
  characterId: string
): Promise<void> {
  if (typeof tx.$queryRaw !== "function") return;

  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Character"
    WHERE "id" = ${characterId}
    FOR UPDATE
  `;
}
```

In the route, delete the local definition and add
`import { lockCharacterForCombatAction } from "@/lib/db/character-lock";`.

- [ ] **Step 4: Create `lib/db/player-hp.ts`**

```ts
import type { Prisma } from "@prisma/client";

/**
 * The player's HP has one source of truth, Character.hp; the player's
 * Combatant row in an active encounter is its mirror. resolveEncounterEnd
 * reads the mirror, so the two must never diverge (enemy-turns spec §6.3).
 */
export async function mirrorPlayerCombatantHp(
  tx: Prisma.TransactionClient,
  encounterId: string | null,
  hp: number
): Promise<void> {
  if (!encounterId) return;
  await tx.combatant.updateMany({
    where: { encounterId, isPlayer: true },
    data: { hp },
  });
}

/**
 * Writes the player's HP, then its mirror, in lock order (Character →
 * Combatant). The caller must already hold the Character row lock
 * (lockCharacterForCombatAction). Returns the value written, clamped at 0.
 */
export async function setPlayerHp(
  tx: Prisma.TransactionClient,
  input: { characterId: string; encounterId: string | null; hp: number }
): Promise<number> {
  const hp = Math.max(0, Math.trunc(input.hp));
  await tx.character.update({ where: { id: input.characterId }, data: { hp } });
  await mirrorPlayerCombatantHp(tx, input.encounterId, hp);
  return hp;
}
```

- [ ] **Step 5: Make healing mirror.** In `lib/rules/combat-pipeline.ts`:
  1. Add `import { mirrorPlayerCombatantHp, setPlayerHp } from "@/lib/db/player-hp";`.
  2. Give `applyCharacterHealing` a fourth parameter,
     `encounterId: string | null`.
  3. In both branches, call
     `await mirrorPlayerCombatantHp(tx, encounterId, newHp);` after the
     successful write and before `return newHp;`. In the CAS loop that means
     inside `if (claim.count === 1)`. Healing keeps its compare-and-set; spec
     §6.3 and DC-PLAN-009 require it.
  4. Update both callers to
     `applyCharacterHealing(tx, playerCharacterId, healed, encounter.id || null)`.

- [ ] **Step 6: Make self-inflicted damage write Character.** In the target HP
  write block, after `newHp` is settled (after the `if (persistedHp < 0) { … }
  else { newHp = persistedHp; }` at lines 718-730), add:

```ts
      // The player's HP has one source of truth; this Combatant row is its
      // mirror. The spell path took the Character lock at transaction start.
      if (target.isPlayer && playerCharacterId) {
        newHp = await setPlayerHp(tx, {
          characterId: playerCharacterId,
          encounterId: encounter.id || null,
          hp: newHp,
        });
      }
```

- [ ] **Step 7: Lock before resolving a combat item.** In the route's item
  branch, make this the first statement inside
  `prisma.$transaction(async (tx) => {` (line 1576), before `executeCombatAction`:

```ts
          await lockCharacterForCombatAction(transactionClient, context.character.id);
```

- [ ] **Step 8: Run the focused tests and the healing race**

Run: `pnpm exec vitest run tests/db/player-hp.test.ts tests/rules/combat-pipeline.test.ts tests/architecture/player-turn-spending-actions.test.ts --maxWorkers=2`
Expected: PASS.

Then, against the disposable E2E database only:

```powershell
$env:E2E_TEST_MODE="true"; pnpm exec playwright test tests/e2e/character-healing-concurrency.spec.ts tests/e2e/consumable-concurrency.spec.ts
```

Expected: PASS, with DC-PLAN-009's guarantee unchanged.

- [ ] **Step 9: Falsify**

Make each change below, run the test, see the named test fail, and restore.

| Change | Test that must fail |
| --- | --- |
| Comment out the mirror call in the CAS branch of `applyCharacterHealing` | the item-healing test |
| Remove the `setPlayerHp` block | the area-spell test |
| Move the item lock after `executeCombatAction` | the architecture test |

- [ ] **Step 10: Commit and run the stage validation**

```bash
git add lib/db/character-lock.ts lib/db/player-hp.ts lib/rules/combat-pipeline.ts "app/api/campaign/[id]/action/route.ts" tests/db/player-hp.test.ts tests/rules/combat-pipeline.test.ts tests/rules/combat-pipeline-fixtures.ts tests/architecture/player-turn-spending-actions.test.ts
git commit -m "fix(combat): write the player's HP through one path and mirror it"
```

Then run `pnpm exec vitest run --maxWorkers=2`, `pnpm typecheck`, `pnpm build`
and `pnpm test:e2e:smoke`. With the go-ahead: push, open the PR "fix(combat):
one write path for the player's HP (enemy turns 2/3)", wait for green,
squash-merge, and sync `master`.

---

# Stage 3 — The enemy-turn chain

**Branch:** `claude/enemy-turns-3-chain`.
**Schema impact:** adds `Combatant.attackProfile JSONB`, nullable, no default.
**Deploy ordering:** apply the migration, **then** deploy (spec §7).
**Behaviour change:** enemies act, and combat no longer parks on an enemy
slot.

### Task 4: The column and its only writer

**Files:**
- Modify: `prisma/schema.prisma` (add the field after `xpValue`, around line 334)
- Create: `prisma/migrations/20260915120000_add_combatant_attack_profile/migration.sql`
- Modify: `app/api/campaign/[id]/encounter/route.ts` (the `resolvedEnemies`
  map at lines 107-136 and the enemy row at lines 235-248)
- Test: `tests/e2e/enemy-attack-profile.spec.ts` (new, `@smoke`)

**Interfaces:**
- Consumes (Task 1): `profileMonster`.
- Produces: `Combatant.attackProfile` (Prisma `Json?`), written only by the
  encounter route.

- [ ] **Step 1: Write the failing E2E**

```ts
// tests/e2e/enemy-attack-profile.spec.ts
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { profileMonster } from "@/lib/rules/monster-attack-profile";
import { assertSafeE2EDatabase, cleanupE2ERecords, type E2ECreatedRecords } from "./support/database";

const GOBLIN = (JSON.parse(
  readFileSync(join(process.cwd(), "data", "srd-es", "monsters.json"), "utf8"),
) as Array<Record<string, unknown>>).find((m) => m.index === "goblin")!;

async function createdId(response: { status(): number; json(): Promise<unknown> }): Promise<string> {
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { id?: unknown };
  expect(typeof body.id).toBe("string");
  return body.id as string;
}

test("@smoke the encounter route snapshots a recognised goblin's attack profile", async ({ request }) => {
  assertSafeE2EDatabase();
  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 8);
  const monsterId = `e2e-goblin-${suffix}`;

  try {
    // CI does not seed the SRD: this spec brings its own row.
    await prisma.srdMonster.create({
      data: { id: monsterId, name: "Goblin", indexSlug: monsterId, data: GOBLIN as object },
    });
    created.characterId = await createdId(await request.post("/api/character", {
      data: { name: `Profile ${suffix}`, race: "human", class: "fighter",
        stats: { STR: 16, DEX: 14, CON: 14, INT: 10, WIS: 12, CHA: 8 } },
    }));
    created.campaignId = await createdId(await request.post("/api/campaign", {
      data: { characterId: created.characterId, title: `Profile ${suffix}` },
    }));

    const response = await request.post(`/api/campaign/${created.campaignId}/encounter`, {
      data: { enemies: [{ name: "Goblin", hp: 7, maxHp: 7, dexModifier: 2, monsterIndex: monsterId }] },
    });
    expect(response.status()).toBe(201);

    const rows = await prisma.combatant.findMany({
      where: { encounter: { campaignId: created.campaignId } },
      select: { isPlayer: true, attackProfile: true },
    });
    expect(rows.find((r) => !r.isPlayer)?.attackProfile).toEqual(profileMonster(GOBLIN));
    expect(rows.find((r) => r.isPlayer)?.attackProfile).toBeNull();
  } finally {
    await cleanupE2ERecords(prisma, created);
    await prisma.srdMonster.deleteMany({ where: { id: monsterId } });
    await prisma.$disconnect();
  }
});
```

Before relying on `cleanupE2ERecords(prisma, created)`, check its signature
at `tests/e2e/support/database.ts:72` and match the argument order the
neighbouring specs use.

- [ ] **Step 2: Add the field and the migration**

In `prisma/schema.prisma`, inside `model Combatant`, after `xpValue`:

```prisma
  /// Recognised SRD attacks, walk speed and multiattack plan, snapshotted once
  /// at encounter creation (docs/superpowers/specs/2026-09-15-enemy-turns-design.md §4).
  /// NULL = no recognised attack, or a row older than this column: the enemy's
  /// turn is skipped. Never written from the request body or from narration.
  attackProfile        Json?
```

`prisma/migrations/20260915120000_add_combatant_attack_profile/migration.sql`:

```sql
-- Añade el perfil de ataque del enemigo sobre "Combatant", fijado una vez en la
-- creación del encuentro (docs/superpowers/specs/2026-09-15-enemy-turns-design.md §4, §7).
--
-- ADITIVA. Añade exclusivamente la columna nullable "attackProfile" JSONB.
--
-- Deliberadamente NULLABLE y SIN DEFAULT: NULL es un hecho con significado —
-- "sin ataque reconocido" o "fila anterior a esta columna"— y en ambos casos el
-- turno del enemigo se salta (falla cerrado). Un DEFAULT rellenaría las filas
-- existentes con un perfil inventado.
--
-- Sin UPDATE ni backfill: esta migración no decide qué enemigos legacy atacan.
-- Sin índice: la columna no es criterio de consulta.
--
-- ORDEN DE DESPLIEGUE: aplicar ANTES de desplegar el código. En cuanto el esquema
-- tiene el campo, el finalizador de turnos lo selecciona en cada acción de
-- combate; desplegar antes de migrar detiene el combate, no lo degrada.
--
-- ─── Por qué un bloque DO ────────────────────────────────────────────────────
-- Misma razón que 20260814120000: un bloque DO es una sola sentencia, atómica en
-- cualquier invocación, y revierte con su DDL si algo falla.
DO $add_combatant_attack_profile$
BEGIN
  EXECUTE 'ALTER TABLE "Combatant" ADD COLUMN IF NOT EXISTS "attackProfile" JSONB';
END
$add_combatant_attack_profile$;
```

Run `pnpm prisma generate`.

- [ ] **Step 3: Run the E2E and confirm it fails**

Ask the maintainer before applying the migration to the disposable E2E
database. With approval, and `E2E_TEST_MODE=true`:

```powershell
pnpm prisma migrate deploy; pnpm exec playwright test tests/e2e/enemy-attack-profile.spec.ts
```

Expected: FAIL. The enemy row's `attackProfile` is `null` because the route
does not write it yet.

- [ ] **Step 4: Write the column in the encounter route.** Import
  `import { profileMonster } from "@/lib/rules/monster-attack-profile";`.
  In `resolvedEnemies`:
  - both non-SRD returns add `srdAttackProfile: null`;
  - the SRD return adds `srdAttackProfile: profileMonster(data)`.

  The local field is deliberately *not* named `attackProfile`. Task 6's
  architecture test proves the column has exactly one reader by searching
  for `.attackProfile`, and a same-named local here would read as a second
  one.

  In the enemy row object (after `xpValue: enemy.srdXp,`):

```ts
        // Backend-recognised SRD attacks (spec §4); omitted, i.e. NULL, when
        // none is recognised. Never derived from the request body.
        ...(enemy.srdAttackProfile
          ? { attackProfile: enemy.srdAttackProfile as unknown as Prisma.InputJsonValue }
          : {}),
```

- [ ] **Step 5: Run the E2E and confirm it passes**

Run: `pnpm exec playwright test tests/e2e/enemy-attack-profile.spec.ts`
Expected: PASS. Then run `pnpm typecheck`. Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260915120000_add_combatant_attack_profile "app/api/campaign/[id]/encounter/route.ts" tests/e2e/enemy-attack-profile.spec.ts
git commit -m "feat(encounter): snapshot each enemy's recognised attack profile"
```

### Task 5: Resolve one enemy turn in the database

**Files:**
- Create: `lib/db/turn-state-conflict.ts`
- Create: `lib/db/enemy-turn-transition.ts`
- Modify: `lib/db/move-transition.ts` (split `claimMoveTransition` out)
- Modify: `app/api/campaign/[id]/action/route.ts`:
  - delete the local `TurnStateConflictError` (lines 165-170);
  - import it from `lib/db/turn-state-conflict.ts`.
- Test: `tests/db/enemy-turn-transition.test.ts` (new)

**Interfaces:**
- Consumes (Tasks 1-3): `planEnemyTurn`, `isMonsterAttackProfile`,
  `toSizeCategory`, `setPlayerHp`.
- Consumes (existing): `resolveAttackRoll`, `rollDamage`, `rollHitLocation`
  and `extractConditions` from `lib/rules/combat.ts`, `armorClassFor`,
  `abilityModifier`, and `COMBATANT_INITIATIVE_ORDER`.
- Produces:
  - `class TurnStateConflictError extends Error`;
  - `class EnemyTurnInvariantError extends Error`;
  - `resolveEnemyTurn(tx, ctx: EnemyTurnContext): Promise<EnemyTurnOutcome>`;
  - `claimMoveTransition(tx, input: MoveClaimInput): Promise<MoveTransitionResult>`.

  The two context types are:

```ts
export interface EnemyTurnContext {
  campaignId: string;
  encounterId: string;
  characterId: string;
  round: number;
  turnIndex: number;
  collectEvents: boolean;
}

export interface EnemyTurnOutcome {
  events: GameEvent[];
  playerDowned: boolean;
}
```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/db/enemy-turn-transition.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { EnemyTurnInvariantError, resolveEnemyTurn } from "@/lib/db/enemy-turn-transition";
import { TurnStateConflictError } from "@/lib/db/turn-state-conflict";

const GOBLIN_PROFILE = {
  version: 1, walkSpeedFt: 30, multiattack: null,
  attacks: [{ name: "Scimitar", attackBonus: 4, melee: { reachFt: 5 }, ranged: null, damage: [{ dice: "1d6+2", type: "slashing" }] }],
};

function rows(goblin: Partial<Record<string, unknown>> = {}) {
  return [
    { id: "p1", name: "Aldric", isPlayer: true, hp: 20, maxHp: 20, x: 5, y: 5, size: "Medium", conditions: [], initiativeOrder: 0, attackProfile: null },
    { id: "g1", name: "Goblin", isPlayer: false, hp: 7, maxHp: 7, x: 5, y: 6, size: "Small", conditions: [], initiativeOrder: 1, attackProfile: GOBLIN_PROFILE, ...goblin },
  ];
}

function buildTx(combatants = rows()) {
  return {
    combatant: {
      findMany: vi.fn().mockResolvedValue(combatants),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    encounter: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    character: {
      findUnique: vi.fn().mockResolvedValue({
        hp: 20, maxHp: 20, stats: { DEX: 10 },
        inventory: [],
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    gameLog: { create: vi.fn().mockResolvedValue({}) },
  } as unknown as Prisma.TransactionClient;
}

const CTX = { campaignId: "camp-1", encounterId: "enc-1", characterId: "char-1", round: 1, turnIndex: 1, collectEvents: true };

function mockRandom(values: number[]): void {
  let i = 0;
  vi.spyOn(Math, "random").mockImplementation(() => values[i++] ?? 0.5);
}

afterEach(() => vi.restoreAllMocks());

describe("resolveEnemyTurn", () => {
  it("hits the unarmoured player and writes both HP rows through setPlayerHp", async () => {
    const tx = buildTx();
    // d20 = 16 (0.75) + 4 = 20 vs AC 10: hit. 1d6 = 4 (0.5) + 2 = 6. Hit location index 3 (0.3).
    mockRandom([0.75, 0.5, 0.3]);
    const outcome = await resolveEnemyTurn(tx, CTX);

    expect(tx.character.update).toHaveBeenCalledWith({ where: { id: "char-1" }, data: { hp: 14 } });
    expect(tx.combatant.updateMany).toHaveBeenCalledWith({ where: { encounterId: "enc-1", isPlayer: true }, data: { hp: 14 } });
    expect(outcome.playerDowned).toBe(false);
    const consequence = outcome.events.find((e) => e.type === "COMBAT_CONSEQUENCE");
    expect(consequence).toMatchObject({
      type: "COMBAT_CONSEQUENCE",
      payload: { attackerName: "Goblin", targets: [{ targetId: "p1", damage: 6, hpAfter: 14, isKill: false }] },
    });
    expect(tx.gameLog.create).toHaveBeenCalledWith({
      data: { campaignId: "camp-1", role: "system", content: "Goblin — Scimitar: 20 vs AC 10, hit, 6 slashing damage." },
    });
  });

  it("stops and reports the player downed at 0 HP", async () => {
    const tx = buildTx();
    (tx.character.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ hp: 3, maxHp: 20, stats: { DEX: 10 }, inventory: [] });
    mockRandom([0.75, 0.5, 0.3]);
    const outcome = await resolveEnemyTurn(tx, CTX);
    expect(outcome.playerDowned).toBe(true);
    expect(outcome.events.map((e) => e.type)).toContain("PLAYER_DOWNED");
    expect(tx.character.update).toHaveBeenCalledWith({ where: { id: "char-1" }, data: { hp: 0 } });
  });

  it("moves a distant goblin with the movement CAS before attacking", async () => {
    const tx = buildTx(rows({ x: 5, y: 9 }));
    mockRandom([0.0]); // natural 1: a miss, so the move is the only write
    await resolveEnemyTurn(tx, CTX);
    expect(tx.combatant.updateMany).toHaveBeenCalledWith({
      where: { id: "g1", x: 5, y: 9 },
      data: { x: 4, y: 6 },
    });
  });

  it("turns a lost movement claim into a turn-state conflict", async () => {
    const tx = buildTx(rows({ x: 5, y: 9 }));
    (tx.combatant.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });
    await expect(resolveEnemyTurn(tx, CTX)).rejects.toBeInstanceOf(TurnStateConflictError);
  });

  it("does nothing for an enemy with no profile", async () => {
    const tx = buildTx(rows({ attackProfile: null }));
    const outcome = await resolveEnemyTurn(tx, CTX);
    expect(outcome).toEqual({ events: [], playerDowned: false });
    expect(tx.character.update).not.toHaveBeenCalled();
  });

  it("fails closed on a malformed profile", async () => {
    const tx = buildTx(rows({ attackProfile: { version: 9 } }));
    await expect(resolveEnemyTurn(tx, CTX)).rejects.toBeInstanceOf(EnemyTurnInvariantError);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm exec vitest run tests/db/enemy-turn-transition.test.ts --maxWorkers=2`
Expected: FAIL, because the modules do not resolve.

- [ ] **Step 3: Create `lib/db/turn-state-conflict.ts`** with the route's class
  moved verbatim, and import it in the route in place of the deleted local
  class:

```ts
/** The encounter turn changed under the transaction; always rolls it back (HTTP 409 TURN_STATE_CONFLICT). */
export class TurnStateConflictError extends Error {
  constructor() {
    super("The encounter turn changed before the action could commit.");
    this.name = "TurnStateConflictError";
  }
}
```

- [ ] **Step 4: Split `claimMoveTransition` out of `persistMoveTransition`.**
  In `lib/db/move-transition.ts`:
  1. Add
     `export type MoveClaimInput = Omit<MoveTransitionInput, "campaignId" | "playerAction">;`.
  2. Change `assertMovementTransitionInput` to take `MoveClaimInput`.
  3. Move everything in `persistMoveTransition` from the assertion through the
     `MoveStateConflictError` throw into:

```ts
/**
 * The two conditional writes of a move — origin CAS, then the Encounter turn
 * budget — with no history. Enemy turns log as `system`; the player's move adds
 * its `user` row in persistMoveTransition.
 */
export async function claimMoveTransition(
  tx: Prisma.TransactionClient,
  input: MoveClaimInput
): Promise<MoveTransitionResult> {
  // (moved verbatim: assertion, budget check, combatant CAS, encounter budget CAS)
  return "claimed";
}

export async function persistMoveTransition(
  tx: Prisma.TransactionClient,
  input: MoveTransitionInput
): Promise<MoveTransitionResult> {
  const result = await claimMoveTransition(tx, input);
  if (result !== "claimed") return result;
  await tx.gameLog.create({
    data: { campaignId: input.campaignId, role: "user", content: input.playerAction },
  });
  return "claimed";
}
```

  The "moved verbatim" comment stands for the exact current statements. Copy
  them; do not rewrite them. Run
  `pnpm exec vitest run tests/api/action-move-macro.test.ts --maxWorkers=2`.
  Expected: PASS, unchanged.

- [ ] **Step 5: Implement `lib/db/enemy-turn-transition.ts`**

```ts
import type { Prisma } from "@prisma/client";
import type { CombatConsequenceEvent, GameEvent, SingleTargetConsequence } from "@/lib/events/game-events";
import { armorClassFor, type ArmorInventoryRow } from "@/lib/rules/armor-class";
import { extractConditions, resolveAttackRoll, rollDamage, rollHitLocation } from "@/lib/rules/combat";
import { abilityModifier } from "@/lib/rules/dice";
import { planEnemyTurn } from "@/lib/rules/enemy-turn";
import { chebyshevSquares, toSizeCategory, type GridCombatant } from "@/lib/rules/geometry";
import { isMonsterAttackProfile, type MonsterAttackProfileV1 } from "@/lib/rules/monster-attack-profile";
import { COMBATANT_INITIATIVE_ORDER } from "@/lib/rules/turn-authority";
import { claimMoveTransition, MoveStateConflictError } from "@/lib/db/move-transition";
import { setPlayerHp } from "@/lib/db/player-hp";
import { TurnStateConflictError } from "@/lib/db/turn-state-conflict";

/** A state the chain must never reach; HTTP 500 ENEMY_TURN_INVARIANT, never retried (spec §8). */
export class EnemyTurnInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnemyTurnInvariantError";
  }
}

export interface EnemyTurnContext {
  campaignId: string;
  encounterId: string;
  characterId: string;
  round: number;
  turnIndex: number;
  collectEvents: boolean;
}

export interface EnemyTurnOutcome {
  events: GameEvent[];
  playerDowned: boolean;
}

interface CombatantRow {
  id: string;
  name: string;
  isPlayer: boolean;
  hp: number;
  x: number;
  y: number;
  size: string;
  conditions: unknown;
  attackProfile: unknown;
}

function grid(row: CombatantRow): GridCombatant {
  return { id: row.id, x: row.x, y: row.y, size: toSizeCategory(row.size) };
}

/**
 * Resolves the enemy that owns (round, turnIndex): move, then attacks on the
 * player. The caller (finalizeEncounterTurn) holds the Character lock and owns
 * the transaction; every write here goes through `tx`, and any conflict throws
 * so the whole transaction rolls back (spec §6.2, §8).
 */
export async function resolveEnemyTurn(
  tx: Prisma.TransactionClient,
  ctx: EnemyTurnContext
): Promise<EnemyTurnOutcome> {
  const events: GameEvent[] = [];
  const combatants = (await tx.combatant.findMany({
    where: { encounterId: ctx.encounterId },
    orderBy: COMBATANT_INITIATIVE_ORDER,
  })) as unknown as CombatantRow[];

  const enemy = combatants[ctx.turnIndex];
  const player = combatants.find((c) => c.isPlayer);
  if (!enemy || enemy.isPlayer || !player) {
    throw new EnemyTurnInvariantError(`Encounter ${ctx.encounterId} has no enemy at turn ${ctx.turnIndex}.`);
  }
  // Prisma returns SQL NULL as null; reduced route-test doubles may omit the
  // field entirely. Both mean "no profile": the turn is skipped, not failed.
  const rawProfile = enemy.attackProfile ?? null;
  if (rawProfile !== null && !isMonsterAttackProfile(rawProfile)) {
    throw new EnemyTurnInvariantError(`Combatant ${enemy.id} carries a malformed attack profile.`);
  }
  const profile = rawProfile as MonsterAttackProfileV1 | null;

  const enemyGrid = grid(enemy);
  const plan = planEnemyTurn({
    enemy: { ...enemyGrid, hp: enemy.hp, conditions: extractConditions(enemy.conditions), profile },
    player: grid(player),
    others: combatants.filter((c) => c.id !== enemy.id).map(grid),
  });

  if (plan.move && profile) {
    const distanceFt = chebyshevSquares(enemyGrid, plan.move) * 5;
    let claim: Awaited<ReturnType<typeof claimMoveTransition>>;
    try {
      claim = await claimMoveTransition(tx, {
        encounterId: ctx.encounterId,
        combatantId: enemy.id,
        expectedFromX: enemy.x,
        expectedFromY: enemy.y,
        expectedRound: ctx.round,
        expectedTurnIndex: ctx.turnIndex,
        expectedMovementSpentFt: 0,
        requestedDistanceFt: distanceFt,
        speedFt: profile.walkSpeedFt,
        targetX: plan.move.x,
        targetY: plan.move.y,
      });
    } catch (error) {
      if (error instanceof MoveStateConflictError) throw new TurnStateConflictError();
      throw error;
    }
    if (claim !== "claimed") throw new TurnStateConflictError();

    await tx.gameLog.create({
      data: { campaignId: ctx.campaignId, role: "system", content: `${enemy.name} moves ${distanceFt} ft.` },
    });
    if (ctx.collectEvents) {
      events.push({
        type: "MOVE_COMBATANT",
        payload: {
          combatantId: enemy.id,
          fromX: enemy.x,
          fromY: enemy.y,
          toX: plan.move.x,
          toY: plan.move.y,
          distanceFt,
        },
      });
    }
  }

  if (plan.attacks.length === 0 || !profile) return { events, playerDowned: false };

  const character = (await tx.character.findUnique({
    where: { id: ctx.characterId },
    select: {
      hp: true,
      maxHp: true,
      stats: true,
      inventory: { select: { type: true, equippedSlot: true, properties: true } },
    },
  })) as { hp: number; maxHp: number; stats: unknown; inventory: ArmorInventoryRow[] } | null;
  if (!character) throw new EnemyTurnInvariantError(`Character ${ctx.characterId} not found.`);

  const stats = (character.stats ?? {}) as Record<string, number>;
  const playerAC = armorClassFor({
    inventory: character.inventory,
    dexModifier: abilityModifier(stats.DEX ?? 10),
  }).armorClass;
  const enemyConditions = extractConditions(enemy.conditions);
  const playerConditions = extractConditions(player.conditions);
  let hp = character.hp;

  for (const name of plan.attacks) {
    const attack = profile.attacks.find((a) => a.name === name);
    if (!attack) throw new EnemyTurnInvariantError(`Planned attack ${name} is not in ${enemy.id}'s profile.`);

    const roll = resolveAttackRoll(attack.attackBonus, playerAC, enemyConditions, playerConditions, plan.mode === "melee");
    let damage = 0;
    let damageText = "";
    if (roll.hit) {
      const parts = attack.damage.map((d) => ({
        type: d.type,
        amount: Math.max(0, rollDamage(d.dice, roll.critical).total),
      }));
      damage = parts.reduce((sum, p) => sum + p.amount, 0);
      damageText = parts.map((p) => `${p.amount} ${p.type}`).join(" + ");
      hp = await setPlayerHp(tx, { characterId: ctx.characterId, encounterId: ctx.encounterId, hp: hp - damage });
    }

    const verdict = roll.critical ? "critical hit" : roll.hit ? "hit" : "miss";
    await tx.gameLog.create({
      data: {
        campaignId: ctx.campaignId,
        role: "system",
        content: `${enemy.name} — ${attack.name}: ${roll.total} vs AC ${playerAC}, ${verdict}${roll.hit ? `, ${damageText} damage` : ""}.`,
      },
    });

    if (ctx.collectEvents) {
      const consequence: SingleTargetConsequence = {
        targetName: player.name,
        targetId: player.id,
        damage,
        naturalRoll: roll.roll,
        isCrit: roll.critical,
        isFumble: roll.fumble,
        hitLocation: roll.hit ? rollHitLocation() : "chest",
        narrativeTags: [],
        hpAfter: hp,
        targetMaxHp: character.maxHp,
        isKill: hp <= 0,
        conditionsApplied: [],
      };
      const consequenceEvent: CombatConsequenceEvent = {
        type: "COMBAT_CONSEQUENCE",
        payload: { attackerName: enemy.name, targets: [consequence] },
      };
      events.push(consequenceEvent);
      // The same per-hit companions executeCombatAction emits (combat-pipeline.ts:748-765).
      if (roll.fumble) {
        events.push({ type: "CRITICAL_MISS", payload: { naturalRoll: roll.roll, targetName: player.name } });
      } else if (roll.critical) {
        events.push({ type: "CRITICAL_HIT", payload: { damage, naturalRoll: roll.roll, targetName: player.name } });
      } else if (damage > 0) {
        events.push({ type: "DAMAGE_DEALT", payload: { damage, naturalRoll: roll.roll, targetName: player.name } });
      }
    }

    if (hp <= 0) {
      if (ctx.collectEvents) events.push({ type: "PLAYER_DOWNED", payload: {} });
      return { events, playerDowned: true };
    }
  }
  return { events, playerDowned: false };
}
```

Spec §6.4 names `buildCombatConsequenceEvent`. It lives in
`combat-pipeline.ts`, which will import this module, so the event is built as
an explicitly typed `CombatConsequenceEvent` literal instead, with the same
shape. Import the builder here and you get an import cycle.

- [ ] **Step 6: Run the focused tests and confirm they pass**

Run: `pnpm exec vitest run tests/db/enemy-turn-transition.test.ts tests/api/action-move-macro.test.ts tests/api/action.test.ts --maxWorkers=2`
Expected: PASS.

If the damage roll lands on a different `Math.random` call than the test
expects, read the dice helpers' call order (`rollN`, then `rollDamage`, then
`rollHitLocation`) and fix the *test's* queue. Never fix the module to fit the
test.

- [ ] **Step 7: Commit**

```bash
git add lib/db/turn-state-conflict.ts lib/db/enemy-turn-transition.ts lib/db/move-transition.ts "app/api/campaign/[id]/action/route.ts" tests/db/enemy-turn-transition.test.ts
git commit -m "feat(combat): resolve one enemy turn inside the combat transaction"
```

### Task 6: The chain inside `finalizeEncounterTurn` (Opus 5, `xhigh`)

**Files:**
- Modify: `lib/rules/combat-pipeline.ts` (`FinalizeEncounterTurnInput` at line
  335, and `finalizeEncounterTurn` from line 807 to the end)
- Test: `tests/rules/combat-turn-transition-atomicity.test.ts` (fixture
  update and new cases)
- Test: `tests/architecture/attack-profile-single-writer.test.ts` (new)

**Interfaces:**
- Consumes (Tasks 3, 5): `lockCharacterForCombatAction`, `resolveEnemyTurn`,
  `EnemyTurnInvariantError`, `TurnStateConflictError`.
- Produces: `FinalizeEncounterTurnInput.mode?: "advance" | "resume"` (default
  `"advance"`). `FinalizeTurnResult` is unchanged.

The steps are ordered so the extraction in Step 1 is proven behaviour-neutral
before any new behaviour lands.

- [ ] **Step 1: Pure extraction, guarded by the existing tests.** Move the
  statements from `const resolution = resolveEncounterEnd(allCombatants);`
  through the end of the `if (resolution.shouldEnd) { … }` block, unchanged,
  into a local function in the same file:

```ts
async function resolveEncounterIfEnded(input: {
  tx: Prisma.TransactionClient;
  encounterId: string;
  currentTurnIndex: number;
  round: number;
  failOnStaleTurn: boolean;
  events: GameEvent[];
}): Promise<FinalizeTurnResult | null>
```

  It returns the block's existing return values, and `null` when
  `!resolution.shouldEnd`. It re-reads `allCombatants` itself with the same
  `findMany`. Call it first in `finalizeEncounterTurn`:
  `const ended = await resolveEncounterIfEnded({...}); if (ended) return ended;`.

  Run: `pnpm exec vitest run tests/rules/combat-pipeline.test.ts tests/rules/combat-turn-transition-atomicity.test.ts tests/architecture/encounter-resolution-authority.test.ts --maxWorkers=2`
  Expected: PASS with **no test edits**. That is the proof the extraction is
  pure. Commit:
  `git commit -am "refactor(combat): extract encounter resolution from the turn finalizer"`.

- [ ] **Step 2: Update the CAS fixture and write the failing chain tests.** In
  `tests/rules/combat-turn-transition-atomicity.test.ts`, make `buildCasTx`'s
  `encounter.findUnique` select-aware. It must answer the owner lookup and
  stay configurable for the stale-path tests that queue a fresh encounter:

```ts
function buildCasTx(fresh: Record<string, unknown> | null = null) {
  return {
    $queryRaw: vi.fn(),
    combatant: {
      findMany: vi.fn().mockResolvedValue(ongoingCombatants()),
    },
    encounter: {
      update: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn().mockImplementation((args?: { select?: Record<string, unknown> }) => {
        if (args?.select?.campaign) {
          return Promise.resolve({ campaignId: "camp-1", campaign: { characterId: "char-1" } });
        }
        return Promise.resolve(fresh);
      }),
    },
  } as unknown as Prisma.TransactionClient;
}
```

  Wherever a test in that file set `encounter.findUnique` directly for the
  stale path, pass that value as `buildCasTx(fresh)` instead. Then add:

```ts
vi.mock("@/lib/db/enemy-turn-transition", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/db/enemy-turn-transition")>()),
  resolveEnemyTurn: vi.fn().mockResolvedValue({ events: [], playerDowned: false }),
}));
import { resolveEnemyTurn } from "@/lib/db/enemy-turn-transition";

describe("finalizeEncounterTurn enemy chain", () => {
  it("locks the owning Character before claiming the turn", async () => {
    const tx = buildCasTx();
    (tx.encounter.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
    await finalizeEncounterTurn({ tx, encounterId: "enc-1", currentTurnIndex: 0, round: 1, failOnStaleTurn: true });
    const lockOrder = (tx.$queryRaw as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    const claimOrder = (tx.encounter.updateMany as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    expect(lockOrder).toBeLessThan(claimOrder);
  });

  it("runs every enemy turn and returns the pointer to the player", async () => {
    const tx = buildCasTx();
    (tx.encounter.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
    const result = await finalizeEncounterTurn({ tx, encounterId: "enc-1", currentTurnIndex: 0, round: 1, failOnStaleTurn: true });
    expect(resolveEnemyTurn).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ encounterResolved: false, turnAdvanceConflict: false, nextTurnIndex: 0, nextRound: 2 });
    expect(result.events.map((e) => e.type)).toEqual(["TURN_ADVANCE", "TURN_ADVANCE", "ROUND_ADVANCE"]);
  });

  it("resolves player_dead when an enemy downs the player", async () => {
    const tx = buildCasTx();
    (tx.encounter.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
    (resolveEnemyTurn as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ events: [{ type: "PLAYER_DOWNED", payload: {} }], playerDowned: true });
    (tx.combatant.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(ongoingCombatants())   // entry resolution check
      .mockResolvedValueOnce(ongoingCombatants())   // chain: slot ownership
      .mockResolvedValue([                           // after the downing blow
        { id: "player-1", isPlayer: true, hp: 0 },
        { id: "enemy-1", isPlayer: false, hp: 10 },
        { id: "enemy-2", isPlayer: false, hp: 10 },
      ]);
    const result = await finalizeEncounterTurn({ tx, encounterId: "enc-1", currentTurnIndex: 0, round: 1, failOnStaleTurn: true });
    expect(result.encounterResolved).toBe(true);
    expect(tx.encounter.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { status: "resolved" } }),
    );
  });

  it("resume starts the chain at the enemy slot without a player claim", async () => {
    const tx = buildCasTx();
    (tx.encounter.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
    await finalizeEncounterTurn({ tx, encounterId: "enc-1", currentTurnIndex: 1, round: 1, failOnStaleTurn: true, mode: "resume" });
    expect(tx.encounter.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "enc-1", status: "active", currentTurnIndex: 1, round: 1 },
      data: { currentTurnMovementSpentFt: 0, currentTurnObjectInteractionUsed: false },
    });
    expect(resolveEnemyTurn).toHaveBeenCalledTimes(2);
  });

  it("reports a stale resume as a conflict without resolving any enemy", async () => {
    const tx = buildCasTx();
    (tx.encounter.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });
    const result = await finalizeEncounterTurn({ tx, encounterId: "enc-1", currentTurnIndex: 1, round: 1, failOnStaleTurn: true, mode: "resume" });
    expect(result).toMatchObject({ turnAdvanceConflict: true });
    expect(resolveEnemyTurn).not.toHaveBeenCalled();
  });

  it("throws the invariant error when the chain cannot return to the player", async () => {
    const tx = buildCasTx();
    (tx.encounter.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
    (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "player-1", isPlayer: false, hp: 20 },
      { id: "enemy-1", isPlayer: false, hp: 10 },
    ]);
    await expect(
      finalizeEncounterTurn({ tx, encounterId: "enc-1", currentTurnIndex: 0, round: 1, failOnStaleTurn: true }),
    ).rejects.toThrow();
  });
});
```

  Add `beforeEach(() => vi.mocked(resolveEnemyTurn).mockClear())` to the new
  `describe`.

  A mock for "no player at all" hits `resolveEncounterEnd` first. The last
  test only asserts that the call *rejects*: the precise error type there
  depends on the existing entry resolution, and Step 6's falsification pins
  the bound itself.

  Create `tests/architecture/attack-profile-single-writer.test.ts` with the
  same file walk as `srd-monster-single-lookup.test.ts` (roots `lib`, `app`):

```ts
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith(".ts") || name.endsWith(".tsx") ? [path] : [];
  });
}
const SOURCES = ["lib", "app"].flatMap((d) => sourceFiles(join(process.cwd(), d)))
  .map((path) => [path.replace(process.cwd(), "").replace(/\\/g, "/"), readFileSync(path, "utf8")] as const);

describe("Combatant.attackProfile has both ends (spec §9.4)", () => {
  // Files that only declare the row's shape, named on purpose: a new file
  // carrying `attackProfile:` is a writer until someone adds it here.
  const TYPE_ONLY = new Set(["/lib/db/enemy-turn-transition.ts"]);

  it("is written only by the encounter route", () => {
    const writers = SOURCES
      .filter(([p, s]) => /\battackProfile\s*:/.test(s) && !TYPE_ONLY.has(p))
      .map(([p]) => p);
    expect(writers).toEqual(["/app/api/campaign/[id]/encounter/route.ts"]);
  });

  it("is read only by the enemy-turn transition", () => {
    const readers = SOURCES.filter(([, s]) => /\.attackProfile\b/.test(s)).map(([p]) => p);
    expect(readers).toEqual(["/lib/db/enemy-turn-transition.ts"]);
  });
});
```

  The search is case-sensitive, so the route's local `srdAttackProfile`
  (Task 4) matches neither `\battackProfile\s*:` nor `\.attackProfile\b`.

- [ ] **Step 3: Run them and confirm they fail**

Run: `pnpm exec vitest run tests/rules/combat-turn-transition-atomicity.test.ts tests/architecture/attack-profile-single-writer.test.ts --maxWorkers=2`
Expected: FAIL.
- There is no lock.
- `resolveEnemyTurn` is never called.
- `mode` does not exist.
- The reader assertion already passes; the writer assertion passes after
  Task 4.

- [ ] **Step 4: Implement the chain.** In `lib/rules/combat-pipeline.ts`:

  1. **Imports:**
     `import { lockCharacterForCombatAction } from "@/lib/db/character-lock";`,
     `import { EnemyTurnInvariantError, resolveEnemyTurn } from "@/lib/db/enemy-turn-transition";`,
     `import { TurnStateConflictError } from "@/lib/db/turn-state-conflict";`,
     `import { COMBATANT_INITIATIVE_ORDER } from "@/lib/rules/turn-authority";`.
  2. **Input type:** add to `FinalizeEncounterTurnInput`:
     `/** "resume" starts the enemy chain at the current (enemy-owned) slot without a player claim (spec §6.6). */ mode?: "advance" | "resume";`.
  3. **Entry lock:** at the top of `finalizeEncounterTurn`, before
     `resolveEncounterIfEnded`, and only when the real Prisma surface is
     present (the file's existing `typeof tx.$queryRaw !== "function"`
     concession for reduced doubles):

```ts
  let owner: { campaignId: string; characterId: string } | null = null;
  if (typeof tx.$queryRaw === "function") {
    const row = await tx.encounter.findUnique({
      where: { id: encounterId },
      select: { campaignId: true, campaign: { select: { characterId: true } } },
    });
    if (!row?.campaignId || !row.campaign?.characterId) {
      throw new EnemyTurnInvariantError(`Encounter ${encounterId} has no owning character.`);
    }
    owner = { campaignId: row.campaignId, characterId: row.campaign.characterId };
    // Character → Combatant → Encounter (DC-AUD-016 plan): before any write here.
    await lockCharacterForCombatAction(tx, owner.characterId);
  }
```

  4. **The chain,** as a local function:

```ts
async function runEnemyChain(input: {
  tx: Prisma.TransactionClient;
  encounterId: string;
  owner: { campaignId: string; characterId: string };
  turnIndex: number;
  round: number;
  collectEvents: boolean;
  events: GameEvent[];
}): Promise<FinalizeTurnResult> {
  const { tx, encounterId, owner, collectEvents, events } = input;
  let { turnIndex, round } = input;
  const ordered = await tx.combatant.findMany({
    where: { encounterId },
    orderBy: COMBATANT_INITIATIVE_ORDER,
    select: { id: true, isPlayer: true },
  });

  for (let step = 0; step < ordered.length; step++) {
    const active = ordered[turnIndex];
    if (!active) throw new EnemyTurnInvariantError(`Encounter ${encounterId} has no combatant at ${turnIndex}.`);
    if (active.isPlayer) {
      return { events, encounterResolved: false, turnAdvanceConflict: false, nextTurnIndex: turnIndex, nextRound: round };
    }

    const outcome = await resolveEnemyTurn(tx, {
      campaignId: owner.campaignId, encounterId, characterId: owner.characterId,
      round, turnIndex, collectEvents,
    });
    events.push(...outcome.events);

    if (outcome.playerDowned) {
      const ended = await resolveEncounterIfEnded({
        tx, encounterId, currentTurnIndex: turnIndex, round, failOnStaleTurn: true, events,
      });
      if (!ended) throw new EnemyTurnInvariantError(`Player downed but encounter ${encounterId} did not end.`);
      return ended;
    }

    const next = advanceTurn({ currentTurnIndex: turnIndex, round, combatantCount: ordered.length });
    const claim = await tx.encounter.updateMany({
      where: { id: encounterId, status: "active", currentTurnIndex: turnIndex, round },
      data: {
        currentTurnIndex: next.nextTurnIndex,
        round: next.nextRound,
        currentTurnMovementSpentFt: 0,
        currentTurnObjectInteractionUsed: false,
      },
    });
    // Writes already happened in this transaction: throw so it rolls back whole.
    if (claim.count !== 1) throw new TurnStateConflictError();
    if (collectEvents) {
      events.push({
        type: next.roundAdvanced ? "ROUND_ADVANCE" : "TURN_ADVANCE",
        payload: { nextTurnIndex: next.nextTurnIndex, nextRound: next.nextRound },
      });
    }
    turnIndex = next.nextTurnIndex;
    round = next.nextRound;
  }
  throw new EnemyTurnInvariantError(`Enemy turn chain for ${encounterId} did not return to the player.`);
}
```

  5. **Hook it in the real CAS path.** Where the loop's `if (claim.count === 1)`
     pushes its advance event and returns, return
     `owner ? await runEnemyChain({ tx, encounterId, owner, turnIndex: nextTurnIndex, round: nextRound, collectEvents, events }) : { …existing return… }`.
     The reduced-double path (`typeof tx.$queryRaw !== "function"`) keeps its
     historical return. No production transaction takes it.
  6. **Resume.** Right after `resolveEncounterIfEnded`, handle
     `mode === "resume"`:

```ts
  if (input.mode === "resume") {
    if (!owner) throw new EnemyTurnInvariantError("Resuming enemy turns needs a real transaction.");
    // Bind the resume to the observed enemy slot; this also resets that turn's budgets.
    const touch = await tx.encounter.updateMany({
      where: { id: encounterId, status: "active", currentTurnIndex, round },
      data: { currentTurnMovementSpentFt: 0, currentTurnObjectInteractionUsed: false },
    });
    if (touch.count !== 1) return { events, encounterResolved: false, turnAdvanceConflict: true };
    return runEnemyChain({ tx, encounterId, owner, turnIndex: currentTurnIndex, round, collectEvents, events });
  }
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `pnpm exec vitest run tests/rules/combat-turn-transition-atomicity.test.ts tests/rules/combat-pipeline.test.ts tests/architecture --maxWorkers=2`
Expected: the new tests PASS.

`buildCasTx` exposes `$queryRaw`, so the *existing* tests in the atomicity
file now run the chain too. `tests/rules/combat-pipeline.test.ts` does not:
`buildMockTx` has no `$queryRaw`, so it keeps the reduced-double path.
Existing atomicity tests that assert a post-claim index, advance events, or
`encounter.updateMany` calls may now fail. Update them under Task 7 Step 6's
three categories, and treat any other failure as a regression.

- [ ] **Step 6: Falsify**

Make each change below, run the test, see the named test fail, and restore.

| Change | Test that must fail |
| --- | --- |
| Move the entry lock after `resolveEncounterIfEnded` and the claim | the lock-order test |
| Change `step < ordered.length` to `step < 1` | the chain test |
| Replace the `claim.count !== 1` throw with `break` | the invariant-bound test |

- [ ] **Step 7: Commit**

```bash
git add lib/rules/combat-pipeline.ts tests/rules/combat-turn-transition-atomicity.test.ts tests/architecture/attack-profile-single-writer.test.ts
git commit -m "feat(combat): chain enemy turns inside the turn finalizer"
```

### Task 7: Route — `End Turn` resume and error mapping; update the turn contract

**Files:**
- Modify: `app/api/campaign/[id]/action/route.ts`:
  - the macro gate (lines 541-547);
  - the `End Turn` branch (lines 549-587);
  - the equipment `catch` (line 1672);
  - `POST` (line 250).
- Modify: `tests/api/action.test.ts` (the enemy-slot `End Turn` test at
  lines 744-778, and the shared prisma mock)
- Modify: the turn-contract tests listed in Step 6.

- [ ] **Step 1: Rewrite the enemy-slot `End Turn` test (RED).** Replace
  "refuses End Turn while an enemy owns the initiative slot" with a test that
  uses the same fixture (goblin at `initiativeOrder: 0`, the player at 1,
  `currentTurnIndex: 0`, `round: 3`):

```ts
  it("resumes enemy turns on End Turn while an enemy owns the initiative slot", async () => {
    // …same combatants / buildCampaignContext / findMany fixture as before…
    (prisma.encounter.updateMany as any).mockResolvedValue({ count: 1 });

    const res = await POST(
      new NextRequest(`http://localhost/api/campaign/${campaignId}/action`, {
        method: "POST",
        body: JSON.stringify({ action: "End Turn" }),
      }),
      { params: Promise.resolve({ id: campaignId }) }
    );

    expect(res.status).toBe(200);
    expect(prisma.encounter.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "enc_123", status: "active", currentTurnIndex: 0, round: 3 },
      data: { currentTurnMovementSpentFt: 0, currentTurnObjectInteractionUsed: false },
    });
    expect(canonicalUserLogWrites()).toHaveLength(1);
  });
```

  The owner lookup needs `prisma.encounter.findUnique` to answer
  `select.campaign`. Give the shared prisma mock's `encounter.findUnique`
  (around `tests/api/action.test.ts:25`) the select-aware implementation from
  Task 6 Step 2, and a `$queryRaw: vi.fn()` if it lacks one.

  Also add `"refuses Attack while an enemy owns the initiative slot"`, if it
  is not already covered by the test at line 680. The resume exception is
  **only** for `End Turn`.

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm exec vitest run tests/api/action.test.ts -t "enemy owns" --maxWorkers=2`
Expected: FAIL, with a 409 `NOT_PLAYER_TURN` instead of a 200.

- [ ] **Step 3: Implement the resume in the macro gate.** Replace
  `route.ts:546-547` with:

```ts
    // Enemy turns resolve inside the End Turn chain. An encounter parked on an
    // enemy slot (a pre-chain save, or a fresh encounter whose initiative put an
    // enemy first) is resumed by End Turn only; every other action keeps 409
    // NOT_PLAYER_TURN (enemy-turns spec §6.6).
    const turnAuthority = resolveEncounterTurnAuthority(context.activeEncounter);
    const resumingEnemyTurns =
      trimmedAction === "End Turn" && turnAuthority.ok && !turnAuthority.playerOwnsTurn;
    if (!resumingEnemyTurns) {
      const turnRefusal = playerTurnRefusal(context.activeEncounter);
      if (turnRefusal) return turnRefusal;
    }
```

  In the `End Turn` finalizer call, add
  `mode: resumingEnemyTurns ? "resume" : "advance",`. It stays the **one**
  call with `failOnStaleTurn: true`. Wrap that branch's
  `await prisma.$transaction(...)` in `try { … } catch (error) { … }`, mapping
  `TurnStateConflictError` to the branch's existing 409 body
  (`code: "TURN_STATE_CONFLICT"`) and rethrowing anything else.

- [ ] **Step 4: Map the other two error paths.**

  In the equipment `catch` (`route.ts:1672`), before `throw error;`:

```ts
          if (error instanceof TurnStateConflictError) {
            return NextResponse.json(
              {
                error: "The encounter turn changed before this equipment change could be applied. Refresh state and try again.",
                code: "TURN_STATE_CONFLICT",
              },
              { status: 409 }
            );
          }
```

  In `POST` (`route.ts:250`), wrap the `resolveAction` call:

```ts
  let res: Response;
  try {
    res = await resolveAction(req, ctx, receiptRef);
  } catch (error) {
    if (error instanceof EnemyTurnInvariantError) {
      console.error("[action] Enemy turn invariant:", error);
      return NextResponse.json(
        { error: "Combat reached an impossible state and was rolled back.", code: "ENEMY_TURN_INVARIANT" },
        { status: 500 }
      );
    }
    throw error;
  }
```

  Import `EnemyTurnInvariantError` from `@/lib/db/enemy-turn-transition`. The
  5xx response settles no receipt, which is the existing behaviour for server
  errors.

- [ ] **Step 5: Run it and confirm it passes**

Run: `pnpm exec vitest run tests/api/action.test.ts tests/architecture/player-turn-spending-actions.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 6: Update the turn contract, file by file.**

  **The new contract.** After a successful turn-ending action, enemies
  resolve in order. Enemies whose `attackProfile` is `null`, which includes
  every hand-built test enemy, are skipped with one `TURN_ADVANCE` or
  `ROUND_ADVANCE` each. The pointer ends on the **player's slot**, so
  `T + 1` is no longer the expected index.

  **Shared E2E helper.** Add `tests/e2e/support/turns.ts`:

```ts
import { advanceTurn } from "@/lib/rules/combat";

/** Where the enemy chain leaves the pointer when no enemy can act (every attackProfile null). */
export function turnAfterSkippedEnemies(input: {
  combatants: ReadonlyArray<{ isPlayer: boolean; initiativeOrder: number }>;
  currentTurnIndex: number;
  round: number;
}): { turnIndex: number; round: number; claims: number } {
  const ordered = [...input.combatants].sort((a, b) => a.initiativeOrder - b.initiativeOrder);
  let turnIndex = input.currentTurnIndex;
  let round = input.round;
  let claims = 0;
  do {
    const next = advanceTurn({ currentTurnIndex: turnIndex, round, combatantCount: ordered.length });
    turnIndex = next.nextTurnIndex;
    round = next.nextRound;
    claims += 1;
  } while (!ordered[turnIndex]!.isPlayer);
  return { turnIndex, round, claims };
}
```

  **Files to update, rule by rule:**

  | File | Update |
  | --- | --- |
  | `tests/e2e/action-idempotency.spec.ts` | Compute `expected` with `turnAfterSkippedEnemies` instead of one `advanceTurn`. `storedEvents` has `expected.claims` entries, each matching `/^(TURN|ROUND)_ADVANCE$/`. The replay frames are `["duplicate", ...Array(expected.claims).fill("evt"), "done"]`. Keep the doc comment's reasoning; amend it to say that the chain now carries the pointer back to the player. |
  | `tests/e2e/turn-advance-concurrency.spec.ts` | The winner's post-state index comes from `turnAfterSkippedEnemies`. The loser is still 409, with no effect. |
  | `tests/e2e/equipment-action-economy.spec.ts` | Any assertion on the count or order of `TURN_ADVANCE` events after a turn-ending equip: expect the extra skipped-enemy advances, and assert the final pointer on the player. |
  | `tests/e2e/combat-movement-authority.spec.ts` | Direct `finalizeEncounterTurn` calls now also run the chain. Assert through `turnAfterSkippedEnemies`. |
  | `tests/api/action.test.ts`, `tests/api/action-combat-check-policy.test.ts`, `tests/rules/combat-pipeline.test.ts` | Update assertions on `nextTurnIndex`, advance-event counts, or `encounter.updateMany` call counts after a turn-ending action to the new contract. |

  Run the full unit suite. **Every failure must fall into one of three
  categories:**
  1. extra skipped-enemy advances;
  2. the pointer returning to the player;
  3. the owner lookup or lock that the double did not provide.

  **Any other failure is a regression: stop and investigate.** Record in the
  commit body which test changed and in which category.

- [ ] **Step 7: Commit**

```bash
git add "app/api/campaign/[id]/action/route.ts" tests
git commit -m "feat(action): resume parked enemy turns on End Turn and map chain errors"
```

### Task 8: Real PostgreSQL — the chain end to end

**Files:**
- Create: `tests/e2e/enemy-turns.spec.ts` (every test `@smoke`)

**Interfaces:**
- Consumes: `profileMonster` and `turnAfterSkippedEnemies`, plus the helpers
  `assertSafeE2EDatabase`, `cleanupE2ERecords` and `E2ECreatedRecords`.

- [ ] **Step 1: Write the specs.** Build every fixture the way
  `turn-advance-concurrency.spec.ts` does: character and campaign through the
  API, and the encounter through `prisma.encounter.create` with explicit
  `initiativeOrder`, `x`/`y`, `currentTurnMovementSpentFt: 0` and
  `currentTurnObjectInteractionUsed: false`. Raise the character to
  `hp: 200, maxHp: 200` (and the player combatant to `hp: 200`), so a critical
  hit can never down the player and turn a `@smoke` test into a coin flip.

  Four tests:

  1. **"@smoke a goblin closes, attacks, and the turn returns to the player".**
     - Setup: player at (5,5) with order 0; goblin at (5,8) with order 1,
       `size: "Small"` and `attackProfile: profileMonster(GOBLIN)`. Post
       `End Turn`.
     - Expect a 200. The SSE `evt` types, in order, begin `TURN_ADVANCE`,
       `MOVE_COMBATANT`, `COMBAT_CONSEQUENCE` and end with `ROUND_ADVANCE`.
     - After: encounter `currentTurnIndex: 0, round: 2`; goblin at `(4, 6)`
       (Task 2's tie-break, from (5,8) with 30 ft); `Character.hp` equals the
       player combatant's `hp`; one `user` row `End Turn`; `system` rows
       starting `Goblin — Scimitar:` and `Goblin moves 10 ft.`.
  2. **"@smoke concurrent End Turns: one chain wins, the other is refused".**
     - Same fixture. Hold the **Character** row with an external
       `SELECT … FOR UPDATE` transaction, as the `turn-advance-concurrency.spec.ts`
       technique does with the Encounter row. Post two `End Turn`s with
       distinct `requestId`s.
     - Wait until two backends are blocked on a query matching
       `%Character%` and `FOR UPDATE`, then release.
     - Expect sorted statuses `[200, 409]`, the 409 carrying
       `TURN_STATE_CONFLICT`; exactly one `user` `End Turn` row; exactly one
       `Goblin — Scimitar:` row.
  3. **"@smoke End Turn racing a rest: no deadlock, the rest is refused".**
     Fire `End Turn` and `POST /api/campaign/{id}/rest` with `{ type: "short" }`
     together. Expect `End Turn` 200, the rest refused with a 4xx, and both
     settled well inside the test timeout. The rest takes the Character lock
     first and then finds the active encounter.
  4. **"@smoke End Turn recovers an encounter parked on an enemy slot".**
     - Setup: `currentTurnIndex` on a goblin whose `attackProfile` is `null`
       (a pre-column row).
     - First `Move` → 409 `NOT_PLAYER_TURN`.
     - Then `End Turn` → 200, the pointer on the player at the next round, no
       `Goblin —` rows, and one `user` `End Turn` row.

- [ ] **Step 2: Run them.** Use the disposable database only, with
  `E2E_TEST_MODE=true`:
  `pnpm exec playwright test tests/e2e/enemy-turns.spec.ts tests/e2e/enemy-attack-profile.spec.ts`.
  Expected: PASS. Then run `pnpm test:e2e:smoke`. Expected: every smoke test
  passes, including the ones updated in Task 7.

- [ ] **Step 3: Falsify on real PostgreSQL**

| Change | Expected result |
| --- | --- |
| Remove the finalizer's entry lock | Test 2 double-writes or deadlocks: two chains, or the Prisma transaction times out |
| Make `setPlayerHp` skip `mirrorPlayerCombatantHp` | Test 1's HP equality fails |
| Drop the `resumingEnemyTurns` guard, so every action bypasses the refusal | Test 4's `Move` succeeds |

Restore each change and re-run.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/enemy-turns.spec.ts tests/e2e/support/turns.ts
git commit -m "test(e2e): enemy turns on real PostgreSQL"
```

### Task 9: Contract docs, full validation, handover

**Files:**
- Modify: `MASTER_ARCH_GUIDE.md` §4.4 (after the
  `Encounter.currentTurnObjectInteractionUsed` bullet)

- [ ] **Step 1: Document the contract.** Append these bullets to §4.4:

```markdown
- Enemy turns are backend-authoritative and resolve inside the canonical
  finalizer. After any successful player turn claim, `finalizeEncounterTurn`
  runs each enemy slot in initiative order in the same transaction: a pure
  plan (`lib/rules/enemy-turn.ts`), then the move CAS, attack rolls against the
  player's current AC, and damage, until the pointer returns to the player or
  the player reaches 0 HP (`player_dead`, no XP) — docs/superpowers/specs/2026-09-15-enemy-turns-design.md.
- The finalizer takes the Character row lock at entry, preserving
  Character → Combatant → Encounter. Any chain conflict throws and rolls the
  whole transaction back (409 `TURN_STATE_CONFLICT`); an impossible state
  returns 500 `ENEMY_TURN_INVARIANT`.
- `Combatant.attackProfile` is written once, by the encounter route, from
  verbatim-recognised SRD attacks; `NULL` means the enemy's turn is skipped.
- `End Turn` on an enemy-owned slot resumes the chain from that slot; every
  other action there keeps 409 `NOT_PLAYER_TURN`.
- The player's HP is written through `setPlayerHp` (Character, then its
  Combatant mirror); in-combat healing keeps its Character CAS and applies the
  same mirror.
```

- [ ] **Step 2: Full validation.** Run each and record the result:
  - `pnpm typecheck`
  - `pnpm exec vitest run --maxWorkers=2`
  - `pnpm build`
  - `pnpm check-retro`
  - `pnpm test:e2e:smoke`, against the disposable database

- [ ] **Step 3: Commit, then open the PR with the handover.** With the
  maintainer's go-ahead, push and open "feat(combat): enemies take their turns
  (enemy turns 3/3)". The PR description **must** begin with:

```markdown
> **Deploy ordering: apply `20260915120000_add_combatant_attack_profile`
> before deploying this code.** The finalizer selects `Combatant.attackProfile`
> on every combat action; deploying first stops combat, it does not degrade it.
> The migration is additive and nullable; rollback is reverting the code.
```

  Then list the turn-contract test updates from Task 7 Step 6 by file and
  category. Wait for pre-merge and post-merge "Verify" and "E2E smoke",
  squash-merge, and sync `master`.

---

## Self-review record

**Spec coverage:**

| Spec section | Where |
| --- | --- |
| §4.1-§4.4 | Task 1 |
| §5 | Task 2 |
| §6.1 | Tasks 3 and 6 |
| §6.2 | Tasks 5 and 6 |
| §6.3 | Task 3 |
| §6.4-§6.5 | Task 5 |
| §6.6 | Tasks 6 and 7 |
| §7 | Task 4 and Task 9 Step 3 |
| §8 | Tasks 5-7 |
| §9.1 | Task 1 |
| §9.2 | Task 2 |
| §9.3 | Tasks 3, 6 and 7 |
| §9.4 | Task 6 |
| §9.5 | Tasks 4 and 8 |
| §9.6 | Falsification steps in Tasks 1, 2, 3, 6 and 8 |
| §9.7 | Stage validations and Task 9 |
| §10 | Task 9 |

**Two deliberate deviations, both recorded where they happen:**
- The consequence event is built as a typed literal rather than through
  `buildCombatConsequenceEvent`, which would create an import cycle (Task 5).
- Reduced unit-test doubles without `$queryRaw` skip the lock and the chain,
  the concession the finalizer already makes for them (Task 6). Production
  transactions always expose `$queryRaw`.
