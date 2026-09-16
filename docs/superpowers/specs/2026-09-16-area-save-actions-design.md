# Area Saving-Throw Actions — Design

**Status:** approved in brainstorming, 2026-09-16.
**Sequence:** follows `docs/superpowers/specs/2026-09-15-enemy-turns-design.md`
(merged in #197-#200) and
`docs/superpowers/specs/2026-09-15-death-saves-design.md` (merged in
#201-#205; `master` at `601dd3f`). Both specs explicitly excluded
"saving-throw actions" from scope. This spec covers the first slice of that:
**area damage with a save, and the recharge mechanic it depends on.**
Condition-only saving-throw actions (Frightful Presence, Enslave, …) and the
one melee-attack rider (the aboleth's Tentacle) are out of scope here and
would need their own spec — see §3.
**Rules baseline:** D&D 5e SRD 2014.

## 1. Decisions

1. **Area collapses to a maximum reach.** With one player as the only
   possible target, "60-foot cone" and "90-foot line" both mean "reaches up
   to that many feet" — no cone/line geometry is modelled.
2. **Recharge is in scope, not deferred.** Every one of the recognised
   actions carries a recharge limit; without it a dragon could breathe every
   turn, which is not the SRD rule and would make these enemies far deadlier
   than intended.
3. **Breath is preferred over multiattack whenever it is charged and in
   range.** It usually deals more damage and is what makes a dragon read as
   a dragon.
4. **Saving-throw proficiency by class ships with this spec.** The SRD fixes
   exactly two saves per class, with no player choice involved; without the
   table, every class would resist a breath equally, which is not the rule
   and matters most against the enemy that deals the most damage.
5. **Recognition is verbatim, never a grammar** — the same discipline as
   `lib/rules/monster-attack-profile.ts` and `lib/rules/damage-clauses.ts.`
   An unrecognised wording is not parsed; that monster simply never uses that
   action.
6. **Where both a prose number and a structured JSON field state the same
   fact, they must agree, or the action is not recognised.** The engine
   already does this for weapon attacks — `recogniseAttack` parses the
   attack bonus out of the header text and rejects unless it equals the
   structured `attack_bonus` field. Measuring this spec's own data (§2)
   found defects in **both** directions — a typo in prose, and once, a wrong
   structured field — so trusting either source alone would have gotten an
   enemy's numbers wrong.

## 2. Problem

Measured on `master` at `601dd3f`:

- **Enemies with a saving-throw action never use it.**
  `lib/rules/monster-attack-profile.ts` recognises only `attack_bonus`
  actions (melee/ranged weapon and spell attacks). `lib/rules/enemy-turn.ts`
  plans only `"melee"` and `"ranged"` modes. An adult red dragon bites and
  claws; its Fire Breath — the action that defines it — never fires.
- **No recharge mechanic exists anywhere in the engine.** Nothing tracks
  whether a limited-use action is available, and nothing rolls to restore it
  at the start of a turn.
- **No saving-throw proficiency by class exists.** `resolveSavingThrow`
  (`lib/rules/combat.ts:961`) takes any ability modifier and DC and is
  already generic, but nothing supplies the class's proficiency bonus for a
  general ability save. `lib/rules/class-skills.ts` is the nearest
  precedent, for skills, not saves.

Measured against `data/srd-es/monsters.json` (334 monsters):

- **81 actions across the roster carry a `dc` field** (a saving throw). Of
  these, 1 is a rider on an already-recognised weapon attack (the aboleth's
  Tentacle) and the rest split by what a **verbatim search for the clause**
  *"…on a failed save, or half as much damage on a successful one."* finds,
  scoped to actions with no `attack_bonus` (so a weapon attack's own rider
  text is never double-counted):
  - **32 actions** carry that clause, a valid `dc` (a recognised ability plus
    a DC), a valid `damage` array (the same shape `damageEntry()` already
    validates for weapon attacks), and a `usage` of `"recharge on roll"`
    with `1d6` and a minimum of 4, 5, or 6.
  - Every action excluded by that filter is excluded for a real, checked
    reason: the metallic dragons' single "Breath Weapons" action offers a
    *choice* between several named breath types in one blob of prose (a
    different data shape, §3); Otyugh's Tentacle Slam and the vrock's Spores
    have no `damage` array at all; the water elemental's Whelm has valid `dc`
    and `damage` and `usage` but its own prose never promises "half as much
    damage" — a success pushes the target out instead; the kraken's Lightning
    Storm does carry the clause, but has no `usage` at all (it is not a
    limited-use action).
  - **The structured `dc.success_type` field is not used and is not
    reliable**: six of these 32 actions carry `success_type: "none"` even
    though their own prose plainly promises half damage on a success —
    including the adult red dragon, the single most iconic monster this
    spec exists for. The verbatim clause search is what actually gates
    recognition; `success_type` is ignored entirely.
- **Of those 32, cross-checking the clause's own numbers against the
  structured fields (decision 6) recognises 28 and rejects 4** — each for a
  specific, measured defect:

  | Monster, action | Defect |
  | --- | --- |
  | `red-dragon-wyrmling`, Fire Breath | Prose DC reads `"DC l3"` — a lowercase L for `13`. |
  | `ancient-white-dragon`, Cold Breath | Prose damage reads `"l6d8"` — a lowercase L for `16d8`. |
  | `black-dragon-wyrmling`, Acid Breath | Prose damage reads `"Sd8"` — a capital S for `5d8`. |
  | `blue-dragon-wyrmling`, Lightning Breath | The *structured* `damage_type` says `"bludgeoning"`; the prose says lightning, correctly. |

  The first three are prose typos the structured fields correct; the fourth
  is the opposite — a wrong structured field the prose corrects. Trusting
  either source alone would have gotten one of these four wrong; requiring
  agreement gets right the only thing that can be gotten right when sources
  disagree — refuse to guess which is correct, the same fail-closed
  treatment as the 39 unrecognised weapon attacks from the enemy-turns
  spec's own measurement.

## 3. Scope

### In

- Verbatim recognition of the 28 area-damage-with-save actions into the
  monster's persisted attack profile.
- The recharge mechanic: a persisted flag, a roll at the start of the
  enemy's turn, and the log line either way.
- Two new planner tiers, ahead of every existing one: breathe from here, or
  move then breathe.
- Resolving the save and the damage, reusing the player-HP write path and
  the downed/died handling built for weapon attacks and death saves.
- Saving-throw proficiency by class (SRD-fixed, no player choice).

### Out, and why

| Out | Why |
| --- | --- |
| The 44 condition-only actions (Frightful Presence, Enslave, Spores' poison, …) | The player has no persisted conditions of their own yet, and no saving throw ever needs to run against them today. A separate spec. |
| The aboleth's Tentacle disease rider | A single monster, a different pattern (rider on a weapon attack, not a standalone action). |
| Otyugh's Tentacle Slam, the water elemental's Whelm | Damage plus a condition with no "half on success" — a third template, one monster each. |
| The kraken's Lightning Storm, the gelatinous cube's Engulf | Different targeting shape (independent bolts; triggered by movement, not an action) — each unique to one monster. |
| The metallic dragons' (brass, bronze, copper, gold, silver — wyrmling through ancient) single "Breath Weapons" action | One action offers a *choice* between several named breath types in one block of prose, not one fixed action — a different data shape from every other dragon's single named breath. |
| The four measured data defects (§2) | Recognition requires the prose and the structured fields to agree; where they do not, the action is not recognised, by design (decision 6). |
| Real cone/line/radius geometry | There is exactly one possible target; a maximum reach settles every case a real shape would (decision 1). |
| Legendary actions, lair actions | Not modelled for any monster today; out of scope for the whole enemy-turns line. |
| A player using a saving-throw action of their own | Nothing here changes what the player can do. |

## 4. Recognition

### 4.1 The gate: an action with no `attack_bonus`

Recognition is only attempted on actions with no `attack_bonus` field — a
weapon attack's own on-hit rider (the aboleth's Tentacle) is the existing
recogniser's action, never this one's, so the two never compete for the same
action.

### 4.2 The core clause: verbatim gate, then a cross-checked read

The action's `desc` must contain, verbatim up to numeric and named slots:

> *…must {make | succeed on} a DC {dc} {Ability} saving throw, taking {n}
> ({dice}) {type} damage on a failed save, or half as much damage on a
> successful one.*

`{Ability}` is one of the six full SRD names (`Strength` … `Charisma`); `{dc}`
and `{n}` are digit runs; `{dice}` is a dice or flat-damage token; `{type}`
is a lowercase damage-type word. Failing to match this clause at all —
whether because the action does not have one, or because a slot's text does
not parse as expected (`red-dragon-wyrmling`'s `"DC l3"` fails at `{dc}`) —
means the action is not recognised, full stop.

**Matching the clause is not enough.** Every slot is then checked against
the action's own structured JSON fields — `dc.dc_type.index` (mapped
`strength→str` etc.), `dc.dc_value`, and the first entry of `damage`
(`damage_dice`, `damage_type.index`) — and every field must equal what the
clause said. A mismatch (`ancient-white-dragon`'s prose `"l6d8"`,
`black-dragon-wyrmling`'s `"Sd8"`, `blue-dragon-wyrmling`'s structured
`"bludgeoning"` against prose "lightning") excludes the action exactly as a
failed parse does (§2, decision 6). Passing the check, the DC, ability, and
damage are read from the structured fields, not the prose. The recharge
threshold has no prose counterpart to cross-check — `usage.type ===
"recharge on roll"` with `dice: "1d6"` and `min_value` in `4`, `5`, or `6` is
read from the structured field alone, the same way `damageEntry()` already
trusts `damage_dice`/`damage_type` for weapon attacks without re-deriving
them from the "Hit: …" prose.

Trailing prose after the core clause (one monster's "Being underwater
doesn't grant resistance against this damage.") is ignored, the same way
trailing narrative after an attack's "Hit: …" clause is ignored today.

### 4.3 The shape clause and its reach

The sentence preceding the core clause gives the shape and size. It has no
structured counterpart at all, so it is the one fact this recogniser takes
from prose alone — reduced to a maximum reach in feet via a closed table of
templates, measured against all 28:

| Template (slots in braces) | Reach | Example |
| --- | --- | --- |
| "exhales {noun phrase} in a{n} {N}-foot cone." | N | adult red dragon |
| "exhales {noun phrase} in a{n} {N}-foot line that is {w} feet/ft. wide." | N | adult black dragon |
| "exhales a {N}-foot cone of {noun}." | N | ice mephit |
| "spits {noun phrase} in a line that is {N} ft. long and {w} ft. wide[, provided …]." | N | ankheg |
| "exhales a line of {noun} that is {N} ft. long and {w} ft. wide." | N | behir |
| "hurls a magical lightning bolt at a point it can see within {N} feet of it." | N | storm giant |

`a`/`an` is accepted either way — the source data has at least one "an
60-foot line" typo (`young-blue-dragon`), and the recogniser does not fail
an otherwise-exact match over an article.

### 4.4 The persisted shape

`MonsterAttackProfileV1` gains one new, independent, optional field —
additive, so every profile already persisted (without this field) reads as
"no area attack," never reinterpreted:

```ts
export interface ProfiledAreaSaveAttack {
  name: string;              // "Fire Breath"
  reachFt: number;
  saveAbility: Ability;      // "STR" | "DEX" | "CON" | "INT" | "WIS" | "CHA"
  saveDC: number;
  damage: ProfiledDamage[];  // the existing shape weapon attacks already use
  rechargeMin: 4 | 5 | 6;    // 1d6; this roll or higher recharges it
}

// MonsterAttackProfileV1 gains:
areaSaveAttack: ProfiledAreaSaveAttack | null;
```

`profileMonster` gains `recogniseAreaSaveAttack`, tried against every
action alongside the existing weapon-attack recogniser. `profileMonster` and
`isMonsterAttackProfile` stop requiring `attacks.length > 0` when
`areaSaveAttack` is present — no monster in the current 334 needs this, but
a profile must not silently disappear if a future SRD monster has only an
area attack and no weapon attack.

### 4.5 Saving-throw proficiency by class

A new file, `lib/rules/saving-throw-proficiency.ts`, in the pattern of
`class-skills.ts` but with no "default" caveat — the SRD assigns exactly two
saves per class, fixed, not chosen:

```ts
export const CLASS_SAVING_THROW_PROFICIENCIES: Record<CharacterClass, readonly [Ability, Ability]> = {
  barbarian: ["STR", "CON"], bard: ["DEX", "CHA"], cleric: ["WIS", "CHA"],
  druid: ["INT", "WIS"],     fighter: ["STR", "CON"], monk: ["STR", "DEX"],
  paladin: ["WIS", "CHA"],   ranger: ["STR", "DEX"],  rogue: ["DEX", "INT"],
  sorcerer: ["CON", "CHA"],  warlock: ["WIS", "CHA"], wizard: ["INT", "WIS"],
};
```

## 5. Persisted state: `Combatant.breathAvailable`

A new nullable column:

| Value | Meaning |
| --- | --- |
| `NULL` | The monster has no `areaSaveAttack` (nearly every combatant). |
| `true` | Available. Written at encounter creation, alongside `attackProfile`, only when the profile carries an `areaSaveAttack` — the SRD starts every limited-use ability ready. |
| `false` | Spent, awaiting a successful recharge roll. |

No monster in the current roster has more than one action of this kind, so
one boolean per combatant is enough; a per-action-name structure is not
needed yet.

## 6. Turn flow

### 6.1 The recharge roll

At the start of `resolveEnemyTurn`, after loading the enemy's profile and
before planning: if `areaSaveAttack` exists and `breathAvailable === false`,
roll `1d6`. Meeting or beating `rechargeMin` sets `breathAvailable = true`.
Either outcome is logged — the same transparency a weapon attack's miss
already gets:

```
"Adult Red Dragon recharges its Fire Breath (5)."
"Adult Red Dragon fails to recharge its Fire Breath (2)."
```

If the ability is already available, nothing is rolled.

### 6.2 The planner: two new tiers, ahead of every existing one

Per decision 3, checked before melee, before ranged, before multiattack:

```
0.  Breathe from here, if charged and the player is within reachFt now.
0a. Move, then breathe, if charged and reachFt only covers the player
    after moving (reuses the existing, mode-agnostic bestDestination).
1.  Melee from here.            (unchanged)
2.  Close and strike.           (unchanged)
3.  Shoot from here.            (unchanged)
4.  Advance, and shoot.         (unchanged)
5.  Nothing.                    (unchanged)
```

`EnemyTurnPlan` gains `areaSaveAttack: string | null`, alongside `attacks`;
when the plan uses the area attack, `attacks` is empty — the two are
mutually exclusive within a turn, which is also the SRD rule (breath spends
the whole action).

The two guards that already exist — refusing to plan anything against a
downed player, and deciding whether there is anything to resolve after
planning — extend to check `areaSaveAttack` alongside `move`/`attacks`.

### 6.3 Resolving the save

Reuses the weapon-attack pipeline's HP write and downed/died handling
end to end:

1. The player's save modifier: `abilityModifier(stats[saveAbility]) +
   (proficient ? proficiencyBonus(level) : 0)`, using §4.5's table. This
   needs `class` and `level` added to the character `select` in
   `resolveEnemyTurn`, which today omits both.
2. `resolveSavingThrow(modifier, saveDC)` — unchanged, already generic.
3. Damage is rolled once; on a success it is halved, rounded down. Saves
   have no critical hit or fumble — no `CRITICAL_HIT`/`CRITICAL_MISS` event
   for this action.
4. `setPlayerHp` writes the result; `applyPlayerDowned` runs exactly as it
   does for a weapon attack when it brings the player to 0 HP.
5. `breathAvailable` is set to `false` in the same transaction.
6. A system log line:

```
"Adult Red Dragon — Fire Breath: DC 21 Dexterity save, Aldric rolls 14 — fails, 63 fire damage."
"Adult Red Dragon — Fire Breath: DC 21 Dexterity save, Aldric rolls 22 — succeeds, 31 fire damage."
```

7. Events: `COMBAT_CONSEQUENCE` and, when damage is dealt, `DAMAGE_DEALT` —
   both reused as-is. No new `GameEventType` is introduced by this spec.

## 7. Migration and deployment

One hand-written, unapplied migration, in the `attackProfile`/
`add_death_save_state` pattern: `ALTER TABLE "Combatant" ADD COLUMN IF NOT
EXISTS "breathAvailable" BOOLEAN`, no default, inside a `DO` block, Spanish
comments, no backfill.

**Deploy the migration before the code.** Prisma selects every scalar
column; new code without this one breaks every `Combatant` query. Existing
rows read `NULL`, which is correct — "no area attack tracked" — for every
already-resolved encounter. Rollback is reverting the code.

This spec changes no existing behaviour: of the 316 already-profiled
monsters, 28 gain `areaSaveAttack`; every other monster's profile is
untouched and the planner's new tiers never trigger for it.

## 8. Testing

- **Recognition**, measured against `data/srd-es/monsters.json`: all 28
  recognised actions match exactly, by name; each of the 6 reach-shape
  templates has its own case; the `a`/`an` article variance is covered; each
  of the 4 measured defects (§2) is pinned by name as staying unrecognised —
  `red-dragon-wyrmling` and `ancient-white-dragon` and `black-dragon-wyrmling`
  (a prose typo the structured field corrects) and `blue-dragon-wyrmling` (a
  wrong structured field the prose corrects) — the same discipline as the 39
  unrecognised weapon attacks are pinned by name today.
- **Saving-throw proficiency:** all 12 classes, exactly two abilities each,
  checked against the SRD table by name.
- **Planner:** breath beats multiattack when charged and in range; ignored
  when spent; ignored against a downed player; tier 0a triggers only when
  movement is what brings the player into reach.
- **Transition, with database doubles:** the recharge roll logs and persists
  both outcomes; the save resolution writes HP through `setPlayerHp` and
  downs/kills through `applyPlayerDowned` exactly as a weapon attack does;
  damage halves and rounds down on a success; `breathAvailable` becomes
  `false` after use.
- **Architecture:** one writer of `breathAvailable` at encounter creation,
  one writer in the enemy-turn transition — the same single-writer pattern
  already proven for `attackProfile` and `diedAt`.
- **E2E `@smoke`, real PostgreSQL.** Dice cannot be fixed here either, so
  each scenario asserts what holds for any roll:
  - a charged dragon breathes on the player: the log reads either "fails,
    full damage" or "succeeds, half damage," never anything else, and the
    breath is spent afterward;
  - with the breath already spent, `End Turn` logs either a successful or a
    failed recharge, and a success leaves it available again.

## 9. Delivery

| PR | Content | Deploy warning |
| --- | --- | --- |
| 0/3 | This spec and its plan | No |
| 1/3 | Pure rules: the area-save recogniser, the saving-throw proficiency table, the two new planner tiers. No schema change. | No |
| 2/3 | Migration, `breathAvailable` written at encounter creation, the recharge roll and the save resolution in `enemy-turn-transition.ts` | **Yes** |
| 3/3 | `MASTER_ARCH_GUIDE.md` §4.4 contract bullets, full validation | No |
