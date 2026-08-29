# Damage resistance, immunity and vulnerability

**Date:** 2026-08-28
**Status:** designed
**Follows:** `docs/superpowers/specs/2026-08-23-equipment-slot-authority-design.md` and the additive armour-class increment, which closed the last two produced-never-consumed values in the equipment stack

## Problem

A monster's damage resistances are written into the database by two seeders, selected out of it by two lookups, and applied by nothing. Every fire elemental in the game takes full fire damage. Every skeleton takes full slashing.

This is not a missing feature. It is the project's one non-negotiable rule inverted — except that the inversion is worse than it first looks, because the chain is broken in three places at once and each break hides the next.

### The chain, break by break

**1. The data exists and is real.** `prisma/seed-srd.ts:158-160` and `scripts/ingest-srd.ts:493-495` both write `damageImmunities`, `damageResistances` and `damageVulnerabilities` onto `SrdMonster`. The schema gives all three a GIN index (`prisma/schema.prisma:450-452`), so someone expected to query them.

The source data is populated — measured in `data/srd-es/monsters.json`, not sampled. A first pass with a single-line `grep` suggested every array was empty; that was wrong, because the arrays are multi-line. A multiline search finds fire elementals immune to fire and poison, werewolves resistant to nonmagical weapons, skeletons vulnerable to bludgeoning.

**2. The lookup selects all three and discards them.** `lib/rules/srd-monster-lookup.ts:59-61` asks Prisma for the three columns. Its `.map((row): Monster => …)` never assigns them: searching `lib/` for the exact strings `damage_resistances`, `damage_immunities` and `damage_vulnerabilities` returns only `lib/rules/srd.ts` and `lib/memory/formatter.ts` — the projection is not among them. Three columns are read from the database and dropped one line later.

The `Monster` schema itself is incomplete in the same direction: `lib/rules/srd.ts:137-138` declares `damage_immunities` and `damage_resistances` as optional, and **has no `damage_vulnerabilities` at all**.

**3. The combatant never carries them.** `Combatant` has no resistance column (`prisma/schema.prisma:242-272`) and no reference back to `SrdMonster` — it is a self-contained snapshot, linked to its monster only by name. At spawn, `lib/rules/encounter-service.ts:289` writes `stats: monsterAbilityScores(monster)`: six ability scores, nothing else.

**4. The narrator is not told either, though the code tries.** `lib/memory/formatter.ts:182` does `const m = combatant.stats as unknown as Monster` and then builds a constraint line from `m.damage_immunities`. Because `stats` holds ability scores, that field is always `undefined` and the line is never emitted. The cast compiles; the read cannot succeed.

So four separate places contain code that looks like it handles damage resistance, and the mechanic does not exist. That is the shape this repository keeps producing, at a scale it has not hit before: not one dormant value, but a whole chain of them, each one making the next look plausible.

### Where damage actually lands

Two places, independently:

| Path | Site | How the number is reached |
| --- | --- | --- |
| Weapon attack | `lib/rules/combat.ts:690` | `Math.max(0, hpBefore - damage)` inside the consequence builder, surfaced as `combat_facts.hp_after` |
| Spell | `lib/rules/combat-pipeline.ts:388` | `newHp = Math.max(0, target.hp - damage)` |

`combat-pipeline.ts` assigns `newHp` from the consequence payload on the weapon path (`:338`) and computes it itself on the spell path, so line 388 is not a shared funnel. Both sites know the damage type: `CombatFacts.damage_type` is a `DamageType` (`lib/rules/combat.ts:232`), a closed union of thirteen (`:203-206`).

**A rule applied at one site and not the other is the defect this codebase has already paid for once** — two armour-class calculations that disagreed about what counted, unified in an earlier increment. That precedent is the reason this design puts the rule in one pure function with two call sites and a test that feeds both the same input and demands the same number.

## The data splits in two, and only half is resolvable

Reading every non-empty array in `data/srd-es/monsters.json`:

