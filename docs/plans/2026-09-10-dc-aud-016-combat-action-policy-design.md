# DC-AUD-016 Combat Ability-Check and Equipment Action Policy

**Status:** Approved; DC-PLAN-016A delivered, DC-PLAN-016B pending

**Date:** 2026-09-10

**Authority baseline:** `eac62dafeb0c84406f9f69d0a5f4870578254d91`

## 1. Decision

Dungeon Cortex will enforce an SRD-shaped combat action policy rather than
continuing to let ability checks and equipment changes bypass initiative and
turn cost.

- Every in-combat ability check and equipment change requires the player's
  current initiative slot.
- An allowed in-combat ability check consumes the action and ends the turn.
- A check whose success requires mechanical state that the backend does not
  represent is refused before rolling, logging, emitting an event, or
  narration.
- A check whose execution requires unrepresented combat movement is refused
  before rolling, logging, emitting an event, or narration.
- Body armour cannot be changed during combat.
- Donning a shield consumes the action. Replacing one shield with another is
  unsupported because doffing and donning each require an action.
- Drawing, stowing, donning, or removing a weapon or accessory consumes the
  turn's one free object interaction when available. A second interaction
  consumes the action and ends the turn.
- The backend, never the intent parser or narrator, owns every cost,
  transition, refusal, and persisted fact.

This is the granular option selected for DC-AUD-016. The selected failure
policy is fail-closed for unrepresented effects.

## 2. Authority and evidence

The applicable authority order is:

1. the active DC-AUD-016 instruction and the selected granular/fail-closed
   decisions;
2. `docs/DECISION_5E_SRD_API.md`;
3. `MASTER_ARCH_GUIDE.md`;
4. `PROJECT_CONTEXT.md`;
5. the current implementation and tests;
6. historical material.

SRD 5.1 establishes the relevant costs:

- a creature normally acts on its own turn;
- Hide and Search are actions;
- grappling and shoving are special melee attacks made through the Attack
  action;
- stabilising a creature uses an action and a DC 10 Wisdom (Medicine) check;
- one object interaction is free during a turn and a second requires the
  action;
- drawing or sheathing a sword is an object interaction;
- light, medium, and heavy armour take minutes to don or doff;
- donning or doffing a shield takes one action.

The project's primary external data boundary remains
<https://www.dnd5eapi.co/api>. The checked-in 2014 combat extract at
`docs/reference/srd/Combat/Combat.md` carries the turn, interaction, Hide,
Search, grapple, shove, and stabilisation rules used here. The official SRD 5.1
PDF corroborates those rules and supplies the don/doff timing table that the
project's cached equipment rows do not duplicate:
<https://media.wizards.com/2016/downloads/DND/SRD-OGL_V5.1.pdf>.

Authority-baseline evidence at
`eac62dafeb0c84406f9f69d0a5f4870578254d91`, before 016A:

- `app/api/campaign/[id]/action/route.ts` gated only attack, spell, and item use
  through `playerTurnRefusal`.
- Its ability-check gate rolled, wrote a user log and system log, emitted
  `ABILITY_CHECK_RESOLVED`, and left the turn unchanged.
- Its equipment gate immediately swapped the target slot in a transaction and
  left the turn unchanged.
- `Combatant.actionBudget` is nullable JSON with no reachable production
  initializer, reader, writer, reset, or validated shape.
- `Encounter.currentTurnMovementSpentFt` already establishes that budget owned
  by the current initiative slot belongs on `Encounter` and is reset by the
  turn transition.
- `finalizeEncounterTurn` supported fail-closed CAS semantics, but attack,
  spell, and item callers did not request them consistently. The default rebase
  could reinterpret a losing action as a transition from a later turn.

### 2.1 Implementation status

DC-PLAN-016A was implemented and locally validated on 2026-09-11. The current
delivery branch enforces player-turn ownership for combat checks, resolves only
the checks whose movement/effects are represented, ends the turn for an allowed
check, and makes End Turn, macro/parsed attacks, combat spells, combat item use,
and combat checks claim the observed turn fail closed in their owning
transaction. Real PostgreSQL races prove exactly one winner for End Turn versus
End Turn, an allowed check, or a weapon attack.

DC-PLAN-016B is implemented by the combat equipment transition. Its persisted
Encounter field, pure cost matrix, Character-first lock, conditional budget or
turn claim, inventory mutation, and canonical log form one atomic boundary.
`Combatant.actionBudget` remains dormant and is not authority.

## 3. Scope

### In scope

- in-combat policy for every current `ability_check` produced by
  `matchImprovisedAction`;
- in-combat policy for the current `equip` intent;
- one persisted free-object-interaction bit owned by the active encounter
  turn;
