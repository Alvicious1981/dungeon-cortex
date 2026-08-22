# Weapon Attack Authority — Implementation Plan (PR 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the weapon's own properties decide the attack bonus — category and
proficiency, finesse, and melee/ranged ability — and make the damage bonus use
the same ability the attack used.

**Architecture:** A pure rule module (`weapon-profile.ts`) reads a weapon's
persisted properties and computes the bonus; a thin service
(`weapon-profile-service.ts`) resolves a legacy row's missing category from the
SRD cache. Both attack sites in the action route call one shared helper instead
of two hand-rolled copies. `weaponAttackModifier` is removed rather than
supplemented, because a second way to compute one bonus is what produced the
drift this increment repairs.

**Tech Stack:** TypeScript, Next.js 15, Prisma 6.19.2, Vitest 4, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-21-weapon-proficiency-authority-design.md`

## Global Constraints

- Package manager is **pnpm**. Never `npm`, `yarn` or `bun`. Do not modify
  `pnpm-lock.yaml`; no dependency is added or removed by this plan.
- Do not run `prisma migrate`, `db push`, `db seed`, or `db execute`. This plan
  touches no migration and no schema.
- Never read or modify `.env`.
- D&D 5e/SRD 2014 only. Never introduce THAC0, descending AC, AD&D saving throw
  categories, or gold-for-XP.
- **Never inflate a roll.** Every unresolvable input degrades to the
  conservative answer — no proficiency, STR ability, level-1 proficiency bonus.
  This matches the convention the recent migrations state explicitly.
- **A rule module never throws on persisted data.** `Character.class` is a
  free-text column and `InventoryItem.properties` is untyped JSON; both reach
  these functions directly from the database.
- Casing: the SRD cache stores `"Martial"` and `"Finesse"`. The rule layer
  lowercases at its own boundary. `EquipmentInfo` itself is **not** normalised —
  it is narrator-facing output and PR 1 deliberately preserved its casing.
- Commit after every task. Do not squash locally; the PR is squashed on merge.
- Test command: `pnpm exec vitest run <path>` for one file, `pnpm test` for all.
- Baseline before this plan: **3015 tests in 152 files.**

## Two spec contradictions this plan resolves

The spec was written before anyone read `view-model.ts:154` or thought about an
unarmed attack. Both are recorded here rather than discovered mid-task.

**1. The "guard binding both ends" is impossible as the spec describes it.**
The spec's "Out, with reasons" declines unifying the view-model's calculation,
and its Testing section then demands a guard asserting the view-model's displayed
bonus equals the backend's resolved bonus. Those cannot both hold.
`lib/character-sheet/view-model.ts:154` computes `attackModifier + proficiencyBonus`
— proficiency applied **unconditionally**. After this PR the backend applies it
conditionally, so a wizard holding a longsword disagrees with the sheet by
exactly the proficiency bonus, and the guard fails by construction.

**Resolution:** the view-model consumes the same **pure rule function**,
`weaponAttackBonus`. This is not the backend service the user declined — no I/O,
no service response, no HTTP. It is one pure function in `lib/rules/`, which is
the only arrangement where the guard the spec asks for can pass.
`MILESTONE_V_SPEC` §5 is respected: no UI or VTT component is altered, only a
`lib/` view-model module. Task 5 does this.

**2. An unarmed strike would silently lose its proficiency bonus.**
The first attack site permits an attack with no weapon (`weaponDice: "1d4"`,
`weaponName: "Unarmed"`, `route.ts:225-247`). Today it receives proficiency via
`weaponAttackModifier`. Under a naive reading of the new rule there is no weapon,
so no category, so no proficiency — every unarmed attack quietly drops by 2.

SRD 2014 states that you are proficient with your unarmed strikes. **Resolution:**
`profile: null` means "no weapon — unarmed strike" and is proficient by rule,
which is a different thing from a weapon whose category could not be resolved
(not proficient). Both report `categoryResolved: false`; they differ in
`proficiencyApplied`. Task 1 encodes this and names it in a test.

**Also carried forward:** `proficiencyBonus(level)` in `lib/rules/proficiency.ts:50`
**throws a `RangeError`** outside 1–20. The function being deleted,
`weaponAttackModifier`, clamps instead. The replacement must keep clamping, or a
corrupt persisted level turns an attack into a 500.

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/rules/weapon-profile.ts` | **Create.** Pure. Owns `WeaponProfile`, `readWeaponProfile`, `weaponAttackBonus`. No Prisma, no I/O, never throws. |
| `tests/rules/weapon-profile.test.ts` | **Create.** The ability rule, proficiency, unarmed, level clamp, exhaustiveness. |
| `lib/rules/weapon-profile-service.ts` | **Create.** `resolveWeaponProfile` — pure fast path, SRD lookup only as fallback. |
| `tests/rules/weapon-profile-service.test.ts` | **Create.** The resolution chain and its precedence rule. |
| ~~`app/api/character/route.ts`~~ `lib/rules/starting-inventory.ts` | **CORRECTED — Create.** Hydrate the starting longsword from the SRD; fall back to the literal when the cache is empty. The plan placed `buildStartingInventory` in the route and had the test import it from there; Next.js App Router permits only route handlers as exports from a `route.ts`, so it shipped as its own rule module, with `tests/rules/starting-inventory.test.ts` as its test. |
| `tests/api/character-create-hydration.test.ts` | **Create.** Hydrated shape, and the empty-cache fallback. |
| `lib/rules/weapon-attack.ts` | **Create.** The one helper both attack sites call. |
| `lib/rules/combat.ts` | **Modify.** Remove `weaponAttackModifier`. |
| `app/api/campaign/[id]/action/route.ts` | **Modify.** Both attack sites call the shared helper; `flatDamageBonus` uses `abilityUsed`. |
| `lib/character-sheet/view-model.ts` | **Modify.** Consume `weaponAttackBonus`; read the canonical `weaponProperties` key. |
| `tests/rules/attack-bonus-both-ends.test.ts` | **Create.** The guard: sheet and backend must agree. |

---

### Task 1: The pure attack rule

**Files:**
- Create: `lib/rules/weapon-profile.ts`
- Test: `tests/rules/weapon-profile.test.ts`

**Interfaces:**
- Consumes: `abilityModifier` from `@/lib/rules/dice`; `isWeaponProficient`,
  `proficiencyBonus`, and the types `CharacterClass` and `WeaponCategory` from
  `@/lib/rules/proficiency`.
- Produces, all imported by Tasks 2–5 from `@/lib/rules/weapon-profile`:
  - `interface WeaponProfile { category: WeaponCategory | null; isRanged: boolean; traits: readonly string[]; damageDice: string | null; damageType: string | null }`
  - `function readWeaponProfile(properties: unknown): WeaponProfile`
  - `interface WeaponAttackBonus { bonus: number; abilityUsed: "STR" | "DEX"; proficiencyApplied: boolean; categoryResolved: boolean }`
  - `function weaponAttackBonus(input: { profile: WeaponProfile | null; stats: Record<string, number>; characterClass: string; level: number }): WeaponAttackBonus`

**Background you need.**

`InventoryItem.properties` is untyped JSON straight out of Postgres. The existing
accessor `getItemProperties` (`lib/rules/inventory.ts:211`) is a bare `as` cast
with no checking; that is how a wrong shape reaches a rule unnoticed. This module
validates instead.

The canonical trait key is `weaponProperties`, matching the `WeaponProperties`
interface at `lib/rules/inventory.ts:50` and `components/character/InventoryPanel.tsx:35`.
(`view-model.ts:143` currently reads a different key, `properties.properties`;
Task 5 corrects that. No persisted row carries either key today, so nothing is
being migrated.)

**Check order is the trap.** `Dart` is the only weapon in the SRD's 37 that is
both `Ranged` and `Finesse`. Testing "ranged" first would force DEX; testing
finesse first lets the player choose. SRD 2014 on Finesse: *"you use your choice
of Strength or Dexterity modifier for the attack and damage rolls"*, with no
exclusion for ranged weapons. So **finesse is checked first**.

Three inputs arrive from the database and must never throw:
- `characterClass` is free text. Normalise with `.trim().toLowerCase()`, following
  `lib/rules/class-skills.ts:47`. Anything outside the twelve classes falls
  through `isWeaponProficient`'s `?? false` to "not proficient".
- `level` may be `0`, `21`, `NaN`, or absent. `proficiencyBonus` **throws** on
  those, so clamp to 1 before calling it.
- `stats` may be missing a key. Default a missing score to `10`.

- [ ] **Step 1: Write the failing test**

