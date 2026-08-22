# Armour Class Unification — Implementation Plan (PR 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One armour-class calculation, shared by combat and the character sheet, that reads the armour category the types already declare.

**Architecture:** A pure module owns "what is this character's AC". `acFromInventory` is removed rather than kept alongside — two ways to compute one number is what produced the divergence being repaired. Both server consumers and the view-model call the replacement, and a guard binds the sheet to the die.

**Tech Stack:** TypeScript, Next.js 15, Prisma 6.19.2, Vitest 4, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-22-armor-proficiency-authority-design.md`

## Global Constraints

- Package manager is **pnpm**. Never `npm`, `yarn` or `bun`. Do not modify `pnpm-lock.yaml`; no dependency is added or removed.
- Do not run `prisma migrate`, `db push`, `db seed`, or `db execute`. This plan touches no migration and no schema.
- Never read or modify environment/secrets files.
- D&D 5e/SRD 2014 only. Never introduce THAC0, descending AC, AD&D saving throw categories, or gold-for-XP.
- **Never inflate a value.** Every unresolvable input degrades to the conservative answer: unarmoured, `10 + DEX`.
- **A rule module never throws on persisted data.** `InventoryItem.properties` is untyped JSON straight from Postgres.
- **No proficiency logic in this PR.** `isArmorProficient` stays unconsumed until PR 2. If a change would alter a roll because of proficiency, it belongs to PR 2 — stop and report.
- **`ArmorCategory` is never redeclared.** `lib/rules/proficiency.ts:32` already exports `"light" | "medium" | "heavy" | "shield"`, and it is the type `isArmorProficient` accepts. Import it.
- Stage files **by name** when committing. Never `git add -A`, `git add .`, or `git commit -a`.
- **Run the full suite as `pnpm exec vitest run --maxWorkers=4`.** A bare `pnpm test` on this machine produces vitest worker-startup timeouts under load that look like test failures and hide the real count.
- Baseline before this plan: **3087 tests in 157 files.**

## The two behaviour changes this PR makes

Both are corrections, and both are stated here so no reviewer has to guess whether they were intended.

1. **Armour must be equipped to count.** `acFromInventory` selected the first row with `type === "armor"` regardless of `equippedSlot`. A breastplate carried in a backpack granted AC. The view-model's rule — `equippedSlot === "ARMOR"` — was the correct one and becomes the only one.
2. **A shield is never body armour.** The SRD stores a shield as `armor_class.base: 2`, an additive bonus. Selecting it as body armour sets a character's AC to `2 + DEX`. The replacement excludes the `shield` category outright. Implementing the shield's actual +2 is **out of scope** — this PR only guarantees it cannot be mistaken for armour.

Neither has a live effect today: the live inventory holds exactly two rows, a Longsword and a Health Potion, and no character owns any armour.

## The trap this plan exists to avoid

`EncounterInventoryItemRecord` (`lib/rules/encounter-service.ts:20-23`) declares only `{ type, properties }`. The new function's input declares `equippedSlot?: string | null`, so passing that record **type-checks cleanly and yields `undefined` forever** — meaning every player would be computed as unarmoured, silently, with a green build.

The record type must gain `equippedSlot`, and Task 2 carries a test that would fail if it did not. Prisma already returns the column at both call sites (`include: { inventory: true }`), so only the type is missing.

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/rules/armor-class.ts` | **Create.** Owns `ArmorProfile`, `readArmorProfile`, `armorClassFor`. Pure: no Prisma, no I/O, never throws. |
| `tests/rules/armor-class.test.ts` | **Create.** The selection rule, the category fallback, the shield case, degenerate input. |
| `lib/rules/combat.ts` | **Modify.** Remove `acFromInventory` and its doc block. |
| `tests/rules/combat.test.ts` | **Modify.** Its `acFromInventory` block moves to the new module's test, migrated. |
| `lib/rules/encounter-service.ts` | **Modify.** Consume the replacement; extend the inventory record type with `equippedSlot`. |
| `app/api/campaign/[id]/encounter/route.ts` | **Modify.** Consume the replacement. |
| `lib/character-sheet/view-model.ts` | **Modify.** Consume the replacement instead of its own inline calculation. |
| `tests/rules/armor-class-both-ends.test.ts` | **Create.** Guard: the AC the sheet shows equals the AC combat resolves. |

---

### Task 1: The pure armour-class rule

**Files:**
- Create: `lib/rules/armor-class.ts`
- Test: `tests/rules/armor-class.test.ts`

