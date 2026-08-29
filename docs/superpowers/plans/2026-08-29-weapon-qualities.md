# Weapon Qualities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the SRD clause "physical damage from nonmagical weapons" — and its silvered and adamantine variants — resolve against the weapon that actually struck, instead of being reported unresolved and paid in full.

**Architecture:** A curated table maps the exact clause strings in the monster data to a structured meaning; nothing parses prose. A weapon's qualities are read once, where the weapon's `properties` are already read, and travel to the damage rule as an optional attack descriptor. Absent descriptor means the clause stays unresolved, so no existing caller changes behaviour by not being updated.

**Tech Stack:** TypeScript, Next.js App Router, Prisma, Vitest. Run tests with `npx vitest run <path>`, types with `npx tsc --noEmit`, lint with `npx next lint --file <path>`.

**Spec:** `docs/superpowers/specs/2026-08-29-weapon-qualities-design.md` — read it before Task 1; every decision below is argued there.

## Global Constraints

- Backend code owns mechanical truth. AI narration only describes outcomes the backend already resolved. (`CLAUDE.md`, `AGENTS.md`)
- D&D 5e/SRD 2014 is the only rules baseline. No AD&D, OSR, THAC0, descending AC.
- A mechanical outcome is never inferred from prose. A clause string is recognised verbatim or it is not recognised at all.
- Every new rule module is pure: no database, no I/O, no randomness, never throws. State this in the module header.
- Test-first. Watch each test fail for the expected reason before implementing, and falsify each new rule line by breaking it and confirming a specific test dies.
- Do not claim a feature is complete unless validation supports it. The full suite is `npx vitest run` and it must be green before the final commit.
- Comments explain *why*, in the voice of the surrounding modules. Do not narrate what the code plainly says.

---

### Task 1: The weapon quality vocabulary

**Files:**
- Create: `lib/rules/weapon-quality.ts`
- Test: `tests/rules/weapon-quality.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `WEAPON_QUALITIES: readonly ["magical", "silvered", "adamantine"]`
  - `type WeaponQuality = (typeof WEAPON_QUALITIES)[number]`
  - `weaponQualitiesFor(properties: unknown): readonly WeaponQuality[]`

- [ ] **Step 1: Write the failing test**

Create `tests/rules/weapon-quality.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { weaponQualitiesFor, WEAPON_QUALITIES } from "@/lib/rules/weapon-quality";

/**
 * Nothing in the game said a weapon was magical, so six SRD damage clauses
 * were paid in full. A declared quality is authoritative; a numeric bonus is
 * the SRD's own definition of a magic weapon, so it derives one. Anything else
 * grants nothing, because guessing is what this project does not do.
 */
