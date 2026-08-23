# Armour Proficiency Penalty — Implementation Plan (PR 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `isArmorProficient` its consumer — a character wearing armour they lack proficiency with takes disadvantage on Strength and Dexterity attacks, checks and saves, and cannot cast spells.

**Architecture:** A pure rule answers "does this character take the armour penalty, and for which category". The penalty travels to each roll as an **explicit value**, never as an invented condition. PR 1 already left the hook: `armorClassFor` returns the equipped category, so the wearer's armour is a solved question.

**Tech Stack:** TypeScript, Next.js 15, Prisma 6.19.2, Vitest 4, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-22-armor-proficiency-authority-design.md`

## Global Constraints

- Package manager is **pnpm**. Never `npm`, `yarn` or `bun`. Do not modify `pnpm-lock.yaml`; no dependency is added or removed.
- Do not run `prisma migrate`, `db push`, `db seed`, or `db execute`. This plan touches no migration and no schema.
- Never read or modify environment/secrets files.
- D&D 5e/SRD 2014 only. Never introduce THAC0, descending AC, AD&D saving throw categories, or gold-for-XP.
- **Armour proficiency never changes armour class.** Per SRD it imposes disadvantage and forbids spellcasting. Any change to an AC number belongs to PR 1 and is a defect here.
- **Never invent a condition.** The penalty must **not** become an entry in `CONDITION_REGISTRY`. An unproficient wearer is not an SRD condition, and a registry entry would leak into every place conditions are listed, displayed or narrated.
- **Fail closed.** An unrecognised class is not proficient with anything, so it **takes** the penalty. This is the opposite direction from the weapon increment, where an unknown class *withheld* a bonus — in both cases the conservative answer is the one that does not favour the character.
- **A rule module never throws on persisted data.** `Character.class` is free text; `InventoryItem.properties` is untyped JSON.
- Stage files **by name** when committing. Never `git add -A`, `git add .`, or `git commit -a`.
- **Run the full suite as `pnpm exec vitest run --maxWorkers=4`.** A bare `pnpm test` on this machine produces vitest worker-startup timeouts under load that look like test failures and hide the real count.
- Baseline before this plan: **3124 tests in 159 files.**

## What the SRD actually says, and what it does not

> If you wear armor that you lack proficiency with, you have disadvantage on any ability check, saving throw, or attack roll that involves Strength or Dexterity, and you can't cast spells.

Three consequences the implementation must respect:

1. **Only Strength and Dexterity.** A Wisdom check made in the same armour is unaffected. Of the 18 skills in `SKILL_ABILITY` (`lib/rules/ability-check.ts:34-53`), exactly **four** qualify: `Athletics` (STR), `Acrobatics`, `Sleight of Hand` and `Stealth` (DEX). That closed set is what the tests pin.
2. **Disadvantage does not stack.** One source is the same as three, which is why `evaluateAbilityCheckAdvantage` returns a boolean rather than a count. The penalty ORs in; it never accumulates.
3. **Spellcasting is refused, not penalised.** You cannot cast — not "you cast at disadvantage". The refusal is declared in the game log, the way an unenforceable spell range and an unresolved weapon category already are.

## Where the penalty attaches, and why each path differs

The three paths take disadvantage in three different shapes. This is not an inconsistency to fix; it is the existing architecture, and the plan works with it.

| Path | How disadvantage arrives today | What this plan adds |
| --- | --- | --- |
| Ability checks | `evaluateAbilityCheckAdvantage(conditions, exhaustion)` returns booleans; the route passes them to `resolveAbilityCheck` (`route.ts:432`, `:482`) | OR the penalty into `disadvantage` at the route, only for STR/DEX skills |
| Attack rolls | `resolveAttackRoll` calls `evaluateAdvantage(attackerConditions, defenderConditions, isMelee)` internally (`combat.ts:852-882`) | Thread an explicit flag through the payload chain |
| Spellcasting | no gate exists | Refuse before any resolution work, and log it |

**One equip action switches the whole rule off, and that is out of scope too.** The equip gate (`app/api/campaign/[id]/action/route.ts:939-941`) sends every `type: "armor"` row to the single `ARMOR` slot, evicting whatever was there. `data/loot-tables.json` ships several `type: "armor"` rows with no `baseAC` — "Ashwalker Boots", "Shadowstep Slippers", "Cloak of Diminished Silhouette", "Ironwood Shield Fragment" — and equipping any of them evicts the body armour: `selectBodyArmor` then returns null, the penalty vanishes and casting is restored, while the fiction still has the character in chain mail. A real shield does the same, because `lib/rules/inventory.ts` gives the SRD "Shield" `type: "armor"` with `armorClass: "shield"`, so it equips into `ARMOR` and is then skipped by `selectBodyArmor`. The root cause is one `ARMOR` slot for every armour-typed row, which is pre-existing and not this PR's to fix — the fix is a slot model (body / shield / accessory), and it would ripple through equip, the sheet and AC. Recorded here so PR 3 inherits it as a known item.

**Saving throws are out of scope, with a reason.** The spec's SRD quote covers them, but this codebase resolves saves inside `resolveSavingThrow` on paths driven by spell effects rather than by the character's own equipment, and no call site currently has the wearer's inventory in hand. Wiring it would be a fourth thread of the same kind for a case no test or live flow exercises. Recorded here so PR 3 has it, rather than left for a reviewer to discover as a gap.

## The attack chain, and the awkwardness it forces

The attack path is four layers deep:

```
route.ts → executeCombatAction (combat-pipeline.ts:69 CombatActionPayload)
        → computeConsequences (combat.ts:643, its input interface at :295-313)
        → resolveAttackRoll (combat.ts:852)
        → evaluateAdvantage (conditions.ts:171)