- atomic GameLog, resource/effect, equipment, and turn claims;
- fail-closed concurrency for all existing player actions that spend and end a
  turn, because the new action types share that transition boundary;
- route, rules, database transition, architecture, unit, integration, and
  PostgreSQL E2E coverage;
- architecture documentation needed to make the new contract discoverable.

### Out of scope

- `EncounterMap`, persisted map dimensions, Zone, or `zoneId`;
- Extra Attack, bonus actions, reactions, readied actions, multi-turn
  activities, or a general action-economy engine;
- implementing grappled, hidden, prone, stable, mount, broken-object,
  transferred-item, disguise, or other missing effect state;
- implementing vertical movement, swimming, climbing, terrain, or mounted
  movement;
- changing the current out-of-combat abstraction that equips an owned item
  immediately;
- reviving or removing `Combatant.actionBudget`;
- resolving unrelated dead services or dormant mechanics.

## 4. Ability-check policy

### 4.1 Rules metadata

`ImprovisedAction` will receive explicit combat metadata owned by
`lib/rules/improvised-actions.ts`:

```ts
type ImprovisedCombatCost = "action" | "attack" | "movement";
type ImprovisedCombatResolution = "check" | "unsupported";

interface ImprovisedCombatPolicy {
  readonly cost: ImprovisedCombatCost;
  readonly resolution: ImprovisedCombatResolution;
  readonly refusalCode?:
    | "COMBAT_EFFECT_UNSUPPORTED"
    | "COMBAT_MOVEMENT_CHECK_UNSUPPORTED";
}
```

Every table entry must carry a policy. Patterns that currently group verbs
with different policies will be split. Tests will bind table exhaustiveness,
unique matching, and route consumption.

The intent parser will continue to report only the matched skill, difficulty
band, and optional target. It will not carry or decide the combat policy. The
route re-matches the same normalised input against the rules table.

### 4.2 Current verb disposition

| Family | Cost when implemented | DC-AUD-016 result in combat |
| --- | --- | --- |
| listen, spot, notice, watch, peek | action | Resolve check; end turn |
| examine, inspect, study, search, investigate, analyse | action | Resolve check; end turn |
| track, navigate | action | Resolve check; end turn |
| persuade, convince, plead, negotiate | action | Resolve check; end turn |
| lie, deceive, bluff, trick | action | Resolve check; end turn |
| intimidate, threaten, menace, scare | action | Resolve check; end turn |
| climb, jump, leap, swim | movement | Refuse movement unsupported |
| tumble, balance, vault, somersault | movement | Refuse movement unsupported |
| drag | movement | Refuse effect unsupported; grapple/moved-target state is absent |
| ride | movement | Refuse effect unsupported; mount state is absent |
| push, shove, grapple, wrestle | attack | Refuse effect unsupported |
| force, pry, break, smash, lift, disarm | action | Refuse effect unsupported |
| pickpocket, steal, palm, swipe | action | Refuse effect unsupported |
| sneak, creep, skulk, hide, slip past | action | Refuse effect unsupported |
| forage | action | Refuse effect unsupported |
| heal, treat, bandage, stabilise | action | Refuse effect unsupported |
| calm, tame, soothe | action | Refuse effect unsupported |
| disguise | action | Refuse effect unsupported |
| Dodge phrasing | action | Refuse effect unsupported; never roll Acrobatics |

English and Spanish patterns receive the same policy. The existing outside-
combat check behaviour is not broadened by this decision.

### 4.3 Route precedence and response contract

For an ability-check intent while an encounter is active:

1. validate encounter turn state and require the player initiative slot;
2. resolve combat policy from the rules table;
3. refuse unsupported movement/effects;
4. only then resolve the check transactionally.

Stable responses:

| Condition | HTTP | Code | Side effects |
| --- | ---: | --- | --- |
| Initiative slot is not the player's | 409 | `NOT_PLAYER_TURN` | None |
| Encounter turn state is invalid | 409 | existing turn-authority code | None |
| Movement is not representable | 400 | `COMBAT_MOVEMENT_CHECK_UNSUPPORTED` | None |
| Required effect state is absent | 400 | `COMBAT_EFFECT_UNSUPPORTED` | None |
| Turn changes during resolution | 409 | `TURN_STATE_CONFLICT` | Transaction rolls back |

Refusals occur before random rolls, resource use, GameLog, GameEvent, turn
advance, or narration. Action receipts settle and replay through the existing
rejected/completed contract.

### 4.4 Atomic allowed check

An allowed in-combat check runs in one transaction:

1. lock the canonical `Character` row using the existing combat lock order;
2. re-read the character fields and inventory that determine modifiers;
3. resolve the check from backend state;
4. call `finalizeEncounterTurn` with fail-closed stale-turn semantics;
5. if the CAS loses, abort the transaction with a typed conflict;
6. write the user and resolved system GameLog rows in the same transaction;
7. after commit, emit `ABILITY_CHECK_RESOLVED` and the turn event before
   narration.