**Bare damage types** — `"fire"`, `"poison"`, `"cold"`, `"acid"`, `"lightning"`, `"thunder"`, `"psychic"`, `"radiant"`, `"necrotic"`, `"piercing"`, `"bludgeoning"`, `"slashing"`. These match the existing `DamageType` union one-for-one.

**Conditional clauses**, which are prose, not a type. Six shapes observed:

```
"bludgeoning, piercing, and slashing from nonmagical weapons"
"bludgeoning, piercing, and slashing from nonmagical weapons that aren't silvered"
"bludgeoning, piercing, and slashing from nonmagical weapons that aren't adamantine"
"bludgeoning, piercing, and slashing from nonmagical attacks (from stoneskin)"
"damage from spells"
"piercing from magic weapons wielded by good creatures"
```

**That list is observed, not proven exhaustive.** An earlier draft of this spec claimed five and named them; the sixth turned up on the next search. Two further attempts to enumerate the set exhaustively failed on the tooling, and a third would have been the wrong instinct: a design that depends on me listing every clause correctly is a design that breaks the day the SRD data gains a seventh. The testing section below therefore asserts the *partition* — every string is either a bare `DamageType` or unresolved — which needs no enumeration and cannot rot.

Every one of these turns on whether the attacking weapon is magical, silvered, adamantine, or wielded by a good creature. **No such notion exists in the codebase** — searched for `"magical"`, `isMagical`, `magicWeapon`, `silvered` and `adamantine` across `lib/` and `app/`: zero hits. The last clause needs the attacker's alignment, which is further out of reach still.

So the second kind cannot be resolved, and this increment does not try. Guessing at it would mean deriving a mechanical outcome from prose, which is the one thing this project forbids — and the guess would not even be conservative, since reading the clause as blanket resistance makes monsters tougher than the rules allow.

**But it will not be silent.** `lib/rules/weapon-attack.ts:83` already establishes the pattern: when the engine cannot resolve a weapon's category, `unresolvedCategoryLog` returns a `⚠️` line for the system log rather than letting the gap pass unremarked. An unresolvable clause gets the same treatment, so a player who wonders why their sword is not bouncing off the werewolf can read why.

## Architecture

### `lib/rules/damage-modifiers.ts` — new, pure

```ts
export interface DamageModifiers {
  immunities: readonly string[];
  resistances: readonly string[];
  vulnerabilities: readonly string[];
}

export interface ModifiedDamage {
  damage: number;
  /** Which rule produced the number, for the log and the facts. */
  applied: "immune" | "resistant" | "vulnerable" | "cancelled" | "none";
  /** Clauses this module could not evaluate, verbatim, for the system log. */
  unresolved: readonly string[];
}

export function applyDamageModifiers(input: {
  damage: number;
  damageType: DamageType;
  modifiers: DamageModifiers;
}): ModifiedDamage;
```

Pure: no database, no I/O, no randomness, and it never throws. The three arrays arrive as untyped strings from Postgres, so any shape is reachable.

**The order is the SRD's.** Immunity settles it: the damage is 0 and nothing else is consulted. Otherwise resistance halves and vulnerability doubles — and when a type appears in both, they cancel and the damage is unchanged, because the rules say so rather than because the arithmetic happens to work out. Halving rounds down, as the SRD directs.

Matching is exact against the `DamageType` union after trimming and lowercasing. A string that is not one of the thirteen is not a match — it is an unresolved clause, and it is returned in `unresolved` rather than dropped.

`applied` exists because two callers need to say what happened, and deriving it from a before/after comparison would make "halved from 1 to 0" indistinguishable from "immune".

### The producer chain, repaired at each break

**`Monster` gains `damage_vulnerabilities`** (`lib/rules/srd.ts`), completing a triple that was already two-thirds declared.

**The lookup stops discarding** (`lib/rules/srd-monster-lookup.ts`): its projection assigns the three fields it already selects.

**`Combatant` gains three columns**, named and shaped exactly as `SrdMonster`'s so a reader never has to translate:

```prisma
damageImmunities      String[] @default([])
damageResistances     String[] @default([])
damageVulnerabilities String[] @default([])
```

