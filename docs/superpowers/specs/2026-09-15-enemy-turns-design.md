# Enemy turns, SRD 2014 — design

**Date:** 2026-09-15
**Status:** approved 2026-09-15; §4 figures and the damage rule corrected
during planning, from a full measurement against the data
**Baseline:** `master` at `6487ec8`
**Sequence:** spec 1 of 2. Spec 2 (death saving throws) builds on this one and
is written after it lands.

## 1. The decision this records

Enemies act. When the player's turn ends, the backend resolves every enemy
turn in initiative order, in the same transaction, until the initiative
pointer returns to the player or the encounter ends.

Five choices were made with the maintainer while designing this, and each one
constrains what follows:

1. **Two specs, enemies first.** Death saves only matter once something can
   bring the player to 0 HP. Today nothing can.
2. **Automatic chain.** Enemy turns resolve inside the request that ended the
   player's turn. No request ever parks on an enemy slot.
3. **Attacks and multiattack only.** Saving-throw actions, spellcasting and
   special abilities are out.
4. **Reach and range come from a closed table of verbatim strings**, following
   `lib/rules/damage-clauses.ts`. No grammar over SRD prose.
5. **Until spec 2 lands, 0 HP is defeat.** The chain stops and the encounter
   resolves as `player_dead`, which is today's behaviour, with no XP.

## 2. Problem

Measured on `master` at `6487ec8`:

- **No enemy ever acts.** `End Turn` advances the pointer one slot
  (`advanceTurn`, `lib/rules/combat.ts:127`). Nothing in `lib/` or `app/`
  resolves a monster's turn, and `git log -S` finds no such code in the
  history of `master` either.
- **Combat deadlocks on the first enemy slot.** `playerTurnRefusal`
  (`app/api/campaign/[id]/action/route.ts:188`) runs before `End Turn` (line
  546) and returns 409 `NOT_PLAYER_TURN` for any action while an enemy owns
  the slot. `tests/e2e/initiative-turn-authority.spec.ts` proves the gate with
  `Move`; `End Turn` passes through the same gate. Once the pointer lands on
  an enemy, no request can move it.
- **The player's HP lives on two rows that drift apart.**
  - `Character.hp` is what the UI renders (`app/campaign/[id]/page.tsx:336-574`)
    and what rest and healing write (`applyCharacterHealing`,
    `lib/rules/combat-pipeline.ts:237`).
  - The player's `Combatant.hp` is copied from it once, at encounter creation
    (`app/api/campaign/[id]/encounter/route.ts:217`), and is what damage writes
    (`combat-pipeline.ts:688`) and what `resolveEncounterEnd` reads.
  - Nothing copies one into the other afterwards. A player caught in their own
    area spell (`route.ts:1447-1448` applies the area to everyone inside it)
    loses Combatant HP only.
- **Enemies carry no attacks.** A spawned enemy `Combatant` stores HP, AC,
  ability scores, damage modifiers and an XP snapshot. It stores neither the
  monster's identity nor its actions, so nothing at turn time could look them
  up.

## 3. Scope

### In

- A persisted attack profile per enemy, recognised once at encounter creation.
- A pure planner for one enemy turn: move, then attack.
- The enemy-turn chain inside `finalizeEncounterTurn`, inherited by all seven
  turn-ending callers.
- One write path for the player's HP that keeps both rows equal.
- A narrow recovery for encounters already parked on an enemy slot.

### Out, and why

| Out | Why |
| --- | --- |
| Death saves, dying, unconscious at 0 HP | Spec 2. |
| Saving-throw actions (breath weapons, 81 actions), spellcasting, special abilities | Need player saves and areas driven by monsters. A separate increment. |
| Fly, swim, climb, burrow speeds | The grid has no terrain to use them on. Walk speed only. |
| Choosing a target other than the player, retreating, dodging, disengaging | There is one hostile to choose. Tactics beyond "close and hit" are YAGNI here. |
| Opportunity attacks, reactions, bonus actions | Not modelled for the player either. |
| Disadvantage for ranged attacks when adjacent or at long range | `evaluateAdvantage` (`lib/rules/conditions.ts:171`) does not apply these to the player today. The planner never shoots in either situation, so the rules are never needed. |
| Pathing around obstacles | Enemy movement uses the same destination rule as the player's `Move`. |
| UI changes | The UI already reacts to every event this design emits. |

## 4. The attack profile — `lib/rules/monster-attack-profile.ts`

### 4.1 What is stored

A new column, `Combatant.attackProfile Json?`, with **no default**. `null` is a
claim: the enemy has no recognised attack, or it predates this column. Either
way its turn is skipped (§6.2).

