# Weapon qualities: magical, silvered and adamantine

**Date:** 2026-08-29
**Status:** designed
**Follows:** `docs/superpowers/specs/2026-08-28-damage-modifiers-design.md`, which built the rule that resolves a creature's damage modifiers and deliberately left every conditional clause unresolved

## Problem

`lib/rules/damage-modifiers.ts` resolves a bare damage type — a fire elemental's immunity to fire, a skeleton's vulnerability to bludgeoning — and refuses to guess at anything else. A clause like `"bludgeoning, piercing, and slashing from nonmagical weapons"` is reported in `unresolved` and full damage is applied, with a system log saying so.

That refusal was correct: the engine had no notion of a weapon being magical, so evaluating the clause would have meant inferring a mechanical outcome from prose. The refusal is also expensive, and this design measures how expensive.

### What the data actually contains

Every non-bare entry across the three modifier arrays in `data/srd-es/monsters.json`, counted over all 334 monsters — read in full, not sampled:

| Occurrences | Clause |
| ---: | --- |
| 36 | `bludgeoning, piercing, and slashing from nonmagical weapons` |
| 27 | `bludgeoning, piercing, and slashing from nonmagical weapons that aren't silvered` |
| 5 | `bludgeoning, piercing, and slashing from nonmagical weapons that aren't adamantine` |
| 1 | `piercing and slashing from nonmagical weapons that aren't adamantine` |
| 1 | `damage from spells` |
| 1 | `bludgeoning, piercing, and slashing from nonmagical attacks (from stoneskin)` |
| 1 | `piercing from magic weapons wielded by good creatures` |

Seven distinct strings, 72 occurrences. Counting per array rather than per string gives ten pairs, which is the shape a first pass over the file produces and is not the number that matters: the table is keyed by the string.

**Four of the seven strings are one family**, and they carry 69 of the 72 occurrences: physical damage from weapons that are not magical, optionally further excluding silvered or adamantine ones. The remaining three each need a concept the engine does not have — the source of the damage being a spell, the alignment of the wielder, a note about where a temporary resistance came from.

### What the engine already knows

The attack side is closer to ready than the defence side was.

- `lib/rules/weapon-attack.ts:39` is the single place that reads the equipped weapon's `properties`; it already pulls `damageBonus` out of that blob. Both of the action route's attack sites call it.
- `lib/rules/combat.ts:656` (`computeConsequences`) is the weapon path's damage site and already accepts an optional `targetModifiers`.
- `lib/rules/combat-pipeline.ts:396` is the spell path's damage site and calls `applyDamageModifiers` directly.
- `data/loot-tables.json` holds nine weapons. The two in the `mundane` table carry no `damageBonus`; all seven from `rare` upwards carry `+1`, `+2` or `+3`. None declares a material or a magical quality.
- `data/srd-es/equipment.json` has no magical, silvered or adamantine weapon at all. Its weapon `properties` vocabulary is the eleven SRD tags — `light`, `finesse`, `versatile`, `thrown` and so on — none of which is a quality in this sense.

So the gap is not the plumbing. It is that nothing anywhere says a weapon is magical, and no rule would read it if it did.

## Decisions taken

Three questions were settled before this design was written. They are recorded here with their reasoning, because each one closes off a road that would otherwise look reasonable later.

**1. Scope: the physical family only.** Three shapes across four wordings, covering 69 of the 72 occurrences, are implemented. `damage from spells`, `(from stoneskin)` and `wielded by good creatures` stay unrecognised and keep the behaviour they have today: reported in `unresolved`, full damage applied, system log written. Two of the three need a new concept for a single occurrence each.

**2. A weapon's magic is declared, or derived from `damageBonus`.** An explicit quality on the row always wins. Absent one, `damageBonus > 0` means magical, because in the SRD a weapon with a bonus to attack and damage rolls *is* a magic weapon. This is reading a mechanical field, not interpreting prose, and it is the distinction that keeps the project's rule intact. It also means the seven existing loot weapons become magical without editing a byte of data.

Silvered and adamantine have no numeric shadow to derive from and must be declared.

