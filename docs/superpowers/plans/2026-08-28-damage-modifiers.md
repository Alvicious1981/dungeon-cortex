# Damage Modifiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A monster's damage immunities, resistances and vulnerabilities change the damage it takes, on both the weapon path and the spell path, from data two seeders have been writing all along.

**Architecture:** One pure rule owns the arithmetic and the damage-type vocabulary. Three additive columns carry the modifiers onto the combatant at spawn. Both damage sites call the same rule, and a test feeds them identical input and demands identical output — the assertion that would have caught the armour-class divergence this repository already paid for.

**Tech Stack:** TypeScript, Next.js 15 App Router, Prisma 6.19.2, PostgreSQL, Vitest 4, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-28-damage-modifiers-design.md` — read it first, especially "The chain, break by break" and "The data splits in two, and only half is resolvable".

## Global Constraints

- **Never run** `prisma migrate`, `prisma db push`, `prisma db seed`, or `prisma db execute`. The database holds a real save. `pnpm generate` (`prisma generate`) **is** allowed and is required — it regenerates the client types from `schema.prisma` without touching the database.
- **The migration is written and not applied.** Task 2 hand-writes the SQL file. The maintainer applies it. Every test in this plan runs against mocks or pure functions, so the suite stays green with the columns absent from the live database.
- **Never read or edit** `.env` or any secrets file.
- **Backend code owns mechanical truth.** A mechanical outcome is never inferred from prose. Conditional clauses in the SRD data are reported unresolved, never guessed.
- **Run the suite as** `pnpm exec vitest run --maxWorkers=2`. Plain `pnpm test` produces worker-startup timeouts on this machine that look like real failures. A single test timing out is usually machine contention — re-run that file alone before concluding it is broken.
- `lib/rules/damage-modifiers.ts` must be `@pure`: no database, no I/O, no randomness, and it must never throw. The three arrays arrive as untyped strings from Postgres.
- **Do not touch** `data/srd-es/monsters.json`. It is read, never edited.
- **Do not implement magical, silvered or adamantine weapons.** The whole second kind of clause waits on that increment.

---

## A dependency decision made up front

`damage-modifiers.ts` needs `DAMAGE_TYPES` as a **value** to tell a bare damage type from a conditional clause. `combat.ts` will import `applyDamageModifiers` as a value. Importing in both directions would close a runtime cycle.

**Resolution: `damage-modifiers.ts` becomes the owner of the damage vocabulary.** It declares `DamageType` and `DAMAGE_TYPES`; `lib/rules/combat.ts` re-exports both from there, so every existing importer of `DamageType` from `combat.ts` keeps working untouched. One definition, one direction, no duplication.

This is a deliberate move, not a drift. The alternative — duplicating the thirteen members — is the failure mode this codebase has spent four increments removing.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/rules/damage-modifiers.ts` *(create)* | Owns the damage-type vocabulary and the SRD arithmetic. Pure. |
| `tests/rules/damage-modifiers.test.ts` *(create)* | Unit behaviour plus the partition test against the real monster file. |
| `lib/rules/combat.ts` *(modify)* | Re-exports the vocabulary; `ComputeConsequencesInput` gains modifiers; `computeConsequences` applies the rule. |
| `prisma/schema.prisma` *(modify, ~242-272)* | Three additive columns on `Combatant`. |
| `prisma/migrations/20260828120000_add_combatant_damage_modifiers/migration.sql` *(create)* | The additive DDL. **Written, not run.** |
| `lib/rules/srd.ts` *(modify, ~137-139)* | `Monster` gains `damage_vulnerabilities`. |
| `lib/rules/srd-monster-lookup.ts` *(modify, ~69-95)* | The projection stops discarding the three columns it selects. |
| `lib/rules/encounter-service.ts` *(modify, ~281-293)* | Spawn copies the modifiers onto the combatant. |
| `lib/memory/context.ts` *(modify, ~81-95, ~322-334)* | `ContextCombatant` and its select carry the three columns. |
| `lib/rules/combat-pipeline.ts` *(modify, ~29-39, ~314-330, ~388)* | `PipelineCombatant` carries them; the spell path applies the rule. |
| `tests/rules/damage-modifiers-both-paths.test.ts` *(create)* | The two damage sites, same input, same number. |

---

### Task 1: The rule and the vocabulary

**Files:**
- Create: `lib/rules/damage-modifiers.ts`
- Create: `tests/rules/damage-modifiers.test.ts`
- Modify: `lib/rules/combat.ts:203-212`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `DamageType`, `DAMAGE_TYPES`, `DamageModifiers`, `ModifiedDamage`, `applyDamageModifiers` — all consumed by Tasks 3 and 4.

- [ ] **Step 1: Write the failing test**

