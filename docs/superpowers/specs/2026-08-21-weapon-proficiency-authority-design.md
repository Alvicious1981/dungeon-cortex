# Weapon proficiency and weapon-property authority

**Date:** 2026-08-21
**Milestone:** V — The Cartographer & The Chronicler, adjacent (no grid dependency)
**Status:** designed
**Follows:** `docs/superpowers/specs/2026-08-19-spell-range-authority-design.md`

## Problem

`lib/rules/proficiency.ts` exports `isWeaponProficient`, covered by ten tests,
and **nothing outside its own test imports it**. `lib/rules/combat.ts:894` says
so in a comment: the proficiency bonus is added unconditionally because
`WeaponProperties` carries no simple/martial category, so the function cannot be
consulted. A wizard swinging a longsword rolls with proficiency they do not have.

That is the shape `AGENTS.md` calls a dormant defect — a value produced that
nothing consumes. Querying the live database rather than reasoning about it
showed the other half, which is worse and more useful:

**The category is in the cache. The code looks for it in an empty table.**

| Table | Rows | Read by | Written by |
| --- | --- | --- | --- |
| `SrdEquipment` | **0** | `lib/rules/srd-equipment-lookup.ts`, `lib/ai/tools/srd-lookup.ts` | nothing |
| `SrdItem` | 237 | `lib/ai/tools/srd-lookup.ts` (item lookup only) | `prisma/seed-srd.ts:305` |

The seeder loads `data/srd-es/equipment.json` into `srdItem`. Both equipment
lookups query `srdEquipment`. So `getEquipmentInfo` returns `null` for every
weapon and every piece of armour in the game, `addItem` always throws
`Item not found in SRD.` — and `addItem` has no callers anyway. One of the two
lookup copies is exposed to the narrator as a tool (`lib/ai/tool-policy.ts:31`).

The data that was missing is present and clean:

| Field | Source in `SrdItem.data` | Coverage across all 237 rows |
| --- | --- | --- |
| Weapon category | `weapon_category` | **37/37** weapons — `Simple` (14), `Martial` (23). Closed set, no nulls, no bilingual drift |
| Melee/ranged | `weapon_range` | 37/37 — `Melee` (28), `Ranged` (9). Closed set |
| Damage dice | `damage.damage_dice` | **36/37** |
| Damage type | `damage.damage_type.name` | 36/37 |
| Properties | `properties[].name` | 37/37 — closed set of 11 capitalised names |
| Range | `range.normal` / `range.long` | 37/37 and 9/37 |
| Armour AC | `armor_class.base` | 13/13 |

Unlike `SrdSpell.data.range` in the previous increment — 26 distinct bilingual
values, 39% of them not distances — this is a clean closed set. The difficulty
here is not classification. It is that nobody wired the two ends together.

### Why 2995 tests did not catch it

Every test touching `srdEquipment` mocks the Prisma client:
`srdEquipment: { findUnique: vi.fn(), findMany: vi.fn() }`, in five files. They
hand back fabricated rows. An empty table is invisible to the entire suite.
This is the hazard `AGENTS.md` names directly — *distrust a test that mocks the
thing it appears to be testing* — and it is why the testing section below binds
the projector to the real SRD file rather than to hand-written objects.

### The second divergence

`lib/character-sheet/view-model.ts:144` honours `Finesse` when it **displays**
an attack bonus. Both attack sites in the action route
(`route.ts:252`, `route.ts:958`) use a fixed STR modifier when they **resolve**
one. The sheet shows one number and the die uses another. Two independent
implementations of one SRD rule, already drifted in two ways.

Three names exist for the same trait list, and no persisted row carries any of
them: `WeaponProperties` declares `weaponProperties`,
`view-model.ts:143` reads `properties.properties`, `InventoryPanel.tsx:35`
reads `weaponProperties`.

## Scope

**In:** the weapon's own properties decide the attack bonus — category and
proficiency, finesse, and melee/ranged ability — sourced from the SRD cache that
actually holds data, **and the damage bonus uses the same ability the attack
used**. See "One ability, both rolls" below; this is not an extension of scope
but a condition of correctness for everything above it.