**Interfaces:**
- Consumes: `ArmorCategory` from `@/lib/rules/proficiency`.
- Produces, imported by Tasks 2 and 3 from `@/lib/rules/armor-class`:
  - `interface ArmorProfile { category: ArmorCategory | null; baseAC: number | null; declaredAddsDex: boolean | null; declaredMaxDexBonus: number | null }`
  - `function readArmorProfile(properties: unknown): ArmorProfile`
  - `interface ArmorClassResult { armorClass: number; category: ArmorCategory | null; armored: boolean }`
  - `function armorClassFor(input: { inventory: readonly ArmorInventoryRow[]; dexModifier: number }): ArmorClassResult`
  - `interface ArmorInventoryRow { type: string; equippedSlot?: string | null; properties: unknown }`

**Background you need.**

`InventoryItem.properties` is untyped JSON. `ArmorProperties` (`lib/rules/inventory.ts:68-76`) declares `baseAC`, `armorClass` (the category), `addDexModifier`, `maxDexBonus`. The category is currently read by nothing.

The SRD data, verified across all 13 armours in `data/srd-es/equipment.json`:

| Category | Count | `armor_class` |
| --- | --- | --- |
| Light | 3 | `dex_bonus: true`, no `max_bonus` |
| Medium | 5 | `dex_bonus: true`, `max_bonus: 2` — all five |
| Heavy | 4 | `dex_bonus: false` |
| Shield | 1 | `base: 2`, `dex_bonus: false` |

**The decision rule, in order:**

1. Select the row with `type === "armor"` **and** `equippedSlot === "ARMOR"` **and** category `!== "shield"`. If several match, take the first.
2. No such row, or its `baseAC` is absent → unarmoured: `10 + dexModifier`, `armored: false`, `category: null`.
3. The row's own `addDexModifier` wins when present, with `maxDexBonus` as its cap (absent cap = uncapped).
4. When `addDexModifier` is absent, the **category** decides: `light` full, `medium` capped at +2, `heavy` none.
5. When both are absent → unarmoured. Do not invent a base from a row that says nothing about how it behaves.

- [ ] **Step 1: Write the failing test**

