# DC-AUD-016 Combat Action Policy Implementation Plan

> **Execution rule:** Follow this plan with test-driven development. Do not
> write production code for a task until its named RED test has failed for the
> expected missing behavior. Deliberately falsify each important new guard
> before calling it covered.

**Goal:** Make in-combat ability checks and equipment changes obey the
player's initiative slot and their SRD-shaped costs, with atomic persistence,
stable fail-closed refusals, and real PostgreSQL concurrency evidence.

**Architecture:** Rules modules own pure policy; the action route owns request
orchestration and response mapping; database transition code owns conditional
writes. A turn-ending player action must commit its effects, resources,
GameLogs, and one fail-closed Encounter turn CAS as a single transaction.
Object-interaction state is a nullable field on the active Encounter turn and
is never inferred by the AI layer.

**Tech stack:** Next.js App Router, TypeScript, Prisma, PostgreSQL 16 with
pgvector, Vitest, Playwright, pnpm.

**Design authority:**
`docs/plans/2026-09-10-dc-aud-016-combat-action-policy-design.md`

## Global execution constraints

- Work from the fetched and independently verified GitHub `master` SHA.
- Require no unrelated worktree changes before every branch/merge boundary.
- Preserve PR #169, all named historical branches, both preserved stashes, and
  `D:\dc-wt\safe-turbo` until the final PR #169 disposition step.
- Never merge PR #169.
- Never apply a migration to the private save.
- Use `pnpm exec vitest run --maxWorkers=2`, never plain `pnpm test`.
- Use hand-written migrations and run them only against a verified disposable
  database with `E2E_TEST_MODE=true`.
- Commit narrowly, squash-merge each PR, validate the exact pushed head, wait
  for pre-merge and post-merge Verify/E2E smoke, then synchronize local
  `master` to clean 0/0 state.
- Do not mix the post-DC-AUD-016 priority audit into either correction PR.

---

# Stage 1 — DC-PLAN-016A

## Ability-check policy and fail-closed turn claims

**Branch:** `codex/dc-plan-016a-combat-check-policy`

**Schema impact:** None.

### Task 1: Pin exhaustive improvised combat policy

**Files:**

- Modify: `tests/rules/improvised-actions.test.ts`
- Modify: `tests/rules/contested-checks.test.ts`
- Modify: `tests/ai/intent.test.ts`
- Modify: `lib/rules/improvised-actions.ts`

**Step 1 — Write RED rules tests**

Add table-driven assertions that every `IMPROVISED_ACTIONS` entry has:

```ts
combat: {
  cost: "action" | "attack" | "movement";
  resolution: "check" | "unsupported";
  refusalCode?:
    | "COMBAT_EFFECT_UNSUPPORTED"
    | "COMBAT_MOVEMENT_CHECK_UNSUPPORTED";
}
```

Pin representative English and Spanish inputs for every disposition from the
approved design. Add strict cases proving:

- Search/Perception, Investigation, track/navigate, Persuasion, Deception, and
  Intimidation are action checks;
- climb/jump/swim and acrobatic traversal are movement-unsupported;
- grapple/shove, physical state changes, theft, Hide, forage, Medicine,
  Animal Handling, ride, disguise, and Dodge are effect-unsupported;
- Dodge never becomes an allowed Acrobatics check in combat;
- mixed current regex families are split without losing target extraction or
  bilingual behavior;
- no two entries accept the same representative verb.

**Step 2 — Demonstrate RED**

Run:

```powershell
pnpm exec vitest run tests/rules/improvised-actions.test.ts tests/rules/contested-checks.test.ts tests/ai/intent.test.ts --maxWorkers=2
```

Record the exact failures showing that combat metadata does not yet exist and
mixed patterns do not expose separable policy.

**Step 3 — Implement the smallest pure policy**

Add exported literal types and `ImprovisedCombatPolicy` to
`lib/rules/improvised-actions.ts`. Make `combat` required on every entry. Split
only patterns whose verbs need different combat metadata; preserve skill,
difficulty, opposition, bilingual matching, normalization, and target
extraction.

The parser continues to emit only intent classification, skill, band, and
target. Do not copy combat cost into `lib/ai/intent.ts`.

**Step 4 — Verify GREEN and falsify**

Run the same focused command. Then deliberately:

1. change one allowed action to `unsupported` and prove its policy assertion
   fails;
2. change one unsupported effect to `check` and prove its assertion fails;
3. change one movement refusal code to the effect code and prove its assertion
   fails;
