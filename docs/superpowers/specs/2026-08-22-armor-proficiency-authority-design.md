# Armour class and armour proficiency authority

**Date:** 2026-08-22
**Milestone:** V — adjacent (no grid dependency)
**Status:** designed
**Follows:** `docs/superpowers/specs/2026-08-21-weapon-proficiency-authority-design.md`

## Problem

`lib/rules/proficiency.ts` exports `isArmorProficient`, covered by its own tests,
and **nothing outside that test imports it**. It is the same dormant defect
`isWeaponProficient` had, one column over: a rule the codebase can state and
never asks.

Investigating it found two more, and the one nobody was looking for is the
dangerous one.

### There are two armour-class calculations, and they already disagree

| | `acFromInventory` (`lib/rules/combat.ts:836`) | `buildSheetViewModel` (`lib/character-sheet/view-model.ts:99`) |
| --- | --- | --- |
| Which armour counts | the **first** row with `type === "armor"`, ignoring `equippedSlot` | requires `equippedSlot === "ARMOR"` |
| When `addDexModifier` is absent | `!== false` → **adds DEX** | `=== true` → **does not add** |

`acFromInventory` decides what the player is hit against — it is consumed by
`lib/rules/encounter-service.ts:234` and `app/api/campaign/[id]/encounter/route.ts:140`
when an encounter spawns. The view-model decides what the sheet displays. For an
armour row written without `addDexModifier`, the two differ by up to the full
Dexterity modifier: the number you are attacked against and the number you are
shown are not the same number.

This is the shape the previous increment just closed for attack rolls. It was
already present here, and nobody had looked.

### A shield can silently collapse the player's armour class

The SRD stores a shield as `armor_class.base: 2` — an **additive** bonus, not a
total. `acFromInventory` selects the first `type === "armor"` row with no regard
for slot or category, so a character who acquires a shield can have it selected
as their body armour, and their AC becomes **2 + DEX** instead of 10 + DEX.

Nothing triggers this today because no character owns any armour at all: the live
inventory measured during this work holds exactly two rows, a Longsword and a
Health Potion. It is a landmine, not a fire — but it is armed, and the first
shield in the game steps on it.

### The data is clean and one field of it is inert

Two files produce `type: "armor"` rows, and only one of them is clean. This
section originally surveyed the SRD file alone; the loot file is added here
because the rule has to survive both.

**`data/srd-es/equipment.json` — all 13 armours, verified across the whole file:**

| Category | Count | `armor_class` shape |
| --- | --- | --- |
| `Light` | 3 | `base`, `dex_bonus: true`, no `max_bonus` |
| `Medium` | 5 | `base`, `dex_bonus: true`, `max_bonus: 2` — all five |
| `Heavy` | 4 | `base`, `dex_bonus: false` |
| `Shield` | 1 | `base: 2`, `dex_bonus: false` |

**`data/loot-tables.json` — 10 rows typed `"armor"`, 0 declaring a category.**
They are gauntlets, boots, cloaks, helms and a buckler fragment: accessories, not
body armour. Nine carry no `baseAC` at all (their bonus, where they have one, sits
in an unread `ac_bonus`). One, the Voidclasp Gauntlet, carries
`baseAC: 1, addDexModifier: false` — a bonus stored in the field that means a
total.

So the category fallback below applies to **SRD-sourced armour only**. Loot rows
carry no category, and the ones with a base carry a base below 10; they are
excluded by the `baseAC` floor in `armorClassFor`, which refuses any row whose
base would leave the wearer worse off than unarmoured. The floor and the
shield-category skip catch different shapes and neither subsumes the other.

`ArmorProperties.armorClass` (`lib/rules/inventory.ts:70`) already declares
exactly this closed set — `"light" | "medium" | "heavy" | "shield"` — and
**neither AC calculation reads it**. A value produced and never consumed, in the
same file as the rule that needs it.

`lib/rules/proficiency.ts:32` declares the same union a third time, as
`ArmorCategory`, and that one is the type `isArmorProficient` accepts. So the
category exists under two names and is read under neither. The new module imports
the `proficiency.ts` one rather than minting a fourth.

### What armour proficiency actually does

Worth stating plainly, because it decides the shape of the work: in SRD 2014,
lacking proficiency with the armour you wear **does not change your armour
class**. It gives disadvantage on every ability check, saving throw and attack
roll that uses Strength or Dexterity, and prevents casting spells.