Create `tests/rules/weapon-profile.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  readWeaponProfile,
  weaponAttackBonus,
  type WeaponProfile,
} from "@/lib/rules/weapon-profile";

const STATS = { STR: 16, DEX: 14, CON: 12, INT: 10, WIS: 10, CHA: 8 }; // +3 / +2

function profile(overrides: Partial<WeaponProfile> = {}): WeaponProfile {
  return {
    category: "martial",
    isRanged: false,
    traits: [],
    damageDice: "1d8",
    damageType: "Slashing",
    ...overrides,
  };
}

describe("readWeaponProfile", () => {
  it("reads a hydrated weapon row, lowercasing category and traits", () => {
    expect(
      readWeaponProfile({
        weaponCategory: "Martial",
        weaponRange: "Melee",
        weaponProperties: ["Versatile"],
        damageDice: "1d8",
        damageType: "Slashing",
      }),
    ).toEqual({
      category: "martial",
      isRanged: false,
      traits: ["versatile"],
      damageDice: "1d8",
      damageType: "Slashing",
    });
  });

  it("marks a ranged weapon from its SRD weaponRange", () => {
    expect(readWeaponProfile({ weaponRange: "Ranged" }).isRanged).toBe(true);
  });

  it("yields a null category for a legacy row that declares none", () => {
    // The live save's longsword: hand-written at character creation with only
    // damage fields. Task 2 resolves its category from the SRD by name.
    const legacy = readWeaponProfile({
      damageDice: "1d8",
      damageBonus: 0,
      damageType: "slashing",
    });
    expect(legacy.category).toBeNull();
    expect(legacy.traits).toEqual([]);
    expect(legacy.damageDice).toBe("1d8");
  });

  it("refuses a category string that is not a category", () => {
    expect(readWeaponProfile({ weaponCategory: "Exotic" }).category).toBeNull();
    expect(readWeaponProfile({ weaponCategory: 7 }).category).toBeNull();
  });

  it("degrades to an empty profile instead of throwing on junk", () => {
    for (const junk of [null, undefined, 42, "text", [], {}]) {
      const read = readWeaponProfile(junk);
      expect(read.category).toBeNull();
      expect(read.isRanged).toBe(false);
      expect(read.traits).toEqual([]);
      expect(read.damageDice).toBeNull();
    }
  });
});

describe("weaponAttackBonus — which ability", () => {
  it("uses STR for a plain melee weapon", () => {
    const result = weaponAttackBonus({
      profile: profile(),
      stats: STATS,
      characterClass: "fighter",
      level: 1,
    });
    expect(result.abilityUsed).toBe("STR");
    expect(result.bonus).toBe(5); // +3 STR, +2 proficiency
  });

  it("uses DEX for a ranged weapon", () => {
    const result = weaponAttackBonus({
      profile: profile({ isRanged: true }),
      stats: STATS,
      characterClass: "fighter",
      level: 1,
    });
    expect(result.abilityUsed).toBe("DEX");
    expect(result.bonus).toBe(4); // +2 DEX, +2 proficiency
  });

  it("lets finesse take the greater of STR and DEX", () => {
    const strong = weaponAttackBonus({
      profile: profile({ traits: ["finesse"] }),
      stats: STATS,
      characterClass: "fighter",
      level: 1,
    });
    expect(strong.abilityUsed).toBe("STR"); // STR 16 beats DEX 14

    const nimble = weaponAttackBonus({
      profile: profile({ traits: ["finesse"] }),
      stats: { ...STATS, STR: 8, DEX: 18 },
      characterClass: "fighter",
      level: 1,
    });
    expect(nimble.abilityUsed).toBe("DEX");
  });

  it("checks finesse before ranged, so a Dart still offers the choice", () => {
    // Dart is the only SRD weapon that is both Ranged and Finesse. Testing
    // ranged first would force DEX on a strong character who may legally
    // choose STR. This is the check-order trap, named.
    const dart = weaponAttackBonus({
      profile: profile({ isRanged: true, traits: ["finesse", "thrown"] }),
      stats: STATS,
      characterClass: "fighter",
      level: 1,
    });
    expect(dart.abilityUsed).toBe("STR");
  });
});

describe("weaponAttackBonus — proficiency", () => {
  it("applies proficiency when the class has the category", () => {
    const result = weaponAttackBonus({
      profile: profile({ category: "martial" }),
      stats: STATS,
      characterClass: "barbarian",
      level: 1,
    });
    expect(result.proficiencyApplied).toBe(true);
    expect(result.categoryResolved).toBe(true);
    expect(result.bonus).toBe(5);
  });

  it("withholds proficiency when the class lacks the category", () => {
    // The defect this whole increment exists to close: a wizard swinging a
    // longsword used to roll with a proficiency they do not have.
    const result = weaponAttackBonus({
      profile: profile({ category: "martial" }),
      stats: STATS,
      characterClass: "wizard",
      level: 1,
    });
    expect(result.proficiencyApplied).toBe(false);
    expect(result.bonus).toBe(3); // +3 STR only
  });

  it("normalises a free-text class the way the database stores it", () => {
    const result = weaponAttackBonus({
      profile: profile({ category: "martial" }),
      stats: STATS,
      characterClass: "  Barbarian ",
      level: 1,
    });
    expect(result.proficiencyApplied).toBe(true);
  });

  it("withholds proficiency for a class outside the twelve", () => {
    const result = weaponAttackBonus({
      profile: profile({ category: "martial" }),
      stats: STATS,
      characterClass: "artificer",
      level: 1,
    });
    expect(result.proficiencyApplied).toBe(false);
    expect(result.bonus).toBe(3);
  });

  it("withholds proficiency when the category could not be resolved", () => {
    const result = weaponAttackBonus({
      profile: profile({ category: null }),
      stats: STATS,
      characterClass: "barbarian",
      level: 1,
    });
    expect(result.categoryResolved).toBe(false);
    expect(result.proficiencyApplied).toBe(false);
    expect(result.bonus).toBe(3);
  });

  it("grants proficiency for an unarmed strike, which has no weapon at all", () => {
    // SRD 2014: you are proficient with your unarmed strikes. A null profile
    // means "no weapon", which is NOT the same as a weapon whose category is
    // unknown — the test above. Conflating them would silently drop every
    // unarmed attack by the proficiency bonus.
    const result = weaponAttackBonus({
      profile: null,
      stats: STATS,
      characterClass: "wizard",
      level: 1,
    });
    expect(result.abilityUsed).toBe("STR");
    expect(result.proficiencyApplied).toBe(true);
    expect(result.categoryResolved).toBe(false);
    expect(result.bonus).toBe(5);
  });
});

describe("weaponAttackBonus — level and degenerate input", () => {
  it.each([
    [1, 5],
    [4, 5],
    [5, 6],
    [9, 7],
    [13, 8],
    [20, 9],
  ])("scales the proficiency bonus at level %i to a total of +%i", (level, expected) => {
    expect(
      weaponAttackBonus({
        profile: profile(),
        stats: STATS,
        characterClass: "fighter",
        level,
      }).bonus,
    ).toBe(expected);
  });

  it.each([0, 21, NaN, undefined as unknown as number])(
    "clamps an unusable level (%s) to level 1 rather than throwing",
    (level) => {
      // proficiencyBonus() throws a RangeError outside 1-20, and this input
      // comes straight from a persisted column. Degrade conservatively.
      expect(
        weaponAttackBonus({
          profile: profile(),
          stats: STATS,
          characterClass: "fighter",
          level,
        }).bonus,
      ).toBe(5);
    },
  );

  it("treats a missing ability score as 10", () => {
    const result = weaponAttackBonus({
      profile: profile(),
      stats: {},
      characterClass: "fighter",
      level: 1,
    });
    expect(result.bonus).toBe(2); // +0 ability, +2 proficiency
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run tests/rules/weapon-profile.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/rules/weapon-profile"`.

- [ ] **Step 3: Write the implementation**

Create `lib/rules/weapon-profile.ts`:

```ts
/**
 * lib/rules/weapon-profile.ts
 *
 * What a weapon is, and what bonus it grants the character wielding it.
 *
 * @pure — no database, no I/O, no randomness, and never throws.
 *
 * This module exists because `isWeaponProficient` had ten tests and no consumer:
 * the proficiency bonus was added to every attack unconditionally, because
 * nothing carried a weapon's simple/martial category. It reads that category —
 * and the rest of the weapon's properties — and lets them decide the roll.
 *
 * Everything here arrives from Postgres as untyped JSON or free text, so every
 * read is checked and every unusable value degrades to the conservative answer.
 * A rule that throws on a persisted row turns a corrupt column into a 500.
 */

import { abilityModifier } from "@/lib/rules/dice";
import {
  isWeaponProficient,
  proficiencyBonus,
  type CharacterClass,
  type WeaponCategory,
} from "@/lib/rules/proficiency";

export interface WeaponProfile {
  /** null when the row declares no category and the SRD could not supply one. */
  category: WeaponCategory | null;
  isRanged: boolean;
  /** SRD weapon properties, lowercased. */
  traits: readonly string[];
  damageDice: string | null;
  damageType: string | null;
}

export interface WeaponAttackBonus {
  bonus: number;
  abilityUsed: "STR" | "DEX";
  proficiencyApplied: boolean;
  categoryResolved: boolean;
}

/**
 * The SRD spelling of each category, keyed by the internal one.
 *
 * Keyed as `Record<WeaponCategory, string>` on purpose: adding a member to
 * `WeaponCategory` becomes a compile error here rather than a category that
 * silently never matches. A hand-written array would still type-check with a
 * member missing.
 */
const SRD_CATEGORY: Record<WeaponCategory, string> = {
  simple: "Simple",
  martial: "Martial",
};

const CATEGORIES = Object.keys(SRD_CATEGORY) as WeaponCategory[];

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toCategory(value: unknown): WeaponCategory | null {
  const raw = str(value)?.trim().toLowerCase();
  return CATEGORIES.find((candidate) => candidate === raw) ?? null;
}

function toTraits(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => str(entry)?.toLowerCase() ?? null)
    .filter((entry): entry is string => entry !== null);
}

/**
 * Reads a persisted `InventoryItem.properties` blob into a checked profile.
 *
 * `getItemProperties` (`inventory.ts:211`) is a bare `as` over `Prisma.JsonValue`;
 * this validates instead, which is the difference between a wrong shape being
 * caught and a wrong shape reaching a die roll.
 */
export function readWeaponProfile(properties: unknown): WeaponProfile {
  const root = asRecord(properties);

  return {
    category: toCategory(root?.weaponCategory),
    isRanged: str(root?.weaponRange)?.trim().toLowerCase() === "ranged",
    traits: toTraits(root?.weaponProperties),
    damageDice: str(root?.damageDice),
    damageType: str(root?.damageType),
  };
}

/** Level is a persisted column; proficiencyBonus() throws outside 1-20. */
function clampLevel(level: number): number {
  return Number.isFinite(level) && level >= 1 && level <= 20 ? level : 1;
}

/**
 * Which ability the attack uses.
 *
 * Finesse is checked **before** ranged, and the order is load-bearing. `Dart` is
 * the only SRD weapon that is both, and SRD 2014 says of Finesse: "you use your
 * choice of Strength or Dexterity modifier for the attack and damage rolls",
 * without excluding ranged weapons. Checking ranged first would take that
 * choice away.
 */
function abilityFor(
  profile: WeaponProfile | null,
  stats: Record<string, number>,
): "STR" | "DEX" {
  if (profile === null) return "STR";

  if (profile.traits.includes("finesse")) {
    return score(stats, "DEX") > score(stats, "STR") ? "DEX" : "STR";
  }

  return profile.isRanged ? "DEX" : "STR";
}

function score(stats: Record<string, number>, key: "STR" | "DEX"): number {
  const raw = stats?.[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 10;
}

/**
 * The attack bonus, and why it is what it is.
 *
 * `profile: null` means **no weapon** — an unarmed strike. SRD 2014 grants
 * proficiency with unarmed strikes, so it is proficient. That is a different
 * case from a weapon whose category could not be resolved, which is not
 * proficient; both report `categoryResolved: false` and differ in
 * `proficiencyApplied`.
 *
 * `abilityUsed` is returned, not just the number, because the damage bonus must
 * use the same ability — SRD 2014 on Finesse: "You must use the same modifier
 * for both." A caller that took the number and left damage on Strength would
 * ship a rule contradicting itself inside one attack.
 */
export function weaponAttackBonus(input: {
  profile: WeaponProfile | null;
  stats: Record<string, number>;
  characterClass: string;
  level: number;
}): WeaponAttackBonus {
  const { profile, stats, characterClass, level } = input;

  const abilityUsed = abilityFor(profile, stats);
  const abilityMod = abilityModifier(score(stats, abilityUsed));

  const category = profile?.category ?? null;
  const normalisedClass = characterClass.trim().toLowerCase() as CharacterClass;

  const proficiencyApplied =
    profile === null
      ? true
      : category !== null && isWeaponProficient(normalisedClass, category);

  const bonus =
    abilityMod + (proficiencyApplied ? proficiencyBonus(clampLevel(level)) : 0);

  return {
    bonus,
    abilityUsed,
    proficiencyApplied,
    categoryResolved: category !== null,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run tests/rules/weapon-profile.test.ts
```

Expected: PASS, 26 tests (5 + 4 + 6 + 11 across the four `describe` blocks — the
last contains two `it.each` tables of 6 and 4 rows plus one standalone case).

- [ ] **Step 5: Commit**

```bash
git add lib/rules/weapon-profile.ts tests/rules/weapon-profile.test.ts
git commit -m "feat(rules): let a weapon's own properties decide its attack bonus"
```

---

### Task 2: Resolving a legacy row's category from the SRD

**Files:**
- Create: `lib/rules/weapon-profile-service.ts`
- Test: `tests/rules/weapon-profile-service.test.ts`

**Interfaces:**
- Consumes: `readWeaponProfile` and `WeaponProfile` from
  `@/lib/rules/weapon-profile` (Task 1); `getEquipmentInfo` from
  `@/lib/rules/srd-equipment-lookup` (shipped in PR 1).
- Produces, both imported by Task 4 from `@/lib/rules/weapon-profile-service`:
  - `interface WeaponRow { name: string; properties: unknown }`
  - `function resolveWeaponProfile(row: WeaponRow): Promise<WeaponProfile>`

**Background you need.**

Every `InventoryItem` persisted today was written by hand at character creation
(`app/api/character/route.ts:90`) with only `damageDice`, `damageBonus` and
`damageType`. None carries a category. Task 3 makes new rows carry one; this
task is how the rows that already exist get one.

`getEquipmentInfo` was repaired in PR 1 and now reads `SrdItem` (237 rows),
matching by id or by **exact** case-insensitive name. It returns SRD casing
verbatim — `"Martial"`, `"Versatile"` — because it is also the narrator's tool
output. `readWeaponProfile` lowercases at the rule boundary, so feed the SRD's
values through the same reader rather than lowercasing here.

The live save's weapon is named `"Longsword"`, which resolves to SRD id
`longsword`: Martial, `1d8` Slashing, `Versatile`.

**Precedence matters and is easy to get backwards.** If the row declares a
category, the row wins — the SRD is a fallback, not an arbiter that overwrites
what was persisted. Magic or modified weapons will need exactly that.

- [ ] **Step 1: Write the failing test**

Create `tests/rules/weapon-profile-service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const getEquipmentInfo = vi.fn();

vi.mock("@/lib/rules/srd-equipment-lookup", () => ({ getEquipmentInfo }));

import { resolveWeaponProfile } from "@/lib/rules/weapon-profile-service";

/** The shape PR 1's projector returns, with SRD casing preserved. */
const SRD_LONGSWORD = {
  name: "Longsword",
  weaponCategory: "Martial",
  weaponRange: "Melee",
  damageDice: "1d8",
  damageType: "Slashing",
  properties: ["Versatile"],
};

beforeEach(() => {
  getEquipmentInfo.mockReset();
  getEquipmentInfo.mockResolvedValue(null);
});

describe("resolveWeaponProfile", () => {
  it("uses what the row declares, without touching the database", async () => {
    const resolved = await resolveWeaponProfile({
      name: "Longsword",
      properties: {
        weaponCategory: "Martial",
        weaponRange: "Melee",
        weaponProperties: ["Versatile"],
        damageDice: "1d8",
        damageType: "Slashing",
      },
    });

    expect(resolved.category).toBe("martial");
    expect(resolved.traits).toEqual(["versatile"]);
    expect(getEquipmentInfo).not.toHaveBeenCalled();
  });

  it("resolves a legacy row by exact name against the SRD", async () => {
    // The live save's weapon: hand-written with damage fields only.
    getEquipmentInfo.mockResolvedValue(SRD_LONGSWORD);

    const resolved = await resolveWeaponProfile({
      name: "Longsword",
      properties: { damageDice: "1d8", damageBonus: 0, damageType: "slashing" },
    });

    expect(getEquipmentInfo).toHaveBeenCalledWith("Longsword");
    expect(resolved.category).toBe("martial");
    expect(resolved.isRanged).toBe(false);
    expect(resolved.traits).toEqual(["versatile"]);
  });

  it("keeps the row's own category even when the SRD disagrees", async () => {
    // Precedence: the SRD is the fallback, never an arbiter overwriting what
    // was persisted. A magic or modified weapon depends on this.
    getEquipmentInfo.mockResolvedValue({ ...SRD_LONGSWORD, weaponCategory: "Simple" });

    const resolved = await resolveWeaponProfile({
      name: "Longsword",
      properties: { weaponCategory: "Martial" },
    });

    expect(resolved.category).toBe("martial");
    expect(getEquipmentInfo).not.toHaveBeenCalled();
  });

  it("falls to a null category when the SRD has no such weapon", async () => {
    getEquipmentInfo.mockResolvedValue(null);

    const resolved = await resolveWeaponProfile({
      name: "Rusty Shiv",
      properties: { damageDice: "1d4" },
    });

    expect(resolved.category).toBeNull();
    expect(resolved.damageDice).toBe("1d4");
  });

  it("keeps the row's own damage when the SRD supplies a category", async () => {
    // Only the missing half is filled in. A +1 longsword's persisted dice must
    // not be replaced by the mundane SRD entry's.
    getEquipmentInfo.mockResolvedValue(SRD_LONGSWORD);

    const resolved = await resolveWeaponProfile({
      name: "Longsword",
      properties: { damageDice: "2d6", damageType: "Radiant" },
    });

    expect(resolved.category).toBe("martial");
    expect(resolved.damageDice).toBe("2d6");
    expect(resolved.damageType).toBe("Radiant");
  });

  it("returns a null category instead of throwing when the lookup fails", async () => {
    // A database blip must not turn an attack into a 500. Degrade to
    // "no category", which withholds proficiency rather than inflating it.
    getEquipmentInfo.mockRejectedValue(new Error("connection lost"));

    const resolved = await resolveWeaponProfile({
      name: "Longsword",
      properties: { damageDice: "1d8" },
    });

    expect(resolved.category).toBeNull();
    expect(resolved.damageDice).toBe("1d8");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run tests/rules/weapon-profile-service.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/rules/weapon-profile-service"`.