Create `tests/rules/damage-modifiers.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DAMAGE_TYPES,
  applyDamageModifiers,
  type DamageType,
} from "@/lib/rules/damage-modifiers";

const NONE = { immunities: [], resistances: [], vulnerabilities: [] };

function apply(damage: number, damageType: DamageType, modifiers: Partial<typeof NONE>) {
  return applyDamageModifiers({
    damage,
    damageType,
    modifiers: { ...NONE, ...modifiers },
  });
}

describe("applyDamageModifiers — the SRD order", () => {
  it("leaves damage alone when nothing applies", () => {
    expect(apply(10, "fire", {})).toEqual({ damage: 10, applied: "none", unresolved: [] });
  });

  it("immunity takes the damage to zero", () => {
    expect(apply(10, "fire", { immunities: ["fire"] })).toEqual({
      damage: 0,
      applied: "immune",
      unresolved: [],
    });
  });

  it("immunity beats vulnerability rather than fighting it", () => {
    expect(
      apply(10, "fire", { immunities: ["fire"], vulnerabilities: ["fire"] }).damage,
    ).toBe(0);
  });

  it("resistance halves", () => {
    expect(apply(10, "cold", { resistances: ["cold"] })).toEqual({
      damage: 5,
      applied: "resistant",
      unresolved: [],
    });
  });

  it("halving rounds down, including one to zero", () => {
    expect(apply(7, "cold", { resistances: ["cold"] }).damage).toBe(3);
    expect(apply(1, "cold", { resistances: ["cold"] }).damage).toBe(0);
  });

  it("vulnerability doubles", () => {
    expect(apply(7, "bludgeoning", { vulnerabilities: ["bludgeoning"] })).toEqual({
      damage: 14,
      applied: "vulnerable",
      unresolved: [],
    });
  });

  it("resistance and vulnerability on the same type cancel", () => {
    // SRD says so outright. Reporting "cancelled" rather than "none" keeps the
    // two distinguishable: one means the rules met and stopped each other, the
    // other means nothing was ever there.
    expect(
      apply(9, "fire", { resistances: ["fire"], vulnerabilities: ["fire"] }),
    ).toEqual({ damage: 9, applied: "cancelled", unresolved: [] });
  });

  it("ignores a modifier for a different damage type", () => {
    expect(apply(10, "fire", { resistances: ["cold"], immunities: ["poison"] }).damage).toBe(10);
  });

  it("matches case-insensitively and ignores surrounding space", () => {
    expect(apply(10, "fire", { immunities: ["  Fire "] }).damage).toBe(0);
  });
});

describe("applyDamageModifiers — clauses it cannot evaluate", () => {
  const CLAUSE = "bludgeoning, piercing, and slashing from nonmagical weapons";

  it("reports a conditional clause instead of guessing at it", () => {
    const result = apply(10, "slashing", { resistances: [CLAUSE] });

    expect(result.damage).toBe(10);
    expect(result.applied).toBe("none");
    expect(result.unresolved).toEqual([CLAUSE]);
  });

  it("does not let a clause that mentions the type match it", () => {
    // The clause contains the word "slashing". A substring match would halve
    // this, which is a mechanical outcome inferred from prose.
    expect(apply(10, "slashing", { resistances: [CLAUSE] }).damage).toBe(10);
  });

  it("still applies the bare types beside a clause", () => {
    const result = apply(10, "cold", {
      resistances: ["cold", CLAUSE],
    });

    expect(result.damage).toBe(5);
    expect(result.applied).toBe("resistant");
    expect(result.unresolved).toEqual([CLAUSE]);
  });

  it("reports each unresolved clause once, in order, without duplicates", () => {
    const other = "damage from spells";
    expect(apply(10, "fire", { resistances: [CLAUSE, other], immunities: [CLAUSE] }).unresolved)
      .toEqual([CLAUSE, other]);
  });
});

describe("applyDamageModifiers — malformed input", () => {
  it("never throws on values Postgres can hand back", () => {
    for (const junk of [null, undefined, 42, {}, []] as unknown[]) {
      expect(() =>
        applyDamageModifiers({
          damage: 10,
          damageType: "fire",
          modifiers: {
            immunities: junk as string[],
            resistances: junk as string[],
            vulnerabilities: junk as string[],
          },
        }),
      ).not.toThrow();
    }
  });

  it("returns zero damage unchanged rather than doubling it", () => {
    expect(apply(0, "fire", { vulnerabilities: ["fire"] }).damage).toBe(0);
  });

  it("never returns negative damage", () => {
    expect(apply(-5, "fire", {}).damage).toBe(0);
  });
});

/**
 * The partition, against the file the seeder reads.
 *
 * This deliberately does not enumerate the conditional clause shapes. An
 * earlier draft of the spec named five and asserted the list was complete;
 * there were at least six. A test that depends on someone listing every clause
 * correctly breaks the day the SRD data gains another. This asserts instead
 * that every string lands on exactly one side of the line.
 */
const MONSTERS = JSON.parse(
  readFileSync(join(process.cwd(), "data", "srd-es", "monsters.json"), "utf8"),
) as Array<Record<string, unknown>>;

function everyModifierString(): string[] {
  const keys = ["damage_immunities", "damage_resistances", "damage_vulnerabilities"] as const;
  return MONSTERS.flatMap((monster) =>
    keys.flatMap((key) => {
      const value = monster[key];
      return Array.isArray(value) ? (value.filter((v) => typeof v === "string") as string[]) : [];
    }),
  );
}

describe("the real monster file", () => {
  it("has modifier strings to test against at all", () => {
    // Guards the guard: a reader bug that returned [] would make every
    // assertion below vacuously true.
    expect(everyModifierString().length).toBeGreaterThan(100);
  });

  it("partitions every string into matched-or-unresolved, with nothing between", () => {
    for (const raw of everyModifierString()) {
      const normalised = raw.trim().toLowerCase();
      const isBareType = (DAMAGE_TYPES as readonly string[]).includes(normalised);

      if (isBareType) {
        // A bare type is understood: asked about itself, it matches, and
        // nothing is reported as unresolved.
        const result = applyDamageModifiers({
          damage: 10,
          damageType: normalised as DamageType,
          modifiers: { immunities: [raw], resistances: [], vulnerabilities: [] },
        });

        expect(result.damage).toBe(0);
        expect(result.unresolved).toEqual([]);
      } else {
        // A clause changes nothing and is reported verbatim.
        //
        // Asked against a real damage type, never against itself: casting a
        // clause to `DamageType` and passing it as the damage type would make
        // the exact-match succeed against its own string, and this test would
        // assert the opposite of what it means. "fire" is used because no
        // clause in the file is the word "fire".
        const result = applyDamageModifiers({
          damage: 10,
          damageType: "fire",
          modifiers: { immunities: [raw], resistances: [], vulnerabilities: [] },
        });

        expect(result.damage).toBe(10);
        expect(result.unresolved).toEqual([raw]);
      }
    }
  });

  it("finds at least one clause and at least one bare type", () => {
    // Otherwise the branch above could be exercising only one arm.
    const all = everyModifierString().map((s) => s.trim().toLowerCase());
    const bare = all.filter((s) => (DAMAGE_TYPES as readonly string[]).includes(s));
    expect(bare.length).toBeGreaterThan(0);
    expect(all.length - bare.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run tests/rules/damage-modifiers.test.ts --maxWorkers=2
```