4. overlap two representative verbs and prove the uniqueness assertion fails.

Restore each mutation and rerun GREEN.

**Step 5 — Commit checkpoint**

```powershell
git add lib/rules/improvised-actions.ts tests/rules/improvised-actions.test.ts tests/rules/contested-checks.test.ts tests/ai/intent.test.ts
git commit -m "test: define improvised combat policy"
```

### Task 2: Require player-turn authority and refuse unsupported checks

**Files:**

- Create: `tests/api/action-combat-check-policy.test.ts`
- Modify: `app/api/campaign/[id]/action/route.ts`

**Step 1 — Write RED route tests using the real classifier**

Build route tests that mock external I/O but do not mock
`@/lib/ai/intent`. Assert:

- `I inspect the room` during an enemy initiative slot returns 409 /
  `NOT_PLAYER_TURN`;
- invalid encounter turn state retains its existing 409 code;
- `I hide` on the player's turn returns 400 /
  `COMBAT_EFFECT_UNSUPPORTED`;
- `I climb the wall` returns 400 /
  `COMBAT_MOVEMENT_CHECK_UNSUPPORTED`;
- refused requests do not call `resolveAbilityCheck`, write GameLog, emit
  events, start narration, or advance the turn;
- equivalent Spanish phrases reach the same codes;
- outside an encounter, the existing ability-check behavior remains
  available.

**Step 2 — Demonstrate RED**

```powershell
pnpm exec vitest run tests/api/action-combat-check-policy.test.ts --maxWorkers=2
```

Record that off-turn checks currently pass and unsupported checks currently
roll/log.

**Step 3 — Implement policy precedence**

Extend the central player-turn gate to include in-combat `ability_check`.
Before calculating modifiers or rolling, re-match the normalized input and
read `action.combat` from the rules table. Map unsupported policy to the two
stable 400 responses. Do not accept cost or availability from the intent
object.

If an `ability_check` intent cannot re-match the rules table, fail closed as
mechanically ambiguous rather than guessing policy.

**Step 4 — Verify GREEN and falsify**

Run the focused test. Then bypass each guard in isolation:

- remove `ability_check` from player-turn gating;
- force `resolution: "check"` for Hide;
- force `cost: "action"` for climb.

Each named test must turn RED independently. Restore and rerun GREEN.

**Step 5 — Commit checkpoint**

```powershell
git add 'app/api/campaign/[id]/action/route.ts' tests/api/action-combat-check-policy.test.ts
git commit -m "fix: gate combat checks by turn and policy"
```

### Task 3: Make an allowed combat check atomically spend the turn

**Files:**

- Modify: `tests/api/action-combat-check-policy.test.ts`
- Modify: `tests/api/action.test.ts`
- Modify: `app/api/campaign/[id]/action/route.ts`
- Optionally create if separation is needed:
  `lib/db/combat-check-transition.ts`
- Optionally create matching test:
  `tests/db/combat-check-transition.test.ts`

**Step 1 — Write RED atomicity tests**

Assert that an allowed combat check:

- locks the canonical Character before reading modifier-bearing character and
  inventory state;
- resolves exactly once from the re-read backend state;
- calls `finalizeEncounterTurn` for the observed encounter round/index with
  fail-closed stale-turn behavior;
- persists the user row and the resolved system row on the transaction client,
  not global Prisma;
- emits `ABILITY_CHECK_RESOLVED` followed by the one turn/round event only
  after commit;
- marks the request receipt completed through the existing wrapper;
- returns 409 / `TURN_STATE_CONFLICT` and leaves no logs/events/narration when
  the turn CAS loses.

Update existing ability-check expectations that currently assume the turn is
unchanged.

**Step 2 — Demonstrate RED**

```powershell
pnpm exec vitest run tests/api/action-combat-check-policy.test.ts tests/api/action.test.ts --maxWorkers=2
```

**Step 3 — Implement one transaction**

Move the in-combat check's authoritative re-read, roll, turn claim, user log,
and system log into one Prisma transaction. Use the existing Character-first
combat lock order. On `turnAdvanceConflict`, throw a typed error so Prisma
rolls back the whole transaction, then map it to the stable 409 response.

Keep the outside-combat branch behavior unchanged. Accumulate events locally
but publish them only after a successful commit.

**Step 4 — Verify GREEN and falsify**

Run the focused command. Separately delete or bypass:

1. the Character lock;
2. fail-closed finalizer option;
3. typed conflict abort;
4. transactional user log;
5. transactional system log;
6. turn-event publication.

Each corresponding assertion must fail alone. Restore and rerun GREEN.

**Step 5 — Commit checkpoint**

```powershell
git add 'app/api/campaign/[id]/action/route.ts' tests/api/action-combat-check-policy.test.ts tests/api/action.test.ts
git add lib/db/combat-check-transition.ts tests/db/combat-check-transition.test.ts
git commit -m "fix: spend combat-check actions atomically"
```

Omit optional paths from `git add` when no separate module is created.

### Task 4: Make every player turn-spending action fail closed on a stale turn

**Files:**

- Modify: `lib/rules/combat-pipeline.ts`
- Modify: `app/api/campaign/[id]/action/route.ts`
- Modify: `tests/rules/combat-turn-transition-atomicity.test.ts`
- Modify: `tests/rules/combat-pipeline.test.ts`
- Modify: `tests/api/action.test.ts`
- Modify: `tests/api/action-intent-contract.test.ts`
- Modify: `tests/e2e/turn-advance-concurrency.spec.ts`
- Modify: `tests/architecture/combat-character-lock-order.test.ts` if its
  structural contract needs the new transaction shape

**Step 1 — Write RED shared-boundary tests**

Add coverage proving:

- with `failOnStaleTurn: true`, the active-to-resolved Encounter claim includes
  expected round/index;
- losing that resolved claim returns `turnAdvanceConflict: true`;
- macro attack, parsed attack, in-combat spell, and in-combat item use all call
  the finalizer fail closed;
- each caller aborts the transaction on a lost claim;
- macro/parsed attack category logs and use-item user logs are inside the
  transaction;
- no losing action reaches events or narration;
- on real PostgreSQL, allowed ability check versus `End Turn` and weapon attack
  versus `End Turn` each produce exactly one successful turn-ending action,
  one 409 loser, one turn advance, and no effects/logs from the loser.

**Step 2 — Demonstrate RED**

```powershell
pnpm exec vitest run tests/rules/combat-turn-transition-atomicity.test.ts tests/rules/combat-pipeline.test.ts tests/api/action.test.ts tests/api/action-intent-contract.test.ts tests/architecture/combat-character-lock-order.test.ts --maxWorkers=2
```

Then provision the verified disposable PostgreSQL/pgvector environment from
`AGENTS.md`, apply all migrations, build/start production, and run:

```powershell
pnpm exec playwright test tests/e2e/turn-advance-concurrency.spec.ts
```

Record the exact unit and real-database failures before changing production.
Keep this disposable environment only until Task 5 finishes its focused GREEN
and falsification runs.

**Step 3 — Implement fail-closed shared behavior**

In `finalizeEncounterTurn`, add expected round/index to the resolved-encounter
claim only when fail-closed semantics are requested, preserving explicitly
non-player callers that retain bounded rebase behavior.

At all five player turn-spending call sites—macro attack, parsed attack,
in-combat spell, in-combat item, and allowed combat check—pass fail closed and
abort on conflict. Move any remaining canonical logs into their owning
transaction. Set `playerActionLogged` only after commit.

Do not change damage, spell, consumable, XP, loot, concentration, or turn
arithmetic rules.

**Step 4 — Verify GREEN and falsify**

Run the focused command. Mutate each caller's fail-closed flag independently
and prove its caller-specific test fails. Remove round and index from the
resolved claim one at a time and prove both assertions fail. Move one log back
to global Prisma and prove its atomicity test fails.

Restore and rerun GREEN.

**Step 5 — Commit checkpoint**

```powershell
git add lib/rules/combat-pipeline.ts 'app/api/campaign/[id]/action/route.ts' tests/rules/combat-turn-transition-atomicity.test.ts tests/rules/combat-pipeline.test.ts tests/api/action.test.ts tests/api/action-intent-contract.test.ts tests/architecture/combat-character-lock-order.test.ts
git commit -m "fix: reject stale player turn actions"
```

### Task 5: Prove cross-action concurrency on PostgreSQL

**Files:**

- Modify: `tests/e2e/turn-advance-concurrency.spec.ts`

**Step 1 — Verify the prewritten races GREEN**

Using the disposable environment retained from Task 4, run:

```powershell
pnpm exec playwright test tests/e2e/turn-advance-concurrency.spec.ts
```

For each race, confirm exactly one success, one 409 /
`TURN_STATE_CONFLICT`, one initiative advance, one canonical user row, no
losing system row/effect, and at most one turn event.