- [ ] **Step 3: Write the implementation**

Create `lib/rules/weapon-profile-service.ts`:

```ts
/**
 * lib/rules/weapon-profile-service.ts
 *
 * Fills in what a persisted weapon row does not say about itself.
 *
 * The pure rule lives in `weapon-profile.ts`; this is the only part that needs
 * the database, and it needs it only for rows written before a category was
 * ever stored. The split mirrors the previous increment: `spell-targeting.ts`
 * decides, `geometry.ts` calculates, `spell-resolution-service.ts` touches the
 * database.
 *
 * Server-only — never import from a client component.
 */

import { getEquipmentInfo } from "@/lib/rules/srd-equipment-lookup";
import { readWeaponProfile, type WeaponProfile } from "@/lib/rules/weapon-profile";

export interface WeaponRow {
  name: string;
  properties: unknown;
}

/**
 * Resolves a weapon's profile: what the row declares, then the SRD, then null.
 *
 * **Precedence:** a category on the row wins outright, and the lookup is not
 * even attempted. The SRD is the fallback, not an arbiter that overwrites what
 * was persisted — magic and modified weapons will depend on that.
 *
 * Only the category, ranged flag and traits are borrowed from the SRD. The
 * row's own damage survives, so a persisted `2d6 Radiant` longsword does not
 * revert to the mundane entry's `1d8 Slashing`.
 */
export async function resolveWeaponProfile(row: WeaponRow): Promise<WeaponProfile> {
  const declared = readWeaponProfile(row.properties);
  if (declared.category !== null) return declared;

  const srd = await getEquipmentInfo(row.name).catch(() => null);
  if (!srd) return declared;

  const fromSrd = readWeaponProfile({
    weaponCategory: srd.weaponCategory,
    weaponRange: srd.weaponRange,
    weaponProperties: srd.properties,
  });

  return {
    ...declared,
    category: fromSrd.category,
    isRanged: fromSrd.isRanged,
    traits: fromSrd.traits,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run tests/rules/weapon-profile-service.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/rules/weapon-profile-service.ts tests/rules/weapon-profile-service.test.ts
git commit -m "feat(rules): resolve a legacy weapon's category from the SRD"
```

---

### Task 3: Hydrate the starting weapon at character creation

**Files:**
- Modify: `app/api/character/route.ts:75-105`
- Test: `tests/api/character-create-hydration.test.ts`

**Interfaces:**
- Consumes: `getEquipmentInfo` from `@/lib/rules/srd-equipment-lookup`.
- Produces: no new symbols. New `InventoryItem` rows whose `properties` carry
  `weaponCategory`, `weaponRange` and `weaponProperties`, so Task 2's fallback
  never fires for them.

**Background you need.**

Every character is born with a hardcoded longsword. The literal is at
`app/api/character/route.ts:90`:

```ts
{
  name: "Longsword",
  type: "weapon",
  quantity: 1,
  properties: { damageDice: "1d8", damageBonus: 0, damageType: "slashing" },
}
```

The SRD row for `longsword` carries exactly `1d8` and `Slashing`, so hydrating
changes no existing or new character's damage. What the row gains is
`weaponCategory: "Martial"`, `weaponRange: "Melee"` and
`weaponProperties: ["Versatile"]`.

**Two things not to do.**

`InventoryItem.indexSlug` stays unwritten. Nothing would read it — a hydrated row
already carries its category, so the resolution chain never reaches a slug
lookup. A field written and never read is the defect this whole increment closes.
It gets written the day `addItem` has callers again.

`Health Potion` is **not** hydrated. It does not exist in the SRD cache at all:
the 237 rows are mundane gear and potions live behind a different endpoint.
Leave its literal exactly as it is.

**Creation must not depend on a populated cache.** On a fresh development
database `SrdItem` is empty and `getEquipmentInfo` returns `null`. Creation then
falls back to the current literal rather than failing.

- [ ] **Step 1: Write the failing test**

Create `tests/api/character-create-hydration.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildStartingInventory } from "@/app/api/character/route";

const getEquipmentInfo = vi.fn();

vi.mock("@/lib/rules/srd-equipment-lookup", () => ({ getEquipmentInfo }));

const SRD_LONGSWORD = {
  name: "Longsword",
  weaponCategory: "Martial",
  weaponRange: "Melee",
  damageDice: "1d8",
  damageType: "Slashing",
  properties: ["Versatile"],
};

beforeEach(() => {
  getEquipmentInfo.mockReset();
  getEquipmentInfo.mockResolvedValue(null);
});

describe("buildStartingInventory", () => {
  it("hydrates the longsword's category and traits from the SRD", async () => {
    getEquipmentInfo.mockResolvedValue(SRD_LONGSWORD);

    const [weapon] = await buildStartingInventory();

    expect(weapon.name).toBe("Longsword");
    expect(weapon.type).toBe("weapon");
    expect(weapon.properties).toEqual({
      damageDice: "1d8",
      damageBonus: 0,
      damageType: "Slashing",
      weaponCategory: "Martial",
      weaponRange: "Melee",
      weaponProperties: ["Versatile"],
    });
  });

  it("does not write indexSlug, because nothing reads it", async () => {
    getEquipmentInfo.mockResolvedValue(SRD_LONGSWORD);

    const [weapon] = await buildStartingInventory();

    expect(weapon).not.toHaveProperty("indexSlug");
  });

  it("falls back to the literal when the SRD cache is empty", async () => {
    // A fresh development database has no SrdItem rows. Creating a character
    // must not depend on the cache being seeded.
    getEquipmentInfo.mockResolvedValue(null);

    const [weapon] = await buildStartingInventory();

    expect(weapon.properties).toEqual({
      damageDice: "1d8",
      damageBonus: 0,
      damageType: "slashing",
    });
  });

  it("falls back to the literal when the lookup throws", async () => {
    getEquipmentInfo.mockRejectedValue(new Error("connection lost"));

    const [weapon] = await buildStartingInventory();

    expect(weapon.properties).toEqual({
      damageDice: "1d8",
      damageBonus: 0,
      damageType: "slashing",
    });
  });

  it("leaves the health potion alone — it is not in the SRD cache", async () => {
    getEquipmentInfo.mockResolvedValue(SRD_LONGSWORD);

    const inventory = await buildStartingInventory();
    const potion = inventory.find((item) => item.name === "Health Potion");

    expect(potion).toEqual({
      name: "Health Potion",
      type: "consumable",
      quantity: 2,
      properties: { healingDice: "2d4", healingBonus: 2 },
    });
    expect(getEquipmentInfo).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run tests/api/character-create-hydration.test.ts
```

Expected: FAIL — `buildStartingInventory` is not exported from
`@/app/api/character/route`.

- [ ] **Step 3: Write the implementation**

In `app/api/character/route.ts`, add this import alongside the existing ones:

```ts
import { getEquipmentInfo } from "@/lib/rules/srd-equipment-lookup";
```

Then add this exported function above the route handler:

```ts
/**
 * The inventory every new character starts with.
 *
 * The longsword's mechanical properties are hydrated from the SRD cache so the
 * row carries its category and traits — without them, every attack applied a
 * proficiency bonus the character may not have. The literal it replaces already
 * matched the SRD's `1d8` and slashing exactly, so no character's damage changes.
 *
 * Exported so it can be tested without standing up the route.
 */
export async function buildStartingInventory() {
  const srd = await getEquipmentInfo("Longsword").catch(() => null);

  // A fresh development database has no SrdItem rows. Creating a character must
  // not depend on the cache being seeded, so an absent lookup keeps the literal.
  const weaponProperties = srd?.weaponCategory
    ? {
        damageDice: srd.damageDice ?? "1d8",
        damageBonus: 0,
        damageType: srd.damageType ?? "slashing",
        weaponCategory: srd.weaponCategory,
        weaponRange: srd.weaponRange,
        weaponProperties: srd.properties,
      }
    : { damageDice: "1d8", damageBonus: 0, damageType: "slashing" };

  return [
    {
      name: "Longsword",
      type: "weapon",
      quantity: 1,
      properties: weaponProperties,
    },
    {
      // Not hydrated: the SRD cache holds mundane gear only, and potions live
      // behind a different endpoint entirely.
      name: "Health Potion",
      type: "consumable",
      quantity: 2,
      properties: { healingDice: "2d4", healingBonus: 2 },
    },
  ];
}
```