Expected: FAIL — `Cannot find package '@/lib/rules/damage-modifiers'`.

- [ ] **Step 3: Write the module**

Create `lib/rules/damage-modifiers.ts`:

```ts
/**
 * lib/rules/damage-modifiers.ts
 *
 * How much of a damage roll actually lands, given what the target resists.
 *
 * @pure — no database, no I/O, no randomness, and never throws.
 *
 * This module exists because the answer was never asked for. `SrdMonster` has
 * carried `damageImmunities`, `damageResistances` and `damageVulnerabilities`
 * since it was written — two seeders populate them and the schema indexes all
 * three — and no rule read any of them. Every fire elemental took full fire
 * damage.
 *
 * ─── Why the vocabulary lives here ───────────────────────────────────────────
 * `DamageType` and `DAMAGE_TYPES` were declared in `lib/rules/combat.ts`. They
 * moved here because this module needs the list as a *value* to tell a bare
 * damage type from a conditional clause, while `combat.ts` needs
 * `applyDamageModifiers` as a value too — and importing both ways closes a
 * runtime cycle. `combat.ts` re-exports both, so every existing importer is
 * untouched. Duplicating the thirteen members would have been the other way
 * out, and duplication is the defect this codebase has spent four increments
 * removing.
 */

export type DamageType =
  | "slashing" | "piercing" | "bludgeoning"
  | "fire" | "cold" | "lightning" | "acid" | "poison"
  | "necrotic" | "radiant" | "psychic" | "thunder" | "force";

export const DAMAGE_TYPES: readonly DamageType[] = Object.freeze([
  "slashing", "piercing", "bludgeoning",
  "fire", "cold", "lightning", "acid", "poison",
  "necrotic", "radiant", "psychic", "thunder", "force",
] as const);

/** A creature's damage modifiers, exactly as the three columns store them. */
export interface DamageModifiers {
  immunities: readonly string[];
  resistances: readonly string[];
  vulnerabilities: readonly string[];
}

export interface ModifiedDamage {
  damage: number;
  /**
   * Which rule produced the number.
   *
   * Reported rather than derived from a before/after comparison, because
   * "halved from 1 to 0" and "immune" both end at 0 and mean different things
   * to whatever narrates the hit.
   */
  applied: "immune" | "resistant" | "vulnerable" | "cancelled" | "none";
  /**
   * Clauses this module could not evaluate, verbatim and de-duplicated, in the
   * order first seen. For the system log — never for a decision.
   */
  unresolved: readonly string[];
}

const EMPTY: readonly string[] = Object.freeze([]);

function asStrings(value: readonly string[] | undefined): readonly string[] {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : EMPTY;
}

function normalise(entry: string): string {
  return entry.trim().toLowerCase();
}

function isBareType(entry: string): boolean {
  return (DAMAGE_TYPES as readonly string[]).includes(normalise(entry));
}

/**
 * Whether any string in `entries` names exactly this damage type.
 *
 * Exact match after trimming and lower-casing, never a substring test. The
 * clause "bludgeoning, piercing, and slashing from nonmagical weapons"
 * contains the word "slashing", and a substring test would halve a sword blow
 * on that basis — a mechanical outcome inferred from prose, which is the one
 * thing this project does not do.
 */
function names(entries: readonly string[], damageType: DamageType): boolean {
  return entries.some((entry) => normalise(entry) === damageType);
}

export function applyDamageModifiers(input: {
  damage: number;
  damageType: DamageType;
  modifiers: DamageModifiers;
}): ModifiedDamage {
  const immunities = asStrings(input.modifiers?.immunities);
  const resistances = asStrings(input.modifiers?.resistances);
  const vulnerabilities = asStrings(input.modifiers?.vulnerabilities);

  const unresolved = [...immunities, ...resistances, ...vulnerabilities]
    .filter((entry) => !isBareType(entry))
    .filter((entry, index, all) => all.indexOf(entry) === index);

  const damage = Math.max(0, Math.floor(input.damage));

  if (names(immunities, input.damageType)) {
    return { damage: 0, applied: "immune", unresolved };
  }

  const resistant = names(resistances, input.damageType);
  const vulnerable = names(vulnerabilities, input.damageType);

  // SRD: resistance and vulnerability to the same damage type cancel. Reported
  // as its own outcome rather than folded into "none", because the two differ
  // in what the narrator may say about the blow.
  if (resistant && vulnerable) return { damage, applied: "cancelled", unresolved };
  if (resistant) return { damage: Math.floor(damage / 2), applied: "resistant", unresolved };
  if (vulnerable) return { damage: damage * 2, applied: "vulnerable", unresolved };

  return { damage, applied: "none", unresolved };
}
```

- [ ] **Step 4: Re-export the vocabulary from its old home**

In `lib/rules/combat.ts`, replace the declaration at lines 203-212:

```ts
export type DamageType =
  | "slashing" | "piercing" | "bludgeoning"
  | "fire" | "cold" | "lightning" | "acid" | "poison"
  | "necrotic" | "radiant" | "psychic" | "thunder" | "force";

export const DAMAGE_TYPES: DamageType[] = [
  "slashing", "piercing", "bludgeoning",
  "fire", "cold", "lightning", "acid", "poison",
  "necrotic", "radiant", "psychic", "thunder", "force",
];
```

with a re-export, so every existing `import { type DamageType } from "@/lib/rules/combat"` keeps working:

```ts
// The vocabulary moved to `lib/rules/damage-modifiers.ts`, which needs the list
// as a value while this file needs `applyDamageModifiers` as one. Re-exported
// here so no importer had to change.
export { DAMAGE_TYPES, type DamageType } from "@/lib/rules/damage-modifiers";
```