Create `tests/rules/armor-class.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  armorClassFor,
  readArmorProfile,
  type ArmorInventoryRow,
} from "@/lib/rules/armor-class";

function equipped(properties: Record<string, unknown>): ArmorInventoryRow {
  return { type: "armor", equippedSlot: "ARMOR", properties };
}

describe("readArmorProfile", () => {
  it("reads a full armour row, lowercasing the category", () => {
    expect(
      readArmorProfile({
        baseAC: 15,
        armorClass: "Medium",
        addDexModifier: true,
        maxDexBonus: 2,
      }),
    ).toEqual({
      category: "medium",
      baseAC: 15,
      declaredAddsDex: true,
      declaredMaxDexBonus: 2,
    });
  });

  it("reports absent fields as null rather than guessing them", () => {
    // The distinction is the whole point: "the row does not say" is not the
    // same as "the row says no", and the two previous implementations
    // disagreed about exactly this.
    expect(readArmorProfile({ baseAC: 11, armorClass: "light" })).toEqual({
      category: "light",
      baseAC: 11,
      declaredAddsDex: null,
      declaredMaxDexBonus: null,
    });
  });

  it("refuses a category string that is not a category", () => {
    expect(readArmorProfile({ baseAC: 12, armorClass: "padded" }).category).toBeNull();
    expect(readArmorProfile({ baseAC: 12, armorClass: 7 }).category).toBeNull();
  });

  it("degrades to nulls instead of throwing on junk", () => {
    for (const junk of [null, undefined, 42, "text", [], {}]) {
      const read = readArmorProfile(junk);
      expect(read.category).toBeNull();
      expect(read.baseAC).toBeNull();
      expect(read.declaredAddsDex).toBeNull();
    }
  });
});

describe("armorClassFor — the row's own data", () => {
  it("is 10 + DEX with nothing equipped", () => {
    const result = armorClassFor({ inventory: [], dexModifier: 3 });
    expect(result.armorClass).toBe(13);
    expect(result.armored).toBe(false);
    expect(result.category).toBeNull();
  });

  it("adds the full modifier for light armour", () => {
    const inventory = [equipped({ baseAC: 12, armorClass: "light", addDexModifier: true })];
    expect(armorClassFor({ inventory, dexModifier: 4 }).armorClass).toBe(16);
  });

  it("caps the modifier at the row's own maximum", () => {
    const inventory = [
      equipped({ baseAC: 14, armorClass: "medium", addDexModifier: true, maxDexBonus: 2 }),
    ];
    expect(armorClassFor({ inventory, dexModifier: 4 }).armorClass).toBe(16);
    expect(armorClassFor({ inventory, dexModifier: 1 }).armorClass).toBe(15);
  });

  it("adds nothing when the row says it adds nothing", () => {
    const inventory = [equipped({ baseAC: 18, armorClass: "heavy", addDexModifier: false })];
    expect(armorClassFor({ inventory, dexModifier: 4 }).armorClass).toBe(18);
    expect(armorClassFor({ inventory, dexModifier: -1 }).armorClass).toBe(18);
  });

  it("reports which category it used", () => {
    const inventory = [equipped({ baseAC: 18, armorClass: "heavy", addDexModifier: false })];
    const result = armorClassFor({ inventory, dexModifier: 0 });
    expect(result.category).toBe("heavy");
    expect(result.armored).toBe(true);
  });
});

describe("armorClassFor — the category decides when the row does not", () => {
  // This is the divergence itself. One previous implementation added the full
  // modifier here and the other added none; neither consulted the category the
  // type has always declared.
  it("gives light armour the full modifier", () => {
    const inventory = [equipped({ baseAC: 11, armorClass: "light" })];
    expect(armorClassFor({ inventory, dexModifier: 3 }).armorClass).toBe(14);
  });

  it("caps medium armour at +2", () => {
    const inventory = [equipped({ baseAC: 15, armorClass: "medium" })];
    expect(armorClassFor({ inventory, dexModifier: 4 }).armorClass).toBe(17);
    expect(armorClassFor({ inventory, dexModifier: 1 }).armorClass).toBe(16);
  });

  it("gives heavy armour none", () => {
    const inventory = [equipped({ baseAC: 16, armorClass: "heavy" })];
    expect(armorClassFor({ inventory, dexModifier: 4 }).armorClass).toBe(16);
  });

  it("treats a row that says nothing at all as no armour", () => {
    // Neither a category nor a dex flag. Inventing a base from a row that
    // cannot say how it behaves would be the one direction that inflates.
    const inventory = [equipped({ baseAC: 20 })];
    const result = armorClassFor({ inventory, dexModifier: 3 });
    expect(result.armorClass).toBe(13);
    expect(result.armored).toBe(false);
  });
});

describe("armorClassFor — what does not count", () => {
  it("never treats a shield as body armour", () => {
    // The SRD stores a shield as base 2 — an additive bonus, not a total.
    // Selecting it as armour would make this character's AC 5 instead of 13.
    const inventory = [equipped({ baseAC: 2, armorClass: "shield" })];
    const result = armorClassFor({ inventory, dexModifier: 3 });
    expect(result.armorClass).toBe(13);
    expect(result.armored).toBe(false);
  });

  it("ignores armour that is carried but not equipped", () => {
    // The behaviour the removed acFromInventory got wrong: it took the first
    // row typed "armor" with no regard for the slot, so a breastplate in a
    // backpack granted its full armour class.
    const inventory: ArmorInventoryRow[] = [
      { type: "armor", properties: { baseAC: 18, armorClass: "heavy" } },
    ];
    expect(armorClassFor({ inventory, dexModifier: 3 }).armorClass).toBe(13);
  });

  it("ignores armour equipped to another slot", () => {
    const inventory: ArmorInventoryRow[] = [
      { type: "armor", equippedSlot: "OFF_HAND", properties: { baseAC: 18, armorClass: "heavy" } },
    ];
    expect(armorClassFor({ inventory, dexModifier: 3 }).armorClass).toBe(13);
  });

  it("ignores rows that are not armour", () => {
    const inventory: ArmorInventoryRow[] = [
      { type: "weapon", equippedSlot: "ARMOR", properties: { baseAC: 18, armorClass: "heavy" } },
    ];
    expect(armorClassFor({ inventory, dexModifier: 3 }).armorClass).toBe(13);
  });

  it("skips a shield to find the body armour behind it", () => {
    const inventory = [
      equipped({ baseAC: 2, armorClass: "shield" }),
      equipped({ baseAC: 16, armorClass: "heavy" }),
    ];
    expect(armorClassFor({ inventory, dexModifier: 3 }).armorClass).toBe(16);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run tests/rules/armor-class.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/rules/armor-class"`.