Additive, with defaults, so every persisted row is valid the moment the migration applies. No backfill, no data rewrite. **The migration is written but not run** — the database holds a real save, and running it is the maintainer's call, not this work's.

**Spawn copies them** (`lib/rules/encounter-service.ts:282-293`), from the monster object already in hand. The player's combatant gets three empty arrays, which is correct: no rule in this codebase grants a player resistance to anything.

### The two consumers

Both damage sites call `applyDamageModifiers` between computing damage and subtracting it from hit points. Neither site gains a new data dependency it did not already have: the target's row is in scope at both, and the damage type is on the facts.

`CombatFacts.damage` reports the number after modification, because that is the damage that happened. The pre-modification figure is not carried: nothing needs it, and a second damage number on the facts is how the narrator ends up describing the wrong one.

## What this changes for a live game

Everything about fighting a resistant creature, in the direction the rules intend. A fire elemental stops taking fire damage. A skeleton takes double from a mace. A wraith stops being killed by a mundane sword — and this one is worth stating plainly, because until the magical-weapon notion exists, *that* fight is unchanged: the clause is unresolvable, so the wraith keeps taking full damage and the log says why.

No persisted encounter changes. The columns default to empty, so combatants spawned before the migration behave exactly as they do today, and only encounters created afterwards carry modifiers. That is a deliberate cut: backfilling a live encounter's combatants from a name-based monster lookup would be guessing at which monster a row came from.

## Testing

- **Bound to the real monster file, by partition rather than by list.** A test reads every string in every `damage_immunities`, `damage_resistances` and `damage_vulnerabilities` array in `data/srd-es/monsters.json` and asserts that each one either matches a `DamageType` exactly or comes back in `unresolved`. Nothing falls between: no string is silently ignored, and none is silently matched. This deliberately does not enumerate the clause shapes — see the note above about why an enumeration is the wrong assertion here. It also proves the rule handles the real vocabulary rather than a fixture's idea of it.
- **The two call sites agree.** One test drives a weapon attack and a spell with the same damage, the same type and the same target modifiers, and asserts the same resulting hit points. This is the assertion that would have caught the armour-class divergence, and it is the reason the rule is a shared function rather than two applications.
- **The SRD order.** Immunity beats vulnerability. Resistance and vulnerability on the same type cancel. Halving rounds down, including 1 → 0.
- **The unresolved clause is reported, not swallowed.** A werewolf's `"bludgeoning, piercing, and slashing from nonmagical weapons"` yields full damage *and* a non-empty `unresolved`, and the system log carries it.
- **Nothing resists by accident.** A combatant with three empty arrays takes exactly the damage it takes today, across both paths — the regression guard for every encounter already in flight.

## Out of scope, with reasons

- **Magical, silvered and adamantine weapons.** The whole second kind of clause waits on this. It is a property of items and attacks, not of damage, and it belongs with the increment that introduces it rather than being smuggled in as a boolean nobody sets.
- **Condition immunities.** `SrdMonster.conditionImmunities` is a fourth column with the same disease, and `formatter.ts:187` reads it through the same cast that cannot succeed. It is a different rule against a different registry, and it deserves its own increment rather than a ride on this one.
- **Player resistances.** The columns will accept them; nothing produces them. Wiring a consumer with no producer is the defect this increment exists to remove.
- **The formatter's phantom read.** `formatter.ts:182-190` casts ability scores to `Monster` and reads fields that are never present. Once the combatant carries the three arrays, that code could be made to work — but it is a narration change, it touches what the AI is told, and merging it here would blur a rules increment with a prompt increment.

## Related

- `lib/rules/weapon-attack.ts:83` — `unresolvedCategoryLog`, the precedent for declaring what the engine could not resolve.
- `docs/superpowers/specs/2026-08-22-armor-proficiency-authority-design.md` — the increment that unified two disagreeing armour-class calculations, and the reason this one has a two-site agreement test.
- `AGENTS.md` §Dormant defects — three breaks in one chain, each making the next look plausible.