`DAMAGE_TYPES` changes from `DamageType[]` to `readonly DamageType[]`. If any caller mutates it, that is a bug this surfaces — report it rather than widening the type back.

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm exec vitest run tests/rules/damage-modifiers.test.ts --maxWorkers=2
```

Expected: PASS, all cases.

- [ ] **Step 6: Typecheck, then the full suite**

```bash
pnpm typecheck
```

```bash
pnpm exec vitest run --maxWorkers=2
```

Expected: PASS. The re-export is the risky part — if a file imported `DAMAGE_TYPES` and mutated or re-sorted it, it fails here. Fix the caller, not the type.

- [ ] **Step 7: Commit**

```bash
git add lib/rules/damage-modifiers.ts tests/rules/damage-modifiers.test.ts lib/rules/combat.ts
git commit -m "feat(combat): resolve damage against a creature's modifiers"
```

---

### Task 2: The columns and the producer chain

**Files:**
- Modify: `prisma/schema.prisma:242-272`
- Create: `prisma/migrations/20260828120000_add_combatant_damage_modifiers/migration.sql`
- Modify: `lib/rules/srd.ts:137-139`
- Modify: `lib/rules/srd-monster-lookup.ts` (the `.map((row): Monster => …)` projection)
- Modify: `lib/rules/encounter-service.ts:281-293`
- Test: `tests/rules/encounter-service-contract.test.ts` (append)

**Interfaces:**
- Consumes: `DamageModifiers` from Task 1 (shape only — this task stores the arrays, it does not apply them).
- Produces: `Combatant.damageImmunities`, `.damageResistances`, `.damageVulnerabilities`, each `string[]`, defaulting to `[]`; `Monster.damage_vulnerabilities?: string[]`. Tasks 3 and 4 read these.

**Why the migration is written and not run:** the database holds a real save. `pnpm generate` regenerates the client types from `schema.prisma` without touching the database, which is what lets the rest of this plan compile and its tests pass. The DDL is applied by the maintainer, separately.

- [ ] **Step 1: Add the columns to the schema**

In `prisma/schema.prisma`, inside `model Combatant`, after `stats` and `conditions`:

```prisma
  /// SRD damage modifiers, snapshotted from the monster at spawn. Same names
  /// and shapes as SrdMonster's, so no reader has to translate between them.
  /// Empty for the player: no rule in this codebase grants a player resistance.
  damageImmunities      String[] @default([])
  damageResistances     String[] @default([])
  damageVulnerabilities String[] @default([])
```

- [ ] **Step 2: Regenerate the client, and confirm the columns exist in the types**

```bash
pnpm generate
```

```bash
pnpm typecheck
```

Expected: both succeed. `prisma generate` reads `schema.prisma` only — it does not connect to the database. If `pnpm generate` attempts a connection or fails on a missing `DATABASE_URL`, **stop and report it**; do not work around it by running any `prisma migrate` or `db` command.

- [ ] **Step 3: Hand-write the migration, and do not run it**

Create `prisma/migrations/20260828120000_add_combatant_damage_modifiers/migration.sql`. This follows `20260814120000_add_combatant_xp_value_snapshot/migration.sql` exactly — read that file first and match its structure and its Spanish commentary:

```sql
-- Añade los modificadores de daño SRD sobre "Combatant", copiados del monstruo
-- en la creación del encuentro (docs/superpowers/specs/2026-08-28-damage-modifiers-design.md).
--
-- ADITIVA. Añade exclusivamente tres columnas TEXT[] con DEFAULT '{}'.
--
-- Aquí el DEFAULT sí es correcto, al contrario que en xpValue: "sin
-- modificadores" y "array vacío" son la misma afirmación, así que rellenar las
-- filas existentes con '{}' no inventa ningún dato. Un combatiente legacy
-- seguirá recibiendo exactamente el daño que recibe hoy.
--
-- No hay UPDATE ni backfill. Rellenar un combatiente ya persistido exigiría
-- adivinar de qué monstruo salió a partir de su nombre, y esa no es una
-- decisión que le corresponda a una migración de esquema.
--
-- No se añaden índices: estas columnas se leen por fila, nunca como criterio
-- de consulta. SrdMonster sí las indexa porque allí sirven para filtrar.
--
-- ─── Por qué un bloque DO ────────────────────────────────────────────────────
-- Igual que 20260814120000: un bloque DO es una sola sentencia, así que
-- PostgreSQL lo ejecuta de forma atómica en cualquier invocación —incluido
-- psql en autocommit— y revierte junto con su DDL si algo falla.
DO $add_combatant_damage_modifiers$
BEGIN
  -- IF NOT EXISTS protege el escenario en el que las columnas ya existieran
  -- por una vía distinta (p.ej. `db push` histórico).
  EXECUTE 'ALTER TABLE "Combatant" ADD COLUMN IF NOT EXISTS "damageImmunities" TEXT[] NOT NULL DEFAULT ''{}''';
  EXECUTE 'ALTER TABLE "Combatant" ADD COLUMN IF NOT EXISTS "damageResistances" TEXT[] NOT NULL DEFAULT ''{}''';
  EXECUTE 'ALTER TABLE "Combatant" ADD COLUMN IF NOT EXISTS "damageVulnerabilities" TEXT[] NOT NULL DEFAULT ''{}''';
END
$add_combatant_damage_modifiers$;
```

**Do not run this file.** Do not run `prisma migrate dev`, `prisma migrate deploy`, `prisma db push`, or `prisma db execute`. Creating the file is the whole of this step.

- [ ] **Step 4: Complete the `Monster` schema**

In `lib/rules/srd.ts`, beside the two that already exist at lines 137-138:

```ts
  damage_immunities: z.array(z.string()).optional(),
  damage_resistances: z.array(z.string()).optional(),
  damage_vulnerabilities: z.array(z.string()).optional(),
  condition_immunities: z.array(z.any()).optional(),