- [ ] **Step 3: Write the implementation**

Create `lib/rules/armor-class.ts`:

```ts
/**
 * lib/rules/armor-class.ts
 *
 * What armour class a character has, and which armour produced it.
 *
 * @pure — no database, no I/O, no randomness, and never throws.
 *
 * This module exists because the answer was computed in two places that
 * disagreed. `acFromInventory` took the first row typed "armor" regardless of
 * slot, and added the Dexterity modifier whenever the row did not explicitly
 * forbid it. The character sheet required the row to be equipped, and added the
 * modifier only when the row explicitly allowed it. One decided what the player
 * was attacked against; the other decided what the player was shown.
 *
 * Both ignored `ArmorProperties.armorClass` — the SRD category, declared in the
 * types since the beginning and read by nothing. It is what makes an absent
 * `addDexModifier` answerable instead of a guess.
 */

import type { ArmorCategory } from "@/lib/rules/proficiency";

const UNARMORED_BASE = 10;
const MEDIUM_DEX_CAP = 2;

const CATEGORIES: ArmorCategory[] = ["light", "medium", "heavy", "shield"];

export interface ArmorInventoryRow {
  type: string;
  equippedSlot?: string | null;
  properties: unknown;
}

export interface ArmorProfile {
  category: ArmorCategory | null;
  baseAC: number | null;
  /** The row's own dex flag, or null when the row does not say. */
  declaredAddsDex: boolean | null;
  /** The row's own cap, or null when the row does not say. */
  declaredMaxDexBonus: number | null;
}

export interface ArmorClassResult {
  armorClass: number;
  /** The category that produced the number, or null when unarmoured. */
  category: ArmorCategory | null;
  /** False for the 10 + DEX case. */
  armored: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toCategory(value: unknown): ArmorCategory | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().toLowerCase();
  return CATEGORIES.find((candidate) => candidate === raw) ?? null;
}

/**
 * Reads a persisted `InventoryItem.properties` blob into a checked profile.
 *
 * Absent is reported as null rather than defaulted. "The row does not say" and
 * "the row says no" are different answers, and the two implementations this
 * module replaces disagreed about precisely that.
 */
export function readArmorProfile(properties: unknown): ArmorProfile {
  const root = asRecord(properties);

  return {
    category: toCategory(root?.armorClass),
    baseAC: num(root?.baseAC),
    declaredAddsDex:
      typeof root?.addDexModifier === "boolean" ? root.addDexModifier : null,
    declaredMaxDexBonus: num(root?.maxDexBonus),
  };
}

/** How much Dexterity a category contributes when the row itself is silent. */
function dexBonusFromCategory(
  category: ArmorCategory,
  dexModifier: number,
): number | null {
  switch (category) {
    case "light":
      return dexModifier;
    case "medium":
      return Math.min(dexModifier, MEDIUM_DEX_CAP);
    case "heavy":
      return 0;
    case "shield":
      // Never selected as body armour; present so adding a category is a
      // compile error here rather than a silent fall-through.
      return null;
  }
}

const UNARMORED = (dexModifier: number): ArmorClassResult => ({
  armorClass: UNARMORED_BASE + dexModifier,
  category: null,
  armored: false,
});

/**
 * The character's armour class.
 *
 * Only equipped body armour counts. A shield is excluded outright: the SRD
 * stores it as base 2, an additive bonus, so treating it as armour would set a
 * character's AC to 2 + DEX.
 *
 * A row that declares neither a category nor a dex flag cannot say how it
 * behaves, so it is ignored rather than trusted for its base alone — the only
 * direction that never inflates.
 */
export function armorClassFor(input: {
  inventory: readonly ArmorInventoryRow[];
  dexModifier: number;
}): ArmorClassResult {
  const { inventory, dexModifier } = input;

  for (const row of inventory) {
    if (row.type !== "armor" || row.equippedSlot !== "ARMOR") continue;

    const profile = readArmorProfile(row.properties);
    if (profile.category === "shield") continue;
    if (profile.baseAC === null) continue;

    if (profile.declaredAddsDex !== null) {
      const bonus = profile.declaredAddsDex
        ? profile.declaredMaxDexBonus === null
          ? dexModifier
          : Math.min(dexModifier, profile.declaredMaxDexBonus)
        : 0;
      return {
        armorClass: profile.baseAC + bonus,
        category: profile.category,
        armored: true,
      };
    }

    if (profile.category === null) continue;

    const bonus = dexBonusFromCategory(profile.category, dexModifier);
    if (bonus === null) continue;

    return {
      armorClass: profile.baseAC + bonus,
      category: profile.category,
      armored: true,
    };
  }

  return UNARMORED(dexModifier);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run tests/rules/armor-class.test.ts
```