So consuming `isArmorProficient` is not an arithmetic change to AC. It is a
penalty that reaches the advantage system — which already exists on both paths:
`evaluateAdvantage` (`lib/rules/conditions.ts:171`) derives advantage and
disadvantage from conditions for attack rolls, and `resolveAbilityCheck`
(`lib/rules/ability-check.ts:242`) takes an explicit `disadvantage` input.

## Scope

**In:** one armour-class calculation shared by combat and the sheet, reading the
category the type already declares; and the consumption of `isArmorProficient`
as the SRD penalty it actually is.

**Out, with reasons:**

- **Implementing the shield's +2.** `combat.ts:829` promises it — "Shield: +2 AC
  (stacks with any armor — not yet implemented here)" — and it stays unpromised
  here. Shields carry their own equip questions: which slot, what happens with a
  two-handed weapon, whether an off-hand shield stacks. This increment only
  guarantees a shield can never be **mistaken for body armour**, which is the
  part that is actively dangerous.
- **`strengthRequirement` and `stealthDisadvantage`.** Both are stored, both are
  unread. They are the next two dormant values in this file and each is its own
  rule.
- **Armour proficiency changing AC.** It does not, per SRD. Recorded because it
  is the intuitive wrong answer.
- **Retiring `acFromInventory`'s dex-modifier parameter shape.** The replacement
  takes what it needs; the old signature is not preserved for compatibility.

## Delivered as two pull requests

The same split as the previous increment, for the same reason: one half repairs a
divergence, the other changes rolls, and a branch doing both at once is harder to
review than the two apart.

**PR 1 — one armour class.** A pure module owns the calculation; `acFromInventory`
is removed; `encounter-service.ts`, the encounter route and the view-model all
consume it; a guard binds the sheet to the die. **No proficiency logic, and no
roll changes beyond correcting the two divergences named above.**

**PR 2 — the proficiency penalty.** `isArmorProficient` gains its consumer, and
an unproficient wearer takes disadvantage on STR/DEX attack rolls, ability checks
and saving throws, and cannot cast spells. **Every STR/DEX roll of an unproficient
character changes here.**

## Architecture

### `lib/rules/armor-class.ts` — new, pure *(PR 1)*

```ts
// ArmorCategory is NOT redeclared here. `lib/rules/proficiency.ts:32` already
// exports exactly this union, and `isArmorProficient` takes it — a second
// identical type would be two names for one thing, which is the defect this
// document is about.
import type { ArmorCategory } from "@/lib/rules/proficiency";

export interface ArmorProfile {
  category: ArmorCategory | null;
  baseAC: number;
  addsDex: boolean;
  maxDexBonus: number | null;
}

export function readArmorProfile(properties: unknown): ArmorProfile | null;

export function armorClassFor(input: {
  inventory: readonly { type: string; equippedSlot?: string | null; properties: unknown }[];
  dexModifier: number;
}): ArmorClassResult;

export interface ArmorClassResult {
  armorClass: number;
  /** The armour the calculation used, or null when unarmoured. */
  category: ArmorCategory | null;
  /** False when no equipped body armour was found — the 10 + DEX case. */
  armored: boolean;
}
```

**The block above is the design sketch, not the shipped signature.** PR 1 shipped
a narrower one and `docs/superpowers/plans/2026-08-22-armor-class-unification.md`,
section "Corrections this plan makes to the spec", records why. What exists in
`lib/rules/armor-class.ts` today is:

```ts
export interface ArmorProfile {
  category: ArmorCategory | null;
  baseAC: number | null;
  declaredAddsDex: boolean | null;
  declaredMaxDexBonus: number | null;
}

export function readArmorProfile(properties: unknown): ArmorProfile; // never null
export interface ArmorInventoryRow { type: string; equippedSlot?: string | null; properties: unknown }
```

`readArmorProfile` always returns a profile; every field is individually
nullable, and `declared*` names say the value came from the row rather than from
a default. Code against this, not against the sketch.

`readArmorProfile` validates rather than casts, the way `readWeaponProfile` does.
Returning `category` and `armored` alongside the number is what lets PR 2 ask
"proficient with what?" without recomputing anything, and what lets the log say
why an AC is what it is.

### Which armour counts