**Step 2 — Make only the minimum concurrency adjustments if needed**

Fix transaction/conflict mapping revealed by the real race. Preserve the
Character -> Combatant -> Encounter and Combatant -> Encounter lock orders; do
not add a broad serializable transaction or an Encounter lock ahead of those
rows.

**Step 3 — Falsify the real guards**

Run the focused Playwright spec. Revert the fail-closed flag for each raced
action independently and demonstrate the relevant race fails or double-
commits. Restore and rerun GREEN.

**Step 4 — Remove disposable infrastructure**

Stop the test server and remove the verified disposable container and its
volume. Confirm no test server or container remains.

**Step 5 — Commit checkpoint**

```powershell
git add tests/e2e/turn-advance-concurrency.spec.ts
git commit -m "test: prove cross-action turn concurrency"
```

### Task 6: Update current architecture truth

**Files:**

- Modify: `MASTER_ARCH_GUIDE.md`
- Modify:
  `docs/plans/2026-09-10-dc-aud-016-combat-action-policy-design.md`
- Add/modify any focused architecture test that guards the new documented
  contract

**Step 1 — Write a characterization architecture assertion**

Add a focused assertion that current player turn-spending gates include
ability checks and request fail-closed finalization. It must inspect behavior
or exact call structure, not only search for a symbol.

**Step 2 — Falsify before trusting it**

Run the new architecture test alone; it may start GREEN because the production
correction already exists. Temporarily remove `ability_check` from the turn
gate and then disable one caller's fail-closed finalizer option. Prove the
relevant assertion turns RED for each mutation, restore, and rerun GREEN.

**Step 3 — Update documentation**

Document:

- allowed combat checks are player-turn actions;
- unrepresented movement/effects fail closed;
- all player turn-ending actions use an atomic fail-closed transition;
- `Combatant.actionBudget` remains dormant and is not authority;
- equipment object-interaction delivery remains pending 016B until merged.

Mark the design's implementation status as 016A delivered only after code and
tests are green.

**Step 4 — Verify documentation and contract**

Run the architecture test and `pnpm check-retro`. Review the documentation
against the exact current diff rather than treating names as proof.

**Step 5 — Commit checkpoint**

```powershell
git add MASTER_ARCH_GUIDE.md docs/plans tests/architecture
git commit -m "docs: record combat-check action authority"
```

### Task 7: Validate the exact 016A head

**Step 1 — Focused suites**

Run every file changed or directly guarding the changed behavior. Report exact
file and test counts.

**Step 2 — Full required validation**

```powershell
pnpm typecheck
pnpm lint
pnpm exec vitest run --maxWorkers=2
pnpm build
pnpm check-retro
pnpm exec prisma validate
git diff --check
```

If machine contention causes a timeout, rerun that file alone. Treat any
assertion failure as a defect, not contention.

**Step 3 — Full disposable PostgreSQL Playwright**

Provision a fresh pgvector/PostgreSQL database, verify its name includes
`e2e`/`test`, verify both URLs and `E2E_TEST_MODE=true`, apply every migration,
build/start production, and run:

```powershell
pnpm test:e2e
```

Report exact migration and Playwright counts. Remove server, container, and
volume afterward.

**Step 4 — Independent review**

Request an independent review of the exact diff with emphasis on:

- Code-is-Law boundary;
- rollback completeness;
- lock order and stale-turn races;
- classifier/rules consistency;
- tests that can actually fail;
- scope control and no 016B/schema leakage.

Resolve findings with new RED tests where applicable, then rerun proportional
and full validation.

### Task 8: Deliver and merge 016A

**Step 1 — Verify branch state**

Require a clean worktree and record exact branch head SHA. Review the diff
against current `origin/master` line by line.

**Step 2 — Push and open PR**

```powershell
git push -u origin codex/dc-plan-016a-combat-check-policy
gh pr create --base master --head codex/dc-plan-016a-combat-check-policy
```

Include RED evidence, falsification results, focused/full counts, database
safety, rollout statement (no schema change), and reviewer outcome.

**Step 3 — Validate CI and merge guard**

Wait for Verify and E2E smoke. Re-fetch and confirm:

- current GitHub master SHA;
- PR base is `master`;
- PR head is the exact validated SHA;
- no open PR is based on the 016A branch;
- PR #169 remains open, draft, and unmerged.

Squash-merge only with the exact-head guard. Do not merge PR #169.