The profile is written once, at encounter creation, from `SrdMonster.data`,
the same way `xpValue` is snapshotted. It is never taken from the request body
or from narration.

```ts
interface MonsterAttackProfileV1 {
  version: 1;
  /** From speed.walk, recognised verbatim (§4.3). Absent walk → 0. */
  walkSpeedFt: number;
  attacks: Array<{
    name: string;
    attackBonus: number;
    melee: { reachFt: number } | null;
    ranged: { normalFt: number; longFt: number | null } | null;
    /** Every damage entry. `dice` is "XdY±Z" or a flat integer ("1"); a
     *  choice entry is reduced to its lowest-average option (§4.2). */
    damage: Array<{ dice: string; type: DamageType }>;
  }>;
  /** Resolved plan, or null when the monster falls back to a single attack. */
  multiattack: Array<{ attack: string; count: number }> | null;
}
```

A player `Combatant` never carries a profile.

### 4.2 Recognising an attack

Measured over the 334 monsters in `data/srd-es/monsters.json`, the file
`prisma/seed-srd.ts` loads into `SrdMonster.data`: 841 actions, 535 of them with
`attack_bonus`.

The attack's header is its `desc` up to `" Hit:"`. With the bonus, reach and
range replaced by slots, 535 headers reduce to 26 templates. **Eight are
recognised**, and they cover 500 attacks:

| Count | Template |
| ---: | --- |
| 385 | `Melee Weapon Attack: +{b} to hit, reach {r} ft., one target.` |
| 55 | `Melee Weapon Attack: +{b} to hit, reach {r} ft., one creature.` |
| 34 | `Ranged Weapon Attack: +{b} to hit, range {rng} ft., one target.` |
| 14 | `Melee or Ranged Weapon Attack: +{b} to hit, reach {r} ft. or range {rng} ft., one target.` |
| 4 | `Melee Spell Attack: +{b} to hit, reach {r} ft., one creature.` |
| 3 | `Ranged Spell Attack: +{b} to hit, range {rng} ft., one target.` |
| 3 | `Ranged Weapon Attack: +{b} to hit, range {rng} ft., one creature.` |
| 2 | `Melee or Ranged Weapon Attack: +{b} to hit, reach {r} ft. or range {rng} ft., one creature.` |

Each slot also takes only measured values:

- `{b}` must equal the action's `attack_bonus`.
- `{r}` must be one of 5, 10, 15, 20, 30 or 50. The nine `reach 0 ft.`
  attacks are excluded, because reaching into one's own space cannot happen
  on a grid where footprints never overlap.
- `{rng}` must be one of the 15 forms the recognised templates carry:
  `15/30`, `20/60`, `25/50`, `30/60`, `30/120`, `40/160`, `50/100`, `60/180`,
  `60/240`, `80/320`, `100/200`, `100/400`, `120`, `150`, `150/600`.

Everything else stays unrecognised on purpose, 35 attacks today:

- **Conditional targets the model does not carry.** Examples: `one prone
  creature`, `one target in the swarm's space`, `one Medium or smaller
  creature`, `one target not grappled by the crocodile`, the vampire's bite.
- **SRD typos:** `reach 10ft.`, `+ 15 to hit`, `ranged 150/600`,
  `ft./320 ft.`, `reach 5 ft. ,`.
- **The druid's shillelagh variant**, and two actions that are not attacks
  (the octopus's ink cloud, the succubus's kiss).

An unrecognised attack is simply absent from the profile. It is not an error.

**Damage.** Every `damage[]` entry must resolve to `{ dice, type }`, where
`type` is a `DamageType`. There are three shapes:

- **Dice:** `damage_dice` matches `roll()`'s `[N]dF[±M]`.
- **Flat:** `damage_dice` is a bare integer, as in the badger's bite (`"1"`).
  The damage is fixed, and a critical hit does not double it. There are 19
  such entries.
- **Choice:** `choose: 1` over `from.options`. It resolves to the option with
  the lowest average damage, with ties broken by type name. For the versatile
  spears and longswords that means the one-handed option; for the djinni it
  means lightning over thunder. Choosing the lowest never overstates damage.
  There are 16 such entries.

If any entry fails, the whole attack is unrecognised. So is an attack with no
`damage` array: the seven webs, grapples and curses whose only effect is a
condition.

**Measured with every rule applied:** 496 attacks recognised, 39 unrecognised,
and 316 of 334 monsters carry a profile. The guard test (§9.1) pins the 39 by
name.

### 4.3 Walk speed