**Equipped body armour only.** The row must have `type === "armor"`,
`equippedSlot === "ARMOR"`, and a category that is not `shield`. The view-model's
existing rule was the correct one; `acFromInventory` ignoring the slot was a bug,
and ignoring the category is what arms the shield landmine.

A character with no such row is unarmoured: `10 + DEX`.

### How the Dexterity bonus is decided

**The row's own data wins; the category answers when it is absent.**

`addDexModifier` and `maxDexBonus` come from the SRD per item and are authority
per piece — a magic breastplate may legitimately differ from the mundane one. But
when the key is missing, neither of today's defaults is defensible: one adds the
full modifier and the other adds none, and both are guesses.

The category is not a guess. Falling back to it:

| Category | DEX contribution when the row does not say |
| --- | --- |
| `light` | full modifier |
| `medium` | modifier, capped at +2 |
| `heavy` | none |
| `shield` | not applicable — never selected as body armour |

This matches the stored SRD data exactly across all 13 rows (the loot corpus
declares no category and never reaches the fallback), so the fallback and the
per-item values agree wherever both exist. A row with **no category and no
`addDexModifier`** falls to `10 + DEX` unarmoured rather than inventing a base:
the conservative direction, and it never inflates.

### `lib/rules/combat.ts` — `acFromInventory` removed *(PR 1)*

Replaced, not supplemented. Two ways to compute one number is what produced this
divergence, and leaving the old one behind for compatibility would preserve
exactly the bug being fixed. Its tests move to the new module, including the
cases that pin `addDexModifier: false` behaviour.

Both consumers — `encounter-service.ts:234` and the encounter route — call the
replacement. Neither has a dex-modifier they compute differently, so the change
is mechanical.

### The penalty, and where it attaches *(PR 2)*

The two paths take disadvantage differently, and the difference is load-bearing:

- **Attack rolls** derive it from conditions, inside `evaluateAdvantage`.
- **Ability checks** take it as an explicit `disadvantage` input.

**The penalty is passed explicitly on both paths, not modelled as a condition.**
Inventing an `unproficient-armor` entry in `CONDITION_REGISTRY` would put a thing
that is not an SRD condition into the registry of SRD conditions, and it would
then leak into every place conditions are listed, displayed, or narrated. The
attack path gains an explicit parameter alongside the condition-derived result,
the same shape the ability-check path already has.

**Spellcasting** is refused rather than penalised — the SRD says you cannot cast,
not that you cast at disadvantage. The refusal is declared in the log, the way an
unenforceable spell range and an unresolved weapon category already are.

## Testing

The suite hid the weapon defect for its whole life. These tests are designed
against that, not only against the rule.

**PR 1:**

- **A guard binding both ends:** for one character and one armour, the AC the
  sheet displays must equal the AC combat resolves. The same device that now
  binds the attack bonus, for the number one column over.
- **The shield case, named:** a shield in the inventory must never be selected
  as body armour, and a character wearing nothing else must be `10 + DEX` — not
  `2 + DEX`.
- **The absent-`addDexModifier` case per category**, which is the divergence
  itself: light, medium and heavy each asserted, so the fallback is pinned rather
  than assumed.
- **Unequipped armour grants nothing:** a breastplate with no `equippedSlot` in
  the inventory leaves the character unarmoured. This is the behaviour
  `acFromInventory` got wrong, so it gets a test that would have caught it.

**PR 2:**

- **Discriminating cases:** a wizard in chain mail (no heavy proficiency →
  disadvantage), a fighter in the same (proficient → none), a barbarian in heavy
  armour specifically, since the live character is a barbarian and barbarians
  have light, medium and shield but **not** heavy.
- **Disadvantage applies only to STR and DEX**, never to a Wisdom check made in
  the same armour.
- **Spellcasting refused, and declared** — asserted on the log line, not only on
  the refusal.
- **An unknown class string** takes the penalty, because `isArmorProficient`
  fails closed and an unrecognised class is not proficient with anything. This is
  the conservative direction and it is the opposite of the weapon case's
  "withhold the bonus" — worth a test precisely because the symmetry is
  misleading.

## Related

- `docs/superpowers/specs/2026-08-21-weapon-proficiency-authority-design.md` —
  the pure/service split, the both-ends guard, and the two-PR shape reused here.
- `AGENTS.md` §Dormant defects — the produced-never-consumed shape. This spec
  documents three more instances of it: `isArmorProficient`,
  `ArmorProperties.armorClass`, and the shield's declared-but-unimplemented +2.