**Step 4 — Post-merge proof**

Wait for master Verify and E2E smoke. Synchronize local `master`, require clean
0/0 divergence, then add an evidence comment to PR #169 with PR URL, validated
head, squash SHA, CI URLs, counts, and behavior contract.

---

# Stage 2 — DC-PLAN-016B

## Persisted object interaction and equipment transition

**Branch:** `codex/dc-plan-016b-equipment-action-economy`

**Schema impact:** Additive nullable Encounter column. Migration-first rollout
is mandatory.

### Task 9: Start 016B from the verified 016A master merge

**Step 1 — Reverify GitHub and local state**

Fetch/prune. Require local `master`, `origin/master`, and the GitHub API master
SHA to match, with 0/0 divergence and a clean tree.

**Step 2 — Create the fresh branch**

```powershell
git switch -c codex/dc-plan-016b-equipment-action-economy
```

Record the base SHA. Confirm no 016A feature branch is the PR base.

### Task 10: Define the pure combat-equipment cost matrix

**Files:**

- Create: `lib/rules/combat-equipment.ts`
- Create: `tests/rules/combat-equipment.test.ts`
- Reuse without changing authority: `lib/rules/equipment-slot.ts`

**Step 1 — Write RED pure-policy tests**

Table-test every row of the approved matrix:

- body armour refusal;
- shield in empty OFF_HAND spends action;
- shield replacement refuses multiple turns;
- weapon/accessory already equipped refusal;
- empty slot with `false`, `true`, and `null` interaction state;
- occupied slot with `false`, `true`, and `null` interaction state;
- accessories and weapons share interaction costs but retain canonical slots;
- malformed armour metadata still routes through the existing fail-safe
  ACCESSORY decision;
- the function is pure and derives no facts from names/descriptions.

Use a discriminated result such as:

```ts
type CombatEquipmentDecision =
  | { ok: true; mode: "interaction" | "action"; endsTurn: boolean }
  | { ok: false; code: EquipmentRefusalCode };
```

**Step 2 — Demonstrate RED**

```powershell
pnpm exec vitest run tests/rules/combat-equipment.test.ts tests/rules/equipment-slot.test.ts --maxWorkers=2
```

**Step 3 — Implement minimum pure resolver**

Implement policy from structural item/slot facts only. Do not import Prisma,
AI, route, or narration modules.

**Step 4 — Verify GREEN and falsify**

Flip each matrix branch one at a time—especially shield versus weapon, empty
versus occupied, and `false` versus `true`—and prove a distinct assertion
fails. Restore and rerun GREEN.

**Step 5 — Commit checkpoint**

```powershell
git add lib/rules/combat-equipment.ts tests/rules/combat-equipment.test.ts tests/rules/equipment-slot.test.ts
git commit -m "feat: define combat equipment costs"
```

### Task 11: Add the nullable Encounter interaction field and safe migration

**Files:**

- Modify: `prisma/schema.prisma`
- Create:
  `prisma/migrations/20260910200000_add_current_turn_object_interaction/migration.sql`
- Create:
  `tests/architecture/combat-object-interaction-schema.test.ts`
- Modify: `lib/memory/context.ts`
- Modify: `app/api/campaign/[id]/encounter/route.ts`
- Modify: `lib/rules/encounter-service.ts`
- Modify: `lib/rules/combat-pipeline.ts`
- Modify all directly affected fixtures/expectations in:
  `tests/api/action.test.ts`, `tests/api/action-move-macro.test.ts`,
  `tests/memory/formatter.test.ts`,
  `tests/rules/combat-turn-transition-atomicity.test.ts`,
  `tests/rules/combat-pipeline.test.ts`,
  `tests/rules/encounter-service-contract.test.ts`, and encounter-route tests

**Step 1 — Write RED schema/lifecycle tests**

Assert:

- Prisma exposes `currentTurnObjectInteractionUsed Boolean?` on Encounter;
- migration adds a nullable Boolean with `IF NOT EXISTS`;
- migration contains no `DEFAULT`, backfill, destructive statement, Zone, or
  EncounterMap;
- every reachable encounter producer explicitly initializes `false`;
- every production and reduced-test-double turn advance resets `false` in the
  same write as round/index and movement;
- context selects and types `boolean | null` without exposing it as narrated
  flavor.

**Step 2 — Demonstrate RED**