Outside combat, the present check pipeline remains non-turn-bound.

## 5. Shared turn-spending transaction safety

Adding another turn-ending action exposes an existing unsafe shared default:
attack, spell, and item finalizers may rebase a failed round/index proposal
onto a later turn. The correction is part of this authority boundary, not a
separate refactor.

Every player-requested action that ends a turn will:

- pass fail-closed stale-turn semantics to `finalizeEncounterTurn`;
- convert `turnAdvanceConflict` to a typed transaction abort;
- return HTTP 409 / `TURN_STATE_CONFLICT`;
- keep the canonical user GameLog and every related system GameLog inside the
  same transaction as effects, resources, and the turn claim;
- publish no event or narration for a rolled-back action.

The resolved-encounter claim must also respect the caller's expected
round/index when fail-closed semantics are requested. A transaction that loses
either the active-to-resolved claim or the turn claim owns no effects.

This preserves the established lock order. The change does not add an early
Encounter lock ahead of Character/Combatant locks, avoiding a cycle with Move's
Combatant-to-Encounter transition.

## 6. Equipment policy

### 6.1 Persisted turn field

Add one nullable field:

```prisma
model Encounter {
  currentTurnObjectInteractionUsed Boolean?
}
```

Semantics:

- `false`: the active initiative slot still owns its free object interaction;
- `true`: it has been consumed;
- `null`: legacy/unknown state; any equipment operation that needs to know the
  free interaction fails closed;
- every newly created encounter explicitly writes `false`;
- every successful turn advance resets it to `false` in the same Encounter CAS
  that resets movement.

`Combatant.actionBudget` remains untouched. Reusing it was rejected because it
is unvalidated JSON, has never had a lifecycle, and is scoped to combatants
rather than the authoritative current-turn state.

### 6.2 Combat equipment matrix

The transition re-reads the target item and current slot occupancy under the
canonical Character lock. A context snapshot never authorises the mutation.

| Target and current state | Cost/result |
| --- | --- |
| Body armour | Refuse; armour must be changed outside combat |
| Shield, OFF_HAND empty | Don using the action; equip and end turn |
| Shield, OFF_HAND occupied by another item | Refuse; doff plus don requires two actions/multiple turns |
| Weapon/accessory already equipped in its canonical slot | Refuse as already equipped; spend nothing |
| Weapon/accessory, slot empty, interaction `false` | Claim interaction `false -> true`; equip; remain on turn |
| Weapon/accessory, slot empty, interaction `true` | Equip using the action; end turn |
| Weapon/accessory, slot occupied, interaction `false` | Free interaction plus action; swap and end turn |
| Weapon/accessory, slot occupied, interaction `true` | Refuse; the request needs more interaction capacity than remains |
| Weapon/accessory and interaction `null` | Refuse budget unavailable |

A shield action does not depend on the free-interaction bit, so a legacy
`null` does not make an otherwise legal shield don unsafe. Its successful turn
advance initializes the next turn to `false`.

### 6.3 Stable equipment responses

| Condition | HTTP | Code |
| --- | ---: | --- |
| Initiative slot is not the player's | 409 | `NOT_PLAYER_TURN` |
| Body armour during combat | 409 | `EQUIP_REQUIRES_OUT_OF_COMBAT` |
| Doff plus don cannot complete this turn | 409 | `EQUIPMENT_CHANGE_REQUIRES_MULTIPLE_TURNS` |
| Target is already equipped | 409 | `ITEM_ALREADY_EQUIPPED` |
| Legacy interaction state is unknown | 409 | `OBJECT_INTERACTION_BUDGET_UNAVAILABLE` |
| Inventory/slot/turn/budget changed concurrently | 409 | `EQUIPMENT_STATE_CONFLICT` |

Each refusal has no GameLog, item mutation, object-interaction claim, turn
advance, event, or narration.

### 6.4 Equipment transition ownership

A dedicated database transition module will own the write sequence. Pure
equipment policy remains in `lib/rules`; the action route maps input and output
but does not derive SRD cost.

Transaction order:

1. lock `Character`;
2. re-read the owned target item and current canonical slot occupancy;
3. recompute the pure cost decision;
4. either claim `currentTurnObjectInteractionUsed = false -> true`, or claim
   the turn transition with fail-closed CAS;
5. clear/equip the relevant inventory rows;
6. write the canonical user GameLog;
7. commit, then emit `EQUIP_ITEM` and any turn event.

Any failed conditional claim aborts the whole transaction. Two equip requests
cannot both observe an empty slot; equip versus Attack/End Turn cannot commit
two turn-ending transitions; Move remains compatible with the existing
Character/Combatant/Encounter lock order.