```

The flag must travel all four. Two of those layers take object inputs, which is clean. `resolveAttackRoll` takes **positional** parameters, and already has six — the sixth being `spatialContext`.

**`spatialContext` is passed by nobody.** Verified across `lib`, `app` and `tests`: it is declared, documented as the replacement for the deprecated `isMelee`, and no call site supplies it. It is a parameter nothing fills — this repository's signature defect, in the very function this task edits.

**Ruling: leave it alone.** Removing it would delete its out-of-range logic, which is real code even if currently unreachable, and refactoring the signature would ripple to six test call sites for no gain to this increment. The new flag becomes a **seventh** optional parameter, and `computeConsequences` passes `undefined` for the sixth. That is ugly and it is recorded as ugly. Cleaning up `resolveAttackRoll`'s signature is its own task for its own increment.

## A rule this codebase does not implement, found while planning

SRD 2014: advantage and disadvantage **cancel** — a roll with both is made
normally. This codebase implements that on one path and not the other:

- `resolveAbilityCheck` (`lib/rules/ability-check.ts:269`) cancels correctly:
  `advantage === true && disadvantage !== true`.
- `resolveAttackRoll` (`lib/rules/combat.ts:887`) does **not**. It reads
  `advantage ? withAdvantage : disadvantage ? withDisadvantage : normal`, so
  **advantage wins outright** when both are present.

This matters here because the armour penalty is a new disadvantage source, and
an attacker who is both invisible and unproficient would, under the SRD, roll
normally — while this code rolls with advantage.

**It is out of scope and must not be fixed in this PR.** Changing it would alter
existing attack outcomes for every condition pairing, which has nothing to do
with armour and would hide inside a branch about proficiency. The wiring guard
in Task 4 therefore pins the **current** behaviour explicitly, with a comment
saying so, which is what makes PR 3 change it deliberately rather than discover
it as a test that suddenly fails.

Recorded here because the plan's first draft asserted the SRD rule in a test and
would have put the implementer in an impossible position: one step demanding the
cancellation, another forbidding the change that produces it.

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/rules/armor-class.ts` | **Modify.** Extract the body-armour selector so two rules can ask "what is this character wearing" without asking twice. |
| `lib/rules/armor-proficiency.ts` | **Create.** Pure. Owns `armorPenaltyFor` and `penalisedByArmor`. No Prisma, no I/O, never throws. |
| `tests/rules/armor-proficiency.test.ts` | **Create.** The rule, the four STR/DEX skills, the fail-closed class, and the unarmoured case. |
| `app/api/campaign/[id]/action/route.ts` | **Modify.** Three sites: the ability-check gate, the attack gate, and a new refusal in the cast gate. |
| `lib/rules/combat-pipeline.ts` | **Modify.** Carry the flag from the payload to `computeConsequences`. |
| `lib/rules/combat.ts` | **Modify.** Carry the flag from `ConsequenceInput` into `resolveAttackRoll`, and apply it there. |
| `tests/rules/armor-penalty-wiring.test.ts` | **Create.** Guard: the flag survives every layer of the attack chain. |

---

### Task 1: Extract the body-armour selector

**Files:**
- Modify: `lib/rules/armor-class.ts`
- Test: `tests/rules/armor-class.test.ts` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: `function selectBodyArmor(inventory: readonly ArmorInventoryRow[]): ArmorProfile | null`, exported from `@/lib/rules/armor-class` and imported by Task 2.

**Background you need.**

`armorClassFor` (`lib/rules/armor-class.ts:137`) currently does two things in one loop: it decides **which** row is the character's body armour, and it computes **what AC** that row grants. Task 2 needs only the first half — "which category is this character wearing" — to answer a proficiency question.

Calling `armorClassFor({ inventory, dexModifier: 0 }).category` would work and would read as a lie: passing a fake modifier to a function whose answer you are discarding. Extracting the selector is the honest shape, and it keeps one definition of "what counts as body armour" rather than two.

The selection rule, which must not change: `type === "armor"`, `equippedSlot === "ARMOR"`, category is not `shield`, `baseAC` is present and **not below `UNARMORED_BASE`**, and — when the row declares no dex flag — it must have a category. The `baseAC` floor is what stops a bonus row (a shield at base 2, the `Voidclasp Gauntlet` at base 1) being worn as body armour.

- [ ] **Step 1: Write the failing test**

Append to `tests/rules/armor-class.test.ts`:

```ts
describe("selectBodyArmor", () => {
  // armorClassFor already proves the selection rule through the AC it returns.
  // These pin the selector directly, because Task 2 asks it a different
  // question — "what is being worn" rather than "what is it worth".
  it("returns the equipped body armour's profile", () => {
    const profile = selectBodyArmor([
      equipped({ baseAC: 16, armorClass: "heavy", addDexModifier: false }),
    ]);
    expect(profile?.category).toBe("heavy");
    expect(profile?.baseAC).toBe(16);
  });

  it("returns null when nothing is equipped", () => {
    expect(selectBodyArmor([])).toBeNull();
  });

  it("returns null for armour that is carried but not equipped", () => {
    expect(
      selectBodyArmor([
        { type: "armor", properties: { baseAC: 16, armorClass: "heavy" } },
      ]),
    ).toBeNull();
  });

  it("never returns a shield", () => {
    expect(selectBodyArmor([equipped({ baseAC: 2, armorClass: "shield" })])).toBeNull();
  });

  it("never returns a bonus row below the unarmoured base", () => {
    // The Voidclasp Gauntlet shape: baseAC 1, a declared dex flag, no category.
    expect(
      selectBodyArmor([equipped({ baseAC: 1, addDexModifier: false })]),
    ).toBeNull();
  });

  it("agrees with armorClassFor about what is worn", () => {
    // The two must never disagree about the selection, because the AC and the
    // proficiency penalty would then be judged against different armour.
    const inventory = [
      equipped({ baseAC: 2, armorClass: "shield" }),
      equipped({ baseAC: 15, armorClass: "medium" }),
    ];
    expect(selectBodyArmor(inventory)?.category).toBe(
      armorClassFor({ inventory, dexModifier: 3 }).category,
    );
  });
});
```