**3. The increment ships its own producer.** Nothing in the game is silvered or adamantine today. A rule with no producer is dormant the day it lands — the failure this repository has spent eight increments removing, most explicitly when the armour-proficiency rule shipped while no loot row carried an armour category. Two weapons are added to the loot tables as part of this work.

## Approaches considered

**A. A curated clause table (chosen).** An exhaustive map from the exact clause strings the data contains to a structured meaning. Anything not in the map is unrecognised and stays unresolved.

*For:* no prose is interpreted — a string is either recognised verbatim or it is not. It is auditable, it is the same mechanism `IMPLEMENTED_EFFECTS` uses in `lib/rules/item-effects.ts`, and an unseen wording fails towards the current behaviour rather than towards a guess.

*Against:* a variant wording — `attacks` where the data says `weapons` — is not resolved until somebody adds it. That is exactly today's behaviour for that string, so the cost is a missed improvement, never a regression.

**B. A regex grammar.** Parse "list of damage types + `from nonmagical weapons` + optional `that aren't X`".

*For:* generalises to wordings nobody has seen.

*Against:* it is deriving a mechanical outcome from prose, which is the rule this project does not bend. A subtle mismatch changes damage silently, where the table's failure is loud and logged.

**C. Structure the clauses at the seam.** Normalise them into a new column when seeding `SrdMonster`, so the runtime never sees prose.

*For:* prose is handled once, at the boundary.

*Against:* a migration, a reseed, and the four snapshot columns on `Combatant` would have to carry the structured form too. The parsing problem does not disappear; it moves into the seeder, where the same choice between A and B recurs.

## Design

### 1. The quality vocabulary and where it is read

New module `lib/rules/weapon-quality.ts`, pure — no database, no I/O, no randomness, never throws.

```
WEAPON_QUALITIES = ["magical", "silvered", "adamantine"] as const
type WeaponQuality = (typeof WEAPON_QUALITIES)[number]

weaponQualitiesFor(properties: unknown): readonly WeaponQuality[]
```

Reads `properties.qualities` as a list of strings, normalises each (trim, lower-case) and **discards anything that is not one of the three**. An invented quality on a row grants nothing, the same way `item-effects.ts` grants nothing for thirty-eight of its forty `effect` strings.

If the declared list does not contain `magical` and `properties.damageBonus` is a number greater than zero, `magical` is added. The reasoning above lives in the module's header, not in a commit message.

The result is computed in `lib/rules/weapon-attack.ts` and surfaced on `ResolvedWeaponAttack` as `qualities`. That module is chosen because it is already the one place reading the weapon's `properties`, and because both of the route's attack sites go through it — a second reader is how two rules come to disagree about the same weapon. An unarmed strike (`weapon: null`) yields an empty list.

### 2. The clause table

New module `lib/rules/damage-clauses.ts`, pure.

```
interface DamageClause {
  /** The damage types the clause covers. */
  types: readonly DamageType[];
  /** The quality that lifts the clause, beyond being magical. Null when only magic lifts it. */
  unless: WeaponQuality | null;
}

DAMAGE_CLAUSES: ReadonlyMap<string, DamageClause>   // keyed by the normalised clause string
clauseFor(entry: string): DamageClause | null
```

Four entries, one per distinct string in the physical family: the three `bludgeoning, piercing, and slashing …` wordings and the `piercing and slashing … adamantine` variant. Keys are the normalised form of the exact strings the data holds.

A clause **applies to an attack** when all of these hold:

- the attack is a weapon attack, not a spell;
- the damage type is one of `types`;
- the attack's qualities do not include `magical`;
- and, when `unless` is set, the attack's qualities do not include it.

A silvered weapon is not magical: it lifts `that aren't silvered` and does not lift the plain `nonmagical weapons` clause. That asymmetry is the whole point of the two wordings and the tests pin it in both directions.

### 3. How it enters the damage rule

`applyDamageModifiers` gains one optional field:

```
attack?: { kind: "weapon" | "spell"; qualities: readonly WeaponQuality[] }
```