describe("weaponQualitiesFor", () => {
  it("reads a declared quality", () => {
    expect(weaponQualitiesFor({ qualities: ["silvered"] })).toEqual(["silvered"]);
  });

  it("normalises case and whitespace on a declared quality", () => {
    expect(weaponQualitiesFor({ qualities: [" Adamantine "] })).toEqual(["adamantine"]);
  });

  it("grants nothing for a quality it does not know", () => {
    expect(weaponQualitiesFor({ qualities: ["cold-iron", "blessed"] })).toEqual([]);
  });

  it("derives magical from a damage bonus", () => {
    expect(weaponQualitiesFor({ damageBonus: 1 })).toEqual(["magical"]);
  });

  it("derives nothing from a zero or absent bonus", () => {
    expect(weaponQualitiesFor({ damageBonus: 0 })).toEqual([]);
    expect(weaponQualitiesFor({ damageDice: "1d8" })).toEqual([]);
  });

  it("leaves a silvered weapon nonmagical when it has no bonus", () => {
    // The whole point of the "that aren't silvered" wording: silver lifts that
    // clause and does not lift the plain nonmagical one.
    const qualities = weaponQualitiesFor({ qualities: ["silvered"] });
    expect(qualities).toContain("silvered");
    expect(qualities).not.toContain("magical");
  });

  it("does not repeat magical when it is both declared and derived", () => {
    expect(weaponQualitiesFor({ qualities: ["magical"], damageBonus: 2 })).toEqual(["magical"]);
  });

  it("grants nothing for a row with no properties at all", () => {
    expect(weaponQualitiesFor(null)).toEqual([]);
    expect(weaponQualitiesFor(undefined)).toEqual([]);
    expect(weaponQualitiesFor("a string")).toEqual([]);
  });

  it("exports the three qualities the engine knows", () => {
    expect([...WEAPON_QUALITIES]).toEqual(["magical", "silvered", "adamantine"]);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/rules/weapon-quality.test.ts`
Expected: FAIL — the module does not exist, so the import cannot resolve.

- [ ] **Step 3: Write the module**

Create `lib/rules/weapon-quality.ts`:

```typescript
/**
 * lib/rules/weapon-quality.ts
 *
 * What a weapon is made of, and whether it is magical, for the three qualities
 * the SRD's damage clauses actually ask about.
 *
 * @pure — no database, no I/O, no randomness, and never throws.
 *
 * ─── Why a bonus means magic ─────────────────────────────────────────────────
 * A declared quality is authoritative. Absent one, `damageBonus > 0` derives
 * `magical`, because in the SRD a weapon with a bonus to attack and damage
 * rolls *is* a magic weapon — the bonus is the definition, not a hint. That is
 * reading a mechanical field, which is a different act from reading prose: the
 * forty `effect` strings in the loot data stay unread for exactly that reason.
 *
 * An unrecognised quality grants nothing. A row is free to claim "blessed";
 * this module has no rule for it and inventing one would be guessing at free
 * text, which is the line this project does not cross.
 */

export const WEAPON_QUALITIES = ["magical", "silvered", "adamantine"] as const;

export type WeaponQuality = (typeof WEAPON_QUALITIES)[number];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toQuality(value: unknown): WeaponQuality | null {
  if (typeof value !== "string") return null;
  const normalised = value.trim().toLowerCase();
  return (WEAPON_QUALITIES as readonly string[]).includes(normalised)
    ? (normalised as WeaponQuality)
    : null;
}

/**
 * The qualities an equipped weapon's persisted `properties` blob declares or
 * implies, de-duplicated and in the order this module decides them.
 */
export function weaponQualitiesFor(properties: unknown): readonly WeaponQuality[] {
  const root = asRecord(properties);
  if (root === null) return [];

  const declared = Array.isArray(root.qualities)
    ? root.qualities.map(toQuality).filter((quality): quality is WeaponQuality => quality !== null)
    : [];

  const qualities = new Set<WeaponQuality>(declared);

  const bonus = root.damageBonus;
  if (typeof bonus === "number" && Number.isFinite(bonus) && bonus > 0) {
    qualities.add("magical");
  }

  return [...qualities];
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/rules/weapon-quality.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Falsify the derivation**

Temporarily change `bonus > 0` to `bonus > 99` and re-run. Expected: "derives magical from a damage bonus" fails. Restore the line.

- [ ] **Step 6: Commit**

```bash
git add lib/rules/weapon-quality.ts tests/rules/weapon-quality.test.ts
git commit -m "feat(rules): read a weapon's magical, silvered or adamantine quality"
```

---

### Task 2: The clause table, bound to the real monster data

**Files:**
- Create: `lib/rules/damage-clauses.ts`
- Test: `tests/rules/damage-clauses.test.ts`

**Interfaces:**
- Consumes: `WeaponQuality` from Task 1; `DamageType` from `lib/rules/damage-modifiers.ts` (type-only import — it is erased at compile time, so it creates no runtime cycle even though `damage-modifiers.ts` will import `clauseFor` as a value in Task 3).
- Produces:
  - `interface DamageClause { types: readonly DamageType[]; unless: WeaponQuality | null }`
  - `clauseFor(entry: string): DamageClause | null`
  - `RECOGNISED_SRD_CLAUSES: readonly string[]` — the table's keys, normalised.
  - `UNRECOGNISED_SRD_CLAUSES: readonly string[]` — the three wordings deliberately left out of scope.

- [ ] **Step 1: Write the failing test**

Create `tests/rules/damage-clauses.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  clauseFor,
  RECOGNISED_SRD_CLAUSES,
  UNRECOGNISED_SRD_CLAUSES,
} from "@/lib/rules/damage-clauses";
import { DAMAGE_TYPES } from "@/lib/rules/damage-modifiers";

/**
 * The table is keyed by the exact strings the data holds. These assertions bind
 * both ends against the real file: an entry that no monster carries is dead
 * weight, and a clause in the data that the table does not know is a number
 * somebody has to change on purpose — the same discipline as IMPLEMENTED_EFFECTS.
 */
const MONSTERS = JSON.parse(
  readFileSync(join(process.cwd(), "data", "srd-es", "monsters.json"), "utf8"),
) as Array<Record<string, unknown>>;

const BARE = new Set<string>(DAMAGE_TYPES);

function clausesInData(): string[] {
  const found = new Set<string>();
  for (const monster of MONSTERS) {
    for (const key of ["damage_immunities", "damage_resistances", "damage_vulnerabilities"]) {
      const entries = monster[key];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (typeof entry !== "string") continue;
        const trimmed = entry.trim();
        if (trimmed.length === 0 || BARE.has(trimmed.toLowerCase())) continue;
        found.add(trimmed);
      }
    }
  }
  return [...found].sort();
}

describe("the damage clause table", () => {
  it("reads the physical family the data actually contains", () => {
    const plain = clauseFor("bludgeoning, piercing, and slashing from nonmagical weapons");
    expect(plain).toEqual({ types: ["bludgeoning", "piercing", "slashing"], unless: null });

    const silvered = clauseFor(
      "bludgeoning, piercing, and slashing from nonmagical weapons that aren't silvered",
    );
    expect(silvered).toEqual({
      types: ["bludgeoning", "piercing", "slashing"],
      unless: "silvered",
    });

    const adamantine = clauseFor(
      "bludgeoning, piercing, and slashing from nonmagical weapons that aren't adamantine",
    );
    expect(adamantine).toEqual({
      types: ["bludgeoning", "piercing", "slashing"],
      unless: "adamantine",
    });

    const narrow = clauseFor("piercing and slashing from nonmagical weapons that aren't adamantine");
    expect(narrow).toEqual({ types: ["piercing", "slashing"], unless: "adamantine" });
  });

  it("matches regardless of case and surrounding whitespace", () => {
    expect(
      clauseFor("  Bludgeoning, Piercing, and Slashing from Nonmagical Weapons  "),
    ).not.toBeNull();
  });

  it("knows nothing about a wording it has never seen", () => {
    expect(clauseFor("slashing from weapons forged in moonlight")).toBeNull();
  });

  it("holds no entry the monster data does not carry", () => {
    const inData = new Set(clausesInData().map((entry) => entry.toLowerCase()));
    const orphans = RECOGNISED_SRD_CLAUSES.filter((key) => !inData.has(key));

    expect(orphans).toEqual([]);
  });

  it("leaves exactly the three out-of-scope wordings unrecognised", () => {
    const unrecognised = clausesInData().filter((entry) => clauseFor(entry) === null);
    expect(unrecognised.sort()).toEqual([...UNRECOGNISED_SRD_CLAUSES].sort());
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/rules/damage-clauses.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

Create `lib/rules/damage-clauses.ts`:

```typescript
/**
 * lib/rules/damage-clauses.ts
 *
 * The conditional damage clauses this engine can read, and what each one means.
 *
 * @pure — no database, no I/O, no randomness, and never throws.
 *
 * ─── Why a table and not a parser ────────────────────────────────────────────
 * Measured over the 334 monsters in `data/srd-es/monsters.json`: seven distinct
 * non-bare clause strings, 72 occurrences, and four of those strings carry 69 of
 * them. Those four are one family — physical damage from weapons that are not
 * magical, sometimes further excluding silvered or adamantine ones — and they
 * are the four entries below.
 *
 * A regex grammar over the wording would generalise to strings nobody has seen,
 * at the price of deriving a mechanical outcome from prose. This table
 * recognises text verbatim or not at all, so an unseen wording keeps the
 * behaviour it has today: reported unresolved, full damage, and a log saying so.
 */

import type { DamageType } from "@/lib/rules/damage-modifiers";
import type { WeaponQuality } from "@/lib/rules/weapon-quality";

export interface DamageClause {
  /** The damage types the clause covers. */
  types: readonly DamageType[];
  /**
   * The quality that lifts the clause beyond simply being magical, or null when
   * only magic lifts it. A silvered weapon is not a magic weapon: it lifts
   * "that aren't silvered" and leaves the plain wording standing.
   */
  unless: WeaponQuality | null;
}

const PHYSICAL: readonly DamageType[] = Object.freeze([
  "bludgeoning",
  "piercing",
  "slashing",
]);

const TABLE: ReadonlyMap<string, DamageClause> = new Map([
  [
    "bludgeoning, piercing, and slashing from nonmagical weapons",
    { types: PHYSICAL, unless: null },
  ],
  [
    "bludgeoning, piercing, and slashing from nonmagical weapons that aren't silvered",
    { types: PHYSICAL, unless: "silvered" as WeaponQuality },
  ],
  [
    "bludgeoning, piercing, and slashing from nonmagical weapons that aren't adamantine",
    { types: PHYSICAL, unless: "adamantine" as WeaponQuality },
  ],
  [
    "piercing and slashing from nonmagical weapons that aren't adamantine",
    { types: Object.freeze(["piercing", "slashing"] as const), unless: "adamantine" as WeaponQuality },
  ],
]);

/**
 * The wordings in the data this table deliberately does not read.
 *
 * Exported so a test can assert it against the real file in both directions:
 * one occurrence each, and each needs a concept the engine does not carry — the
 * damage's own source, the wielder's alignment, the provenance of a temporary
 * resistance. The count is a number somebody has to change on purpose.
 */
export const UNRECOGNISED_SRD_CLAUSES: readonly string[] = Object.freeze([
  "damage from spells",
  "bludgeoning, piercing, and slashing from nonmagical attacks (from stoneskin)",
  "piercing from magic weapons wielded by good creatures",
]);

/**
 * Every key in the table, normalised, so a test can assert the other direction:
 * an entry no monster carries is dead weight and should not be here.
 */
export const RECOGNISED_SRD_CLAUSES: readonly string[] = Object.freeze([...TABLE.keys()]);

/** The clause this entry names, or null when the table has never seen it. */
export function clauseFor(entry: string): DamageClause | null {
  return TABLE.get(entry.trim().toLowerCase()) ?? null;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/rules/damage-clauses.test.ts`
Expected: PASS, 5 tests. If "leaves exactly the three out-of-scope wordings unrecognised" fails, the data has changed since the spec was measured — read the failure's actual list before touching the table, and do not add an entry the data does not have.

- [ ] **Step 5: Falsify the data guard**

Temporarily delete the `"piercing and slashing from nonmagical weapons that aren't adamantine"` entry and re-run. Expected: the out-of-scope test fails, because that string now appears among the unrecognised. Restore it.

- [ ] **Step 6: Commit**

```bash
git add lib/rules/damage-clauses.ts tests/rules/damage-clauses.test.ts
git commit -m "feat(rules): name the SRD damage clauses the engine can read"
```

---

### Task 3: The damage rule evaluates a clause against the attack

**Files:**
- Modify: `lib/rules/damage-modifiers.ts`
- Test: `tests/rules/damage-modifiers.test.ts`

**Interfaces:**
- Consumes: `clauseFor` from Task 2, `WeaponQuality` from Task 1.
- Produces:
  - `export interface DamageAttack { kind: "weapon" | "spell"; qualities: readonly WeaponQuality[] }`
  - `applyDamageModifiers` accepts an optional `attack?: DamageAttack`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/rules/damage-modifiers.test.ts`:

```typescript
describe("applyDamageModifiers — conditional clauses", () => {
  const WEREWOLF = {
    immunities: ["bludgeoning, piercing, and slashing from nonmagical weapons that aren't silvered"],
    resistances: [] as string[],
    vulnerabilities: [] as string[],
  };

  const GARGOYLE = {
    immunities: [] as string[],
    resistances: ["bludgeoning, piercing, and slashing from nonmagical weapons"],
    vulnerabilities: [] as string[],
  };

  const mundane = { kind: "weapon" as const, qualities: [] as const };

  it("applies an immunity clause to a mundane weapon", () => {
    const result = applyDamageModifiers({
      damage: 12,
      damageType: "slashing",
      modifiers: WEREWOLF,
      attack: mundane,
    });

    expect(result.damage).toBe(0);
    expect(result.applied).toBe("immune");
    expect(result.unresolved).toEqual([]);
  });

  it("lifts that immunity for a silvered weapon", () => {
    const result = applyDamageModifiers({
      damage: 12,
      damageType: "slashing",
      modifiers: WEREWOLF,
      attack: { kind: "weapon", qualities: ["silvered"] },
    });

    expect(result.damage).toBe(12);
    expect(result.applied).toBe("none");
    expect(result.unresolved).toEqual([]);
  });

  it("lifts it for a magic weapon too", () => {
    const result = applyDamageModifiers({
      damage: 12,
      damageType: "slashing",
      modifiers: WEREWOLF,
      attack: { kind: "weapon", qualities: ["magical"] },
    });

    expect(result.damage).toBe(12);
    expect(result.applied).toBe("none");
  });

  it("does not let silver lift a clause that only magic lifts", () => {
    const result = applyDamageModifiers({
      damage: 12,
      damageType: "slashing",
      modifiers: GARGOYLE,
      attack: { kind: "weapon", qualities: ["silvered"] },
    });

    expect(result.damage).toBe(6);
    expect(result.applied).toBe("resistant");
  });

  it("leaves a damage type the clause does not name alone", () => {
    const result = applyDamageModifiers({
      damage: 12,
      damageType: "fire",
      modifiers: GARGOYLE,
      attack: mundane,
    });

    expect(result.damage).toBe(12);
    expect(result.applied).toBe("none");
  });

  it("does not apply a weapon clause to spell damage", () => {
    const result = applyDamageModifiers({
      damage: 12,
      damageType: "slashing",
      modifiers: GARGOYLE,
      attack: { kind: "spell", qualities: [] },
    });

    expect(result.damage).toBe(12);
    expect(result.applied).toBe("none");
    expect(result.unresolved).toEqual([]);
  });

  it("still reports the clause unresolved when nothing says what struck", () => {
    // The case that proves no existing caller changed by not being updated.
    const result = applyDamageModifiers({
      damage: 12,
      damageType: "slashing",
      modifiers: GARGOYLE,
    });

    expect(result.damage).toBe(12);
    expect(result.applied).toBe("none");
    expect(result.unresolved).toEqual([
      "bludgeoning, piercing, and slashing from nonmagical weapons",
    ]);
  });

  it("keeps reporting a wording it cannot read, even with an attack", () => {
    const result = applyDamageModifiers({
      damage: 12,
      damageType: "slashing",
      modifiers: {
        immunities: [],
        resistances: ["piercing from magic weapons wielded by good creatures"],
        vulnerabilities: [],
      },
      attack: mundane,
    });

    expect(result.unresolved).toEqual([
      "piercing from magic weapons wielded by good creatures",
    ]);
  });

  it("writes no warning line when every clause was evaluated", () => {
    const result = applyDamageModifiers({
      damage: 12,
      damageType: "slashing",
      modifiers: GARGOYLE,
      attack: mundane,
    });

    expect(unresolvedModifierLog({ defenderName: "Gargoyle", result })).toBeNull();
  });
});
```

Add `unresolvedModifierLog` to the file's existing import from `@/lib/rules/damage-modifiers` if it is not already imported.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run tests/rules/damage-modifiers.test.ts`
Expected: FAIL — `attack` is not a known property, and the clause cases report `unresolved` instead of resolving.

- [ ] **Step 3: Implement the evaluation**

In `lib/rules/damage-modifiers.ts`, add the imports at the top:

```typescript
import { clauseFor } from "@/lib/rules/damage-clauses";
import type { WeaponQuality } from "@/lib/rules/weapon-quality";
```

Add the descriptor beside `DamageModifiers`:

```typescript
/**
 * What struck, for the clauses that ask.
 *
 * Optional at every call site on purpose: absent means the engine does not know
 * what hit, so a clause it can read still goes unevaluated rather than being
 * resolved on an assumption. That is what lets a caller stay untouched without
 * silently changing what it computes.
 */
export interface DamageAttack {
  kind: "weapon" | "spell";
  qualities: readonly WeaponQuality[];
}
```

Add the two helpers below `names`:

```typescript
/** Whether a recognised clause covers this attack, given what struck. */
function clauseApplies(
  entry: string,
  damageType: DamageType,
  attack: DamageAttack,
): boolean {
  const clause = clauseFor(entry);
  if (clause === null) return false;
  if (attack.kind !== "weapon") return false;
  if (!clause.types.includes(damageType)) return false;
  if (attack.qualities.includes("magical")) return false;
  if (clause.unless !== null && attack.qualities.includes(clause.unless)) return false;
  return true;
}

/**
 * Whether this list stops the damage: by naming the type outright, or by a
 * clause the engine could both read and evaluate.
 */
function catches(
  entries: readonly string[],
  damageType: DamageType,
  attack: DamageAttack | undefined,
): boolean {
  if (names(entries, damageType)) return true;
  if (attack === undefined) return false;
  return entries.some((entry) => clauseApplies(entry, damageType, attack));
}
```

Change the signature and body of `applyDamageModifiers`:

```typescript
export function applyDamageModifiers(input: {
  damage: number;
  damageType: DamageType;
  modifiers: DamageModifiers;
  attack?: DamageAttack;
}): ModifiedDamage {
```

Inside it, the `unresolved` loop's `continue` condition gains one clause — a string the table reads *and* the attack lets us evaluate is no longer unresolved:

```typescript
  for (const entry of [...immunities, ...resistances, ...vulnerabilities]) {
    if (isBareType(entry)) continue;
    // A clause the table reads is only unresolved while nothing says what
    // struck. Once it does, the clause has an answer — applicable or not — and
    // reporting it as unreadable would send the narrator a refusal that no
    // longer happened.
    if (input.attack !== undefined && clauseFor(entry) !== null) continue;
    const key = normalise(entry);
    if (seenClauses.has(key)) continue;
    seenClauses.add(key);
    unresolved.push(entry);
  }
```

And the three decisions read through `catches`:

```typescript
  if (catches(immunities, input.damageType, input.attack)) {
    return { damage: 0, applied: "immune", unresolved };
  }

  const resistant = catches(resistances, input.damageType, input.attack);
  const vulnerable = catches(vulnerabilities, input.damageType, input.attack);
```

Finally rewrite the sentence in `unresolvedModifierLog`, which now overstates what the engine cannot do:

```typescript
  return (
    `⚠️ ${input.defenderName}: damage modifier not applied — ` +
    `"${unresolved.join('", "')}" is a condition this engine does not read. ` +
    `Full damage was applied.`
  );
```

Update the doc comment above it so it no longer says the engine tracks nothing about magical, silvered or adamantine attacks: it does now, and the line survives only for wordings outside the table.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run tests/rules/damage-modifiers.test.ts`
Expected: PASS, including every pre-existing case in the file.

- [ ] **Step 5: Falsify two lines**

Remove `if (attack.qualities.includes("magical")) return false;` and re-run: "lifts it for a magic weapon too" must fail. Restore it. Then remove `if (attack.kind !== "weapon") return false;` and re-run: "does not apply a weapon clause to spell damage" must fail. Restore it.

- [ ] **Step 6: Commit**

```bash
git add lib/rules/damage-modifiers.ts tests/rules/damage-modifiers.test.ts
git commit -m "feat(rules): resolve a damage clause against the weapon that struck"
```

---

### Task 4: The attack carries its qualities

**Files:**
- Modify: `lib/rules/weapon-attack.ts`
- Test: `tests/rules/weapon-attack.test.ts` — it exists, and already mocks `@/lib/rules/srd-equipment-lookup` with a hoisted `getEquipmentInfo`; append to it rather than starting a new file.

**Interfaces:**
- Consumes: `weaponQualitiesFor` from Task 1.
- Produces: `ResolvedWeaponAttack.qualities: readonly WeaponQuality[]`.

- [ ] **Step 1: Write the failing test**

Append to `tests/rules/weapon-attack.test.ts`. The file's existing `getEquipmentInfo` mock is what keeps this off the database; leave it returning whatever the surrounding cases set, since none of these three assertions depends on the SRD profile:

```typescript
describe("resolveWeaponAttack — qualities", () => {
  const CHARACTER = {
    stats: { STR: 16, DEX: 12 },
    characterClass: "fighter",
    level: 3,
    fallbackDamageType: "bludgeoning",
  };

  it("carries the quality declared on the weapon row", async () => {
    const attack = await resolveWeaponAttack({
      weapon: { name: "Silvered Longsword", properties: { qualities: ["silvered"] } },
      ...CHARACTER,
    });

    expect(attack.qualities).toEqual(["silvered"]);
  });

  it("derives magical from the weapon's damage bonus", async () => {
    const attack = await resolveWeaponAttack({
      weapon: { name: "Blade of Bitter Resolve", properties: { damageBonus: 1 } },
      ...CHARACTER,
    });

    expect(attack.qualities).toEqual(["magical"]);
  });

  it("gives an unarmed strike no qualities", async () => {
    const attack = await resolveWeaponAttack({ weapon: null, ...CHARACTER });

    expect(attack.qualities).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/rules/weapon-attack.test.ts`
Expected: FAIL — `qualities` does not exist on the result.

- [ ] **Step 3: Implement**

In `lib/rules/weapon-attack.ts`, import the reader and add the field. The module already extracts `properties` into a local for `damageBonus`, so the quality is read from the same value — one read, one meaning:

```typescript
import { weaponQualitiesFor, type WeaponQuality } from "@/lib/rules/weapon-quality";
```

Add to `ResolvedWeaponAttack`:

```typescript
  /**
   * What the weapon is, for the damage clauses that ask: magical, silvered,
   * adamantine, or none of them. Read here because this is already the one
   * place that opens the weapon's `properties`, and a second reader is how two
   * rules come to disagree about the same sword.
   */
  qualities: readonly WeaponQuality[];
```

And to the returned object:

```typescript
    qualities: weapon === null ? [] : weaponQualitiesFor(properties),
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run tests/rules/weapon-attack.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/rules/weapon-attack.ts tests/rules/weapon-attack.test.ts
git commit -m "feat(rules): surface a weapon's qualities on the resolved attack"
```

---

### Task 5: Wire the quality from the route to the damage rule

**Files:**
- Modify: `lib/rules/combat.ts` (the `ComputeConsequencesInput` interface at ~`:315-326`, and the `applyDamageModifiers` call at ~`:705`)
- Modify: `lib/rules/combat-pipeline.ts` (`CombatActionPayload` at ~`:79-113`, the `computeConsequences` call at ~`:335`, the spell-path `applyDamageModifiers` call at ~`:396`)
- Modify: `app/api/campaign/[id]/action/route.ts` (the `executeCombatAction` payload at ~`:294-318`)
- Test: `tests/rules/damage-modifiers-both-paths.test.ts`

**Interfaces:**
- Consumes: `DamageAttack` from Task 3, `ResolvedWeaponAttack.qualities` from Task 4.
- Produces: `CombatActionPayload.weaponQualities?: readonly WeaponQuality[]`, forwarded as `attack` into `computeConsequences`.

**Not touched, deliberately:** `resolveCombatAttack` in `lib/rules/combat-service.ts`. Its attacker may be a monster and its own comment records that enemy combatants carry no inventory to read; by passing no `attack`, that path keeps today's behaviour with no code and no claim the engine cannot check.

- [ ] **Step 1: Write the failing cross-layer test**

Append to `tests/rules/damage-modifiers-both-paths.test.ts`:

Extend the file's imports with the quality type:

```typescript
import type { WeaponQuality } from "@/lib/rules/weapon-quality";
```

Then append:

```typescript
describe("a weapon's quality reaches the damage the pipeline writes", () => {
  const WEREWOLF_CLAUSE =
    "bludgeoning, piercing, and slashing from nonmagical weapons that aren't silvered";

  afterEach(() => vi.restoreAllMocks());

  async function damageAfterAttack(qualities: readonly WeaponQuality[]): Promise<number> {
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const target = buildEnemy({
      id: "wolf",
      name: "Werewolf",
      hp: 999,
      maxHp: 999,
      ac: 1,
      damageImmunities: [WEREWOLF_CLAUSE],
    });

    const outcome = await executeCombatAction(
      {
        actionType: "attack",
        encounter: buildEncounter([buildPlayer(), target]),
        actorId: "pc1",
        actorName: "Kara",
        actorConditions: [],
        targetCombatants: [target],
        weaponName: "Longsword",
        weaponDice: "0d1",
        damageType: "slashing",
        attackModifier: 100,
        flatDamageBonus: 12,
        weaponQualities: qualities,
      },
      buildMockTx(),
    );

    return outcome.totalDamageDealt;
  }

  it("pays nothing through a werewolf's hide with a mundane blade", async () => {
    expect(await damageAfterAttack([])).toBe(0);
  });

  it("cuts through with a silvered one", async () => {
    expect(await damageAfterAttack(["silvered"])).toBe(12);
  });

  it("cuts through with a magic one", async () => {
    expect(await damageAfterAttack(["magical"])).toBe(12);
  });
});
```

Before writing this, open `tests/rules/combat-pipeline-fixtures.ts` and confirm `buildEnemy` accepts `damageImmunities` through its `Partial<PipelineCombatant>` overrides; `PipelineCombatant` declares the four modifier columns as optional (`lib/rules/combat-pipeline.ts:44-47`), so it does.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/rules/damage-modifiers-both-paths.test.ts`
Expected: FAIL — `weaponQualities` is not a known payload field, and all three cases pay 12, because the clause is unresolved.

- [ ] **Step 3: Widen `computeConsequences`**

In `lib/rules/combat.ts`, extend the existing `@/lib/rules/damage-modifiers` import with `type DamageAttack`, then add the field to `ComputeConsequencesInput` directly below `targetModifiers`:

```typescript
  /**
   * What struck, for the clauses that ask about it. Optional for the same
   * reason `targetModifiers` is: every existing caller and fixture keeps
   * compiling, and absent means the clause goes unevaluated rather than being
   * resolved on a guess.
   */
  attack?: DamageAttack;
```

Destructure `attack` alongside `targetModifiers` in the function body, and pass it through:

```typescript
  const modified = applyDamageModifiers({
    damage,
    damageType,
    modifiers: targetModifiers ?? {
      immunities: [],
      resistances: [],
      vulnerabilities: [],
    },
    attack,
  });
```

- [ ] **Step 4: Carry it through the pipeline**

In `lib/rules/combat-pipeline.ts`, add `import type { WeaponQuality } from "@/lib/rules/weapon-quality";` beside the existing rule imports, then add to `CombatActionPayload` in the "Weapon/Attack data" block:

```typescript
  /** The striking weapon's SRD qualities. Empty or absent for an unarmed or unknown weapon. */
  weaponQualities?: readonly WeaponQuality[];
```

In the `computeConsequences` call, beside `targetModifiers`:

```typescript
        attack: payload.weaponQualities
          ? { kind: "weapon", qualities: payload.weaponQualities }
          : undefined,
```

In the spell path's `applyDamageModifiers` call, add:

```typescript
        attack: { kind: "spell", qualities: [] },
```

with a comment recording that this resolves a `from nonmagical weapons` clause as inapplicable to spell damage, and does not resolve the separate `damage from spells` clause, which stays outside the table.

- [ ] **Step 5: Pass it from the route**

In `app/api/campaign/[id]/action/route.ts`, the `attack` local is already `await resolveWeaponAttack({...})`. Add one line to the `executeCombatAction` payload, next to `flatDamageBonus`:

```typescript
          weaponQualities: attack.qualities,
```

- [ ] **Step 6: Run the cross-layer test and the suites it touches**

```bash
npx vitest run tests/rules/damage-modifiers-both-paths.test.ts tests/rules/combat-pipeline.test.ts tests/rules/combat.test.ts tests/api/action.test.ts
```
Expected: PASS.

- [ ] **Step 7: Falsify the wiring**

Comment out `weaponQualities: attack.qualities` in the route and run `npx vitest run tests/api/action.test.ts`; if nothing fails, the route hop is untested — add a route-level case in `tests/api/action.test.ts` that equips a `+1` weapon against a target carrying the werewolf clause and asserts the damage in the `COMBAT_CONSEQUENCE` frame is non-zero, then make it fail the same way before restoring the line.

- [ ] **Step 8: Commit**

```bash
git add lib/rules/combat.ts lib/rules/combat-pipeline.ts "app/api/campaign/[id]/action/route.ts" tests/rules/damage-modifiers-both-paths.test.ts tests/api/action.test.ts
git commit -m "feat(combat): carry the weapon's quality to the damage rule"
```

---

### Task 6: The producer — a silvered and an adamantine weapon

**Files:**
- Modify: `data/loot-tables.json`
- Test: `tests/rules/loot-weapon-qualities.test.ts`

**Interfaces:**
- Consumes: `weaponQualitiesFor` from Task 1.
- Produces: nothing in code. Two data rows the rule can actually meet.

- [ ] **Step 1: Write the failing test**

Create `tests/rules/loot-weapon-qualities.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { weaponQualitiesFor } from "@/lib/rules/weapon-quality";

/**
 * A rule with no producer is dormant the day it lands — the armour-proficiency
 * rule shipped while no loot row carried a category, and could not fire in
 * production. These assertions read the real file so the silvered and
 * adamantine branches always have something in the game that reaches them.
 *
 * Neither row may carry a `damageBonus`. A silvered sword that also had +1
 * would derive as magical, the "that aren't silvered" clause would be lifted by
 * the magic instead of by the silver, and the branch under test would never run.
 */
const LOOT = JSON.parse(
  readFileSync(join(process.cwd(), "data", "loot-tables.json"), "utf8"),
) as Record<string, unknown>;

function weapons(): Array<Record<string, unknown>> {
  return Object.values(LOOT)
    .filter((table): table is Array<Record<string, unknown>> => Array.isArray(table))
    .flat()
    .filter((row) => row.type === "weapon");
}

describe("the loot tables produce weapons the damage clauses can meet", () => {
  it.each(["silvered", "adamantine"] as const)("has at least one %s weapon", (quality) => {
    const matching = weapons().filter((row) =>
      weaponQualitiesFor(row.properties).includes(quality),
    );

    expect(matching.length).toBeGreaterThan(0);
  });

  it.each(["silvered", "adamantine"] as const)(
    "keeps the %s weapon nonmagical, so the clause is lifted by the material",
    (quality) => {
      const matching = weapons().filter((row) =>
        weaponQualitiesFor(row.properties).includes(quality),
      );

      for (const row of matching) {
        expect(weaponQualitiesFor(row.properties)).not.toContain("magical");
      }
    },
  );
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/rules/loot-weapon-qualities.test.ts`
Expected: FAIL — no row carries either quality.

- [ ] **Step 3: Add the two rows**

In `data/loot-tables.json`, append to the `uncommon` array:

```json
    {
      "name": "Silvered Hunting Sword",
      "description": "A plain blade whose edge is inlaid with a bright, soft line of silver.",
      "type": "weapon",
      "properties": {
        "damageDice": "1d8",
        "damageType": "slashing",
        "qualities": ["silvered"]
      },
      "valueGP": 115,
      "iconPath": "/assets/icons/items/broadsword.svg"
    }
```

and to the `rare` array:

```json
    {
      "name": "Adamantine Warpick",
      "description": "Head forged from a single black ingot, heavier than its size explains.",
      "type": "weapon",
      "properties": {
        "damageDice": "1d8",
        "damageType": "piercing",
        "qualities": ["adamantine"]
      },
      "valueGP": 500,
      "iconPath": "/assets/icons/items/battle-axe.svg"
    }
```

Neither carries a `damageBonus`; that is load-bearing, not an omission. Both icon paths were checked against `public/assets/icons/items/` and exist.

- [ ] **Step 4: Run and watch it pass**

```bash
npx vitest run tests/rules/loot-weapon-qualities.test.ts tests/rules/loot.test.ts
```
Expected: PASS. The second file is included because it validates the loot tables against `LootItemSchema`; run it to prove the new rows parse.

- [ ] **Step 5: Commit**

```bash
git add data/loot-tables.json tests/rules/loot-weapon-qualities.test.ts
git commit -m "feat(loot): put a silvered and an adamantine weapon in the game"
```

---

### Task 7: Close the entry and verify the whole thing

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/specs/2026-08-29-weapon-qualities-design.md` (status line)

- [ ] **Step 1: Run the full suite, the types and the linter**

```bash
npx vitest run
```
Then: `npx tsc --noEmit`
Then: `npx next lint --file lib/rules/weapon-quality.ts --file lib/rules/damage-clauses.ts --file lib/rules/damage-modifiers.ts --file lib/rules/weapon-attack.ts --file lib/rules/combat.ts --file lib/rules/combat-pipeline.ts`

Expected: every test green, no type errors, no lint findings in the touched files. Do not proceed on a failure — fix it, and if the fix changes a rule, add the test that would have caught it.

- [ ] **Step 2: Update `AGENTS.md`**

In "Known dormant values, still open", replace the "Magical, silvered and adamantine weapons" bullet with a closure note in the same voice as the entries above it: what the table reads, that a weapon's magic is declared or derived from `damageBonus`, that two loot rows exist so the silvered and adamantine branches are reachable, and that three wordings stay unrecognised on purpose — `damage from spells`, the `(from stoneskin)` note, and `piercing from magic weapons wielded by good creatures`.

- [ ] **Step 3: Mark the spec implemented**

Change the spec's `**Status:** designed` to `**Status:** implemented`.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md docs/superpowers/specs/2026-08-29-weapon-qualities-design.md
git commit -m "docs(agents): close the weapon-qualities entry"
```

---

## Notes for whoever executes this

- **The optional `attack` is the safety property of the whole change.** If a test that never mentioned qualities starts failing, the likeliest cause is a call site that now passes `attack` where it did not before. Check that before changing the test.
- **`normalise`, `isBareType` and `names` are private to `damage-modifiers.ts`.** Task 3 reuses them rather than reimplementing them; do not export them.
- **The clause table is keyed on the normalised string.** `clauseFor` lower-cases and trims its argument, so the map's keys must already be lower-case. A capital letter in a key makes that entry unreachable and the data guard in Task 2 will catch it.
- **Do not add a table entry for a wording the data does not contain.** The guard in Task 2 asserts both directions precisely so the table cannot grow speculative entries.