```

The vulnerabilities line is the addition. The schema declared two thirds of a triple.

- [ ] **Step 5: Write the failing test for the projection and the spawn**

Append to `tests/rules/encounter-service-contract.test.ts`. Read the top of that file first and reuse its existing helpers and fixture builders — do not introduce a second way of constructing an encounter.

```ts
describe("damage modifiers reach the combatant", () => {
  it("copies all three arrays from the monster onto the spawned combatant", async () => {
    // The monster the fixture spawns must carry modifiers for this to mean
    // anything; assert that first so a fixture change cannot make this vacuous.
    const monster = {
      name: "Fire Elemental",
      hit_points: 102,
      damage_immunities: ["fire", "poison"],
      damage_resistances: ["bludgeoning, piercing, and slashing from nonmagical weapons"],
      damage_vulnerabilities: [],
    };

    const created = await spawnWith(monster);
    const enemy = created.find((c) => !c.isPlayer)!;

    expect(enemy.damageImmunities).toEqual(["fire", "poison"]);
    expect(enemy.damageResistances).toEqual([
      "bludgeoning, piercing, and slashing from nonmagical weapons",
    ]);
    expect(enemy.damageVulnerabilities).toEqual([]);
  });

  it("gives the player three empty arrays, never undefined", () => {
    // A rule reading `undefined.length` is the failure this prevents. Nothing
    // in this codebase grants a player resistance, so empty is the truth.
    const player = createdCombatants().find((c) => c.isPlayer)!;

    expect(player.damageImmunities).toEqual([]);
    expect(player.damageResistances).toEqual([]);
    expect(player.damageVulnerabilities).toEqual([]);
  });
});
```

> `spawnWith` and `createdCombatants` **do not exist** — they are stand-ins. The file has `mockRandom` (line 27) and `createDb` (line 32), and drives `createEncounter` through that db double. Read it, find how it inspects the `combatants: { create: … }` payload, and express these two assertions in that pattern. The assertion that matters is the first: **all three arrays arrive**, including the unresolvable clause, verbatim.

- [ ] **Step 6: Run it to verify it fails**

```bash
pnpm exec vitest run tests/rules/encounter-service-contract.test.ts --maxWorkers=2
```

Expected: FAIL — the combatant payload has no `damageImmunities` key.

- [ ] **Step 7: Stop the lookup discarding what it selects**

In `lib/rules/srd-monster-lookup.ts`, inside the `.map((row): Monster => ({ … }))` projection, add the three fields beside the ones already mapped:

```ts
      damage_immunities: row.damageImmunities,
      damage_resistances: row.damageResistances,
      damage_vulnerabilities: row.damageVulnerabilities,
```

The `select` at lines 59-61 already asks Prisma for all three. They were read from the database and dropped one line later.

- [ ] **Step 8: Copy them at spawn**

In `lib/rules/encounter-service.ts`, in the monster branch of `combatantData` (around line 282), beside `stats`:

```ts
      stats: monsterAbilityScores(monster),
      // Snapshotted rather than looked up at damage time: Combatant has no
      // reference back to SrdMonster, only a name, and resolving by name in the
      // combat path would be a guess dressed as a query.
      damageImmunities: monster.damage_immunities ?? [],
      damageResistances: monster.damage_resistances ?? [],
      damageVulnerabilities: monster.damage_vulnerabilities ?? [],
```

And in the player branch (around line 263), beside `stats`:

```ts
      stats,
      // Explicit, not defaulted: a rule that reads `.length` must never meet
      // undefined. No rule in this codebase grants a player resistance.
      damageImmunities: [],
      damageResistances: [],
      damageVulnerabilities: [],