```powershell
pnpm exec vitest run tests/architecture/combat-object-interaction-schema.test.ts tests/rules/combat-turn-transition-atomicity.test.ts tests/rules/combat-pipeline.test.ts tests/rules/encounter-service-contract.test.ts --maxWorkers=2
```

**Step 3 — Write migration and schema by hand**

Follow the current migration guard/comment style. Add only the nullable column;
do not use `prisma migrate dev`, do not connect to the private save, and do not
invent a default for legacy active turns.

Update context, both encounter producers, and every finalizer update. Then run:

```powershell
pnpm exec prisma generate
```

**Step 4 — Verify GREEN and falsify**

Run the focused command. Delete each producer initialization and each reset
site independently and prove its assertion fails. Add a temporary default or
backfill to the migration and prove the safety test fails. Restore and rerun
GREEN.

**Step 5 — Commit checkpoint**

```powershell
git add prisma/schema.prisma prisma/migrations/20260910200000_add_current_turn_object_interaction/migration.sql lib/memory/context.ts 'app/api/campaign/[id]/encounter/route.ts' lib/rules/encounter-service.ts lib/rules/combat-pipeline.ts tests
git commit -m "feat: persist turn object interaction"
```

### Task 12: Implement the atomic equipment database transition

**Files:**

- Create: `lib/db/equipment-transition.ts`
- Create: `tests/db/equipment-transition.test.ts`
- Reuse: `tests/e2e/equipment-action-economy.spec.ts` written RED in Task 12
- Reuse: `lib/rules/combat-equipment.ts`
- Reuse: `lib/rules/combat-pipeline.ts`

**Step 1 — Write RED transition tests**

Create transaction doubles that model Character lock, target item re-read,
slot occupancy, Encounter CAS, inventory updates, GameLog, and turn finalizer.
Assert:

- Character is locked before item/slot reads;
- ownership and canonical slot are revalidated inside the transaction;
- free interaction uses one conditional Encounter update matching id, active
  status, expected round/index, and `currentTurnObjectInteractionUsed: false`;
- action-cost paths claim the turn fail closed;
- inventory clear/equip and user log occur only after an owned claim and on the
  same transaction client;
- a lost interaction/turn claim throws a typed conflict so earlier writes roll
  back;
- body-armour, multiple-turn, already-equipped, and null-budget refusals do no
  writes;
- out-of-combat equipment preserves the existing immediate atomic swap without
  consulting Encounter state;
- returned events describe only committed mutations.

At the same time, write the complete real-PostgreSQL lifecycle and race cases
listed in Task 14. They must exist before the route/database correction.

**Step 2 — Demonstrate RED**

```powershell
pnpm exec vitest run tests/db/equipment-transition.test.ts tests/rules/combat-equipment.test.ts --maxWorkers=2
```

Then provision the verified disposable PostgreSQL/pgvector environment, apply
all migrations, build/start production, and run:

```powershell
pnpm exec playwright test tests/e2e/equipment-action-economy.spec.ts
```

Record the missing module/transition/route behavior that makes the new tests
RED. Keep the disposable environment only through Task 14 focused GREEN and
falsification.

**Step 3 — Implement database ownership**

Add a narrow transition API and typed refusal/conflict result. Keep cost logic
in the pure rules module. Use the established Character `FOR UPDATE` lock,
then re-read inventory. Never authorize a write from `buildCampaignContext`.

For a free interaction, CAS `false -> true`. For an action cost, use the
fail-closed finalizer. Any conflict must abort the caller-owned transaction.
Write the canonical user row in the same transaction.

**Step 4 — Verify GREEN and falsify**

Run the focused command. Independently remove Character locking, slot re-read,
round predicate, index predicate, Boolean predicate, transaction log, and
conflict throw. Each must fail a distinct assertion. Restore and rerun GREEN.

**Step 5 — Commit checkpoint**

```powershell
git add lib/db/equipment-transition.ts tests/db/equipment-transition.test.ts
git commit -m "feat: claim equipment transitions atomically"
```

### Task 13: Route all equipment requests through the new authority

**Files:**

- Modify: `app/api/campaign/[id]/action/route.ts`
- Create: `tests/api/action-equipment-policy.test.ts`
- Modify: `tests/api/action-intent-contract.test.ts`
- Modify: `tests/api/action.test.ts`

**Step 1 — Write RED route tests with the real classifier**

Assert stable HTTP/code and zero side effects for:

- off-turn equip;
- body armour in combat;
- shield replacement;
- already-equipped item;
- unknown legacy interaction budget;
- stale inventory/slot/interaction/turn state.