Then replace the inline `inventory: { create: [ … ] }` block at
`app/api/character/route.ts:87-102` with:

```ts
      inventory: {
        create: await buildStartingInventory(),
      },
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run tests/api/character-create-hydration.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Check the route still compiles and its own tests still pass**

```bash
pnpm typecheck
```

```bash
pnpm exec vitest run tests/api
```

Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add app/api/character/route.ts tests/api/character-create-hydration.test.ts
git commit -m "feat(character): hydrate the starting weapon from the SRD cache"
```

---

### Task 4: One shared call site, and damage that follows the attack

**Files:**
- Create: `lib/rules/weapon-attack.ts`
- Modify: `lib/rules/combat.ts:884-912` (remove `weaponAttackModifier`)
- Modify: `app/api/campaign/[id]/action/route.ts:236-273` and `:948-979`
- Modify: `tests/rules/ability-check-advantage.test.ts:73-97` (rewrite its assertions)
- Test: `tests/rules/weapon-attack.test.ts`

**Interfaces:**
- Consumes: `resolveWeaponProfile` from `@/lib/rules/weapon-profile-service`
  (Task 2); `weaponAttackBonus` and `WeaponAttackBonus` from
  `@/lib/rules/weapon-profile` (Task 1); `abilityModifier` from `@/lib/rules/dice`.
- Produces, both used by the two attack sites in the action route:
  - `resolveWeaponAttack(input): Promise<ResolvedWeaponAttack>`
  - `unresolvedCategoryLog(input: { weaponName: string; attack: ResolvedWeaponAttack }): string | null`

**Background you need.**

There are two attack sites and they are not identical. Their differences are
legitimate and must survive:

| | Site 1 (`route.ts:236`) | Site 2 (`route.ts:948`) |
| --- | --- | --- |
| Weapon selection | `type === "weapon" && equippedSlot === "MAIN_HAND"` | first `type === "weapon"` |
| No weapon | allowed — unarmed, `1d4` | rejected with HTTP 400 |
| Damage-type default | `"bludgeoning"` | `"slashing"` |

Both currently compute the same three things by hand:

```ts
const strMod = abilityModifier(charStats.STR ?? 10);
const attackModifier = weaponAttackModifier(strMod, context.character.level);
// ...
flatDamageBonus: strMod + weaponBonus,
```

That duplication is what let the route drift from `view-model.ts`. The shared
helper takes it over.

**The damage bonus must use `abilityUsed`.** SRD 2014 on Finesse: *"You must use
the same modifier for both."* Changing only the attack to DEX — through finesse
or through a ranged weapon — would ship a rule contradicting itself inside one
attack. This is the only place in the increment where an existing damage number
changes, and only for ranged or finesse weapons. The live save's longsword is
neither, so its damage is untouched.

**`weaponAttackModifier` is removed, not deprecated.** A second way to compute
one bonus is the disease. Its tests at
`tests/rules/ability-check-advantage.test.ts:73-97` are rewritten against the
replacement — the level-scaling and the level-clamp cases both survive, because
both behaviours survive.

**The unresolved category must be declared, not swallowed.** The spec requires
it, and without it `categoryResolved` would be a value produced and never
consumed — the exact defect this increment exists to close. The previous
increment set the pattern at `route.ts:716-724`: build the line, then write it
with `prisma.gameLog.create` only once the action is confirmed to proceed.

The line itself is a **pure function** in the same module, so it can be tested
without mocking Prisma. An unarmed strike never logs: it has no weapon and
therefore no category to resolve, and a line on every punch would be noise, not
signal.

- [ ] **Step 1: Write the failing test**

Create `tests/rules/weapon-attack.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const getEquipmentInfo = vi.fn();

vi.mock("@/lib/rules/srd-equipment-lookup", () => ({ getEquipmentInfo }));

import { resolveWeaponAttack, unresolvedCategoryLog } from "@/lib/rules/weapon-attack";

const STATS = { STR: 16, DEX: 14, CON: 12, INT: 10, WIS: 10, CHA: 8 }; // +3 / +2

const HYDRATED_LONGSWORD = {
  name: "Longsword",
  properties: {
    damageDice: "1d8",
    damageBonus: 0,
    damageType: "Slashing",
    weaponCategory: "Martial",
    weaponRange: "Melee",
    weaponProperties: ["Versatile"],
  },
};

const HYDRATED_LONGBOW = {
  name: "Longbow",
  properties: {
    damageDice: "1d8",
    damageBonus: 0,
    damageType: "Piercing",
    weaponCategory: "Martial",
    weaponRange: "Ranged",
    weaponProperties: [],
  },
};

beforeEach(() => {
  getEquipmentInfo.mockReset();
  getEquipmentInfo.mockResolvedValue(null);
});

describe("resolveWeaponAttack", () => {
  it("resolves a melee weapon against a proficient class", async () => {
    const attack = await resolveWeaponAttack({
      weapon: HYDRATED_LONGSWORD,
      stats: STATS,
      characterClass: "barbarian",
      level: 1,
      fallbackDamageType: "slashing",
    });

    expect(attack.attackModifier).toBe(5); // +3 STR, +2 proficiency
    expect(attack.flatDamageBonus).toBe(3); // +3 STR, +0 weapon
    expect(attack.abilityUsed).toBe("STR");
    expect(attack.weaponDice).toBe("1d8");
    expect(attack.damageType).toBe("Slashing");
  });

  it("makes damage follow the attack's ability for a ranged weapon", async () => {
    // The rule that would contradict itself if only the attack moved to DEX.
    const attack = await resolveWeaponAttack({
      weapon: HYDRATED_LONGBOW,
      stats: STATS,
      characterClass: "ranger",
      level: 1,
      fallbackDamageType: "slashing",
    });

    expect(attack.abilityUsed).toBe("DEX");
    expect(attack.attackModifier).toBe(4); // +2 DEX, +2 proficiency
    expect(attack.flatDamageBonus).toBe(2); // +2 DEX, not +3 STR
  });

  it("withholds proficiency from a class that lacks the category", async () => {
    const attack = await resolveWeaponAttack({
      weapon: HYDRATED_LONGSWORD,
      stats: STATS,
      characterClass: "wizard",
      level: 1,
      fallbackDamageType: "slashing",
    });

    expect(attack.proficiencyApplied).toBe(false);
    expect(attack.attackModifier).toBe(3);
    expect(attack.flatDamageBonus).toBe(3); // damage keeps the ability modifier
  });

  it("adds the weapon's own damage bonus on top of the ability", async () => {
    const attack = await resolveWeaponAttack({
      weapon: {
        name: "Longsword +1",
        properties: { ...HYDRATED_LONGSWORD.properties, damageBonus: 1 },
      },
      stats: STATS,
      characterClass: "barbarian",
      level: 1,
      fallbackDamageType: "slashing",
    });

    expect(attack.flatDamageBonus).toBe(4); // +3 STR, +1 weapon
  });

  it("treats a missing weapon as a proficient unarmed strike", async () => {
    // Site 1 permits this. SRD 2014 grants proficiency with unarmed strikes,
    // so the bonus must not silently drop by the proficiency bonus.
    const attack = await resolveWeaponAttack({
      weapon: null,
      stats: STATS,
      characterClass: "wizard",
      level: 1,
      fallbackDamageType: "bludgeoning",
    });

    expect(attack.weaponDice).toBe("1d4");
    expect(attack.damageType).toBe("bludgeoning");
    expect(attack.proficiencyApplied).toBe(true);
    expect(attack.attackModifier).toBe(5);
  });

  it("resolves a legacy row's category from the SRD", async () => {
    getEquipmentInfo.mockResolvedValue({
      name: "Longsword",
      weaponCategory: "Martial",
      weaponRange: "Melee",
      damageDice: "1d8",
      damageType: "Slashing",
      properties: ["Versatile"],
    });

    const attack = await resolveWeaponAttack({
      weapon: {
        name: "Longsword",
        properties: { damageDice: "1d8", damageBonus: 0, damageType: "slashing" },
      },
      stats: STATS,
      characterClass: "wizard",
      level: 1,
      fallbackDamageType: "slashing",
    });

    expect(attack.categoryResolved).toBe(true);
    expect(attack.proficiencyApplied).toBe(false); // resolved, and still not proficient
  });

  it("reports an unresolved category so the gap can be declared", async () => {
    getEquipmentInfo.mockResolvedValue(null);

    const attack = await resolveWeaponAttack({
      weapon: { name: "Rusty Shiv", properties: { damageDice: "1d4" } },
      stats: STATS,
      characterClass: "fighter",
      level: 1,
      fallbackDamageType: "slashing",
    });

    expect(attack.categoryResolved).toBe(false);
    expect(attack.proficiencyApplied).toBe(false);
  });

  it("uses the caller's damage-type fallback when the weapon declares none", async () => {
    // The two attack sites default differently — "bludgeoning" and "slashing" —
    // and both defaults are pre-existing behaviour worth keeping.
    const attack = await resolveWeaponAttack({
      weapon: { name: "Odd Thing", properties: { damageDice: "1d6" } },
      stats: STATS,
      characterClass: "fighter",
      level: 1,
      fallbackDamageType: "bludgeoning",
    });

    expect(attack.damageType).toBe("bludgeoning");
  });
});

describe("unresolvedCategoryLog", () => {
  const RESOLVED = {
    attackModifier: 5,
    flatDamageBonus: 3,
    weaponDice: "1d8",
    damageType: "Slashing",
    abilityUsed: "STR" as const,
    proficiencyApplied: true,
    categoryResolved: true,
  };

  it("says nothing when the category resolved", () => {
    expect(
      unresolvedCategoryLog({ weaponName: "Longsword", attack: RESOLVED }),
    ).toBeNull();
  });

  it("declares the gap when the category could not be resolved", () => {
    // A rule that did not apply and left no trace is how a gap survives
    // unnoticed. The previous increment declares an unenforceable spell range
    // the same way rather than implying it held.
    const line = unresolvedCategoryLog({
      weaponName: "Rusty Shiv",
      attack: { ...RESOLVED, categoryResolved: false, proficiencyApplied: false },
    });

    expect(line).toContain("Rusty Shiv");
    expect(line).toContain("proficiency");
  });

  it("says nothing for an unarmed strike, which has no category to resolve", () => {
    // Unarmed is proficient by SRD rule and has no weapon. A line on every
    // punch would be noise rather than signal.
    expect(
      unresolvedCategoryLog({
        weaponName: "Unarmed",
        attack: { ...RESOLVED, categoryResolved: false, proficiencyApplied: true },
      }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run tests/rules/weapon-attack.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/rules/weapon-attack"`.