```

- [ ] **Step 9: Run the tests, then the full suite**

```bash
pnpm exec vitest run tests/rules/encounter-service-contract.test.ts --maxWorkers=2
```

```bash
pnpm exec vitest run --maxWorkers=2
```

Expected: PASS. Other encounter tests may assert the combatant payload by exact equality and now see three new keys — update those expectations; do not revert the payload.

- [ ] **Step 10: Commit**

```bash
git add prisma/schema.prisma prisma/migrations lib/rules/srd.ts lib/rules/srd-monster-lookup.ts lib/rules/encounter-service.ts tests/rules/encounter-service-contract.test.ts
git commit -m "feat(combat): carry a monster's damage modifiers onto its combatant"
```

---

### Task 3: The weapon path

**Files:**
- Modify: `lib/rules/combat.ts:293-315` (`ComputeConsequencesInput`) and `:686-692` (the hp computation)
- Modify: `lib/memory/context.ts:81-95` (`ContextCombatant`) and `:322-334` (the select)
- Modify: `lib/rules/combat-pipeline.ts:29-39` (`PipelineCombatant`) and `:314-330` (the `computeConsequences` call)
- Test: `tests/rules/combat.test.ts` (append) — **this is where `computeConsequences` is tested**, not `combat-service-contract.test.ts`, which exercises a service through a transaction double

**Interfaces:**
- Consumes: `applyDamageModifiers`, `DamageModifiers`, `ModifiedDamage` from Task 1; the three combatant columns from Task 2.
- Produces: `ComputeConsequencesInput.targetModifiers?: DamageModifiers` and `CombatConsequences.damageUnresolved: readonly string[]`, both consumed by Task 4.

- [ ] **Step 1: Write the failing test**

Append to `tests/rules/combat.test.ts`. That file already calls `computeConsequences` directly (see line 781) with a full literal input and has `makeSnapshot()` at line 233. It has **no** shared input builder, so write one once at the top of the new describe block — modelled on the literal at line 781 — and reuse it across all five cases rather than pasting the object five times:

```ts
function consequenceInput(overrides: Partial<ComputeConsequencesInput> = {}): ComputeConsequencesInput {
  return {
    attacker: "PC:Kara",
    defender: "NPC:Goblin",
    weapon: "Longsword",
    // 0d1 plus a flat bonus makes the damage deterministic, so these cases
    // assert the modifier rather than the dice.
    weaponDice: "0d1",
    flatDamageBonus: 10,
    attackModifier: 100,
    damageType: "slashing",
    targetAC: 1,
    targetHp: 50,
    targetMaxHp: 50,
    targetIsPlayer: false,
    targetIsBoss: false,
    statusApplied: [],
    attackerConditions: [],
    defenderConditions: [],
    isMelee: true,
    encounterSnapshot: makeSnapshot(),
    usedSenses: [],
    zones: [],
    ...overrides,
  };
}
```

Confirm `rollDamage` accepts `"0d1"` before relying on it. If it does not, use `mockRandom` — which `tests/rules/combat-service-contract.test.ts:17` demonstrates — or whatever this file already uses to fix dice, and say which in the report.

```ts
describe("computeConsequences applies the target's damage modifiers", () => {
  const NO_MODIFIERS = { immunities: [], resistances: [], vulnerabilities: [] };

  it("halves a hit against a resistant target", () => {
    // Forced hit and fixed dice: this asserts the modifier, not the roll.
    const result = computeConsequences({
      ...consequenceInput(),
      weaponDice: "0d1",
      flatDamageBonus: 10,
      attackModifier: 100,
      targetAC: 1,
      damageType: "slashing",
      targetHp: 50,
      targetModifiers: { ...NO_MODIFIERS, resistances: ["slashing"] },
    });

    expect(result.combat_facts.damage).toBe(5);
    expect(result.combat_facts.hp_after).toBe(45);
  });

  it("takes an immune target to zero and leaves its hit points alone", () => {
    const result = computeConsequences({
      ...consequenceInput(),
      weaponDice: "0d1",
      flatDamageBonus: 10,
      attackModifier: 100,
      targetAC: 1,
      damageType: "fire",
      targetHp: 50,
      targetModifiers: { ...NO_MODIFIERS, immunities: ["fire"] },
    });

    expect(result.combat_facts.damage).toBe(0);
    expect(result.combat_facts.hp_after).toBe(50);
  });

  it("reports an unresolvable clause and applies nothing", () => {
    const clause = "bludgeoning, piercing, and slashing from nonmagical weapons";
    const result = computeConsequences({
      ...consequenceInput(),
      weaponDice: "0d1",
      flatDamageBonus: 10,
      attackModifier: 100,
      targetAC: 1,
      damageType: "slashing",
      targetHp: 50,
      targetModifiers: { ...NO_MODIFIERS, resistances: [clause] },
    });

    expect(result.combat_facts.damage).toBe(10);
    expect(result.damageUnresolved).toEqual([clause]);
  });

  it("is unchanged for a target with no modifiers", () => {
    // The regression guard for every encounter already in flight.
    const result = computeConsequences({
      ...consequenceInput(),
      weaponDice: "0d1",
      flatDamageBonus: 10,
      attackModifier: 100,
      targetAC: 1,
      damageType: "slashing",
      targetHp: 50,
      targetModifiers: NO_MODIFIERS,
    });

    expect(result.combat_facts.damage).toBe(10);
    expect(result.damageUnresolved).toEqual([]);
  });

  it("is unchanged when the caller passes no modifiers at all", () => {
    const result = computeConsequences({
      ...consequenceInput(),
      weaponDice: "0d1",
      flatDamageBonus: 10,
      attackModifier: 100,
      targetAC: 1,
      damageType: "slashing",
      targetHp: 50,
    });

    expect(result.combat_facts.damage).toBe(10);
  });
});
```

> `consequenceInput()` is the builder from Step 1 above. `attackModifier: 100` against `targetAC: 1` forces a hit, so these cases never flake on a miss — but a critical is still possible, and a crit would double the dice. With `weaponDice: "0d1"` there are no dice to double, so `flatDamageBonus` carries the whole figure and a crit changes nothing. **Verify that claim against `rollDamage` before relying on it**; if a crit does alter the total, fix the roll with `mockRandom` instead and say so in the report.

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm exec vitest run tests/rules/combat-service-contract.test.ts --maxWorkers=2
```

Expected: FAIL — `targetModifiers` is not a known property, and `damageUnresolved` does not exist.

- [ ] **Step 3: Widen the input and the result**

In `lib/rules/combat.ts`, add to `ComputeConsequencesInput` (after `isMelee`, line 311):

```ts
  /**
   * The target's SRD damage modifiers. Optional so that every existing caller
   * and fixture keeps compiling; absent means no modifiers, which is what a
   * combatant spawned before this shipped genuinely has.
   */
  targetModifiers?: DamageModifiers;
```

Add to the `CombatConsequences` interface, beside `combat_facts`:

```ts
  /** Modifier clauses the engine could not evaluate. For the system log. */
  damageUnresolved: readonly string[];
```

Add the import at the top of `combat.ts`:

```ts
import { applyDamageModifiers, type DamageModifiers } from "@/lib/rules/damage-modifiers";
```

- [ ] **Step 4: Apply the rule where the damage is decided**

In `computeConsequences`, destructure `targetModifiers` alongside the rest of the input, then replace step 3 (lines 687-691):

```ts
  // 3. Apply damage and compute overkill.
  const hpBefore = targetHp;
  const hpAfter  = Math.max(0, hpBefore - damage);
  const overkill = computeOverkill(damage, hpBefore);
```

with:

```ts
  // 3. Resolve the damage against what the target resists, then apply it.
  //
  // Between the roll and the subtraction, so that `damage` on the facts is the
  // damage that happened. Carrying both figures would be how the narrator ends
  // up describing the one that did not.
  const modified = applyDamageModifiers({
    damage,
    damageType,
    modifiers: targetModifiers ?? {
      immunities: [],
      resistances: [],
      vulnerabilities: [],
    },
  });

  const hpBefore = targetHp;
  const hpAfter  = Math.max(0, hpBefore - modified.damage);
  const overkill = computeOverkill(modified.damage, hpBefore);
```

Then in the `combat_facts` object below, change `damage` to `modified.damage`, and add `damageUnresolved: modified.unresolved` to the returned `CombatConsequences`.

Leave `rollsArr` alone: it reports what the dice showed, which is still true.

- [ ] **Step 5: Plumb the columns to the call site**

In `lib/memory/context.ts`, add to the `combatants` select (after `stats: true`, line 332):

```ts
            damageImmunities: true,
            damageResistances: true,
            damageVulnerabilities: true,
```

and to `ContextCombatant` (after `stats`, line 93):

```ts
  /** SRD damage modifiers, snapshotted at spawn. Empty for the player. */
  damageImmunities: string[];
  damageResistances: string[];
  damageVulnerabilities: string[];
```