Assert successful behavior for:

- shield in an empty OFF_HAND equips and ends the turn;
- first empty-slot weapon/accessory equip claims the interaction and remains on
  the turn;
- a later empty-slot equip spends the action and ends the turn;
- replacing a weapon/accessory with the interaction available swaps and ends
  the turn;
- outside-combat equip remains an immediate swap;
- successful requests log once and emit `EQUIP_ITEM` plus a turn event only
  when the cost ends the turn;
- the interaction bit is not supplied by or copied into the intent parser.

**Step 2 — Demonstrate RED**

```powershell
pnpm exec vitest run tests/api/action-equipment-policy.test.ts tests/api/action-intent-contract.test.ts tests/api/action.test.ts --maxWorkers=2
```

**Step 3 — Integrate the transition**

Add in-combat `equip` to central player-turn authority. Replace route-owned
slot clearing with the database transition. Map pure refusals and typed
conflicts to the approved stable codes. Set `playerActionLogged` only after a
successful transaction and publish returned events only after commit.

Do not change `slotFor`, inventory ownership, item effects, AC calculation, or
out-of-combat product behavior except as required to delegate the same atomic
swap.

**Step 4 — Verify GREEN and falsify**

Run the focused command. Bypass each stable refusal and each cost branch in
isolation; each corresponding route assertion must fail. Bypass the central
turn gate and prove the off-turn test fails. Restore and rerun GREEN.

**Step 5 — Commit checkpoint**

```powershell
git add 'app/api/campaign/[id]/action/route.ts' tests/api/action-equipment-policy.test.ts tests/api/action-intent-contract.test.ts tests/api/action.test.ts
git commit -m "fix: enforce combat equipment action costs"
```

### Task 14: Prove equipment lifecycle and races on PostgreSQL

**Files:**

- Create: `tests/e2e/equipment-action-economy.spec.ts`
- Modify: `tests/e2e/turn-advance-concurrency.spec.ts` only if shared lock
  helpers are deliberately extracted
- Modify: `tests/e2e/support/database.ts` only if cleanup needs the new fixture
  shape

**Step 1 — Verify the prewritten real-database coverage GREEN**

On a fresh disposable database, test:

- first free weapon/accessory interaction stays on the same turn and stores
  `true`;
- the next eligible interaction consumes the action and resets the next turn
  to `false`;
- a complete player -> enemy -> player cycle restores the player's free
  interaction;
- null legacy state fails closed for weapon/accessory but permits an otherwise
  legal shield action;
- body armour and shield replacement refuse without mutation/log;
- concurrent equip/equip leaves one canonical slot owner and legal budget;
- concurrent equip/End Turn has exactly one turn-ending winner;
- concurrent equip/Attack cannot commit two turn-ending actions;
- all losing requests leave no GameLog or EQUIP event.

Use deterministic fixtures and assert persisted Encounter and InventoryItem
rows, not only response text.

**Step 2 — Run the focused lifecycle/race spec**

```powershell
pnpm exec playwright test tests/e2e/equipment-action-economy.spec.ts
```

Record exact pass/fail/skip counts and inspect persisted Encounter and
InventoryItem rows, not only response text.

**Step 3 — Correct only observed transition defects**

Adjust CAS predicates, transaction boundaries, or lock ordering only where the
real race demonstrates a mismatch. Do not add broad isolation-level changes.

**Step 4 — Verify GREEN and falsify**

Run the focused spec. Break each race guard independently and demonstrate a
double commit, illegal slot state, incorrect budget, or orphan log. Restore
and rerun GREEN.

**Step 5 — Remove disposable infrastructure**

Stop the server and remove the disposable container and volume. Confirm none
remains.

**Step 6 — Commit checkpoint**

```powershell
git add tests/e2e/equipment-action-economy.spec.ts tests/e2e/turn-advance-concurrency.spec.ts tests/e2e/support/database.ts
git commit -m "test: prove equipment action concurrency"
```

### Task 15: Update architecture and deployment documentation

**Files:**

- Modify: `MASTER_ARCH_GUIDE.md`
- Modify:
  `docs/plans/2026-09-10-dc-aud-016-combat-action-policy-design.md`
- Add/modify a focused architecture test for context/producer/finalizer
  alignment

**Step 1 — Write a characterization architecture assertion**

Bind both ends: exactly one Encounter field is the current-turn object
interaction authority; every reachable producer initializes it; every turn
advance resets it; the equipment route consumes it through the database
transition; AI modules do not import the transition or set cost.

