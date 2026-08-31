# AGENTS.md — Dungeon Cortex Codex Instructions

This is the primary operating guide for Codex in this repository.

## First read

Before planning non-trivial work, Codex must read:

1. `docs/DECISION_5E_SRD_API.md`
2. `MASTER_ARCH_GUIDE.md`
3. `PROJECT_CONTEXT.md`
4. `package.json`
5. The code files directly related to the task

Do not rely on historical milestone notes, old planning documents, or comments alone to determine current implementation truth.

## Source of truth order

When documents conflict, use this order:

1. Explicit user instruction in the active task.
2. `docs/DECISION_5E_SRD_API.md` for rules-system and SRD data-source authority.
3. `MASTER_ARCH_GUIDE.md` for architecture and system law.
4. `PROJECT_CONTEXT.md` for product vision and scope.
5. Current implementation and tests.
6. Historical documents and archived references.

If repository reality differs from documentation, report the mismatch before proposing changes.

## Project canon

- Dungeon Cortex uses D&D 5e/SRD 2014 only.
- `https://www.dnd5eapi.co/api` is the canonical external SRD data source.
- Backend code is authoritative for legality, rolls, DCs, damage, resources, conditions, state, persistence, and deterministic events.
- AI narration may only describe facts already resolved by backend code.
- Do not introduce AD&D, OSR, THAC0, descending Armor Class, AD&D saving throw categories, morale as an OSR authority system, or gold-for-XP as active mechanics.

## Editing rules

- Do not touch rules, combat, events, persistence, migrations, or action pipelines unless the task explicitly authorizes it.
- Do not modify `.env`, secrets, deployment configuration, or production credentials.
- Do not install, update, or remove dependencies unless the task explicitly authorizes it.
- Do not modify lockfiles unless dependency changes are explicitly authorized.
- Do not create commits, branches, tags, deployments, or pull requests unless the user explicitly asks.
- Keep changes small, reviewable, and tied to the requested task.

## Package manager

- Use the package manager detected in the repository.
- If `pnpm-lock.yaml` exists, use `pnpm`.
- Do not mix `npm`, `yarn`, `pnpm`, or `bun`.

## Safe validation commands

Before running a script, confirm it exists in `package.json`.

Use the smallest relevant check:

- `pnpm typecheck` — TypeScript and contract changes.
- `pnpm exec vitest run --maxWorkers=2` — rules, backend, utilities, and regression checks. **Use this, not `pnpm test`.** On this machine plain `pnpm test` produces vitest worker-startup timeouts that read as test failures; capping the workers removes them. A test that *times out* is usually machine contention — re-run that file alone before concluding anything. A test that fails an *assertion* is not contention.
- `pnpm build` — broad app, route, or framework changes.
- `pnpm lint` — lint checks when relevant.
- `pnpm test:e2e` — UI flow or end-to-end behavior.
- `pnpm check-retro` — rules-canon or documentation changes involving D&D terminology.

## Validation by change type

| Change type | Minimum validation |
| --- | --- |
| Documentation only | Manual review; `pnpm check-retro` if rules terminology changed. |
| TypeScript types or shared contracts | `pnpm typecheck` |
| Rules/backend utilities | `pnpm exec vitest run --maxWorkers=2` |
| API routes or app-wide changes | `pnpm typecheck` and `pnpm build` |
| UI flow changes | `pnpm test:e2e` when feasible |
| D&D canon/rules terminology | `pnpm check-retro` |
| Dependency changes | `pnpm install`, relevant tests, and lockfile review |

## Commands requiring explicit approval

Ask before running commands that:

- remove files or folders,
- reset or clean Git state,
- install, update, or remove dependencies,
- run database migrations,
- run seed scripts that modify data,
- change deployment configuration,
- push to GitHub,
- deploy the app.

### Migrations: write them, never run them

The database holds a real save — one user, one character, one campaign. Write
the migration file by hand and leave it unapplied; the maintainer applies it.
`prisma generate` is the exception and is required: it regenerates the client
types from `schema.prisma` without touching the database, which is what lets a
branch compile and its tests pass while the save stays untouched.

Follow the shape of `prisma/migrations/20260814120000_add_combatant_xp_value_snapshot/`:
an atomic `DO $tag$` block, `ADD COLUMN IF NOT EXISTS`, and commentary
explaining the choices. On whether to give a new column a `DEFAULT`, the
question is whether the default is a *claim*: `xpValue` was left nullable
because `0` is a legitimate authorised award and a default would have made
legacy rows indistinguishable from it, while the damage-modifier columns took
`DEFAULT '{}'` because an empty array and "has no modifiers" are the same fact.