In `lib/rules/combat-pipeline.ts`, add to `PipelineCombatant` (after `stats`, line 37):

```ts
  damageImmunities?: string[];
  damageResistances?: string[];
  damageVulnerabilities?: string[];
```

Optional here, because test doubles for this interface predate the columns.

Then in the `computeConsequences` call (around line 314), pass them:

```ts
        targetModifiers: {
          immunities: target.damageImmunities ?? [],
          resistances: target.damageResistances ?? [],
          vulnerabilities: target.damageVulnerabilities ?? [],
        },
```

- [ ] **Step 6: Run the tests, typecheck, then the full suite**

```bash
pnpm exec vitest run tests/rules/combat-service-contract.test.ts --maxWorkers=2
```

```bash
pnpm typecheck
```

```bash
pnpm exec vitest run --maxWorkers=2
```

Expected: PASS. Tests that assert a `CombatConsequences` object by exact equality now see `damageUnresolved` — add it to those expectations rather than loosening the assertion to `toMatchObject`.

- [ ] **Step 7: Commit**

```bash
git add lib/rules/combat.ts lib/memory/context.ts lib/rules/combat-pipeline.ts tests/rules/combat-service-contract.test.ts
git commit -m "feat(combat): resolve weapon damage against the target's modifiers"
```

---

### Task 4: The spell path, and proving the two agree

**Files:**
- Modify: `lib/rules/combat-pipeline.ts:356-390`
- Modify: `lib/rules/damage-modifiers.ts` — Step 4 adds `unresolvedModifierLog` to the module Task 1 created
- Create: `tests/rules/damage-modifiers-both-paths.test.ts`
- Test: `tests/rules/combat-pipeline.test.ts` (append)

**Interfaces:**
- Consumes: `applyDamageModifiers` from Task 1; the `PipelineCombatant` fields and `targetModifiers` wiring from Task 3.
- Produces: nothing new. This task closes the second site and proves both agree.

**Why this task is separate:** a rule applied at one damage site and not the other is the defect this repository has already paid for once — two armour-class calculations that disagreed about what counted. Task 3 and this task are reviewed separately so that the gap between them is visible if it survives.

- [ ] **Step 1: Write the agreement test**

Create `tests/rules/damage-modifiers-both-paths.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyDamageModifiers } from "@/lib/rules/damage-modifiers";

/**
 * The two damage sites, given the same input, must reach the same number.
 *
 * `lib/rules/combat.ts` decides hit points for a weapon attack and
 * `lib/rules/combat-pipeline.ts` decides them for a spell, independently. This
 * codebase has already paid once for two implementations of one rule drifting:
 * two armour-class calculations disagreed about which armour counted, one
 * deciding what the player was attacked against and the other what they were
 * shown. This file exists so that cannot happen here quietly.
 */
describe("both damage paths resolve modifiers identically", () => {
  const CASES = [
    { damage: 10, damageType: "fire" as const, immunities: ["fire"], expected: 0 },
    { damage: 10, damageType: "cold" as const, resistances: ["cold"], expected: 5 },
    { damage: 7, damageType: "cold" as const, resistances: ["cold"], expected: 3 },
    { damage: 7, damageType: "bludgeoning" as const, vulnerabilities: ["bludgeoning"], expected: 14 },
    { damage: 9, damageType: "fire" as const, resistances: ["fire"], vulnerabilities: ["fire"], expected: 9 },
    { damage: 10, damageType: "slashing" as const, resistances: ["cold"], expected: 10 },
  ];

  for (const testCase of CASES) {
    it(`agrees on ${testCase.damage} ${testCase.damageType}`, () => {
      const modifiers = {
        immunities: testCase.immunities ?? [],
        resistances: testCase.resistances ?? [],
        vulnerabilities: testCase.vulnerabilities ?? [],
      };

      const weaponPath = damageAfterWeaponAttack({
        damage: testCase.damage,
        damageType: testCase.damageType,
        modifiers,
      });

      const spellPath = damageAfterSpell({
        damage: testCase.damage,
        damageType: testCase.damageType,
        modifiers,
      });

      expect(weaponPath).toBe(testCase.expected);
      expect(spellPath).toBe(testCase.expected);
      expect(weaponPath).toBe(spellPath);
    });
  }
});
```

> `damageAfterWeaponAttack` and `damageAfterSpell` must drive the **real** code paths — `computeConsequences` for the first, and `executeCombatAction`'s spell branch for the second — not call `applyDamageModifiers` twice. A test that calls the shared function twice proves the shared function is deterministic, which nobody doubted; it proves nothing about whether both sites call it.
>
> Write those two helpers in this file against the same harnesses Tasks 3 and 4's other tests use. If driving `executeCombatAction` needs a transaction double, reuse the one in `tests/rules/combat-pipeline.test.ts` rather than writing a second. If a path genuinely cannot be driven in isolation, **stop and report it** rather than substituting a direct call to `applyDamageModifiers` — that substitution would turn this file into exactly the test it was written to prevent.

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm exec vitest run tests/rules/damage-modifiers-both-paths.test.ts --maxWorkers=2
```

Expected: FAIL — the spell path ignores modifiers entirely, so every case where the expected value differs from the raw damage is wrong on `spellPath`.

- [ ] **Step 3: Apply the rule on the spell path**

In `lib/rules/combat-pipeline.ts`, the spell branch computes `damage` at lines 356-366 and then builds facts and `newHp`. Insert the resolution immediately after `damage` is finalised and **before** the `if (damage > 0)` block at line 367:

```ts
      const modified = applyDamageModifiers({
        damage,
        damageType: normalizeDamageType(effect.damageType),
        modifiers: {
          immunities: target.damageImmunities ?? [],
          resistances: target.damageResistances ?? [],
          vulnerabilities: target.damageVulnerabilities ?? [],
        },
      });

      damage = modified.damage;
      damageUnresolved = modified.unresolved;
```

Declare `damageUnresolved` beside `let damage = 0;` at line 286:

```ts
    let damageUnresolved: readonly string[] = [];
