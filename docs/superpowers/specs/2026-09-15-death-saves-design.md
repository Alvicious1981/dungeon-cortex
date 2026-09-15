# Death Saving Throws — Design

**Status:** approved in brainstorming, 2026-09-15.
**Sequence:** spec 2 of 2. Builds on
`docs/superpowers/specs/2026-09-15-enemy-turns-design.md` (merged in #198,
#199, #200; `master` at `701920f`) and replaces its §11.
**Rules baseline:** D&D 5e SRD 2014.

## 1. Decisions

1. **Enemies do not attack a downed player.** A player at 0 HP is no longer a
   threat; every enemy holds position. Only the death saves decide.
2. **One death save per request, on the player's turn.** The dying player's
   only action is `Death Save`; it rolls, persists, then runs the enemy chain.
3. **Stable does not end combat.** A stable player passes turns with `Wait`
   and wakes with 1 HP after 1d4 rounds (the SRD's 1d4 hours, scaled to
   combat). Combat then resumes and enemies attack again.
4. **Death is permanent.** Three failures, or massive damage, kill the
   character. `Character.diedAt` is written and every write path refuses.
5. **Massive damage applies** (SRD): leftover damage after reaching 0 HP that
   is at least the player's maximum HP kills outright.

## 2. Problem

Measured on `master` at `701920f`:

- **0 HP ends combat as a free defeat.** `resolveEncounterEnd`
  (`lib/rules/combat.ts:808-830`) returns `player_dead` whenever the player's
  HP is `<= 0`; the enemy chain stops and `resolveEncounterIfEnded`
  (`lib/rules/combat-pipeline.ts:851`) resolves the encounter with no XP.
  `Character.hp` stays 0, and a rest starts from `max(0, hp)`
  (`lib/rules/rest-service.ts:304`), so a long rest restores the character
  with no lasting consequence.
- **Death-save state has no reader or writer.** `Combatant.deathSaveSuccesses`
  and `deathSaveFailures` (`prisma/schema.prisma:318-321`, migration
  `20260805090000`) are never read or written.
- **The record is wrong.** `docs/SYSTEM_STATE.md:79-93` claims
  `resolveDeathSave`, `DEATH_SAVE_REQUIRED`, a `death_save` macro and a
  "Tirada de Muerte" button shipped. `git log -S resolveDeathSave --all` finds
  only an agent-log commit; the code never reached any branch.
- **Several write routes check nothing about the player.** `magic/cast` and
  `level-up` do not check `campaign.status`; `social`, `social/rumors`, `npc`
  and `quest` do not look at the active encounter
  (`app/api/campaign/[id]/**/route.ts`).
- **Single player, no allies.** While unconscious nobody can heal or
  stabilise the player; the rules must not depend on a helper.

## 3. Scope

### In

- Pure death-save rules, massive damage and the stable wake clock.
- Downed state inside the enemy chain; enemies hold against a downed player.
- `Death Save` and `Wait` actions through the canonical turn finalizer.
- The action barrier at 0 HP and one shared write-route guard.
- Permanent death via `Character.diedAt`.
- Minimal UI: the two buttons, counters, the "Inconsciente" badge, the
  epitaph screen.
- Correcting `docs/SYSTEM_STATE.md` and `MASTER_ARCH_GUIDE.md` §4.4.

### Out, and why

| Out | Why |
| --- | --- |
| Resurrection (*Revivify* and similar) | Needs another caster; there are no allies. |
| Enemies finishing off a downed player; auto-crits at 0 HP | Decision 1. |
| Damage while at 0 HP | Nothing can deal it once enemies hold and the player cannot act. Guarded as an invariant (§7.3). |
| Forbidding social, quest or NPC routes while conscious in combat | Allowed today; not this spec's problem. |
| Deleting or archiving dead characters | Unchanged. |
| An admin "undo death" tool | Would need its own spec. |
| Retroactive death for past `player_dead` encounters | Those characters stay alive (§8.3). |

## 4. State model

All combat death-save state lives on the player's `Combatant`:

| Field | Meaning |
| --- | --- |
| `hp = 0` | Downed. `Character.hp` stays canonical; `setPlayerHp` mirrors it (enemy-turns spec §6.1). |
| `conditions` contains `unconscious` | Added on falling, removed on waking. Uses the existing case-insensitive helpers (`lib/rules/combat.ts:177`, `:194`) and `CONDITION_REGISTRY`. |
| `deathSaveSuccesses`, `deathSaveFailures` | Existing columns, 0..3. Reset to 0 on falling, waking and healing. |
| **new** `stableWakeRound Int?` | `NULL` while dying. Set to `round + 1d4` on stabilising. |
| **new** `Character.diedAt DateTime?` | Written only by death (§9). |

States are derived, never stored as an enum:

| State | Condition |
| --- | --- |
| conscious | `hp > 0` |
| dying | `hp = 0`, `deathSaveFailures < 3`, `stableWakeRound IS NULL` |
| stable | `hp = 0`, `stableWakeRound IS NOT NULL` |
| dead | `deathSaveFailures = 3` in combat; `Character.diedAt IS NOT NULL` everywhere |

`deathSaveFailures = 3` is the canonical in-combat death marker, including
massive damage (§6.1).

## 5. Pure rules — `lib/rules/death-save.ts`

No I/O; dice are injected.

- `resolveDownedBlow({ hpBefore, damage, maxHp })` →
  `"instant_death"` when `damage - hpBefore >= maxHp`, else `"dying"`.
- `resolveDeathSave({ successes, failures }, d20)`:
  - natural 20 → `{ outcome: "revived" }`;
  - natural 1 → failures + 2;
  - `d20 >= 10` → successes + 1; otherwise failures + 1;
  - failures reaching 3 (capped at 3) → `"dead"`; successes reaching 3 →
    `"stable"`; otherwise `"dying"` with the new counters.
  - No modifiers: in the SRD a death save is a saving throw tied to no
    ability.
- `stabilize(round, d4)` → `stableWakeRound = round + d4`.
- `shouldWake(state, round)` → `true` only when stable and
  `round >= stableWakeRound`.

The enemy planner (`lib/rules/enemy-turn.ts`) returns `noAction()` for every
enemy while the player's HP is 0: no movement, no attack.

## 6. Turn and chain flow

### 6.1 The downing blow

When an HP write brings the player to 0 — `resolveEnemyTurn` today, and the
player's own area spell — one helper, `applyPlayerDowned`, runs after
`setPlayerHp`:

1. `resolveDownedBlow` decides.
   - **instant_death:** write `deathSaveFailures = 3`; the encounter resolves
     `player_dead` (§9) with `PLAYER_DIED { cause: "massive_damage" }`.
   - **dying:** add `unconscious`, set both counters to 0 and
     `stableWakeRound` to `NULL`; emit `PLAYER_DOWNED`.
2. The downing enemy's remaining multiattack attacks are not rolled.
3. **The chain continues.** Later enemies plan `noAction()`; the pointer
   returns to the player as usual.

### 6.2 `resolveEncounterEnd`

`player_dead` is decided by `deathSaveFailures >= 3`, not by `hp <= 0`.
Being at 0 HP no longer ends the encounter; dying does.

### 6.3 `Death Save` (player dying)

Takes the Character lock first (Character → Combatant → Encounter), claims the
turn like `End Turn`, rolls 1d20:

| Result | Effect |
| --- | --- |
| natural 20 | `setPlayerHp(1)`, remove `unconscious`, counters to 0; emit `PLAYER_REVIVED`. **The player keeps the turn** (the SRD rolls at the start of the turn); no chain runs. |
| success or failure, no outcome | Persist counters; `finalizeEncounterTurn` advances; the chain returns to the player. |
| third success | Persist `stableWakeRound = round + 1d4`; emit `PLAYER_STABILIZED`; advance. |
| third failure (natural 1 counts twice) | `deathSaveFailures = 3`; the encounter resolves `player_dead`; `PLAYER_DIED { cause: "death_saves" }` (§9). |

Every roll emits `DEATH_SAVE_ROLLED { natural, successes, failures, outcome }`
and a system log, e.g. `Death save: 14 — success (2/3).`

### 6.4 `Wait` (player stable)

Calls `finalizeEncounterTurn` directly.

### 6.5 Waking

When the chain ends with the pointer on the player, in the same transaction:
if `shouldWake`, `setPlayerHp(1)`, remove `unconscious`, clear
`stableWakeRound` and the counters, emit `PLAYER_WOKE`. The player acts
normally that turn; enemies attack again from the next round.

### 6.6 Events and narration

New `GameEvent` types: `DEATH_SAVE_ROLLED`, `PLAYER_STABILIZED`,
`PLAYER_REVIVED`, `PLAYER_WOKE`, `PLAYER_DIED`. The combat fact adapter maps
each to a narrative fact; the narrative validator refuses death prose without
a `PLAYER_DIED` fact.

### 6.7 Idempotency

`Death Save` and `Wait` are ordinary actions with a `requestId` and a
receipt; a duplicate replays the stored events and never rolls again. The
turn claim uses CAS with `failOnStaleTurn`, so two concurrent saves produce
one roll and one 409.

## 7. Barriers and errors

### 7.1 Action route

`playerConditionRefusal` runs after `playerTurnRefusal`, so enemy slots keep
409 `NOT_PLAYER_TURN`. It applies to both the macro fast path and the
standard path, before the receipt is claimed; a refusal writes nothing.

| Player | Allowed | Otherwise |
| --- | --- | --- |
| dying | `Death Save` only | 409 `PLAYER_UNCONSCIOUS`, `{ allowedAction: "Death Save" }` |
| stable | `Wait` only | 409 `PLAYER_UNCONSCIOUS`, `{ allowedAction: "Wait" }` |
| conscious | everything except `Death Save`, `Wait` | those two: 409 `PLAYER_CONSCIOUS` |
| no active encounter | — | `Death Save`, `Wait`: 409 `NO_ACTIVE_ENCOUNTER` |

### 7.2 Every other write route: `assertCampaignPlayable`

One guard, one query (`campaign.status`, `character.diedAt`, the active
encounter's player combatant):

- campaign not `"active"` → 409 `CAMPAIGN_NOT_ACTIVE`;
- `character.diedAt` set → 409 `CHARACTER_DEAD`;
- active encounter with the player at 0 HP → 409 `PLAYER_UNCONSCIOUS`.

Applied to: action, encounter, rest, social, social/rumors, npc, quest,
quest/[questId], magic/cast, level-up. `magic/cast` and `level-up` gain a
campaign-status check they lack today. `encounter/turn` (410) and GET
handlers are explicit exemptions.

The action route calls the guard with `{ unconscious: "delegate" }`: it keeps
the status and `diedAt` checks but leaves 0 HP to `playerConditionRefusal`
(§7.1), which is what lets `Death Save` and `Wait` through. Every other route
refuses 0 HP outright.

Character routes (`/api/character/[id]/...` writes, the sheet service,
proposal acceptance) use `assertCharacterAlive` → 409 `CHARACTER_DEAD`.
`POST /api/campaign` refuses a dead character with 409 `CHARACTER_DEAD`.

Encounter creation refuses `Character.hp <= 0` with 409
`CHARACTER_AT_ZERO_HP` ("rest first"); rest already works from 0 HP.

### 7.3 Races and invariants

- Concurrent `Death Save` or `Wait`: one wins, the other gets 409
  `TURN_STATE_CONFLICT` and writes nothing.
- Impossible state (`stableWakeRound` with `hp > 0`, counters outside 0..3,
  a downed player taking damage) → `DeathSaveInvariantError` → 500
  `DEATH_SAVE_INVARIANT`, whole transaction rolled back.
- An attack plan against a player at 0 HP → `EnemyTurnInvariantError`
  (defence in depth for §5's hold).

### 7.4 UI

The backend decides; the UI only reflects it.

- `MacroDeck`: only "Tirada de muerte" (dying) or "Esperar" (stable), with
  counters shown as ●●○ / ✕○○.
- `InitiativeTracker`: "Inconsciente" badge.
- Campaign screen when dead: the action bar is replaced by an epitaph
  ("{name} ha caído", cause, round) and a link to create a character.
- Campaign list: "Caída". Character picker: dead characters shown, not
  selectable.

## 8. Migration, deployment, existing data

### 8.1 Migration

One hand-written, unapplied migration, `add_death_save_state`, in the
`attackProfile` pattern (a `DO` block, `ADD COLUMN IF NOT EXISTS`, Spanish
comments):

- `Combatant.stableWakeRound INTEGER NULL`, no default;
- `Character.diedAt TIMESTAMP(3) NULL`, no default;
- `CHECK` on `Combatant`: `deathSaveSuccesses BETWEEN 0 AND 3`,
  `deathSaveFailures BETWEEN 0 AND 3`,
  `stableWakeRound IS NULL OR stableWakeRound >= 1`.

The columns have never had a writer, so every row holds 0. The migration
still counts out-of-range rows first and raises a clear error instead of
failing inside `ADD CONSTRAINT`.

### 8.2 Deploy ordering

Apply the migration before deploying the code. Prisma selects every scalar
column, so new code without the columns breaks every `Combatant` and
`Character` query — combat and the character sheet first. Old code ignores
the new columns. Rollback is reverting the code. The PR carrying the
migration opens with this warning.

### 8.3 Existing data, no backfill

- An active encounter with the player at 0 HP reads as dying with zero
  counters and plays normally.
- Past `player_dead` encounters: no retroactive death; `diedAt` stays `NULL`.
- Characters left at 0 HP outside combat: encounter creation refuses them
  (§7.2) until they rest.

## 9. Permanent death

`Character.diedAt` is the single source of truth. `Campaign.status` is not
written: the guard reads `diedAt`, the Character lock is already held on
every path to death, and one field cannot contradict another. A campaign
whose character died stays `"active"` in the database and is unplayable.

In the winner of the `active → resolved` claim with reason `player_dead`
(`resolveEncounterIfEnded`), same transaction as the roll or blow:

1. `character.updateMany({ where: { id, diedAt: null }, data: { diedAt: now } })`
   — idempotent; a retry or a losing racer updates zero rows.
2. Emit `PLAYER_DIED { cause }` and a system log.
3. No XP, no loot (unchanged).

The killing action narrates normally with the `PLAYER_DIED` fact; it is the
campaign's last narration. Reads (logs, memories, inventory, sheet) keep
working. There is no resurrection and no undo endpoint.

## 10. Testing

### 10.1 Pure rules — `tests/rules/death-save.test.ts`

- Natural 20 revives; natural 1 adds two failures; 10 succeeds and 9 fails.
- 2 → 3 successes is `stable`; 2 failures plus a natural 1 is `dead`, capped
  at 3.
- `resolveDownedBlow`: leftover exactly `maxHp` kills; one less is dying.
- `shouldWake`: one round early is false, the exact round is true, dying is
  always false.
- Planner: a player at 0 HP yields `noAction` for every enemy, including an
  adjacent one with a profile.
- Every comparison falsified by mutation (`>=` → `>`, 2 → 1).

### 10.2 Transactions with database doubles

- Downing blow: `PLAYER_DOWNED`, remaining multiattack skipped, later enemies
  hold, pointer returns, encounter stays active.
- Massive damage: failures 3, `player_dead`, `diedAt` written once,
  `PLAYER_DIED { cause: "massive_damage" }`.
- `Death Save`, one test per row of §6.3.
- Waking at the exact round.
- Lock order Character → Combatant → Encounter (the atomicity matcher).
- `DEATH_SAVE_INVARIANT` and `ENEMY_TURN_INVARIANT`.

### 10.3 Routes

One test per cell of §7.1 and per guard outcome of §7.2, including
`CHARACTER_DEAD` on `POST /api/campaign` and `CHARACTER_AT_ZERO_HP`; a refusal
writes no receipt and no log.

### 10.4 Architecture

- Every campaign and character route with a write handler calls its guard;
  exemptions are listed.
- One writer each for `diedAt`, `stableWakeRound` and the death-save
  counters.
- `resolveEncounterEnd` decides `player_dead` from `deathSaveFailures`, not
  `hp`.

### 10.5 E2E `@smoke`, real PostgreSQL

Dice cannot be fixed in E2E, so every scenario is either set up to be
deterministic or asserts what holds for any roll:

- **No finishing blow:** a profiled goblin, the player already dying.
  `Death Save` → 200, no goblin attack log, the pointer returns.
- **Terminal save:** 2 successes and 2 failures; any d20 ends it. The final
  state is exactly one of revived, stable or dead and matches the events.
- **Race:** two `Death Save`s with the Character lock held → 200 and 409,
  one roll logged.
- **Deterministic wake:** stable with `stableWakeRound` set in the database;
  `Wait` wakes the player at that round.
- **Dead campaign:** `diedAt` set in the database; every write route → 409
  `CHARACTER_DEAD`, reads → 200.
- **Constraints:** writing `deathSaveFailures = 4` fails in PostgreSQL.

### 10.6 Contract changes to existing tests

Unit tests of the chain and of `resolveEncounterEnd` that expect
`player_dead` at 0 HP now expect "dying, combat continues". The `@smoke`
goblin test is unchanged (the player has 200 HP). Each PR lists these by
file.

### 10.7 Per-PR validation

Typecheck, vitest, build, `check-retro`, and the `@smoke` lane in CI;
falsification recorded in the PR description.

## 11. Delivery

| PR | Content | Deploy warning |
| --- | --- | --- |
| 0/3 | This spec and its plan | No |
| 1/3 | `lib/rules/death-save.ts`, the planner hold; no database change | No |
| 2/3 | Migration, downed state, `Death Save` / `Wait`, waking, barriers, `assertCampaignPlayable` | **Yes** |
| 3/3 | Permanent death, UI, `docs/SYSTEM_STATE.md` correction, `MASTER_ARCH_GUIDE.md` §4.4 | No |

The whole migration ships in 2/3, `diedAt` included, so there is one ordered
deploy rather than two.

## 12. What this replaces

- Enemy-turns spec §1 decision 5 and §11: "0 HP is defeat" becomes "dying,
  death saves on the player's turn".
- `docs/SYSTEM_STATE.md:79-93`: rewritten to describe what actually ships.