**Optional, and absent means unresolved.** Without `attack`, a recognised clause is not evaluated: it goes into `unresolved` exactly as it does today. No existing call site changes behaviour by not being updated, and the engine never resolves a clause without knowing what struck.

With `attack` present, each clause entry is either:

- *recognised and applicable* — it counts as naming the damage type, so an immunity clause makes the target immune and a resistance clause halves the damage, through the same immune-then-resist-then-vulnerable ordering the module already has;
- *recognised and not applicable* — the attack is magical, or silvered against an `aren't silvered` clause, or a spell against a `weapons` clause. It resolves to "does not apply", contributes nothing, and **does not enter `unresolved`**;
- *unrecognised* — into `unresolved`, as today.

This narrows what `unresolved` means. It currently conflates "I cannot read this string" with "I can read it but I do not know what hit you". After this change it means only the first, and `unresolvedModifierLog` must be rewritten: its present sentence — *"depends on whether the attack was magical, silvered or adamantine, which this engine does not track"* — becomes false for every clause the table now covers.

### 4. Wiring: two sites, and one deliberately left alone

**The route's weapon attack.** `resolveWeaponAttack` returns `qualities`; the route passes them on the `executeCombatAction` payload; `combat-pipeline.ts` forwards them to `computeConsequences` as `attack: { kind: "weapon", qualities }`; `computeConsequences` passes them to `applyDamageModifiers`. The new field on `ComputeConsequencesInput` is optional and carries the same justification the neighbouring `targetModifiers` already carries: every existing caller and fixture keeps compiling.

**The spell path.** `lib/rules/combat-pipeline.ts:396` passes `{ kind: "spell", qualities: [] }`. This resolves a `from nonmagical weapons` clause as *not applicable* to spell damage, which is correct and free. It does **not** resolve the separate `damage from spells` clause, which stays out of scope and unrecognised.

**`resolveCombatAttack` in `lib/rules/combat-service.ts` is not touched.** It is the tool entry point where the attacker may be a monster, and its own comment records that enemy combatants carry no inventory to read. Passing `qualities: []` there would assert "a non-magical natural weapon" — the SRD's default, but an assertion the engine cannot check, and one that changes nothing today because a player is spawned with all four modifier columns empty. By not passing `attack`, that path keeps today's behaviour by construction, with no code and no claim.

### 5. The producer

Two rows added to `data/loot-tables.json`: a silvered weapon in `uncommon` and an adamantine weapon in `rare`, each declaring `properties.qualities`. `LootItemSchema` validates `properties` as `z.record(z.string(), z.unknown())`, so no schema changes.

**Neither row may carry a `damageBonus`.** A silvered sword that also had `+1` would derive as magical, the `nonmagical weapons that aren't silvered` clause would be lifted by the magic rather than by the silver, and the silvered branch would ship having never been exercised. A silvered weapon is not a magic weapon, and that distinction is precisely what the clause is about.

## Out of scope, stated so it is not mistaken for an oversight

- `damage from spells`, `(from stoneskin)` and `piercing from magic weapons wielded by good creatures` — one occurrence each, and two of them need concepts the model does not carry.
- Silvering an existing weapon through trade for the SRD's 100 gp. It is a live producer and a reasonable follow-up, but it reaches into the trade route and into inventory mutation, which is a second increment.
- Monsters whose natural attacks count as magical. The SRD says so for some stat blocks; nothing in the data expresses it, and the tool path that would need it is left untouched above.
- Ammunition inheriting a bow's quality, or a quality on off-hand weapons. Only the main-hand weapon reaches the damage site today.

## Testing

Test-first throughout, and each new rule line falsified by breaking it and confirming that a specific test dies — not merely watched to go green.

**Unit — `tests/rules/weapon-quality.test.ts`**
A declared quality is read; an invented string grants nothing; `damageBonus > 0` derives `magical`; a zero or absent bonus derives nothing; a declared `silvered` row with no bonus is silvered and **not** magical; `weapon: null` yields an empty list.