```

Everything downstream — the facts, `newHp` at line 388, `totalDamageDealt` at 395, and the concentration check at 452 — then reads the modified figure without further change, because they all read `damage`.

Add the import:

```ts
import { applyDamageModifiers } from "@/lib/rules/damage-modifiers";
```

- [ ] **Step 4: Surface the unresolved clauses in the system log**

Both paths now produce unresolved clauses and neither says so. Follow the precedent in `lib/rules/weapon-attack.ts:83` — read `unresolvedCategoryLog` first and match its shape and tone.

Add to `lib/rules/damage-modifiers.ts`:

```ts
/**
 * A system-log line for clauses the engine could not evaluate, or null when
 * there is nothing to say.
 *
 * Declared rather than silent, exactly as `unresolvedCategoryLog` declares an
 * unresolved weapon category. A player whose sword is not bouncing off the
 * werewolf is owed the reason, and a resolution the engine did not make must
 * never look like one it did.
 */
export function unresolvedModifierLog(input: {
  defenderName: string;
  unresolved: readonly string[];
}): string | null {
  if (input.unresolved.length === 0) return null;

  return (
    `⚠️ ${input.defenderName}: damage modifier not applied — ` +
    `"${input.unresolved.join('", "')}" depends on whether the attack was ` +
    `magical, silvered or adamantine, which this engine does not track. ` +
    `Full damage was applied.`
  );
}
```

Call it in `lib/rules/combat-pipeline.ts` where the pipeline already writes system logs, using `damageUnresolved` and `target.name`. Read how the file writes its existing `⚠️` lines and follow that; if it does not write any, push the line onto the same collection the other declared refusals use and say which one in the report.

- [ ] **Step 5: Add the pipeline's own test**

Append to `tests/rules/combat-pipeline.test.ts`, reusing the file's existing transaction double and combatant fixtures:

```ts
it("halves spell damage against a resistant target", async () => {
  // Reuse this file's existing way of driving a cast; only the target's
  // modifiers and the expected hit points are new.
  const target = { ...enemyFixture(), hp: 50, damageResistances: ["fire"] };
  const result = await castFireballAt(target, { rolledDamage: 10 });

  expect(result.combatants.find((c) => c.id === target.id)!.hp).toBe(45);
});

it("logs a clause it cannot evaluate instead of applying it", async () => {
  const clause = "bludgeoning, piercing, and slashing from nonmagical weapons";
  const target = { ...enemyFixture(), hp: 50, damageResistances: [clause] };
  const result = await castFireballAt(target, { rolledDamage: 10 });

  expect(result.combatants.find((c) => c.id === target.id)!.hp).toBe(40);
  expect(systemLogLines(result).some((line) => line.includes("not applied"))).toBe(true);
});
```

> `enemyFixture`, `castFireballAt` and `systemLogLines` stand in for this file's existing helpers. Read it and use what is there.

- [ ] **Step 6: Run everything**

```bash
pnpm exec vitest run tests/rules/damage-modifiers-both-paths.test.ts tests/rules/combat-pipeline.test.ts --maxWorkers=2
```

```bash
pnpm typecheck && pnpm lint
```

```bash
pnpm exec vitest run --maxWorkers=2
```

Expected: PASS throughout.

- [ ] **Step 7: Commit**

```bash
git add lib/rules/combat-pipeline.ts lib/rules/damage-modifiers.ts tests/rules/damage-modifiers-both-paths.test.ts tests/rules/combat-pipeline.test.ts
git commit -m "feat(combat): resolve spell damage against the target's modifiers"
```

---

## Whole-branch review

Not optional, and it does not substitute for the per-task gates. On the previous four branches this step found a produced-never-consumed field, a false guarantee written in a code comment, and a free armour-class bonus reachable through legacy data — none of which the per-task reviews caught.

- [ ] **Step 1: Read the whole diff against the spec**

```bash
git diff origin/master...HEAD
```

For each claim in `docs/superpowers/specs/2026-08-28-damage-modifiers-design.md`, name the line that implements it.

- [ ] **Step 2: Dispatch the two auditors**

Both are read-only. The questions to put to them:

- To `dormant-defect-hunter`: is `ModifiedDamage.applied` consumed anywhere, or produced and never read? Does `damageUnresolved` reach a log, or stop at the type? Did `conditionImmunities` stay out, as the spec says, or get half-wired? Does anything still read `DAMAGE_TYPES` from its old home in a way the re-export does not cover?
- To `mock-fidelity-auditor`: does `tests/rules/damage-modifiers-both-paths.test.ts` genuinely drive both production paths, or does it call `applyDamageModifiers` twice and prove nothing? Does the partition test read the real `monsters.json`?

- [ ] **Step 3: One fix wave, then one scoped re-review**

Fix what they find in a single pass, with a recorded ruling for anything deliberately not fixed.

- [ ] **Step 4: Final verification**

```bash
pnpm exec vitest run --maxWorkers=2
```

```bash
pnpm typecheck && pnpm lint
```

- [ ] **Step 5: Hand the migration over explicitly**

The branch is not finished by a green suite. Tell the maintainer, in the summary: the migration file exists, it has not been run, and until it is, `Combatant` has no such columns in the live database — so any query selecting them will fail at runtime even though every test passes. Name the file path.

---

## Out of scope, recorded

- **Magical, silvered and adamantine weapons.** The entire second kind of clause waits on this. It is a property of items and attacks, not of damage.
- **Condition immunities.** `SrdMonster.conditionImmunities` has the same disease and `lib/memory/formatter.ts:187` reads it through the same cast that cannot succeed. Different rule, different registry, its own increment.
- **Player resistances.** The columns accept them; nothing produces them.
- **The formatter's phantom read.** `lib/memory/formatter.ts:182-190` casts ability scores to `Monster` and reads fields that were never there. Once the combatant carries the arrays this could be made to work, but it changes what the AI is told, and merging a narration change into a rules increment blurs both.
- **Backfilling existing encounters.** Would require guessing which monster a persisted row came from, by name.