`speed.walk` takes 10 string values in the data, from `"0 ft."` to
`"60 ft."`, and 8 monsters have no `walk`. The table recognises the 10 strings
verbatim. An absent or unrecognised `walk` becomes `walkSpeedFt: 0`, so the
enemy cannot move and can only attack what is already in reach.

### 4.4 Multiattack

148 actions are named `Multiattack`. 115 list their parts structurally
(`actions: [{ action_name, count }]`). A multiattack is recognised only when
**every** part names a recognised attack of the same monster. With the final
attack rules, that holds for 85 of them.

Every other monster falls back to one attack per turn: the recognised attack
with the highest average damage, with ties broken by name. That covers:

- multiattacks with a part that is not a recognised attack, such as
  Frightful Presence or an attack left unrecognised;
- the 33 choice multiattacks (`action_options`);
- the multiattacks without structured parts.

An enemy therefore never makes more attacks than the SRD grants it.

## 5. The enemy's turn — `lib/rules/enemy-turn.ts`

`planEnemyTurn(input): EnemyTurnPlan` is pure: no database, no dice, never
throws.

**Input:**
- the enemy's profile, position, size and conditions;
- the player's position and size;
- every other combatant's position and size.

**Output:** `{ move: GridPoint | null, attacks: string[] }`.

### 5.1 Skipping

The plan is empty when any of these holds:

- the enemy is at 0 HP;
- its profile is `null`;
- any of its conditions carries the registry's `incapacitated` flag.

That last rule needs a new `isIncapacitated(conditions)` beside
`isUnawareOfSurroundings` in `lib/rules/conditions.ts`.

### 5.2 Measuring

- **Reach** is measured between footprints with `minFootprintDistanceFt`
  (`lib/rules/geometry.ts:376`).
- A **melee attack** is usable when that distance is at most `reachFt`.
- A **ranged attack** is usable when the distance is more than 5 ft (not
  adjacent) and at most `normalFt`.

### 5.3 Choosing a destination

The best destination is the square that minimises the footprint distance to
the player. A candidate must satisfy all of these:

- within `walkSpeedFt / 5` squares by `chebyshevSquares`;
- inside the grid (`isFootprintWithinCombatGrid`);
- every square of its footprint free (`isOccupied`).

Ties go to the fewest squares moved, then the lowest `y`, then the lowest
`x`. The current square is a candidate and moves zero squares, so standing
still wins any tie it is part of.

These are exactly the checks the player's `Move` applies
(`route.ts:780-822`). `toSizeCategory`, now local to `route.ts:113`, moves to
`geometry.ts` so both callers share one size conversion.

### 5.4 The plan, in order

1. **Melee from here.** If a melee attack is usable now, stay and attack in
   melee.
2. **Close and strike.** If a melee attack is usable from the best
   destination, move there and attack in melee.
3. **Shoot from here.** If a ranged attack is usable now, stay and shoot.
4. **Advance.** Otherwise move to the best destination, and shoot if a ranged
   attack is usable from there.
5. **Nothing.** A ranged-only enemy adjacent to the player does nothing. This
   is a known limitation of excluding retreat.

**Which attacks.** In the chosen mode, the enemy uses its multiattack when
every part is usable in that mode. Otherwise it makes one attack: the usable
one with the highest average damage, ties broken by name.

### 5.5 Resolving an attack against the player

These steps run in the finalizer (§6), not in the pure planner, because they
roll dice and read inventory:

1. **Hit roll:** `resolveAttackRoll(attackBonus, playerAC, enemyConditions,
   playerConditions, isMelee)` (`combat.ts:884`).
2. **Player AC** is computed at resolution time with `armorClassFor` over the
   player's current inventory. It is not read from the player's `Combatant.ac`,
   which is a stale copy from encounter creation that nothing updates after an
   in-combat equipment change.
3. **Damage on a hit:** `rollDamage(dice, isCrit)` for each damage entry,
   summed, with a floor of 0. The player has no damage modifiers in this
   codebase.
4. **Stop at 0 HP.** After every attack, including between the parts of a
   multiattack, the chain stops if the player is at 0 HP.

## 6. The chain inside `finalizeEncounterTurn`

### 6.1 Entry lock

The finalizer derives `characterId` from persisted state
(`Encounter → Campaign.characterId`), the rule the XP award already follows.
It then takes the `Character` row lock with `FOR UPDATE` before any write.

For that, `lockCharacterForCombatAction` moves from `route.ts:151` to
`lib/db/character-lock.ts`.

This preserves the order the DC-AUD-016 plan fixes, `Character → Combatant →
Encounter`. It is safe for all seven callers:

- **Macro attack (643), check (1084), spell (1463) and parsed attack (1788)**
  already take the lock at transaction start.
- **`equipment-transition.ts:27`** takes it itself.
- **`End Turn`** writes nothing before the finalizer.
- **Item use** writes only `InventoryItem` and `Character` before it
  (`targetCombatants: []`).

Re-locking a row the same transaction already holds does not block.

The item-use transaction also gains `lockCharacterForCombatAction` at its
start, like every other combat path. §6.3 needs it: `setPlayerHp` requires the
caller to hold the lock.

### 6.2 The loop

The loop starts after the player's own turn claim succeeds, and runs while the
active slot belongs to an enemy and the encounter is active:

1. `planEnemyTurn` produces the plan (§5).
2. **Move.** The CAS core of `persistMoveTransition` (`lib/db/move-transition.ts`)
   checks the origin and the per-turn movement budget, which the turn claim
   just reset to 0. Its `GameLog` write (line 97) is player-specific
   (`role: "user"`) and is split out; enemies log as in §6.5. A failed CAS
   throws, and the transaction rolls back to 409 `TURN_STATE_CONFLICT`.
3. **Attacks**, resolved as in §5.5. The damage goes through `setPlayerHp`
   (§6.3).
4. **0 HP.** If the player reaches 0 HP, the finalizer emits `PLAYER_DOWNED`
   and leaves the loop. The encounter then takes the existing conditional
   `active → resolved` claim with reason `player_dead`, and no XP is paid.
5. **Next turn.** Otherwise the finalizer claims the next turn with the
   existing conditional update, and loops.

**Bound:** at most one iteration per combatant. If the bound runs out without
returning to the player, the finalizer throws `ENEMY_TURN_INVARIANT` (§8).

### 6.3 One write path for the player's HP

`setPlayerHp(tx, characterId, encounterId | null, value)` writes
`Character.hp`, then the player's `Combatant.hp` in the active encounter, in
that order. It requires the caller to hold the `Character` lock, and every
write of the player's HP in combat uses it:

- enemy damage (this design);
- in-combat healing (`applyCharacterHealing`), which today writes `Character`
  only. Healing keeps its existing compare-and-set on `Character`
  (DC-PLAN-009) instead of taking the lock, and after a successful claim
  applies the same Combatant mirror, `mirrorPlayerCombatantHp`, that
  `setPlayerHp` uses. Its concurrency guarantee is unchanged;
- self-inflicted area damage, which today writes `Combatant` only.

The two rows can no longer diverge, and `resolveEncounterEnd` reads a true
value.

### 6.4 Events

Events are published after commit, as the route already does:

- `TURN_ADVANCE` / `ROUND_ADVANCE` on every claim, including claims for
  skipped enemies;
- `MOVE_COMBATANT`, with the payload shape the player's move emits
  (`route.ts:917`);
- `COMBAT_CONSEQUENCE` through `buildCombatConsequenceEvent`, as
  `{ attackerName: <enemy>, targets: [<player consequence>] }`. The target
  uses exactly the `SingleTargetConsequence` fields `executeCombatAction`
  fills (`combat-pipeline.ts:732-745`), and `hitLocation` comes from
  `rollHitLocation()`. The per-hit companion events `executeCombatAction`
  emits for a player attack are emitted the same way, with the player as
  target; the implementation plan lists them;
- `PLAYER_DOWNED` when the player reaches 0 HP.

`lib/narrative/combat-fact-adapter.ts` already maps these events, so the
narrator describes only what the backend resolved (LAW-01, DECISION §7).

### 6.5 Canonical log

Each enemy action writes one `system` `GameLog` row through `tx`, so a
rollback removes it. For example:

```
Goblin — Scimitar: 17 vs AC 15, hit, 5 slashing damage.
```

### 6.6 Encounters already parked on an enemy slot

Saves made before this change can sit on an enemy slot with no way out. **Only
`End Turn`, and only while the active slot belongs to an enemy**, resumes the
chain from that slot without advancing a player turn. It still writes the
player's `End Turn` row. Every other action keeps returning 409
`NOT_PLAYER_TURN`.

Those enemies have no profile, so they are skipped and the pointer returns to
the player.

The finalizer gains an explicit `mode: "advance" | "resume"`. `resume` is
accepted only when the active slot is an enemy.

## 7. Persistence and deploy ordering

**Migration.** Hand-written and left unapplied, following
`prisma/migrations/20260814120000_add_combatant_xp_value_snapshot/`: an atomic
`DO $tag$` block with `ADD COLUMN IF NOT EXISTS "attackProfile" JSONB` and no
`DEFAULT`. `null` is the fail-closed legacy state, not a value to paper over.