**State the deploy ordering in the handover, every time.** A new column that
`lib/memory/context.ts` selects is selected unconditionally, and
`buildCampaignContext` runs on every campaign action — so merging before the
migration is applied does not degrade the game, it stops it. The suite cannot
catch this, because every test fabricates its rows.

### Merging convention

Squash. Every PR since #52 lands as a single commit with a `(#NN)` suffix;
the 49 merge commits with two parents in the history all predate that. When
merging locally without a PR: squash-merge into `master`, **run the suite on
the merged result rather than only on the branch**, then push.

## Closed plans

**PLAN-058 (session ledger, atomic action journal, `EncounterMap` replacing
`Zone`) is closed, not implemented.** PR #58
(`codex/full-session-ledger-tactical-map`) closed without merging on
2026-08-19. Issues #63 (coordinator), #64 (D0, Prisma reconciliation) and
#65 (PR #58 stabilization) were closed `not planned` on 2026-08-30, after an
audit confirmed `EncounterMap`, `ActionRequest` and `GameEventRecord` never
reached `master` and no file from the PR's change list landed there either.
`Zone` remains the only spatial model in production.

Do not treat #63/#64/#65 or the PR #58 branch as live work, do not
cherry-pick from that branch, and do not resume any PLAN-058/D-series
delivery without a new decision and a new Issue based on current `master`.

## Dormant defects

The defects that survived longest in this repository were not broken code. They were correct data read with the wrong shape, or values written and never read: inert until something started depending on them. Tests passed throughout, because nothing checked the result.

Three that reached `master` and were only found later:

- `lib/ai/intent.ts` classified `explore` and `travel`, and no gate in `app/api/campaign/[id]/action/route.ts` consumed either. Those actions crossed the route with nothing rolled and reached the narrator.
- `Combatant.stats` existed with a `{}` default and was never written. Every rule reading a creature's ability score silently saw 10.
- The encounter route read ability scores from `data.ability_scores`, a key the stored SRD JSON does not have. The flat `wisdom` and `dexterity` fields were right there, and the adjacent line already used them.

The same failure repeats one level up, in the checking itself. A cheap sample gets mistaken for the check it stands in for. Twice in one session, in opposite directions:

- A worktree's uncommitted changes were declared superseded after confirming that four distinctive symbols from them appeared in `master`. A line-by-line comparison then found 92 added lines `master` did not have, including five named tests. The sample was accurate; the conclusion drawn from it was not, and acting on it would have destroyed the tests.
- Those five tests were then declared missing coverage because their names appear nowhere in `master`. Reading what each one asserts showed two were already covered under different names — one of them asserting behaviour `master` had deliberately replaced, so porting it would have reinstated the worse rule.

**A sample can prove presence. It can never prove absence.** Finding a symbol in `master` proves that symbol is there; it proves nothing about the other ninety lines. A name missing from `master` proves the name is missing; it proves nothing about the behaviour.

Names, symbols and signatures are identifiers, not behaviour. Before deleting anything, porting anything, or calling anything redundant, compare what the code *does*: line by line for a diff, assertion by assertion for a test. Run the cheap check first if it helps you find work — never to rule work out.

So, when inspecting:

- For every value produced, confirm something consumes it. For every value consumed, confirm something produces it. A field that only one side touches is the shape of this defect.
- Prefer a guard that binds both ends over a test that asserts one. `tests/architecture/intent-gate-exhaustiveness.test.ts` and `tests/api/action-intent-contract.test.ts` exist for that reason.
- Distrust a test that mocks the thing it appears to be testing. Mocking `@/lib/ai/intent` in a route test verifies the gates against hand-written intents and never exercises the classifier that feeds them.
- `vi.mock` of a module does not intercept calls that module makes to itself. Mocking `resolveAttackRoll` does not affect `lib/rules/combat.ts` calling it internally, so an assertion on the mock silently proves nothing.
- Before trusting a field, check the data. A read-only query against the real table settles in seconds what a type annotation only claims.
- Re-run the verification immediately before a destructive step, not once at the start of the investigation. The check that matters is the one whose result is still true when the files are deleted.