Expected: PASS, 18 tests (4 + 5 + 4 + 5 across the four `describe` blocks).

- [ ] **Step 5: Run typecheck and lint**

```bash
pnpm typecheck
```

```bash
pnpm lint
```

Expected: both clean. An earlier increment shipped a test file that broke typecheck because nobody ran it; that is not happening again.

- [ ] **Step 6: Commit**

```bash
git add lib/rules/armor-class.ts tests/rules/armor-class.test.ts
git commit -m "feat(rules): let the armour category decide the dexterity bonus"
```

---

### Task 2: Remove `acFromInventory` and rewire the server consumers

**Files:**
- Modify: `lib/rules/combat.ts:820-850` (remove the doc block and the function)
- Modify: `tests/rules/combat.test.ts:184-205` (migrate its `acFromInventory` block out)
- Modify: `lib/rules/encounter-service.ts:20-23` and `:234`
- Modify: `app/api/campaign/[id]/encounter/route.ts:4` and `:140`

**Interfaces:**
- Consumes: `armorClassFor` and `ArmorInventoryRow` from `@/lib/rules/armor-class` (Task 1).
- Produces: no new symbols. `acFromInventory` ceases to exist.

**Background you need.**

`acFromInventory` has two production consumers, and both already receive the full inventory row from Prisma via `include: { inventory: true }`, so `equippedSlot` is present at runtime at both sites:

- `lib/rules/encounter-service.ts:234` — `acFromInventory(campaign.character.inventory, playerDexMod)`
- `app/api/campaign/[id]/encounter/route.ts:140` — the same call

**The trap.** `EncounterInventoryItemRecord` (`lib/rules/encounter-service.ts:20-23`) declares only `{ type: string; properties: unknown }`. `ArmorInventoryRow` declares `equippedSlot` as **optional**, so passing that record compiles cleanly and yields `undefined` forever — every player computed as unarmoured, with a green build and green types. **Add `equippedSlot?: string | null` to that interface**, and the test below is what proves it.

Its doc comment (`combat.ts:821-835`) already states the correct SRD rules by category — light full, medium capped, heavy none — while the implementation never read a category. Delete the comment with the function; the new module's header carries the history.

- [ ] **Step 1: Migrate the existing tests**

In `tests/rules/combat.test.ts`, delete the entire `describe("acFromInventory", …)` block (lines 184-205) and remove `acFromInventory` from the import at the top of the file.

Append the migrated equivalents to `tests/rules/armor-class.test.ts`. The fixtures gain what the old rule ignored — an `equippedSlot` and a category — because without them the new rule correctly reports "no armour":

```ts
describe("armorClassFor — cases migrated from acFromInventory", () => {
  // These arrived from tests/rules/combat.test.ts. Each fixture gains an
  // equippedSlot and a category: the originals had neither, because the
  // implementation they covered read neither.
  it("calculates unarmored correctly", () => {
    expect(armorClassFor({ inventory: [], dexModifier: 3 }).armorClass).toBe(13);
  });

  it("calculates with full dex bonus (light armor)", () => {
    const inventory = [equipped({ baseAC: 12, armorClass: "light" })];
    expect(armorClassFor({ inventory, dexModifier: 4 }).armorClass).toBe(16);
  });

  it("calculates with capped dex bonus (medium armor)", () => {
    const inventory = [
      equipped({ baseAC: 14, armorClass: "medium", maxDexBonus: 2, addDexModifier: true }),
    ];
    expect(armorClassFor({ inventory, dexModifier: 4 }).armorClass).toBe(16);
    expect(armorClassFor({ inventory, dexModifier: 1 }).armorClass).toBe(15);
  });

  it("calculates with no dex bonus (heavy armor)", () => {
    const inventory = [equipped({ baseAC: 18, armorClass: "heavy", addDexModifier: false })];
    expect(armorClassFor({ inventory, dexModifier: 4 }).armorClass).toBe(18);
    // A negative modifier is not subtracted either: addDexModifier false means
    // exactly zero Dexterity, not "apply it anyway".
    expect(armorClassFor({ inventory, dexModifier: -1 }).armorClass).toBe(18);
  });
});
```