**Out, with reasons:**

- **Unifying the view-model's calculation.** Deliberately declined; the sheet
  keeps computing its own bonus. A guard binds the two ends instead, so they
  cannot diverge silently. `MILESTONE_V_SPEC` §5 stays respected.
- **Armour proficiency.** `isArmorProficient` is unconsumed for the same reason,
  but AC is resolved on a different path and would double this increment.
- **Versatile damage, two-handed, reach, thrown range.** Traits become available
  and stay unread. Each is its own rule.
- **`InventoryItem.indexSlug`.** See "A field deliberately not written" below.
- **Repopulating `SrdEquipment`.** Rejected: it would leave two caches of one
  SRD truth, and seeding the live database is out of bounds for this work.
- **Retiring the `SrdEquipment` model.** A destructive migration deserves its own
  decision. This increment leaves the table unread rather than dropped.

## Delivered as two pull requests

The two halves carry very different risk and are reviewed separately.

**PR 1 — repair the SRD pipeline.** Repoint `srd-equipment-lookup.ts` at
`SrdItem`, add the projector, delete the duplicate lookup in
`lib/ai/tools/srd-lookup.ts`. **No rule changes; no roll changes.** It is not a
change without a consumer: the narrator's equipment tool already calls
`getEquipmentInfo` and receives `null` for every weapon and every armour, so the
observable result of PR 1 is that tool starting to answer.

**PR 2 — the attack rule.** `weapon-profile.ts`, `weapon-profile-service.ts`,
removal of `weaponAttackModifier`, the ability and proficiency rules, the damage
consistency above, creation-time hydration, the shared call site, and the guards.
**Every attack roll in the game changes here.**

The reason for splitting is the previous increment's own evidence: a whole-branch
review found two critical defects that seven per-task reviews had missed. A
branch that simultaneously repairs a dead pipeline and alters every attack is
harder to review than the two apart, and if something misbehaves later, the two
histories say which one did it.

The sections below describe the finished state. Each names the PR it lands in.

## Architecture

The split mirrors the previous increment: `spell-targeting.ts` decides,
`geometry.ts` calculates, `spell-resolution-service.ts` touches the database.

### `lib/rules/weapon-profile.ts` — new, pure *(PR 2)*

```ts
export interface WeaponProfile {
  category: WeaponCategory | null;   // "simple" | "martial" | null
  isRanged: boolean;
  traits: readonly string[];         // lowercased
  damageDice: string | null;
  damageType: string | null;
}

export function readWeaponProfile(properties: unknown): WeaponProfile;

export function weaponAttackBonus(input: {
  profile: WeaponProfile;
  stats: Record<string, number>;
  characterClass: string;
  level: number;
}): WeaponAttackBonus;

export interface WeaponAttackBonus {
  bonus: number;
  abilityUsed: "STR" | "DEX";
  proficiencyApplied: boolean;
  categoryResolved: boolean;
}
```

`readWeaponProfile` **validates rather than casts**. `getItemProperties`
(`inventory.ts:211`) is a bare `as` over `Prisma.JsonValue`; that is how a wrong
shape reaches a rule unnoticed.

Returning `abilityUsed`, `proficiencyApplied` and `categoryResolved` alongside
the number is what lets the log say *why* the bonus is what it is, the same way
`checkSpellRange` returns `enforced`.

### `lib/rules/weapon-profile-service.ts` — new, I/O *(PR 2)*

`resolveWeaponProfile(item)`: pure fast path, database only as fallback.

### `lib/rules/srd-equipment-lookup.ts` — repointed *(PR 1)*

Reads `SrdItem`. Exports `projectSrdItem(raw: unknown): EquipmentInfo | null`,
tested independently of any query. `getEquipmentInfo` resolves by id, then by
**exact** case-insensitive name — never `contains`.