### A test that cannot fail is worse than no test

Two shapes of this reached `master` before review caught them, both written
while fixing dormant defects:

- `expect(outcome.consequenceDetails?.[0]?.combat_facts.status_applied ?? []).toEqual([])`
  — for a `cast_spell` action that array is always empty, so `[0]` is
  `undefined` and `?? []` makes the assertion unconditionally true. It passed
  identically on `master` with the bug still in place.
- Four assertions each checking `[]` against four different columns. Every one
  passed with every column's projection line deleted.

**Falsify the test, don't just watch it go green.** Break the line it guards,
confirm red, restore. Where a test guards several things, break each one
separately — a test that only fails when all of them are gone is guarding one
thing, not several.

### Forcing an attack to land

`hit: critical || (!fumble && total >= targetAC)` in `lib/rules/combat.ts` —
**a natural 1 misses regardless of the attack modifier.** Setting
`attackModifier: 100` against `targetAC: 1` does not force a hit; it forces one
nineteen times in twenty, and the twentieth fumbles. Eight tests shipped with
that assumption and failed roughly a third of full-suite runs between them.

Pin the die instead: `vi.spyOn(Math, "random").mockReturnValue(0.45)` gives a
natural 10 — neither a fumble nor a critical, which would double the damage
dice. Restore with `vi.restoreAllMocks()` or a `finally`; `vi.clearAllMocks()`
clears call history without restoring a spy's implementation, so a leaked
`Math.random` spy silently affects every later test in the file.

The scoping lesson cost a second round: find these by asking "does this
assertion depend on the attack landing or missing?", not by grepping for
whatever literal the first batch happened to use.

### Known dormant values, still open

Anchors verified 2026-08-29, except the tool-builder entry, verified
2026-08-30. Each is the same shape as the defects above — a value produced
with no consumer, or a consumer with no producer.

Closed 2026-08-29: weapons now have qualities, so the SRD's conditional damage
clauses resolve. `lib/rules/weapon-quality.ts` reads `magical`, `silvered` and
`adamantine` off the row — a declaration is authoritative, and absent one a
`damageBonus > 0` derives `magical`, because in the SRD a weapon with a bonus is
a magic weapon. `lib/rules/damage-clauses.ts` holds four entries, the exact
strings covering 69 of the data's 72 conditional entries, recognised verbatim
rather than parsed: a grammar over the wording would be deriving mechanics from
prose. `applyDamageModifiers` takes an optional attack descriptor and **absent
still means unresolved**, which is what let every untouched caller keep its
behaviour. Two loot rows — a silvered sword and an adamantine warpick, neither
with a `damageBonus` — exist so the silvered and adamantine branches are
reachable rather than born dormant.

Three wordings stay unrecognised on purpose, one occurrence each: `damage from
spells`, the `(from stoneskin)` note, and `piercing from magic weapons wielded by
good creatures`. Each needs a concept the model does not carry, and
`tests/rules/damage-clauses.test.ts` asserts that the unrecognised remainder is
exactly those three — a new SRD wording fails that test rather than passing
unnoticed.

Closed 2026-08-29: the AI tool module's dead surface is gone.
`lib/ai/tools/srd-lookup.ts` held seven exports no source imported — a
`queryMonsters`, `MonsterQueryOptions` and `buildMonsterRawData` duplicating
`lib/rules/srd-monster-lookup.ts` (identical `where`, `orderBy` and `select`;
only the live one projects the four modifier columns), plus `querySpells`,
`SpellQueryOptions`, `proficiencyBonusForCR` and `monsterAttackModifier`, dead
without a copy anywhere. The file went from 480 lines to 236.
`tests/architecture/srd-monster-single-lookup.test.ts` binds both ends the way
the equipment guard does: the query is defined in exactly one module, and the
module's exported surface is written down, so a new export is a line somebody
changes on purpose.

Closed 2026-08-29: armour marked "Stealth: Disadvantage" now costs the wearer
the roll. `stealthDisadvantage` had two producers — `projectSrdItem` and
`addItemToInventory` — and no mechanical reader, so the heaviest plate in the
game rolled Stealth like a rogue in nothing. `lib/rules/armor-stealth.ts` reads
it through `selectBodyArmor`, the selector the proficiency rule already asks, and
enters the roll as a third term beside the armour penalty. The `ac_bonus` bullet
that stood here was stale in the other direction: `lib/rules/armor-class.ts:102`
has consumed it since `39365f8`, and the note outlived the fix.