**Unit — `tests/rules/damage-clauses.test.ts`**
Both directions against the real `data/srd-es/monsters.json`, so the table cannot drift from the data:

- every key in the table appears verbatim in the file;
- the set of clause strings in the file that the table does not recognise equals a written-down list of the three out-of-scope wordings — `damage from spells`, the `(from stoneskin)` note, and `piercing from magic weapons wielded by good creatures`. A new SRD clause therefore fails this test rather than passing unnoticed — the same discipline as `IMPLEMENTED_EFFECTS`.

**Unit — additions to `tests/rules/damage-modifiers.test.ts`**
Clause plus mundane weapon resists or immunises; the same clause plus a magical weapon applies nothing, leaves full damage, and leaves `unresolved` empty; `that aren't silvered` is lifted by a silvered weapon and not by a plain one; `that aren't adamantine` likewise; a spell against a `weapons` clause does not apply; **and, with no `attack` at all, the clause still lands in `unresolved`** — the case that proves no existing caller changed.

**Unit — the log**
`unresolvedModifierLog` writes nothing when every clause on the creature was recognised and evaluated, and its rewritten sentence names only what is genuinely untracked.

**Pipeline level, which is where increments like this fail**
A target carrying the real werewolf clause, struck by a mundane weapon and then by a `+1`, must differ in the `hp_after` that reaches the facts — proving the quality crosses `weapon-attack` → route payload → `combat-pipeline` → `computeConsequences` → `applyDamageModifiers`, rather than proving five helpers are self-consistent.

**Data guard**
A test reads `data/loot-tables.json` and fails if either new row loses its quality or gains a `damageBonus`.

## Risks

- **A silent behaviour change for callers that do not pass `attack`.** Guarded by making the field optional and by an explicit test that the absent case still reports `unresolved`.
- **The derivation from `damageBonus` catching a row that was never meant to be magical.** Today it catches exactly the seven loot weapons from `rare` upwards, all of which are magical in fiction; a future mundane row with a bonus would be wrongly magical. An explicit `qualities` declaration overrides it, which is the escape hatch.
- **Table drift.** A reseed or a data update introducing a new wording would leave it unresolved — safe — but silently, if not for the two-directional test above, which is why that test is not optional.
- **`unresolved` narrowing is observable.** The system log stops appearing for the clauses now covered. That is the intended outcome, and the log test pins it so the change is deliberate rather than noticed later in a transcript.

## Files

| File | Change |
| --- | --- |
| `lib/rules/weapon-quality.ts` | **New.** The vocabulary and `weaponQualitiesFor`. |
| `lib/rules/damage-clauses.ts` | **New.** The curated table and `clauseFor`. |
| `lib/rules/weapon-attack.ts` | Compute `qualities` and surface them on `ResolvedWeaponAttack`. |
| `lib/rules/damage-modifiers.ts` | Optional `attack` input; clause evaluation; rewritten `unresolvedModifierLog` sentence. |
| `lib/rules/combat.ts` | Optional `attack` on `ComputeConsequencesInput`, forwarded to the damage rule. |
| `lib/rules/combat-pipeline.ts` | Forward the weapon qualities; pass `kind: "spell"` on the spell path. |
| `app/api/campaign/[id]/action/route.ts` | Pass `attack.qualities` on the `executeCombatAction` payload. |
| `data/loot-tables.json` | Two new weapon rows: one silvered, one adamantine, neither with a `damageBonus`. |
| `tests/rules/weapon-quality.test.ts` | **New.** |
| `tests/rules/damage-clauses.test.ts` | **New**, including the two-directional guard against the real monster data. |
| `tests/rules/damage-modifiers.test.ts` | Clause cases, including the absent-`attack` case. |
| `tests/rules/loot-weapon-qualities.test.ts` | **New.** The producer guard against the real loot file. |
| `tests/rules/combat-pipeline.test.ts` | A pair proving the quality crosses every layer to `hp_after`, using the fixtures in `tests/rules/combat-pipeline-fixtures.ts`. |
| `AGENTS.md` | Close the weapon-qualities entry in the dormant list; record what stays out of scope. |