The duplicate `getEquipmentInfo` in `lib/ai/tools/srd-lookup.ts` is deleted and
imported from here. Fixing one copy and leaving the other would reinstate the
defect in the layer that feeds the narrator.

### `lib/rules/combat.ts` — `weaponAttackModifier` removed *(PR 2)*

Replaced, not supplemented. A second way to compute the same bonus is what
produced the drift with the view-model. Its four assertions are rewritten
against `weaponAttackBonus`.

### A field deliberately not written *(PR 2)*

Character creation will hydrate the weapon from the SRD but will **not** write
`InventoryItem.indexSlug`. Nothing would read it: the resolution chain never
reaches a slug lookup, because a hydrated row already carries its category. A
field written and never read is the exact defect this increment closes. It gets
written the day `addItem` has callers again.

## Resolution chain *(PR 2)*

`resolveWeaponProfile(item)` — two steps and a floor:

1. **What the row declares.** `readWeaponProfile(item.properties)`. If it yields
   a category, done, with no I/O. This is the path every new row takes.
2. **Exact name against `SrdItem`.** Case-insensitive equality only. The live
   save's `"Longsword"` resolves to id `longsword` — Martial, `1d8`, Versatile.
3. **Floor:** category `null`.

**Precedence:** if the row declares a category, the row wins, even against the
SRD. The SRD is the fallback, not an arbiter that overwrites what was persisted.
Magic or modified weapons will need exactly that behaviour.

## The ability rule, and its check order *(PR 2)*

Order is the trap here, as it was with `Lanzador (radio de 5 pies)` in the
previous increment:

1. **`Finesse` → the greater of STR and DEX.**
2. **Otherwise ranged (`weapon_range` = `Ranged`) → DEX.**
3. **Otherwise → STR.**

**`Dart` is Ranged *and* Finesse** — the only weapon that is both, confirmed
across all 37. Checking "ranged" first would force DEX; checking finesse first
lets the player choose. SRD 2014 states of Finesse: *"you use your choice of
Strength or Dexterity modifier for the attack and damage rolls"*, without
excluding ranged weapons. **Finesse is therefore checked first, and `Dart` is
its named test.** This is a decision, recorded so a later reader knows it was
taken rather than overlooked.

Proficiency, applied after the ability:

- `character.class` is normalised at the boundary with `.trim().toLowerCase()`,
  following `class-skills.ts:47`. `Character.class` is a free-text column.
- A class outside the twelve falls through `isWeaponProficient`'s `?? false`.
- Category `null` → no proficiency bonus.

Both failures are closed. Neither ever inflates a roll, matching the convention
the recent migrations state explicitly.

## One ability, both rolls *(PR 2)*

Both attack sites compute damage as `flatDamageBonus: strMod + weaponBonus`
(`route.ts:273`, `route.ts:979`). Changing only the attack to use DEX — through
finesse or through a ranged weapon — would ship a rule that contradicts itself
inside a single attack. SRD 2014 is explicit about Finesse: *"You must use the
same modifier for both."*

**The damage bonus consumes `abilityUsed`.** This is why `weaponAttackBonus`
returns it rather than a bare number. Returning the ability and then leaving the
damage line on `strMod` would be a value produced and never consumed, in the
increment whose entire subject is that defect.

Concretely: `flatDamageBonus` becomes the modifier of `stats[abilityUsed]` plus
the weapon's own `damageBonus`, at both sites. A longbow that now attacks with
DEX also deals damage with DEX; a dart resolved under finesse uses one chosen
ability for both rolls, never one for each.

This is the only place in the increment where an existing damage number changes
for a weapon that already resolves today — and only for weapons that are ranged
or finesse. The live save's longsword is neither, so its damage is untouched.

## The projector *(PR 1)*

`SrdItem.data` is raw dnd5eapi JSON. This is where "correct data read with the
wrong shape" would enter, so it is isolated and tested against real shapes.