## 7. Migration and rollout

The migration is additive, hand-written, and never run against the private
save by Codex.

- Add nullable `BOOLEAN` with `ADD COLUMN IF NOT EXISTS` inside the repository's
  established guarded migration shape.
- Do not add a database default.
- Do not backfill existing encounters. `false` would falsely claim that a
  possibly mid-turn legacy encounter has not used its interaction.
- Run `prisma generate` after editing the schema; this does not touch a
  database.

Required production ordering:

1. apply the additive migration;
2. deploy the new application/client;
3. drain every older application instance before declaring enforcement live.

The new application selects and writes the new column, so application-first is
unsafe. Older instances ignore the additive column, so migration-first is
database compatible. During a rolling overlap, an older instance can still
perform legacy instant equipment changes or advance a turn without resetting
the new bit; draining it is therefore part of the behavioural rollout
contract.

Disposable validation ordering:

1. provision PostgreSQL plus pgvector with a database name containing `e2e` or
   `test`;
2. verify `DATABASE_URL`, `DIRECT_URL`, and `E2E_TEST_MODE=true`;
3. deploy every migration from zero;
4. build and run the production server;
5. run the full Playwright suite, including concurrency cases;
6. remove the disposable server/container and volume.

## 8. Delivery sequence

### DC-PLAN-016A — Ability-check and shared turn-claim authority

- add RED policy/route/concurrency tests;
- add and consume exhaustive improvised-combat metadata;
- enforce player-turn ownership and fail-closed unsupported categories;
- make allowed checks turn-ending and transactional;
- make every existing player turn-spending action fail closed on a stale CAS;
- move any canonical logs still outside those transactions into them;
- falsify each important policy and transaction guard;
- run focused and full validation;
- obtain independent review, commit, push, PR, pre-merge CI, guarded squash
  merge, post-merge CI, local synchronization, and PR #169 evidence.

This stage has no schema change.

### DC-PLAN-016B — Persisted object interaction and equipment transition

- add RED pure-policy, route, database-transition, schema, migration, and real
  PostgreSQL concurrency tests;
- add the nullable Encounter field and hand-written additive migration;
- initialize new encounters and reset the field in every turn advance;
- implement the pure equipment cost resolver and atomic database transition;
- enforce the combat matrix while preserving out-of-combat behaviour;
- run `prisma generate` and complete disposable-database/Playwright validation;
- falsify each important cost, reset, and CAS guard;
- obtain independent review, commit, push, PR, pre-merge CI, guarded squash
  merge, post-merge CI, local synchronization, and PR #169 evidence.

After both stages:

- add the final evidence map to PR #169;
- verify corresponding master CI;
- close PR #169 unmerged while preserving its branch as RED history;
- run a fresh current-master priority audit without automatically refactoring.

## 9. Required verification

For each stage:

- focused Vitest suites with exact file/test counts;
- deliberate falsification of every important new assertion;
- `pnpm typecheck`;
- `pnpm lint`;
- `pnpm exec vitest run --maxWorkers=2`;
- `pnpm build`;
- `pnpm check-retro`;
- `pnpm exec prisma validate`;
- `git diff --check`;
- independent review with explicit findings or no-findings result.

For 016B, additionally:

- fresh disposable PostgreSQL/pgvector;
- all migrations applied from zero and reported exactly;
- full Playwright suite with exact counts;
- real concurrency tests for equip/equip, equip/End Turn, and equip/another
  turn-spending action;
- disposable infrastructure removed afterward.

The pre-016A RED cases were:

- an ability check succeeded during an enemy initiative slot;
- an allowed ability check did not advance the turn;
- Hide rolled and narrated despite absent hidden state;
- two different turn-spending actions could reinterpret a stale turn.

The remaining 016B RED baseline is:

- equipment currently succeeds off-turn and costs nothing;
- body armour currently changes instantly during combat;
- no persisted free-object-interaction claim or reset currently exists.

## 10. Rejected alternatives

### Reuse `Combatant.actionBudget`

Rejected. Its JSON shape is unenforced, no producer or consumer exists, it has
no reset lifecycle, and per-combatant storage disagrees with the established
Encounter-owned current-turn movement authority. Reviving it would require a
larger action-economy design than DC-AUD-016.

### Keep interaction state only in memory or in the request receipt

Rejected. It would not coordinate application instances or concurrent
requests and would not survive process restart.

### Treat every check and equipment change as a whole-turn action

Rejected by the selected granular policy. It would avoid a field but erase the
SRD's one free object interaction and make drawing a weapon equivalent to
donning a shield.

### Allow roll-only results for missing effects

Rejected by the selected fail-closed policy. It would let narration claim
grappled, hidden, stable, transferred, or broken state that the backend neither
stored nor enforced.