- [ ] **Step 3: Write the shared helper**

Create `lib/rules/weapon-attack.ts`:

```ts
/**
 * lib/rules/weapon-attack.ts
 *
 * Everything one weapon attack needs, resolved once.
 *
 * The action route had two attack sites, each computing the attack modifier and
 * the damage bonus by hand from the Strength modifier. Two parallel copies of
 * one rule is what let the route drift from `lib/character-sheet/view-model.ts`,
 * so both now call this.
 *
 * Server-only — never import from a client component.
 */

import { abilityModifier } from "@/lib/rules/dice";
import { weaponAttackBonus } from "@/lib/rules/weapon-profile";
import { resolveWeaponProfile } from "@/lib/rules/weapon-profile-service";

const UNARMED_DICE = "1d4";

export interface ResolvedWeaponAttack {
  attackModifier: number;
  flatDamageBonus: number;
  weaponDice: string;
  damageType: string;
  abilityUsed: "STR" | "DEX";
  proficiencyApplied: boolean;
  categoryResolved: boolean;
}

/**
 * Resolves one attack's numbers from the weapon, the character, and the SRD.
 *
 * `weapon: null` is an unarmed strike, which the first attack site permits.
 *
 * `flatDamageBonus` uses the same ability the attack roll used. SRD 2014 on
 * Finesse: "You must use the same modifier for both." Leaving damage on
 * Strength while the attack moved to Dexterity would be a rule contradicting
 * itself inside a single attack.
 */
export async function resolveWeaponAttack(input: {
  weapon: { name: string; properties: unknown } | null;
  stats: Record<string, number>;
  characterClass: string;
  level: number;
  /** Each attack site has its own pre-existing default; both are preserved. */
  fallbackDamageType: string;
}): Promise<ResolvedWeaponAttack> {
  const { weapon, stats, characterClass, level, fallbackDamageType } = input;

  const profile = weapon === null ? null : await resolveWeaponProfile(weapon);
  const bonus = weaponAttackBonus({ profile, stats, characterClass, level });

  const properties =
    typeof weapon?.properties === "object" && weapon.properties !== null
      ? (weapon.properties as Record<string, unknown>)
      : {};
  const weaponDamageBonus =
    typeof properties.damageBonus === "number" ? properties.damageBonus : 0;

  const abilityScore = stats?.[bonus.abilityUsed];
  const abilityMod = abilityModifier(
    typeof abilityScore === "number" && Number.isFinite(abilityScore) ? abilityScore : 10,
  );

  return {
    attackModifier: bonus.bonus,
    flatDamageBonus: abilityMod + weaponDamageBonus,
    weaponDice: profile?.damageDice ?? UNARMED_DICE,
    damageType: profile?.damageType ?? fallbackDamageType,
    abilityUsed: bonus.abilityUsed,
    proficiencyApplied: bonus.proficiencyApplied,
    categoryResolved: bonus.categoryResolved,
  };
}

/**
 * The line to write when a weapon's category could not be resolved.
 *
 * Declared rather than silent: a rule that did not apply and left no trace is
 * how a gap survives unnoticed. The previous increment declares an unenforceable
 * spell range the same way instead of implying it held.
 *
 * Returns null for an unarmed strike, which is proficient by SRD rule and has no
 * category to resolve — a line on every punch would be noise, not signal.
 */
export function unresolvedCategoryLog(input: {
  weaponName: string;
  attack: ResolvedWeaponAttack;
}): string | null {
  const { weaponName, attack } = input;
  if (attack.categoryResolved || attack.proficiencyApplied) return null;

  return (
    `⚠️ ${weaponName}: weapon category not resolved — the SRD has no entry ` +
    `under that name, so the attack was rolled without a proficiency bonus.`
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run tests/rules/weapon-attack.test.ts
```

Expected: PASS, 11 tests — 8 for `resolveWeaponAttack`, 3 for
`unresolvedCategoryLog`.

- [ ] **Step 5: Remove `weaponAttackModifier` and rewrite its tests**