| `EquipmentInfo` field | Source | Note |
| --- | --- | --- |
| `weaponCategory` | `weapon_category` | lowercased to match `WeaponCategory` |
| `weaponRange` | `weapon_range` | `Melee` \| `Ranged` |
| `damageDice` | `damage.damage_dice` | **nullable** |
| `damageType` | `damage.damage_type.name` | nullable |
| `properties` | `properties[].name` | lowercased |
| `rangeNormal` / `rangeLong` | `range.normal` / `range.long` | long is 9/37 |
| `armorClassBase` | `armor_class.base` | 13/13 |

The projector maps armour fields even though armour *proficiency* is out of
scope. `getEquipmentInfo` also backs the narrator's equipment tool; a projector
that handled only weapons would answer every armour query with a half-filled
object — trading one silent gap for another.

**`Net` has no `damage` object** — 36 of 37 weapons have one. A projector that
assumes `damage.damage_dice` either throws or invents a die on that one weapon.
`damageDice` is nullable and `Net` is its test.

## Wiring *(PR 2)*

**Character creation** (`app/api/character/route.ts:90`) hydrates the longsword
from SRD id `longsword`. The hand-written literal already matches the SRD row
exactly in dice (`1d8`) and type (`slashing`), so no existing or new character
sees its damage change; the row gains category and traits.

**If `SrdItem` is empty** — an unseeded development database — creation falls
back to the current literal rather than failing. Creating a character must not
depend on a populated cache.

**`Health Potion` is not hydrated.** It does not exist in the SRD cache at all:
the 237 rows are mundane gear, and potions live behind a different endpoint.
Stated here rather than discovered mid-implementation.

**Both attack sites** call one shared helper. Two parallel call sites is what let
them drift from the view-model in the first place. Their legitimate differences
survive: the first allows an unarmed `1d4` attack, the second requires a weapon
and answers 400.

**Canonical trait key:** `weaponProperties`, matching the declared type and
`InventoryPanel`. `view-model.ts:143` is corrected to read it. No persisted row
carries either key, so there is no data to migrate — only three names for one
thing to stop having.

**Log:** when the category cannot be resolved, say so, the way the previous
increment declares an unenforceable range instead of implying it held.

## Testing

The suite hid this defect for its whole life. The tests are designed against
that failure, not only against the rule.

**PR 1:**

- **The projector is tested against `data/srd-es/equipment.json`** — the real
  file the seeder reads — not against hand-written objects. If the SRD shape
  changes, a test fails instead of a game. `Net` is a named case.
- **No fuzzy matching:** `"Sword"` must **not** resolve to `"Longsword"`. An
  absence proved by construction, not by sampling.
- **One lookup, not two:** a guard asserting that `lib/ai/tools/srd-lookup.ts`
  does not define its own equipment query. The duplicate is what let the defect
  exist in two places; a test is what stops it coming back as three.

**PR 2:**

- **A guard binding both ends:** for one character and one weapon, the bonus the
  view-model displays must equal the bonus the backend resolves. Divergence
  becomes a CI failure rather than a discovery three months later.
- **One ability, both rolls:** for a ranged or finesse weapon, the ability behind
  the damage bonus must be the ability behind the attack bonus. This binds the
  two ends of the rule that the current code splits.
- **Exhaustiveness guard** keyed as `Record<WeaponCategory, …>`, so adding a
  category is a compile error — the I1 correction from #95, which replaced a
  hand-written array that still type-checked with a member missing.
- **Discriminating cases:** `Dart` (ranged and finesse — must offer the choice),
  a non-proficient class with a martial weapon (bonus must drop), an unknown
  class string (no proficiency), a legacy row with no category (resolves by
  name), and level scaling across the 1–20 table.

## Related

- `docs/superpowers/specs/2026-08-19-spell-range-authority-design.md` — the
  purity split and the `enforced` reporting pattern reused here.
- `AGENTS.md` §Dormant defects — the produced-never-consumed shape, and the
  warning about tests that mock what they appear to test.
- Issue #64 — unrelated to this increment; noted only because its preconditions
  are stale (PR #58 is closed, not open as the issue requires).