- [ ] **Step 2: Write the failing test for the record-type trap**

Append to `tests/rules/armor-class.test.ts`:

```ts
describe("the encounter service's inventory record reaches the rule intact", () => {
  it("carries equippedSlot through to the rule", () => {
    // EncounterInventoryItemRecord declared only { type, properties }. Because
    // ArmorInventoryRow makes equippedSlot optional, passing that record would
    // type-check and silently compute every player as unarmoured. This test
    // builds the row through the service's OWN record type, so it stops
    // compiling if the field is ever dropped again — a runtime assertion alone
    // could not catch it.
    const row: EncounterInventoryItemRecord = {
      type: "armor",
      equippedSlot: "ARMOR",
      properties: { baseAC: 16, armorClass: "heavy" },
    };
    expect(armorClassFor({ inventory: [row], dexModifier: 3 }).armorClass).toBe(16);
  });
});
```

and add this to the file's imports:

```ts
import type { EncounterInventoryItemRecord } from "@/lib/rules/encounter-service";
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
pnpm exec vitest run tests/rules/armor-class.test.ts tests/rules/combat.test.ts
```

Expected: FAIL. `EncounterInventoryItemRecord` is not exported and does not declare `equippedSlot`; `combat.test.ts` still imports `acFromInventory`.

- [ ] **Step 4: Remove the function**

In `lib/rules/combat.ts`, delete lines 820-850 — the `/** Derives a player character's AC from their inventory. … */` doc block and the whole `acFromInventory` function that follows it. Leave `acFromMonsterData` and everything else untouched.

- [ ] **Step 5: Rewire `encounter-service.ts`**

Export the record interface and give it the field, at `lib/rules/encounter-service.ts:20-23`:

```ts
export interface EncounterInventoryItemRecord {
  type: string;
  /**
   * Required by the armour rule. Declared here because `ArmorInventoryRow`
   * makes it optional: omitting it compiles and computes every player as
   * unarmoured.
   */
  equippedSlot?: string | null;
  properties: unknown;
}
```

Replace the import of `acFromInventory` with `armorClassFor` from `@/lib/rules/armor-class`, and replace line 234:

```ts
  const playerAC = armorClassFor({
    inventory: campaign.character.inventory,
    dexModifier: playerDexMod,
  }).armorClass;
```

- [ ] **Step 6: Rewire the encounter route**

In `app/api/campaign/[id]/encounter/route.ts`, remove `acFromInventory` from the import on line 4 (keep `rollInitiative` and `acFromMonsterData`), add:

```ts
import { armorClassFor } from "@/lib/rules/armor-class";
```

and replace line 140:

```ts
  const playerAC = armorClassFor({
    inventory: campaign.character.inventory,
    dexModifier: playerDexMod,
  }).armorClass;
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
pnpm exec vitest run tests/rules/armor-class.test.ts tests/rules/combat.test.ts
```

Expected: PASS.

```bash
pnpm exec vitest run tests/rules/encounter-service-contract.test.ts tests/api
```

Expected: PASS. If an encounter test fails, read it before changing anything — a genuine failure here means a player's AC moved, and the only movements this PR sanctions are the two named in "The two behaviour changes this PR makes".

- [ ] **Step 8: Verify nothing still references the removed function**

```bash
grep -rn "acFromInventory" lib app tests
```

Expected: no output.

- [ ] **Step 9: Typecheck and lint**

```bash
pnpm typecheck
```

```bash
pnpm lint
```

Expected: both clean.

- [ ] **Step 10: Commit**

```bash
git add lib/rules/armor-class.ts tests/rules/armor-class.test.ts lib/rules/combat.ts tests/rules/combat.test.ts lib/rules/encounter-service.ts "app/api/campaign/[id]/encounter/route.ts"
git commit -m "fix(rules): compute one armour class, from equipped armour only"
```

---

### Task 3: The sheet and the die must agree

**Files:**
- Modify: `lib/character-sheet/view-model.ts:99-114`
- Test: `tests/rules/armor-class-both-ends.test.ts` (create)

**Interfaces:**
- Consumes: `armorClassFor` from `@/lib/rules/armor-class` (Task 1).
- Produces: no new symbols.

**Background you need.**

`lib/character-sheet/view-model.ts:99-114` computes AC inline:

```ts
  let armorClass = 10 + dexMod;
  const equippedArmor = inventory.find(
    (item) => item.type === "armor" && item.equippedSlot === "ARMOR"
  );
  if (equippedArmor) {
    const armor = getObject(equippedArmor.properties);
    if (typeof armor.baseAC === "number") {
      armorClass = armor.baseAC;
      if (armor.addDexModifier === true) { … }
    }
  }
```

Its selection rule was right and survives in the shared module; its `addDexModifier === true` default is the half of the divergence being corrected. The view-model is pure and stays pure — `armorClassFor` is a pure function, so this is a substitution, not a new dependency on I/O.

The previous increment added `tests/rules/attack-bonus-both-ends.test.ts` for the attack bonus. This is the same device for the number one column over.

- [ ] **Step 1: Write the failing guard**

Create `tests/rules/armor-class-both-ends.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSheetViewModel } from "@/lib/character-sheet/view-model";
import { armorClassFor, type ArmorInventoryRow } from "@/lib/rules/armor-class";

/**
 * The armour class the sheet shows must equal the one combat resolves.
 *
 * They were computed in two places that disagreed twice over: which armour
 * counted, and what an absent addDexModifier meant. One decided what the player
 * was attacked against and the other decided what the player was shown.
 */

function sheetAC(stats: Record<string, number>, properties: Record<string, unknown>): number {
  const sheet = buildSheetViewModel({
    character: {
      id: "c1",
      name: "Test",
      race: "human",
      class: "fighter",
      level: 1,
      hp: 10,
      maxHp: 10,
      xp: 0,
      stats,
    },
    inventory: [
      { id: "a1", name: "Armour", type: "armor", quantity: 1, equippedSlot: "ARMOR", properties },
    ],
  });
  return sheet.core.armorClass;
}

function backendAC(stats: Record<string, number>, properties: Record<string, unknown>): number {
  const inventory: ArmorInventoryRow[] = [
    { type: "armor", equippedSlot: "ARMOR", properties },
  ];
  return armorClassFor({
    inventory,
    dexModifier: Math.floor((stats.DEX - 10) / 2),
  }).armorClass;
}

const DEXTEROUS = { STR: 10, DEX: 18, CON: 10, INT: 10, WIS: 10, CHA: 10 }; // +4

describe("the sheet's armour class equals the backend's", () => {
  it.each([
    ["light armour stating its dex flag", { baseAC: 11, armorClass: "light", addDexModifier: true }],
    ["medium armour with its own cap", { baseAC: 15, armorClass: "medium", addDexModifier: true, maxDexBonus: 2 }],
    ["heavy armour refusing dex", { baseAC: 18, armorClass: "heavy", addDexModifier: false }],
    ["light armour that does not state the flag", { baseAC: 11, armorClass: "light" }],
    ["medium armour that does not state the flag", { baseAC: 15, armorClass: "medium" }],
    ["heavy armour that does not state the flag", { baseAC: 18, armorClass: "heavy" }],
    ["a shield in the armour slot", { baseAC: 2, armorClass: "shield" }],
    ["a row stating nothing but a base", { baseAC: 20 }],
  ])("agrees for %s", (_label, properties) => {
    expect(sheetAC(DEXTEROUS, properties)).toBe(backendAC(DEXTEROUS, properties));
  });

  it("pins the direction for armour that does not state its dex flag", () => {
    // Equality alone would pass if both ends regressed together. Medium armour
    // with no flag must be 15 + 2, not 15 + 4 (the old combat answer) and not
    // 15 (the old sheet answer).
    expect(sheetAC(DEXTEROUS, { baseAC: 15, armorClass: "medium" })).toBe(17);
  });

  it("pins the direction for a shield", () => {
    // 10 + 4 unarmoured, never 2 + 4.
    expect(sheetAC(DEXTEROUS, { baseAC: 2, armorClass: "shield" })).toBe(14);
  });
});
```

- [ ] **Step 2: Run the guard to verify it fails**

```bash
pnpm exec vitest run tests/rules/armor-class-both-ends.test.ts
```

Expected: FAIL on the no-flag cases and the shield case — the view-model still applies its own rule.

- [ ] **Step 3: Rewrite the view-model's calculation**

In `lib/character-sheet/view-model.ts`, replace lines 99-114 — from `let armorClass = 10 + dexMod;` through the closing brace of the `if (equippedArmor) { … }` block — with:

```ts
  // The same pure rule the encounter service resolves with. The sheet used to
  // compute its own, agreeing with the backend on which armour counted but not
  // on what an absent addDexModifier meant.
  const armorClass = armorClassFor({ inventory, dexModifier: dexMod }).armorClass;
```