Closed 2026-08-29: `lib/memory/formatter.ts` no longer casts `combatant.stats`
to `Monster`. It reads the four snapshot columns `ContextCombatant` carries, so
the narrator's constraint line now names immunities, resistances,
vulnerabilities and condition immunities — the same values the combat pipeline
resolved against. Fifty-six combatant fixtures in `tests/api/action.test.ts` and
`tests/api/action-intent-contract.test.ts` had never carried those columns; they
do now, because a fixture thinner than the row it stands for is how a shape
mismatch survives a green suite.

- **`lib/rules/magic.ts:396`** — `resolveSpellEffect` returns `condition: null`
  on all three exit paths, with its own TODO: *"To be extracted from SRD
  description or specialized fields."* Because of it, **no spell in the game
  applies any condition.** `CONDITION_REGISTRY`, `applyCondition`,
  `lib/rules/condition-immunity.ts` and `Combatant.conditionImmunities` are all
  built, wired and unreachable, waiting on this one field.
  **Blocked by the data, not by effort — do not pick this up expecting a small
  increment.** `data/srd-es/spells.json` has no structured condition anywhere:
  zero `/api/conditions` references, zero `condition*` keys, and the word
  "charmed" appears exactly once in the whole file, inside a `desc`. Extracting
  a condition from a spell therefore means deriving a mechanical outcome from
  prose, which this project does not do. It needs either a new structured
  source or an explicit, recorded decision about that boundary. An earlier note
  here called it the highest-value item; that was written without checking the
  spell data, and it was wrong.
- **The whole wilderness subsystem** — not a dormant value: a subsystem the
  project switched off on purpose. `stealthAdvantage` at
  `lib/rules/wilderness.ts:275` is one field of it, and the note that stood here
  called it a missing `pace` column. That was wrong, and wrong in a way worth
  recording: the pace is already read and written as `travelState.partyPace` in
  `lib/rules/wilderness-service.ts:447`. What does not exist is the table.
  `schema.prisma` has no `TravelState` and no `WildernessMap`; migration
  `20260805090000` says so in its second line — "excluded pending a separate
  5e/SRD 2014 decision" — and `resolveDb` throws `LEGACY_SUBSYSTEM_DISABLED`
  when nothing injects a database. `buildWildernessTool` is not in
  `buildNarratorTools` either; its only importers are two tests.
  **Blocked by a recorded decision, not by effort.** Consuming any of it means
  reviving two models and taking the rules decision that migration parked, which
  is a project call and not an increment. Do not propose it as a next step
  without that decision being made first.