**Step 2 — Falsify before trusting it**

Run the focused architecture test; it may start GREEN because implementation
already exists. Remove one producer, reset, consumer, and AI-boundary guard in
isolation, prove the corresponding assertion turns RED, then restore and rerun
GREEN.

**Step 3 — Document current truth and rollout**

Update architecture truth with the full 016A/016B contract, stable failure
semantics, dormant `Combatant.actionBudget`, and mandatory order:

1. apply additive migration;
2. deploy new app/client;
3. drain all old instances before declaring enforcement live.

State explicitly that the migration has no default/backfill and does not touch
Zone, EncounterMap, or persisted dimensions.

**Step 4 — Verify documentation and contract**

Run the architecture test and `pnpm check-retro`. Review the documented rollout
against the migration and every runtime reader/writer line by line.

**Step 5 — Commit checkpoint**

```powershell
git add MASTER_ARCH_GUIDE.md docs/plans tests/architecture
git commit -m "docs: record equipment action authority"
```

### Task 16: Validate the exact 016B head

**Step 1 — Focused suites and generated client**

Run every changed/directly guarding Vitest file and confirm Prisma client was
generated from the edited schema. Report exact file/test counts.

**Step 2 — Full required validation**

```powershell
pnpm typecheck
pnpm lint
pnpm exec vitest run --maxWorkers=2
pnpm build
pnpm check-retro
pnpm exec prisma validate
git diff --check
```

**Step 3 — Fresh migration proof**

Provision a new disposable pgvector/PostgreSQL database; verify the database
name contains `e2e`/`test`, verify `DATABASE_URL`, `DIRECT_URL`, and
`E2E_TEST_MODE=true`; apply all migrations from zero; report the exact count
and current status.

Run the full production-build Playwright suite:

```powershell
pnpm test:e2e
```

Report exact pass/fail/skip counts. Remove the server, container, and volume.

**Step 4 — Independent review**

Request review of the exact diff with emphasis on:

- migration safety and rollout ordering;
- no fabricated legacy budget;
- producer/select/reset/consumer alignment;
- pure rule versus database mutation ownership;
- Character/Combatant/Encounter lock ordering;
- CAS and rollback behavior under three named races;
- stable refusal precedence and no narration leakage;
- tests that fail under individual mutations.

Resolve findings and rerun proportional/full validation.

### Task 17: Deliver and merge 016B

**Step 1 — Verify branch state and migration handover**

Require clean state. Record exact head SHA and confirm the private save was
untouched. Put the migration-first/drain-old ordering prominently in the PR.

**Step 2 — Push and open PR**

```powershell
git push -u origin codex/dc-plan-016b-equipment-action-economy
gh pr create --base master --head codex/dc-plan-016b-equipment-action-economy
```

**Step 3 — Validate CI and guarded squash merge**

Wait for Verify/E2E smoke. Re-fetch and reconfirm GitHub master, PR base,
exact validated head, and no stacked children. Squash-merge with the validated
head guard only.

**Step 4 — Post-merge proof**

Wait for master Verify/E2E smoke. Synchronize local master to clean 0/0 state.
Add 016B evidence to PR #169 including migration safety, exact migration/E2E
counts, reviewer outcome, PR/head/squash SHAs, and CI URLs.

---

# Final audit-artifact disposition

### Task 18: Close PR #169 unmerged after final evidence

**Step 1 — Build the evidence map**

Map every PR #169 finding to its merged correction or formal disposition:

- 014A;
- 014B;
- 014C;
- 014D;
- 014E1;
- 014E2;
- 016A;
- 016B.

For each, include validated source head, squash commit on master, behavior
contract, validation counts, independent review, and post-merge CI URL.

**Step 2 — Reverify master and artifact state**

Fetch current master and verify the GitHub API SHA, local/origin 0/0 state,
and relevant master CI. Confirm PR #169 is still open, draft, unmerged, at
`7d53d3c9e9d27b75296296dad7eb8ee81081e0fe`.

**Step 3 — Add final evidence and close without merging**

Post the final evidence map, then close PR #169 through GitHub without merge.
Verify the preserved audit branch still points at its RED-history head. Do not
delete the branch.

### Task 19: Run the fresh current-master priority audit

Read current authority documents and implementation after all merges. Inspect
current production/test import and data flows rather than relying on the old
audit artifact. Report prioritized findings with evidence and explicit
dispositions. Do not refactor or open a correction automatically.