Add to the file's imports:

```ts
import { armorClassFor } from "@/lib/rules/armor-class";
```

- [ ] **Step 4: Run the guard to verify it passes**

```bash
pnpm exec vitest run tests/rules/armor-class-both-ends.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Check the view-model's own tests**

```bash
pnpm exec vitest run tests/character-sheet
```

`tests/character-sheet/view-model.test.ts` asserts `armorClass: 16` for a Scale Mail fixture with `{ baseAC: 14, addDexModifier: true, maxDexBonus: 2 }` and DEX 14 (+2). Under the new rule that is `14 + min(2, 2) = 16` — **unchanged**, because the row states its own flag.

If that assertion moves, stop and report: it would mean the rule shifted something it should not have. If it passes, no fixture edit is needed.

- [ ] **Step 6: Typecheck and lint**

```bash
pnpm typecheck
```

```bash
pnpm lint
```

Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add lib/character-sheet/view-model.ts tests/rules/armor-class-both-ends.test.ts
git commit -m "fix(character-sheet): show the armour class combat resolves"
```

---

### Task 4: Full verification

**Files:** none modified.

**Interfaces:**
- Consumes: the finished state of Tasks 1-3.
- Produces: a verification report.

**Do not push and do not open a pull request.** Those are the user's call and are deliberately not in this plan's scope.

- [ ] **Step 1: Run the full suite**

```bash
pnpm exec vitest run --maxWorkers=4
```

Expected: PASS. The baseline before this plan is **3087 tests in 157 files**.

`armor-class.test.ts` ends with 23 tests — 18 written in Task 1, 4 migrated out of `combat.test.ts`, and 1 for the record-type trap. `armor-class-both-ends.test.ts` has 10. The 4 migrated ones are moved, not added, so they net zero.

Net: **+29 tests, +2 files** → expect **3116 in 159**.

An exact match is not required; a table row may shift during implementation. A count *below* 3087 is never acceptable — it means something was deleted that this plan did not intend to delete. Stop and report.

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

- [ ] **Step 3: Confirm this PR's own claims**

One calculation, and no proficiency logic:

```bash
grep -rn "acFromInventory" lib app tests
```

Expected: no output.

```bash
grep -rn "isArmorProficient" lib app | grep -v "lib/rules/proficiency.ts"
```

Expected: **no output.** `isArmorProficient` stays unconsumed until PR 2. A hit here means proficiency logic leaked into this PR.

- [ ] **Step 4: Report completion**

Report files created and modified, commands run with their results, the test count before and after, and anything that surprised you — especially any place where the real code disagreed with this plan.

---

## Corrections this plan makes to the spec

Recorded here rather than left to diverge, the way the spec records its own.

- **`readArmorProfile` always returns a profile**, where the spec wrote
  `ArmorProfile | null`. The row's existence is the caller's question and every
  field is individually nullable, so a null return would force each caller to
  handle two shapes of "nothing". Same reasoning as `projectSrdItem` in the
  previous increment, and it is what lets the function promise never to throw.
- **`ArmorProfile` carries `declaredAddsDex` and `declaredMaxDexBonus`**, not the
  spec's `addsDex` and `maxDexBonus`. The names matter: the whole divergence
  being repaired came from treating "the row does not say" as if it were an
  answer, and a field named `addsDex` invites exactly that. `declared*` says
  where the value came from and admits it can be absent.
- **`ArmorInventoryRow` is exported**, which the spec did not mention. Task 2's
  record-type test needs to name the shape it is proving, and the two server
  consumers pass values into it.

## Notes for the reviewer

- **Two behaviour changes are intended**, both named at the top: armour must be equipped to count, and a shield is never body armour. Neither has a live effect — no character owns armour, and the live inventory holds two rows, a Longsword and a Health Potion.
- **The absent-`addDexModifier` case is the divergence itself.** Combat added the full modifier, the sheet added none. Both now defer to the category, which matches the stored SRD data on all 13 armour rows.
- **`isArmorProficient` is still unconsumed** and that is deliberate. It is PR 2's subject, and Task 4 asserts it stayed out.
- **The shield's +2 is still unimplemented.** This PR only guarantees a shield cannot be mistaken for body armour. `combat.ts`'s old comment promising the +2 is deleted along with the function; the promise moves nowhere, which is honest — it was never kept.