**Writer.** Only `app/api/campaign/[id]/encounter/route.ts` writes the column,
when it resolves each enemy's `SrdMonster`. `spawnCombatEncounter` has no
production caller and is not changed; enemies it creates carry `null` and fail
closed.

**Deploy ordering — state it in every handover.** Once the schema has the
field, Prisma selects it:

- `finalizeEncounterTurn` reads combatants with an unrestricted `findMany`, so
  every column is selected;
- every turn-ending action runs the finalizer.

So merging before the migration is applied does not degrade combat. It stops
it. **Apply the migration, then deploy.** No test catches this, because every
test fabricates its rows.

**Rollback:** revert the code. The column is nullable and inert without it.

## 8. Error handling

Any failure inside the chain rolls back the whole transaction, including the
player's turn that triggered it. Nothing is half-applied: no HP, positions,
turns, `GameLog` rows, or events, which only go out after commit.

| Situation | Result |
| --- | --- |
| A move or turn CAS finds the row changed | 409 `TURN_STATE_CONFLICT` (existing) |
| Iteration bound exhausted, or a profile fails its shape check | 500 `ENEMY_TURN_INVARIANT`, not retried |
| Enemy with no profile, incapacitated, or at 0 HP | Not an error: turn skipped, `TURN_ADVANCE` emitted |
| Unrecognised attack or multiattack | Not an error: absent from the profile since creation |
| Any action other than `End Turn` on an enemy slot | 409 `NOT_PLAYER_TURN` (existing) |

## 9. Testing

### 9.1 Recognition — `tests/rules/monster-attack-profile.test.ts`

Run over `data/srd-es/monsters.json`, as `tests/rules/damage-clauses.test.ts`
does:

- The unrecognised remainder equals an explicit list. A new SRD wording fails
  the test instead of passing unnoticed.
- No table entry is orphaned.
- Reach, range and walk-speed vocabularies are fixed.
- Multiattack resolves for exactly the measured monsters. Everyone else falls
  back to a single attack.

### 9.2 Planner — `tests/rules/enemy-turn.test.ts`

Pure cases, one per rule of §5:

- each step of the plan order;
- tie-breaks by squares moved, then `y`, then `x`, and attack choice by
  average damage, then name;
- Large and Huge footprints at the grid edge;
- the skip rules;
- the adjacent ranged-only limitation.

### 9.3 Route and finalizer

- The chain returns to the player.
- Each of the seven callers inherits it.
- `PLAYER_DOWNED` stops the chain and resolves the encounter `player_dead`
  with no XP.
- `End Turn` on an enemy slot resumes; any other action there is still 409.
- `setPlayerHp` keeps both rows equal for enemy damage, in-combat healing and
  self-inflicted area damage.

Existing tests that assert 409 for `End Turn` on an enemy slot are updated on
purpose, and each such change is named in its PR.

### 9.4 Architecture

`attackProfile` has exactly one writer (the encounter route) and one reader
(the finalizer). The test binds both ends, like
`tests/architecture/srd-monster-single-lookup.test.ts`.

### 9.5 Real PostgreSQL — Playwright, `@smoke`

- A full fight against a goblin: enemy turns resolve and the player's turn
  returns.
- `End Turn` racing `End Turn`, and `End Turn` racing a rest: exactly one
  winner, no deadlock.
- A pre-existing encounter parked on an enemy slot recovers.

### 9.6 Falsification

Each guard is shown to matter by reverting it and watching its test fail:

- remove the finalizer's entry lock → the rest race deadlocks or double-writes;
- write only one HP row → the `setPlayerHp` tests fail;
- drop the `resume` gate → a non-`End Turn` action on an enemy slot succeeds.

### 9.7 Validation before each PR

`pnpm typecheck`, `pnpm exec vitest run --maxWorkers=2`, `pnpm build`,
`pnpm check-retro`, `pnpm test:e2e`.

## 10. Documentation in the same delivery

- `MASTER_ARCH_GUIDE.md` §4.4: enemy turns, the `End Turn` resume exception,
  and `setPlayerHp` as the single HP write path.
- The handover: the deploy ordering of §7.

## 11. What spec 2 replaces

- **0 HP.** "Stop the chain, resolve `player_dead`" becomes "unconscious,
  death saves on the player's own turn". `Combatant.deathSaveSuccesses` and
  `deathSaveFailures` already exist in the database (migration
  `20260805090000`) with no reader or writer.
- **Documentation.** `docs/SYSTEM_STATE.md:79-93` claims death saves shipped.
  They never reached code on `master`, and spec 2 corrects that record.