- **The entire non-SRD AI tool surface** — 24 tool definitions across seven
  builders, none with a production caller. `buildNarratorTools` spreads only
  `buildSrdTools()`; `buildCombatTools`, `buildExplorationTools`,
  `buildInventoryTools`, `buildProgressionTools`, `buildSocialTools`,
  `buildWildernessTool` and `buildWorldTools` are all unreferenced outside
  their own tests. `UNAVAILABLE_NARRATOR_TOOL_NAMES` in `lib/ai/tool-policy.ts`
  is the full list.

  **This entry said "twelve tool definitions across `social.ts` and
  `world.ts`" until 2026-08-31.** That was the two files a defect scan
  happened to surface; the directory was never listed. Same error as the rest
  of this section — measuring the part that was handed over and describing it
  as the whole.

  `a0bb009` stopped `buildNarratorTools` spreading them. This is the shape of
  the dead `srd-lookup.ts` surface deleted in `8806e06`, with one difference
  that kept it hidden: `lib/ai/tool-policy.ts` called the reduction temporary
  and named "SEC-AI-001 PR 3" as what would restore them, which reads as the
  "no callers yet, and the plan says so" exception. **That plan was cancelled,
  not delayed.** SEC-AI-001 closed completed on 2026-08-30 having replaced
  PR 3's design — contextual activation became physical exclusion — so nothing
  is scheduled to call these again. The comment has been corrected; the
  modules have not been touched.
  **Not blocked, but not a one-file delete either.** The import graph was
  verified across `app/`, `lib/`, `components/`, `scripts/`, `workflows/` and
  `evals/` on 2026-08-31, and it is worse than two dead wrappers: **four
  backend services are now reachable only through them.**

  | Service | Dead entry points | Live parallel path |
  | --- | --- | --- |
  | `lib/rules/trade-service.ts` | `resolveTradeTransaction`, `getCampaignCharacterIdForTrade` | `app/actions/trade.ts` → its own `prisma.$transaction`, from `components/trade/TradeOverlayController.tsx` |
  | `lib/rules/npc-service.ts` | `trackNpcState`, `upsertGeneratedNpc`, `establishInitialNpcDisposition`, `trackMerchantState` | `app/api/campaign/[id]/npc/route.ts` → its own `prisma.nPC.upsert` |
  | `lib/rules/equipment-service.ts` | `equipCharacterItem` | the `equip` gate in `app/api/campaign/[id]/action/route.ts:987` |
  | `lib/rules/social-service.ts` | `resolveSocialCheck`, `resolveRumors` | **none — there is no social route at all** |

  The equipment row named `app/api/campaign/[id]/inventory/route.ts` until
  2026-08-31. That route is `GET` only and equips nothing; the real live path
  is the action route's `equip` gate. A row in this table is a claim about
  behaviour, and that one was written from a directory listing.

  All three comparisons are now done, and **they do not share a verdict** —
  which is the point. Reading each pair was the only way to find that out.

  **Trade was compared line by line on 2026-08-31. Neither copy is whole, and
  an earlier version of this note guessed the wrong way about which is.** It
  said the dead services were "transactional and Zod-validated" and that the
  dead copy "may well be the correct one" — for trade that is false, and the
  guess was made from module shape without reading either file.

  - `app/actions/trade.ts` **did not validate `quantity` at all — fixed in
    `12267bf`.** A negative quantity on buy made `totalCost` negative, passed
    the `gold < totalCost` check, and reached `gold: { decrement: <negative> }`,
    which raises the balance. It is a Server Action, so the UI was never the
    only caller. The `campaign.userId !== user.id` check confined it to the
    caller's own save — self-cheating rather than privilege escalation — but
    accepting an illegal quantity and mutating gold from it breached backend
    mechanical authority regardless. The guard now refuses before the
    transaction opens, so nothing partial can be written, and
    `tests/actions/trade-quantity-validation.test.ts` covers the negative,
    zero, fractional and non-finite cases plus one asserting a valid quantity
    still gets through. **The defect is worth remembering even though it is
    closed:** it sat on the live path the whole time the review attention was
    on the dead one.
  - `lib/rules/trade-service.ts` **does not match the schema.** `InventoryItem`
    has no `campaignId` column and `Character` has no `campaignId` field, yet
    the service passes `campaignId` to `inventoryItem.create` (real Prisma
    would throw `Unknown argument` on the first purchase) and asserts against
    `item.campaignId` and `character.campaignId`, which are always `undefined`
    against real rows — so half of each ownership check is a no-op. It stays
    green because `resolveDb` casts `prisma as unknown as TradeDb` and its
    contract test injects a fake `tx`. Mocked shape, never checked against the
    table: the exact pair of defects this file warns about.

  So the live path holds the auth check, the working schema, the prose log the
  narrator consumes and now the input validation too, leaving `trade-service.ts`
  with nothing the live path lacks and one thing it gets wrong.

  **It still cannot be deleted on its own, and an earlier version of this
  paragraph said otherwise.** That version listed only what production code
  would lose — `getCampaignCharacterIdForTrade` and the `TradeServiceError`
  codes — because the production import graph was the only thing checked. The
  test bindings were not, and they are what block the delete:

  - `lib/ai/tools/social.ts:31` imports both functions for its `executeTrade`
    tool, so removing the module fails `pnpm typecheck`.
  - `tests/architecture/social-tool-no-direct-trade-prisma.test.ts:29`
    **requires** that import to exist. Its thirteen assertions are a Code is
    Law guard written in the negative: `executeTrade` must not call
    `prisma.$transaction`, must not mutate `campaign.gold`, must not write
    `InventoryItem`, must not compose trade prose while persisting. Deleting
    the service deletes the proof that the AI layer cannot touch money.
  - `tests/rules/trade-service-contract.test.ts` plus `vi.mock` lines in
    `tests/ai/tools/tool-result-contract.test.ts:87` and
    `tests/ai/narrator-real-sdk-containment.test.ts:20`.

  The guard now protects dead code — `executeTrade` has no production caller
  either — so removing both together is coherent. But that is five files and
  the retirement of an architectural barrier, not a one-module delete, and
  `executeTrade` is one of twelve tools in `buildSocialTools`/`buildWorldTools`
  whose siblings will have bindings of their own. **Decide the fate of those
  two builders as a whole; do not pick trade off separately.** Checking the
  production import graph and calling a module deletable is how this paragraph
  was wrong twice.

  **`equipment-service` — the live path wins outright.** The `equip` gate runs
  inside `prisma.$transaction` while `equipCharacterItem` fires its updates
  through `Promise.all`, so a half-applied equip is possible in the dead one
  and not in the live one. The gate also *derives* the slot with `slotFor`,
  where the service accepts a `targetSlot` from its caller and validates it —
  deriving is the stronger of the two, since no illegal value can be supplied
  at all. The service carries the same phantom `campaignId` on `InventoryItem`
  as trade (line 154), on a branch real Prisma never reaches. It holds nothing
  the gate lacks.

  **`npc-service` — not a duplicate, and the only one of the three worth
  keeping on its merits.** The route derives its statblock from `generateNPC`
  and refuses to trust the body, keeps `name`/`maxHp`/`ac` immutable after
  creation, whitelists three roles and requires an active campaign. The
  service does none of that: it takes `name`/`maxHp`/`ac` from its caller's
  descriptor, lets an update rewrite them, accepts any non-empty `role`, and
  its ownership check is opt-in — `if (input.userId && campaign?.userId && …)`
  — which **never fires, because neither caller passes `userId`**. That reads
  like an AI-supplies-monster-stats breach and **is not one**: both
  `trackNPC` and `generateAndTrackNPC` call `generateNPC(seed, role)` and hand
  over the derived statblock. The boundary holds at the call site, not in the
  service, so the exposure is latent for a future caller rather than live.
  What makes it worth keeping is the other half: `disposition` (validated to
  −10..10), `personalityTags`, `traits`, `race`/`profession`/`alignment` and
  `trackMerchantState` have **no equivalent on the route at all** — it cannot
  set a disposition. Deleting this one removes capability, not redundancy.

  ### What to do with the tool surface

  **Do not bulk-delete the wrappers.** Two reasons, both concrete.

  First, they are what the AI-layer boundary is enforced *against*. Around ten
  `tests/architecture/*-tool-no-direct-prisma.test.ts` files exist to prove the
  AI layer never reaches for Prisma, and `narrator-tool-containment.test.ts:72`
  — "catalogues every implemented non-SRD tool as unavailable" — binds both
  ends by enumerating what exists. With no non-SRD tools implemented that
  assertion is vacuous: it passes forever and guards nothing. A test that
  cannot fail is worse than no test, and this would produce ten of them.

  Second, they are the only written record of what the game was meant to do.
  SEC-AI-001 correctly took the AI's hands off the wheel but did not build
  replacement controls for everything it removed. Today the game can attack,
  cast, equip, rest, level up and trade through the UI. It **cannot** run a
  social check, set an NPC disposition, or track a merchant. Deleting the
  wrappers erases the map of that gap while the gap is still open.

  So this is a product backlog wearing dead code's clothes, and it resolves
  capability by capability, never in bulk:

  - `equipment-service` — delete; the live gate wins outright and the service
    has already rotted.
  - `trade-service` and its guard — delete, once `narrator-tool-containment`
    is confirmed to cover the invariant the trade-specific guard asserts.
  - `npc-service`, `social-service` — **product decisions.** Does the game
    want NPC disposition and social checks? Yes means building a route, as
    trade and equip have. No means deleting tool and service together.
  - combat, exploration, inventory, progression — **four builders whose
    services were never compared.** Do not assume they match any verdict here.
  - wilderness — leave alone; it is blocked by the recorded decision above.

  The four pairs that *were* compared produced four different verdicts. Any
  rule applied across the surface would have been right about one of them.

## Work style

For non-trivial tasks, Codex should:

1. Inspect the current implementation.
2. Summarize the real state.
3. Identify files likely to change.
4. Explain risks.
5. Propose the smallest safe plan.
6. Apply changes only within the requested scope.
7. Validate with relevant commands.
8. Report results clearly.

## Completion report

At the end of each task, Codex must report:

- files created or modified,
- what changed,
- commands executed,
- command results,
- remaining risks,
- whether prohibited files or operations were avoided,
- recommended next step.