In `lib/rules/combat.ts`, delete the `weaponAttackModifier` function
(`lib/rules/combat.ts:903-912`) together with its doc comment block that begins
`* The attack bonus a character adds to a weapon attack roll.`
(`lib/rules/combat.ts:884`, the line after the previous function's closing `*/`). Leave `resolveAttackRoll` and everything else in the
file untouched.

In `tests/rules/ability-check-advantage.test.ts`, remove `weaponAttackModifier`
from the import at line 7, and replace the entire
`describe("weaponAttackModifier", …)` block at lines 73-97 with:

```ts
describe("weaponAttackBonus replaces weaponAttackModifier", () => {
  const PROFILE = {
    category: "martial" as const,
    isRanged: false,
    traits: [] as readonly string[],
    damageDice: "1d8",
    damageType: "Slashing",
  };
  const NO_MOD = { STR: 10, DEX: 10 }; // ability modifier 0

  it.each([
    [1, 2],
    [4, 2],
    [5, 3],
    [9, 4],
    [13, 5],
    [20, 6],
  ])("a nivel %i el bono de competencia es +%i", (level, expected) => {
    // Estaba fijo a +2 en las dos rutas de ataque, así que desde nivel 5 toda
    // tirada salía corta. Con modificador 0, lo devuelto es la competencia.
    expect(
      weaponAttackBonus({
        profile: PROFILE,
        stats: NO_MOD,
        characterClass: "fighter",
        level,
      }).bonus,
    ).toBe(expected);
  });

  it("suma el modificador de característica a la competencia", () => {
    expect(
      weaponAttackBonus({
        profile: PROFILE,
        stats: { STR: 16, DEX: 10 },
        characterClass: "fighter",
        level: 5,
      }).bonus,
    ).toBe(6); // +3 STR, +3 competencia
  });

  it.each([0, 21, NaN, undefined as unknown as number])(
    "un nivel inutilizable (%s) cae al suelo de nivel 1, nunca a NaN",
    (level) => {
      // Degradar conservador: nunca infla el ataque, y no propaga NaN a la
      // tirada como haría una fórmula aplicada a un nivel ausente.
      expect(
        weaponAttackBonus({
          profile: PROFILE,
          stats: NO_MOD,
          characterClass: "fighter",
          level,
        }).bonus,
      ).toBe(2);
    },
  );
});
```

Add this import at the top of that test file:

```ts
import { weaponAttackBonus } from "@/lib/rules/weapon-profile";
```

- [ ] **Step 6: Rewire attack site 1**

In `app/api/campaign/[id]/action/route.ts`, replace lines 236-252 — from
`const foundWeapon = context.character.inventory.find(` through
`const attackModifier = weaponAttackModifier(strMod, context.character.level);` —
with:

```ts
      const foundWeapon = context.character.inventory.find(
        (i) => i.type === "weapon" && i.equippedSlot === "MAIN_HAND"
      );

      const charStats = context.character.stats as Record<string, number>;
      const playerCombatant = activeEncounter.combatants.find(c => c.isPlayer);
      const playerConditions = extractConditions(playerCombatant?.conditions);

      const attack = await resolveWeaponAttack({
        weapon: foundWeapon
          ? { name: foundWeapon.name, properties: foundWeapon.properties }
          : null,
        stats: charStats,
        characterClass: context.character.class,
        level: context.character.level,
        fallbackDamageType: "bludgeoning",
      });

      // Declared before the transaction opens: at this point the attack is
      // confirmed to proceed, so the line never describes an attack that was
      // rejected. Same discipline as the unenforceable-range log above.
      const categoryLog = foundWeapon
        ? unresolvedCategoryLog({ weaponName: foundWeapon.name, attack })
        : null;
      if (categoryLog) {
        await prisma.gameLog.create({
          data: { campaignId, role: "system", content: categoryLog },
        });
      }
```

Then in the `executeCombatAction` call below it, replace these four fields:

```ts
          weaponDice,
          damageType: ((foundWeapon?.properties as Record<string, unknown>)?.damageType || "bludgeoning") as DamageType,
          attackModifier,
          flatDamageBonus: strMod + weaponBonus,
```

with:

```ts
          weaponDice: attack.weaponDice,
          damageType: attack.damageType as DamageType,
          attackModifier: attack.attackModifier,
          flatDamageBonus: attack.flatDamageBonus,
```

- [ ] **Step 7: Rewire attack site 2**

In the same file, replace lines 948-958 — from
`const foundWeapon = context.character.inventory.find(item => item.type === "weapon");`
through `const attackModifier = weaponAttackModifier(strMod, context.character.level);` —
with:

```ts
      const foundWeapon = context.character.inventory.find(item => item.type === "weapon");
      if (!foundWeapon) {
        return NextResponse.json({ error: "No weapon found." }, { status: 400 });
      }

      const charStats = context.character.stats as Record<string, number>;
      const playerCombatant = context.activeEncounter.combatants.find(c => c.isPlayer);
      const playerConditions = extractConditions(playerCombatant?.conditions);

      const attack = await resolveWeaponAttack({
        weapon: { name: foundWeapon.name, properties: foundWeapon.properties },
        stats: charStats,
        characterClass: context.character.class,
        level: context.character.level,
        fallbackDamageType: "slashing",
      });

      const categoryLog = unresolvedCategoryLog({
        weaponName: foundWeapon.name,
        attack,
      });
      if (categoryLog) {
        await prisma.gameLog.create({
          data: { campaignId, role: "system", content: categoryLog },
        });
      }
```

Then in that site's `executeCombatAction` call, replace:

```ts
          weaponDice: weaponProps?.damageDice || "1d4",
          damageType: (weaponProps?.damageType as DamageType) || "slashing",
          attackModifier,
          flatDamageBonus: strMod + (weaponProps?.damageBonus || 0),
```

with:

```ts
          weaponDice: attack.weaponDice,
          damageType: attack.damageType as DamageType,
          attackModifier: attack.attackModifier,
          flatDamageBonus: attack.flatDamageBonus,
```

- [ ] **Step 8: Fix the imports in the route**

At the top of `app/api/campaign/[id]/action/route.ts`, remove
`weaponAttackModifier` from the import from `@/lib/rules/combat` (line 21) and add:

```ts
import { resolveWeaponAttack, unresolvedCategoryLog } from "@/lib/rules/weapon-attack";
```

`abilityModifier` and `getItemProperties` may now be unused in this file. Run
`pnpm lint` and remove whichever imports it reports as unused — do not remove
them on assumption, since both are used elsewhere in the same file.

- [ ] **Step 9: Verify the whole wiring**

```bash
pnpm typecheck
```

```bash
pnpm lint
```

```bash
pnpm exec vitest run tests/rules tests/api
```

Expected: all clean. If `tests/api/action-intent-contract.test.ts` fails, read
the failure before changing anything — that suite guards the route's action
gates, and a genuine break there means the rewiring changed a gate's behaviour,
which it must not.

- [ ] **Step 10: Commit**

```bash
git add lib/rules/weapon-attack.ts tests/rules/weapon-attack.test.ts lib/rules/combat.ts tests/rules/ability-check-advantage.test.ts "app/api/campaign/[id]/action/route.ts"
git commit -m "feat(combat): resolve both attack sites through one weapon rule"
```

---

### Task 5: The sheet and the die must agree

**Files:**
- Modify: `lib/character-sheet/view-model.ts:141-158`
- Test: `tests/rules/attack-bonus-both-ends.test.ts`

**Interfaces:**
- Consumes: `readWeaponProfile` and `weaponAttackBonus` from
  `@/lib/rules/weapon-profile` (Task 1).
- Produces: no new symbols.

**Background you need.**

This is the task that resolves the spec's internal contradiction, recorded at the
top of this plan. `lib/character-sheet/view-model.ts:154` computes
`bonus: attackModifier + proficiencyBonus` — proficiency applied
**unconditionally**, and its own finesse check at `:144-147` duplicating the rule.
After Task 4 the backend applies proficiency conditionally, so a wizard with a
longsword would see a sheet number two higher than the die uses.

The view-model therefore consumes the same **pure** rule function. This is not
the backend service the user declined: no I/O, no HTTP, no service response —
one pure function from `lib/rules/`. `MILESTONE_V_SPEC` §5 is respected because
no UI or VTT component is touched, only this `lib/` module.

**The trait key changes here too.** `view-model.ts:143` reads
`properties.properties`; the canonical key is `weaponProperties`, matching the
`WeaponProperties` interface (`lib/rules/inventory.ts:50`) and `InventoryPanel.tsx:35`.
No persisted row carries either key today, so there is nothing to migrate — three
names for one thing simply stop existing.

**What the view-model cannot do:** it has no database, so it cannot resolve a
legacy row's category from the SRD. A legacy row shows no proficiency on the
sheet. That is the conservative direction — it under-reports rather than
over-promises — and it is why the guard below uses a hydrated weapon.

- [ ] **Step 1: Write the failing guard**

Create `tests/rules/attack-bonus-both-ends.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSheetViewModel } from "@/lib/character-sheet/view-model";
import { readWeaponProfile, weaponAttackBonus } from "@/lib/rules/weapon-profile";

/**
 * The sheet and the die must show the same number.
 *
 * They diverged silently for a long time: the view-model honoured Finesse while
 * the action route used a fixed Strength modifier, and the view-model applied
 * the proficiency bonus unconditionally while the backend now does not. Two
 * implementations of one SRD rule is the defect; this guard is what makes a
 * third divergence a CI failure instead of a discovery months later.
 */

const HYDRATED = {
  damageDice: "1d8",
  damageBonus: 0,
  damageType: "Slashing",
  weaponCategory: "Martial",
  weaponRange: "Melee",
  weaponProperties: ["Versatile"],
};

const FINESSE = { ...HYDRATED, weaponProperties: ["Finesse"] };
const RANGED = { ...HYDRATED, weaponRange: "Ranged", weaponProperties: [] };

function sheetBonus(
  characterClass: string,
  level: number,
  stats: Record<string, number>,
  properties: Record<string, unknown>,
): number {
  const sheet = buildSheetViewModel({
    character: {
      id: "c1",
      name: "Test",
      race: "human",
      class: characterClass,
      level,
      hp: 10,
      maxHp: 10,
      xp: 0,
      stats,
    },
    inventory: [
      {
        id: "w1",
        name: "Longsword",
        type: "weapon",
        quantity: 1,
        equippedSlot: "MAIN_HAND",
        properties,
      },
    ],
  });

  return sheet.attacks[0].bonus;
}

function backendBonus(
  characterClass: string,
  level: number,
  stats: Record<string, number>,
  properties: Record<string, unknown>,
): number {
  return weaponAttackBonus({
    profile: readWeaponProfile(properties),
    stats,
    characterClass,
    level,
  }).bonus;
}

describe("the sheet's attack bonus equals the backend's", () => {
  it.each([
    ["a proficient class", "barbarian", 1, { STR: 16, DEX: 14 }, HYDRATED],
    ["a class without the category", "wizard", 1, { STR: 16, DEX: 14 }, HYDRATED],
    ["a class outside the twelve", "artificer", 1, { STR: 16, DEX: 14 }, HYDRATED],
    ["proficiency scaling at level 5", "fighter", 5, { STR: 16, DEX: 14 }, HYDRATED],
    ["proficiency scaling at level 20", "fighter", 20, { STR: 16, DEX: 14 }, HYDRATED],
    ["a finesse weapon and a nimble character", "rogue", 1, { STR: 8, DEX: 18 }, FINESSE],
    ["a finesse weapon and a strong character", "rogue", 1, { STR: 18, DEX: 8 }, FINESSE],
    ["a ranged weapon", "ranger", 1, { STR: 16, DEX: 14 }, RANGED],
  ])("agrees for %s", (_label, characterClass, level, stats, properties) => {
    expect(sheetBonus(characterClass, level, stats, properties)).toBe(
      backendBonus(characterClass, level, stats, properties),
    );
  });

  it("shows a wizard no proficiency with a martial weapon", () => {
    // Pins the direction, not just the agreement: if both ends regressed to
    // applying proficiency unconditionally, the equality test above would still
    // pass. +3 STR and nothing else.
    expect(sheetBonus("wizard", 1, { STR: 16, DEX: 14 }, HYDRATED)).toBe(3);
  });

  it("reads the canonical weaponProperties key", () => {
    // The old key was `properties.properties`. A weapon whose traits live under
    // the canonical name must have its finesse honoured.
    // CORRECTED: this shipped as 4, not 6. A rogue has only the `simple`
    // category in this model (`lib/rules/proficiency.ts:82`), so no proficiency
    // bonus applies to a martial finesse weapon: +4 DEX and nothing else.
    expect(sheetBonus("rogue", 1, { STR: 8, DEX: 18 }, FINESSE)).toBe(4); // +4 DEX, no prof
  });
});
```

- [ ] **Step 2: Run the guard to verify it fails**

```bash
pnpm exec vitest run tests/rules/attack-bonus-both-ends.test.ts
```

Expected: FAIL. The wizard case disagrees — the sheet adds the proficiency bonus
that the backend now withholds — and the `weaponProperties` case fails because
the view-model still reads `properties.properties`.

- [ ] **Step 3: Rewrite the view-model's attack block**

In `lib/character-sheet/view-model.ts`, replace the whole `attacks:` block at
lines 141-158 with:

```ts
    attacks: inventory.filter((item) => item.type === "weapon").map((weapon) => {
      // The bonus comes from the same pure rule the action route resolves with.
      // The sheet used to compute its own, honouring Finesse while the route did
      // not and applying proficiency where the route now does not; two
      // implementations of one SRD rule is exactly the drift this closes.
      const properties = getObject(weapon.properties);
      const profile = readWeaponProfile(properties);
      const attack = weaponAttackBonus({
        profile,
        stats,
        characterClass: character.class,
        level: character.level,
      });

      const abilityMod = getModifier(stats[attack.abilityUsed]);
      const damageBonus =
        abilityMod + (typeof properties.damageBonus === "number" ? properties.damageBonus : 0);
      const damageDice = profile.damageDice ?? "N/D";
      const damageType = profile.damageType ?? "";

      return {
        id: weapon.id,
        name: weapon.name,
        bonus: attack.bonus,
        damage: `${damageDice}${damageBonus === 0 ? "" : formatModifier(damageBonus)} ${damageType}`.trim(),
        traits: [...profile.traits],
      };
    }),
```

Add this import at the top of the file:

```ts
import { readWeaponProfile, weaponAttackBonus } from "@/lib/rules/weapon-profile";
```

If `getStringArray` is now unused, `pnpm lint` will say so — remove it only if it
reports it, since it may serve other fields.

- [ ] **Step 4: Run the guard to verify it passes**

```bash
pnpm exec vitest run tests/rules/attack-bonus-both-ends.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Check the view-model's own tests**

```bash
pnpm exec vitest run tests/character-sheet
```

Expected: FAIL. `tests/character-sheet/view-model.test.ts:15` holds a Rapier
fixture whose traits live under the retired `properties` key and which declares
no category, so under the new rule it loses both its finesse and its proficiency
and its bonus drops from 6 to 3.

Fix the **fixture**, not the rule — it encodes the key this task retires. Change
that line's `properties` object from:

```ts
properties: { damageDice: "1d8", damageType: "piercing", properties: ["finesse"] }
```

to:

```ts
properties: { damageDice: "1d8", damageType: "piercing", weaponCategory: "Martial", weaponProperties: ["Finesse"] }
```

Every existing assertion in that test then passes **unchanged**, and this is
worth checking rather than assuming: the character is a Fighter at level 5, so
the proficiency bonus is 3; the Rapier is Martial and Fighters are proficient
with martial weapons; finesse takes the greater of STR 16 (+3) and DEX 14 (+2),
which is +3. Total 6 — the number already asserted. Damage is +3 with no weapon
bonus, so `"1d8+3 piercing"` is unchanged too.

If any assertion in that file still fails after this edit, stop and report it.
A fixture change that alters an expected value is a signal the rule moved
something it should not have.

- [ ] **Step 6: Commit**

```bash
git add lib/character-sheet/view-model.ts tests/rules/attack-bonus-both-ends.test.ts tests/character-sheet/view-model.test.ts
git commit -m "fix(character-sheet): show the attack bonus the die actually uses"
```

---

### Task 6: Full verification

**Files:** none modified. This task only runs checks.

**Interfaces:**
- Consumes: the finished state of Tasks 1-5.
- Produces: a verification report.

**Do not push and do not open a pull request.** Those are the user's call and
are deliberately not in this plan's scope.

- [ ] **Step 1: Run the full suite**

```bash
pnpm test
```

Expected: PASS. The baseline before this plan is **3015 tests in 152 files**.

This plan adds **5 new test files and 58 tests**: 26 (Task 1) + 6 (Task 2) +
5 (Task 3) + 11 (Task 4) + 10 (Task 5). The `weaponAttackModifier` block removed
in Task 4 is rewritten one-for-one — 11 cases before, 11 after — so it nets zero.

Expect **3073 in 157**.

A small discrepancy is worth investigating but not necessarily wrong; an exact
`it()` count can shift if a table gains or loses a row during implementation.
A count *below* 3015 is never acceptable: it means something was deleted that
this plan did not intend to delete. Stop and report.

- [ ] **Step 2: Run the remaining gates**

```bash
pnpm typecheck
```

```bash
pnpm lint
```

```bash
pnpm check-retro
```

```bash
pnpm build
```

Expected: all four clean, exit 0.

- [ ] **Step 3: Confirm the dormant defect is closed**

The whole increment exists because `isWeaponProficient` had no consumer. Verify
it now has one:

```bash
grep -rn "isWeaponProficient" --include=*.ts lib app | grep -v "^lib/rules/proficiency.ts"
```

Expected: at least one hit in `lib/rules/weapon-profile.ts`. An empty result
means the rule was built and never wired — the exact defect being repaired.

Then verify the replaced function is gone, not merely unused:

```bash
grep -rn "weaponAttackModifier" --include=*.ts lib app tests
```

Expected: no output.

- [ ] **Step 4: Report completion**

Report files created and modified, commands run with their results, the test
count before and after, and anything that surprised you — especially any place
where the real code disagreed with this plan.

---

## Notes for the reviewer

- **Every attack roll in the game changes here.** That is the point, and it is
  why this was split from PR 1. The live save is a level-1 barbarian
  (STR 15, +2) holding a Longsword, which is Martial and which barbarians are
  proficient with, so that character's numbers do not move. A wizard with the
  same starting longsword loses 2 from both attack and damage — correctly.
- **The damage change is real but narrow.** `flatDamageBonus` moves from the
  Strength modifier to the ability the attack used. It differs only for ranged
  and finesse weapons; no such weapon exists in any persisted inventory today.
- **`addItem` still has no callers.** PR 1's review noted it flipped from
  always-throwing to always-succeeding and is covered by
  `tests/rules/inventory-add-item.test.ts`. This plan does not give it callers,
  and `InventoryItem.indexSlug` stays unwritten for the same reason.
- **Armour proficiency remains unconsumed.** `isArmorProficient` has the same
  shape of defect as `isWeaponProficient` had. AC is resolved on a different path
  and the spec puts it out of scope; it is the obvious next increment.


---

## Corrections

Recorded after implementation and review, the way the spec records its own
"Correction made while planning". The plan is left otherwise intact; these are
the places where what shipped differs from what was written, and why.

1. **`buildStartingInventory` does not live in `app/api/character/route.ts`.**
   Next.js App Router allows only route handlers to be exported from a
   `route.ts`, so importing the builder from there is not possible. It shipped
   as `lib/rules/starting-inventory.ts`, tested by
   `tests/rules/starting-inventory.test.ts` rather than
   `tests/api/character-create-hydration.test.ts`.

2. **The rogue guard case is `4`, not `6`.** The plan annotated it
   `// +4 DEX, +2 prof`. A rogue holds only the `simple` category in
   `lib/rules/proficiency.ts:82` — the SRD's individual rapier/shortsword grants
   are deliberately outside that table — so a martial finesse weapon earns no
   proficiency bonus. +4 DEX and nothing else.

3. **The view-model's calculation was unified after all.** The spec listed this
   as deliberately out of scope. It could not stay out: every character created
   before this branch carries damage and no weapon category, so the attack sites
   fill the category from `SrdItem` while a sheet resolving with
   `readWeaponProfile` alone cannot — the live save's level-1 barbarian rolled
   +4 with a legacy Longsword and displayed +2. `buildSheetViewModel` now takes
   an optional pre-resolved `weaponProfiles` map keyed by inventory item id and
   stays pure; its two server-side callers
   (`app/campaign/[id]/page.tsx`, `app/api/character/[id]/pdf/route.ts`) build
   it with `resolveInventoryWeaponProfiles`. With no map supplied the behaviour
   is unchanged, so every existing test holds. `MILESTONE_V_SPEC` §5 is
   respected: no rendering, no JSX, nothing under `components/` changed.

4. **`damageType` is lowercased at the rule boundary.** The hydrated starting
   longsword wrote the SRD's `"Slashing"` into a field typed as a lowercase-only
   `DamageType` union; `normalizeDamageType` (`lib/rules/combat-pipeline.ts:63`)
   silently converts an unrecognised type to force damage, so the plan's claim
   that hydration changes no character's damage type held only by luck.