Add `selectBodyArmor` to that file's existing import from `@/lib/rules/armor-class`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run tests/rules/armor-class.test.ts
```

Expected: FAIL — `selectBodyArmor` is not exported.

- [ ] **Step 3: Extract the selector**

In `lib/rules/armor-class.ts`, add this exported function above `armorClassFor`:

```ts
/**
 * Which row, if any, is the character's body armour.
 *
 * Split out of `armorClassFor` because two rules now ask about the same armour
 * for different reasons: one wants the number it grants, the other wants the
 * category to judge proficiency against. Asking twice through two selectors
 * would be how they come to disagree.
 *
 * A shield is excluded — the SRD stores it as an additive base of 2 — and so is
 * any row whose base is below the unarmoured 10, because armour that leaves you
 * worse than naked is a bonus row wearing armour's type.
 */
export function selectBodyArmor(
  inventory: readonly ArmorInventoryRow[],
): ArmorProfile | null {
  for (const row of inventory) {
    if (row.type !== "armor" || row.equippedSlot !== "ARMOR") continue;

    const profile = readArmorProfile(row.properties);
    if (profile.category === "shield") continue;
    if (profile.baseAC === null) continue;
    if (profile.baseAC < UNARMORED_BASE) continue;
    if (profile.declaredAddsDex === null && profile.category === null) continue;

    return profile;
  }

  return null;
}
```

Then rewrite `armorClassFor`'s body to consume it, leaving its exported signature and every returned value unchanged:

```ts
export function armorClassFor(input: {
  inventory: readonly ArmorInventoryRow[];
  dexModifier: number;
}): ArmorClassResult {
  const { inventory, dexModifier } = input;

  const profile = selectBodyArmor(inventory);
  if (profile === null || profile.baseAC === null) return UNARMORED(dexModifier);

  if (profile.declaredAddsDex !== null) {
    const bonus = profile.declaredAddsDex
      ? profile.declaredMaxDexBonus === null
        ? dexModifier
        : Math.min(dexModifier, Math.max(profile.declaredMaxDexBonus, 0))
      : 0;
    return { armorClass: profile.baseAC + bonus, category: profile.category, armored: true };
  }

  if (profile.category === null) return UNARMORED(dexModifier);

  const bonus = dexBonusFromCategory(profile.category, dexModifier);
  if (bonus === null) return UNARMORED(dexModifier);

  return { armorClass: profile.baseAC + bonus, category: profile.category, armored: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run tests/rules/armor-class.test.ts
```

Expected: PASS. The file's pre-existing tests must all still pass **unchanged** — this is a refactor with no behaviour change, so a moved expectation means the selection rule shifted. If any existing assertion fails, stop and report it rather than adjusting it.

- [ ] **Step 5: Check the AC consumers still agree**

```bash
pnpm exec vitest run tests/rules/armor-class-both-ends.test.ts tests/rules/encounter-service-contract.test.ts tests/character-sheet
```

Expected: PASS, unchanged.

- [ ] **Step 6: Typecheck and lint**

```bash
pnpm typecheck
```

```bash
pnpm lint
```

- [ ] **Step 7: Commit**

```bash
git add lib/rules/armor-class.ts tests/rules/armor-class.test.ts
git commit -m "refactor(rules): ask once what a character is wearing"
```

---

### Task 2: The pure penalty rule

**Files:**
- Create: `lib/rules/armor-proficiency.ts`
- Test: `tests/rules/armor-proficiency.test.ts`

**Interfaces:**
- Consumes: `selectBodyArmor`, `ArmorInventoryRow` from `@/lib/rules/armor-class` (Task 1); `isArmorProficient`, `ArmorCategory`, `CharacterClass` from `@/lib/rules/proficiency`; `SKILL_ABILITY`, `Skill` from `@/lib/rules/ability-check`.
- Produces, imported by Tasks 3-5 from `@/lib/rules/armor-proficiency`:
  - `interface ArmorPenalty { applies: boolean; category: ArmorCategory | null }`
  - `function armorPenaltyFor(input: { inventory: readonly ArmorInventoryRow[]; characterClass: string }): ArmorPenalty`
  - `function penalisedByArmor(skill: Skill): boolean`

**Background you need.**

`isArmorProficient(characterClass: CharacterClass, armorCategory: ArmorCategory): boolean` (`lib/rules/proficiency.ts:148`) is the function this whole increment exists to give a consumer. It has had tests and no importer since it was written.

Its table (`lib/rules/proficiency.ts:96-109`) is the SRD class baseline. The live character is a **barbarian**, whose armour proficiencies are `light`, `medium` and `shield` — **not** `heavy`. That makes the barbarian-in-heavy case a real, named test rather than a hypothetical.

`Character.class` is a free-text column. Normalise it with `.trim().toLowerCase()`, following `lib/rules/class-skills.ts:47`. A class outside the twelve falls through `isArmorProficient`'s own guard to `false` — **not proficient**, so it **takes** the penalty. That is the conservative direction here, and it is the opposite of the weapon increment's fail-closed, where an unknown class lost a bonus. Both refuse to favour the character; the sign differs because the rule differs.

`SKILL_ABILITY` (`lib/rules/ability-check.ts:34-53`) maps all 18 skills to an ability. Exactly four are STR or DEX.

- [ ] **Step 1: Write the failing test**

Create `tests/rules/armor-proficiency.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  armorPenaltyFor,
  penalisedByArmor,
} from "@/lib/rules/armor-proficiency";
import { SKILL_ABILITY, type Skill } from "@/lib/rules/ability-check";
import type { ArmorInventoryRow } from "@/lib/rules/armor-class";

function wearing(category: string, baseAC = 16): ArmorInventoryRow[] {
  return [
    {
      type: "armor",
      equippedSlot: "ARMOR",
      properties: { baseAC, armorClass: category, addDexModifier: false },
    },
  ];
}

describe("armorPenaltyFor", () => {
  it("penalises a wizard in chain mail", () => {
    // A wizard has no armour proficiency at all.
    const penalty = armorPenaltyFor({ inventory: wearing("heavy"), characterClass: "wizard" });
    expect(penalty.applies).toBe(true);
    expect(penalty.category).toBe("heavy");
  });

  it("does not penalise a fighter in the same armour", () => {
    const penalty = armorPenaltyFor({ inventory: wearing("heavy"), characterClass: "fighter" });
    expect(penalty.applies).toBe(false);
    expect(penalty.category).toBe("heavy");
  });

  it("penalises a barbarian in heavy armour", () => {
    // The live character is a barbarian, and barbarians have light, medium and
    // shield — not heavy. This is the case a real save can reach.
    expect(
      armorPenaltyFor({ inventory: wearing("heavy"), characterClass: "barbarian" }).applies,
    ).toBe(true);
  });

  it("does not penalise that barbarian in medium armour", () => {
    expect(
      armorPenaltyFor({ inventory: wearing("medium", 15), characterClass: "barbarian" }).applies,
    ).toBe(false);
  });

  it("normalises a free-text class the way the column stores it", () => {
    expect(
      armorPenaltyFor({ inventory: wearing("heavy"), characterClass: "  Fighter " }).applies,
    ).toBe(false);
  });

  it("penalises a class outside the twelve", () => {
    // Fail closed. An unrecognised class is proficient with nothing, so it takes
    // the penalty — the opposite sign from the weapon rule's fail-closed, and
    // the same principle: never favour the character on unusable data.
    expect(
      armorPenaltyFor({ inventory: wearing("light", 11), characterClass: "artificer" }).applies,
    ).toBe(true);
  });

  it("does not penalise a character wearing nothing", () => {
    const penalty = armorPenaltyFor({ inventory: [], characterClass: "wizard" });
    expect(penalty.applies).toBe(false);
    expect(penalty.category).toBeNull();
  });

  it("does not penalise a character carrying but not wearing armour", () => {
    const penalty = armorPenaltyFor({
      inventory: [{ type: "armor", properties: { baseAC: 16, armorClass: "heavy" } }],
      characterClass: "wizard",
    });
    expect(penalty.applies).toBe(false);
  });

  it("does not penalise a shield, which is not body armour here", () => {
    const penalty = armorPenaltyFor({
      inventory: wearing("shield", 2),
      characterClass: "wizard",
    });
    expect(penalty.applies).toBe(false);
    expect(penalty.category).toBeNull();
  });

  it("does not penalise armour whose category cannot be resolved", () => {
    // No category means no question to ask isArmorProficient. Penalising on a
    // guess would be the one direction that harms the character on bad data.
    const penalty = armorPenaltyFor({
      inventory: [
        {
          type: "armor",
          equippedSlot: "ARMOR",
          properties: { baseAC: 14, addDexModifier: true },
        },
      ],
      characterClass: "wizard",
    });
    expect(penalty.applies).toBe(false);
    expect(penalty.category).toBeNull();
  });

  it("degrades instead of throwing on junk", () => {
    for (const junk of [null, undefined, 42, "text", []]) {
      const penalty = armorPenaltyFor({
        inventory: [{ type: "armor", equippedSlot: "ARMOR", properties: junk }],
        characterClass: "wizard",
      });
      expect(penalty.applies).toBe(false);
    }
  });
});

describe("penalisedByArmor", () => {
  it("covers exactly the four Strength and Dexterity skills", () => {
    // Pinned as a set rather than case by case: if a skill is ever added to
    // SKILL_ABILITY, this fails and someone decides deliberately.
    const penalised = (Object.keys(SKILL_ABILITY) as Skill[]).filter(penalisedByArmor);
    expect(penalised.sort()).toEqual(
      ["Acrobatics", "Athletics", "Sleight of Hand", "Stealth"].sort(),
    );
  });

  it("does not penalise a Wisdom check made in the same armour", () => {
    expect(penalisedByArmor("Perception")).toBe(false);
    expect(penalisedByArmor("Insight")).toBe(false);
  });

  it("penalises Athletics and Stealth", () => {
    expect(penalisedByArmor("Athletics")).toBe(true);
    expect(penalisedByArmor("Stealth")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run tests/rules/armor-proficiency.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/rules/armor-proficiency"`.

- [ ] **Step 3: Write the implementation**

Create `lib/rules/armor-proficiency.ts`:

```ts
/**
 * lib/rules/armor-proficiency.ts
 *
 * What it costs to wear armour you were never trained in.
 *
 * @pure — no database, no I/O, no randomness, and never throws.
 *
 * This module exists because `isArmorProficient` had tests and no consumer, the
 * same shape `isWeaponProficient` had before the previous increment. The rule
 * was stateable and never asked.
 *
 * SRD 2014: "If you wear armor that you lack proficiency with, you have
 * disadvantage on any ability check, saving throw, or attack roll that involves
 * Strength or Dexterity, and you can't cast spells."
 *
 * Note what it does NOT say: nothing about armour class. Wearing plate you
 * cannot use still protects you exactly as well; it is everything else that
 * suffers. Any change to an AC number from this module would be a bug.
 */

import { SKILL_ABILITY, type Skill } from "@/lib/rules/ability-check";
import { selectBodyArmor, type ArmorInventoryRow } from "@/lib/rules/armor-class";
import {
  isArmorProficient,
  type ArmorCategory,
  type CharacterClass,
} from "@/lib/rules/proficiency";

export interface ArmorPenalty {
  /** True when the wearer lacks proficiency with what they are wearing. */
  applies: boolean;
  /** The category worn, or null when nothing qualifying is worn. */
  category: ArmorCategory | null;
}

/**
 * Whether this character takes the unproficient-armour penalty.
 *
 * Fails closed: a class outside the twelve is proficient with nothing, so it
 * takes the penalty. That is the opposite sign from the weapon rule's
 * fail-closed, where an unknown class loses a bonus — and the same principle,
 * because both refuse to favour the character on data they cannot read.
 *
 * An equipped row whose category cannot be resolved yields no penalty: there is
 * no question to put to `isArmorProficient`, and penalising on a guess is the
 * one direction that harms the character over bad data.
 */
export function armorPenaltyFor(input: {
  inventory: readonly ArmorInventoryRow[];
  characterClass: string;
}): ArmorPenalty {
  const profile = selectBodyArmor(input.inventory);
  const category = profile?.category ?? null;

  if (category === null) return { applies: false, category: null };

  const normalisedClass = input.characterClass.trim().toLowerCase() as CharacterClass;

  return {
    applies: !isArmorProficient(normalisedClass, category),
    category,
  };
}

/**
 * Whether a skill's ability is one the penalty touches.
 *
 * Exactly four of the eighteen qualify. Derived from `SKILL_ABILITY` rather than
 * listed, so a new skill inherits the right answer instead of being forgotten.
 */
export function penalisedByArmor(skill: Skill): boolean {
  const ability = SKILL_ABILITY[skill];
  return ability === "STR" || ability === "DEX";
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run tests/rules/armor-proficiency.test.ts
```

Expected: PASS, 14 tests.

- [ ] **Step 5: Typecheck and lint**

```bash
pnpm typecheck
```

```bash
pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add lib/rules/armor-proficiency.ts tests/rules/armor-proficiency.test.ts
git commit -m "feat(rules): let armour you cannot use cost you something"
```

---

### Task 3: Disadvantage on Strength and Dexterity checks

**Files:**
- Modify: `app/api/campaign/[id]/action/route.ts:432-436` and its `resolveAbilityCheck` call at `:478-484`
- Test: `tests/rules/armor-proficiency.test.ts` (append)

**Interfaces:**
- Consumes: `armorPenaltyFor`, `penalisedByArmor` from `@/lib/rules/armor-proficiency` (Task 2).
- Produces: no new symbols.

**Background you need.**

The ability-check gate already computes both booleans and hands them straight to the rule:

```ts
const { advantage, disadvantage } = evaluateAbilityCheckAdvantage(
  checkConditions,
  charData.exhaustionLevel
);
```

`resolveAbilityCheck` takes `disadvantage?: boolean` as an input field (`lib/rules/ability-check.ts:117`), so no signature changes anywhere — the penalty ORs into a value that already exists and already travels.

**Disadvantage does not stack.** `evaluateAbilityCheckAdvantage` returns a boolean for exactly that reason. ORing is correct; counting would not be.

**Advantage still cancels it.** `resolveAbilityCheck:269` implements the SRD's mutual cancellation (`advantage === true && disadvantage !== true`). Do not special-case the armour penalty around that — an unproficient wearer with advantage from another source rolls normally, which is the rule.

- [ ] **Step 1: Write the failing test**

Append to `tests/rules/armor-proficiency.test.ts`:

```ts
describe("the penalty as the ability-check gate applies it", () => {
  // The route ORs the penalty into the disadvantage the condition evaluator
  // already produced. These pin the composition rule the route implements,
  // without standing up the route.
  function gateDisadvantage(input: {
    conditionDisadvantage: boolean;
    skill: Skill;
    characterClass: string;
    inventory: ArmorInventoryRow[];
  }): boolean {
    const penalty = armorPenaltyFor({
      inventory: input.inventory,
      characterClass: input.characterClass,
    });
    return (
      input.conditionDisadvantage || (penalty.applies && penalisedByArmor(input.skill))
    );
  }

  it("adds disadvantage to a Stealth check in unproficient armour", () => {
    expect(
      gateDisadvantage({
        conditionDisadvantage: false,
        skill: "Stealth",
        characterClass: "wizard",
        inventory: wearing("heavy"),
      }),
    ).toBe(true);
  });

  it("leaves a Perception check alone in the same armour", () => {
    expect(
      gateDisadvantage({
        conditionDisadvantage: false,
        skill: "Perception",
        characterClass: "wizard",
        inventory: wearing("heavy"),
      }),
    ).toBe(false);
  });

  it("leaves a Stealth check alone when the wearer is proficient", () => {
    expect(
      gateDisadvantage({
        conditionDisadvantage: false,
        skill: "Stealth",
        characterClass: "fighter",
        inventory: wearing("heavy"),
      }),
    ).toBe(false);
  });

  it("does not stack with disadvantage that was already there", () => {
    // One source is the same as three. The boolean is the point.
    expect(
      gateDisadvantage({
        conditionDisadvantage: true,
        skill: "Stealth",
        characterClass: "wizard",
        inventory: wearing("heavy"),
      }),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run tests/rules/armor-proficiency.test.ts
```

Expected: FAIL — `Skill` is imported as a type already, but `wearing` and the helpers must resolve; the failure will name whichever import is missing. Add `import type { Skill }` if it is not already present at the top of the file.

- [ ] **Step 3: Wire the route**

In `app/api/campaign/[id]/action/route.ts`, add to the imports:

```ts
import { armorPenaltyFor, penalisedByArmor } from "@/lib/rules/armor-proficiency";
```

Then, immediately after the `evaluateAbilityCheckAdvantage` call (around line 432-436), insert:

```ts
      // SRD: armour you lack proficiency with gives disadvantage on any check
      // that involves Strength or Dexterity — four of the eighteen skills. It is
      // passed as a value rather than modelled as a condition: an unproficient
      // wearer is not an SRD condition, and a CONDITION_REGISTRY entry would
      // leak into everywhere conditions are listed and narrated.
      const armorPenalty = armorPenaltyFor({
        inventory: charData.inventory,
        characterClass: charData.class,
      });
      const armorDisadvantage =
        armorPenalty.applies && penalisedByArmor(intent.skill);
```

Then change the `resolveAbilityCheck` call's `disadvantage` field (around line 483) from:

```ts
          disadvantage,
```

to:

```ts
          disadvantage: disadvantage || armorDisadvantage,
```

Leave `advantage` exactly as it is — the SRD's mutual cancellation is already implemented inside `resolveAbilityCheck` and must keep applying.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm exec vitest run tests/rules/armor-proficiency.test.ts
```

Expected: PASS, 18 tests.

```bash
pnpm exec vitest run tests/api tests/rules/ability-check-advantage.test.ts
```

Expected: PASS. The route's existing ability-check tests use fixtures with no armour, so the penalty never fires and nothing moves. **If an existing assertion changes, stop and report it** — it would mean a fixture is wearing something nobody noticed.

- [ ] **Step 5: Typecheck and lint**

```bash
pnpm typecheck
```

```bash
pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add lib/rules/armor-proficiency.ts tests/rules/armor-proficiency.test.ts "app/api/campaign/[id]/action/route.ts"
git commit -m "feat(rules): make unproficient armour cost a Strength or Dexterity check"
```

---

### Task 4: Disadvantage on Strength and Dexterity attacks

**Files:**
- Modify: `lib/rules/combat.ts:295-313` (the `ConsequenceInput` interface), `:643-666` (`computeConsequences`), `:852-882` (`resolveAttackRoll`)
- Modify: `lib/rules/combat-pipeline.ts:69-80` (`CombatActionPayload`) and `:312-330` (the `computeConsequences` call)
- Modify: `app/api/campaign/[id]/action/route.ts` — both attack sites' `executeCombatAction` calls
- Test: `tests/rules/armor-penalty-wiring.test.ts` (create)

**Interfaces:**
- Consumes: `armorPenaltyFor` from `@/lib/rules/armor-proficiency` (Task 2).
- Produces: an `armorPenalty?: boolean` field on `CombatActionPayload` and on `ConsequenceInput`, and a seventh parameter on `resolveAttackRoll`.

**Background you need.**

Every weapon attack in this game is a Strength or Dexterity attack — the ability is chosen by `weaponAttackBonus`, which returns `"STR"` or `"DEX"` and nothing else. So **no skill filter applies here**: if the penalty applies at all, it applies to the attack.

The chain is four layers, and the flag must survive all four:

```
route.ts (both attack sites)
  → executeCombatAction        — CombatActionPayload, combat-pipeline.ts:69
  → computeConsequences        — ConsequenceInput, combat.ts:295
  → resolveAttackRoll          — positional parameters, combat.ts:852
  → evaluateAdvantage          — conditions.ts:171
```

**Why a seventh positional parameter.** `resolveAttackRoll` already takes six, the sixth being `spatialContext`, which **no call site anywhere supplies** — verified across `lib`, `app` and `tests`. Removing it would delete real out-of-range logic and ripple to six test call sites for no gain here, so it stays and the new flag lands after it. `computeConsequences` passes `undefined` for the sixth. This is ugly, it is deliberate, and cleaning up that signature is its own increment.

- [ ] **Step 1: Write the failing wiring guard**

Create `tests/rules/armor-penalty-wiring.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveAttackRoll } from "@/lib/rules/combat";

/**
 * The penalty has to survive four layers to reach the die. Each layer is a
 * place it can be dropped silently — the value would simply be `undefined`, the
 * types would still check, and every existing test would still pass.
 *
 * These assert on `AttackRollResult`'s own reported roll mode rather than on a
 * spy. `resolveAttackRoll` returns `advantage` and `disadvantage` as part of its
 * result, so the real outcome is observable without mocking the dice module —
 * and a spy on another module's export is exactly the kind of test that proves
 * less than it appears to.
 */

describe("resolveAttackRoll takes the armour penalty", () => {
  it("reports disadvantage when the flag is set", () => {
    expect(resolveAttackRoll(5, 10, [], [], true, undefined, true).disadvantage).toBe(true);
  });

  it("reports no disadvantage when it is not", () => {
    expect(resolveAttackRoll(5, 10, [], [], true, undefined, false).disadvantage).toBe(false);
  });

  it("defaults to no penalty when the parameter is omitted", () => {
    // Every existing call site omits it, so the default is what keeps this PR
    // from changing any attack that has no armour involved.
    expect(resolveAttackRoll(5, 10, [], [], true).disadvantage).toBe(false);
  });

  it("still reports the advantage a condition grants, which wins as it does today", () => {
    // NOTE: this asserts CURRENT behaviour, not the SRD. resolveAttackRoll
    // picks advantage outright when both are present (combat.ts:887) — it does
    // not cancel them, unlike resolveAbilityCheck:269 which does. That
    // divergence is pre-existing and out of scope; see the plan's "A rule this
    // codebase does not implement" note. Pinning it here means PR 3 changes it
    // deliberately rather than by accident.
    const result = resolveAttackRoll(5, 10, ["invisible"], [], true, undefined, true);
    expect(result.advantage).toBe(true);
    expect(result.disadvantage).toBe(true);
  });
});
```

- [ ] **Step 2: Run the guard to verify it fails**

```bash
pnpm exec vitest run tests/rules/armor-penalty-wiring.test.ts
```

Expected: FAIL — `resolveAttackRoll` takes six parameters; the seventh is ignored, so the first test rolls normally.

- [ ] **Step 3: Give `resolveAttackRoll` the parameter**

In `lib/rules/combat.ts`, change the signature at line 852 to add a seventh parameter after `spatialContext`:

```ts
  /** @deprecated — Use spatialContext instead. */
  isMelee: boolean = true,
  spatialContext?: AttackSpatialContext,
  /**
   * SRD: armour the attacker lacks proficiency with gives disadvantage on any
   * attack involving Strength or Dexterity — which every weapon attack is.
   *
   * Passed as a value rather than modelled as a condition, because an
   * unproficient wearer is not an SRD condition and a CONDITION_REGISTRY entry
   * would leak into everywhere conditions are listed and narrated.
   *
   * It lands seventh because the sixth parameter, `spatialContext`, is supplied
   * by no call site anywhere and is left undisturbed rather than removed.
   */
  armorPenalty: boolean = false
): AttackRollResult {
```

Then, where the function currently destructures the evaluator's answer, fold the penalty in as another disadvantage source **before** the cancellation is applied:

```ts
  const evaluated = evaluateAdvantage(
    attackerConditions,
    defenderConditions,
    isMelee
  );
  const advantage = evaluated.advantage;
  // Disadvantage does not stack in 5e — one source is the same as three — and
  // it still cancels against advantage, so the penalty joins the pool rather
  // than overriding it.
  const disadvantage = evaluated.disadvantage || armorPenalty;
```

**Keep the existing roll selection exactly as it is.** It reads `advantage ? withAdvantage : disadvantage ? withDisadvantage : normal`, so advantage wins outright when both are present. That is **not** the SRD rule and it is **not** yours to change here — see the note below. Your job is only to add the penalty to the disadvantage pool; how the two are then weighed against each other stays exactly as it is.

- [ ] **Step 4: Run the guard to verify it passes**

```bash
pnpm exec vitest run tests/rules/armor-penalty-wiring.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Thread the flag through the two object layers**

In `lib/rules/combat.ts`, add to the `ConsequenceInput` interface (around line 307, beside `attackerConditions`):

```ts
  /** SRD armour-proficiency penalty on the attacker. Defaults to no penalty. */
  attackerArmorPenalty?: boolean;
```

In `computeConsequences`, add `attackerArmorPenalty` to the destructuring and pass it through:

```ts
  const attackResult = resolveAttackRoll(
    attackModifier,
    targetAC,
    attackerConditions,
    defenderConditions,
    isMelee,
    undefined,
    attackerArmorPenalty ?? false
  );
```

In `lib/rules/combat-pipeline.ts`, add to `CombatActionPayload` (beside `actorConditions`, around line 74):

```ts
  /** SRD armour-proficiency penalty on the actor. Defaults to no penalty. */
  actorArmorPenalty?: boolean;
```

and pass it in the `computeConsequences` call (around line 326, beside `attackerConditions`):

```ts
        attackerArmorPenalty: payload.actorArmorPenalty ?? false,
```

- [ ] **Step 6: Wire both attack sites**

In `app/api/campaign/[id]/action/route.ts`, at **both** `executeCombatAction` calls, add the field beside `actorConditions`:

```ts
          actorArmorPenalty: armorPenaltyFor({
            inventory: context.character.inventory,
            characterClass: context.character.class,
          }).applies,
```

Every weapon attack uses Strength or Dexterity, so no skill filter applies — if the penalty applies at all, it applies here.

- [ ] **Step 7: Verify the whole chain**

```bash
pnpm exec vitest run tests/rules/armor-penalty-wiring.test.ts tests/rules/combat.test.ts
```

```bash
pnpm exec vitest run tests/api
```

Expected: PASS. The route's attack fixtures carry no armour, so the flag is `false` and nothing moves. If an existing attack assertion changes, stop and report.

- [ ] **Step 8: Typecheck and lint**

```bash
pnpm typecheck
```

```bash
pnpm lint
```

- [ ] **Step 9: Commit**

```bash
git add lib/rules/combat.ts lib/rules/combat-pipeline.ts "app/api/campaign/[id]/action/route.ts" tests/rules/armor-penalty-wiring.test.ts
git commit -m "feat(combat): make unproficient armour cost the attack roll"
```

---

### Task 5: Refuse spellcasting, and say so

**Files:**
- Modify: `app/api/campaign/[id]/action/route.ts:537-543` (the start of the `cast_spell` gate)
- Test: `tests/api/action-intent-contract.test.ts` (append)

**Interfaces:**
- Consumes: `armorPenaltyFor` from `@/lib/rules/armor-proficiency` (Task 2), already imported by Task 3.
- Produces: no new symbols.

**Background you need.**

The SRD says you **cannot cast**, not that you cast at disadvantage. So this is a refusal, not a modifier — and it belongs before any resolution work, because a refused cast must not spend a slot, roll anything, or reach the narrator.

The gate opens at `route.ts:537` with a spell-name check that returns HTTP 400. The refusal goes immediately after it, before `resolveCachedSpell` is called.

The refusal is **declared in the log**, the way an unenforceable spell range and an unresolved weapon category already are — a rule that fired and left no trace is how a gap survives unnoticed. `campaignId` is bound at `route.ts:97` and `prisma` is imported at `route.ts:2`, so both are in scope.

- [ ] **Step 1: Write the failing test**

Append to `tests/api/action-intent-contract.test.ts`, inside its existing top-level `describe`:

```ts
  it("refuses a spell from a character in armour they cannot use", async () => {
    // SRD: you cannot cast at all — not "you cast at disadvantage". The refusal
    // comes before any resolution, so no slot is spent and nothing is rolled.
    const response = await postAction("I cast Fireball", {
      character: {
        class: "wizard",
        inventory: [
          {
            type: "armor",
            equippedSlot: "ARMOR",
            properties: { baseAC: 16, armorClass: "heavy", addDexModifier: false },
          },
        ],
      },
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/armour|armor/i);
  });

  it("lets the same wizard cast once the armour comes off", async () => {
    const response = await postAction("I cast Fireball", {
      character: { class: "wizard", inventory: [] },
    });

    expect(response.status).not.toBe(400);
  });
```

**Read that file's existing helpers before writing this.** It has its own harness for posting an action with a mocked context; use it rather than inventing a second one, and adapt the two cases above to its actual shape. If the harness cannot express a character's inventory, say so in your report and put these two cases in `tests/rules/armor-proficiency.test.ts` against the pure rule instead — a test that cannot reach the gate is worth less than one that says why.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run tests/api/action-intent-contract.test.ts
```

Expected: FAIL — the cast currently proceeds, so the status is not 400.

- [ ] **Step 3: Add the refusal**

In `app/api/campaign/[id]/action/route.ts`, immediately after the spell-name check that ends around line 543, insert:

```ts
      // SRD: armour you lack proficiency with stops you casting altogether — a
      // refusal, not a penalty. It comes before any resolution so that a refused
      // cast spends no slot, rolls nothing, and never reaches the narrator.
      const castArmorPenalty = armorPenaltyFor({
        inventory: context.character.inventory,
        characterClass: context.character.class,
      });
      if (castArmorPenalty.applies) {
        // Declared rather than silent, the way an unenforceable spell range and
        // an unresolved weapon category already are.
        await prisma.gameLog.create({
          data: {
            campaignId,
            role: "system",
            content:
              `⚠️ Casting refused: ${context.character.name} is wearing ` +
              `${castArmorPenalty.category} armour without proficiency, and the ` +
              `SRD forbids casting in armour you cannot use.`,
          },
        });
        return NextResponse.json(
          {
            error:
              `You cannot cast while wearing ${castArmorPenalty.category} armour ` +
              `you are not proficient with.`,
          },
          { status: 400 }
        );
      }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run tests/api/action-intent-contract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Check the other route suites**

```bash
pnpm exec vitest run tests/api
```

Expected: PASS. Existing cast fixtures carry no armour, so the refusal never fires. If a cast test starts returning 400, stop and report — a fixture is wearing something nobody noticed.

- [ ] **Step 6: Typecheck and lint**

```bash
pnpm typecheck
```

```bash
pnpm lint
```

- [ ] **Step 7: Commit**

```bash
git add "app/api/campaign/[id]/action/route.ts" tests/api/action-intent-contract.test.ts
git commit -m "feat(rules): refuse a spell cast in armour the caster cannot use"
```

---

### Task 6: Full verification

**Files:** none modified.

**Interfaces:**
- Consumes: the finished state of Tasks 1-5.
- Produces: a verification report.

**Do not push and do not open a pull request.** Those are the user's call and are deliberately not in this plan's scope.

- [ ] **Step 1: Run the full suite**

```bash
pnpm exec vitest run --maxWorkers=4
```

Expected: PASS. The baseline before this plan is **3124 tests in 159 files**. This plan adds 6 tests to `armor-class.test.ts`, creates `armor-proficiency.test.ts` with 18, creates `armor-penalty-wiring.test.ts` with 4, and adds 2 to `action-intent-contract.test.ts` — **+30 tests, +2 files** → expect **3154 in 161**.

An exact match is not required; a table row may shift during implementation. A count *below* 3124 is never acceptable — it means something was deleted that this plan did not intend to delete. Stop and report.

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

The dormant defect is finally closed:

```bash
grep -rn "isArmorProficient" lib app | grep -v "lib/rules/proficiency.ts"
```

Expected: at least one hit, in `lib/rules/armor-proficiency.ts`. An empty result means the rule was built and never wired — the exact defect being repaired.

No condition was invented:

```bash
grep -rn "unproficient\|armorPenalty" lib/rules/conditions.ts
```

Expected: **no output.** A hit means the penalty leaked into `CONDITION_REGISTRY`, which the spec forbids.

Armour class did not move:

```bash
git diff origin/master --stat -- lib/rules/armor-class.ts
```

Expected: changes confined to the `selectBodyArmor` extraction. `armorClassFor`'s returned numbers must be unchanged — Task 1's own tests prove it, and any AC movement in this PR is a defect.

- [ ] **Step 4: Report completion**

Report files created and modified, commands run with their results, the test count before and after, and anything that surprised you — especially any place where the real code disagreed with this plan.

---

## Notes for the reviewer

- **Every Strength and Dexterity ability check and attack roll of an unproficient wearer changes here** — not every STR/DEX roll: saving throws are not wired, see below. Nothing changes today for the live save either way: the character owns no armour at all, so `selectBodyArmor` returns null and the penalty never applies.
- **The barbarian case is the one a real save can reach.** Barbarians have light, medium and shield — not heavy. The live character is a barbarian, so heavy armour is one loot drop away from being live.
- **Saving throws are deliberately out of scope**, with the reason stated in the plan's own "Where the penalty attaches" section: no save call site currently has the wearer's inventory in hand, and no flow exercises it. It is PR 3's first item.
- **`resolveAttackRoll` now takes seven positional parameters**, the sixth of which (`spatialContext`) is still supplied by nobody. That is recorded as ugly rather than fixed, because removing it would delete real logic and ripple to six test call sites. Its cleanup is its own increment.
- **`isArmorProficient` finally has a consumer.** Task 6 asserts it, because the whole increment exists for that one wire.
