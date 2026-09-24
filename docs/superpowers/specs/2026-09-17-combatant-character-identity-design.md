---
title: Combatant Character Identity Link
status: Approved for planning (design phase complete)
date: 2026-09-17
scope: Combatant.characterId, the write paths keyed on isPlayer:true, encounter creation
---

# Combatant Character Identity Link

## 0. Status and scope

This is the design for **DC-PARTY-002**, the "combat affiliation" stage referenced in
`docs/PARTY_AND_COMPANIONS.md` §11 (future work not authorized by DC-PARTY-001). It is
subordinate to `docs/DECISION_5E_SRD_API.md` and `MASTER_ARCH_GUIDE.md`.

**In scope:** give `Combatant` a durable link to the `Character` it represents, and use that
link to close a specific correctness gap in three write paths. Combat behavior does not
observably change for any existing user.

**Explicitly out of scope, decided during brainstorming:**
- Enabling more than one simultaneous `isPlayer: true` Combatant per encounter. The invariant
  "exactly one player Combatant" (`lib/rules/turn-authority.ts`'s `resolveEncounterTurnAuthority`)
  is unchanged.
- Turn order, initiative, victory-condition logic (`all_enemies_dead` / `player_dead`),
  target selection, action routing.
- Actor/control routing (stage 3 of the Party & AI Companions roadmap) and companion AI.
- Rewriting the ~10 pure *read* lookups (`find(c => c.isPlayer)`) scattered across
  `turn-authority.ts`, `campaign-guard.ts`, and `action/route.ts`'s actor/target identification.
  These are not the risk this design addresses (see §2) and leaving them alone keeps the diff
  proportionate to the problem.

## 1. Problem

`Combatant` has no foreign key to `Character` at all today — only `isPlayer: Boolean`. It is a
value-copied snapshot, not a live reference. Three write paths rely on `isPlayer: true` being
unambiguous:

- `lib/db/player-hp.ts` — `mirrorPlayerCombatantHp`: `updateMany({ where: { encounterId,
  isPlayer: true }, data: { hp, ...DEATH_STATE_RESET } })`
- `lib/db/player-downed.ts` — `applyPlayerDowned`: `updateMany({ where: { encounterId,
  isPlayer: true }, data: { deathSaveFailures: DEATH_SAVE_LIMIT } })`
- `lib/db/death-save-transition.ts` — `rollPlayerDeathSave`: the same `{ encounterId, isPlayer:
  true }` shape, reused for its `findFirst` and both of its `updateMany` branches (stable/dead)

This is correct *today* only because `resolveEncounterTurnAuthority` and both encounter-creation
code paths guarantee exactly one `isPlayer: true` row per encounter. Nothing at the database level
enforces that, and nothing about these three `updateMany` calls would notice if it ever became
false — they would silently write the same value to every matching row instead of erroring. This
is a real landmine for any future task that lets a companion's Combatant also carry
`isPlayer: true` (or any other multi-Combatant player-side scenario), and the honest way to defuse
it is to stop keying these writes off a boolean and key them off the Combatant's actual identity.

## 2. Data model

```prisma
model Combatant {
  // ...existing fields unchanged...
  characterId String?

  character Character? @relation(fields: [characterId], references: [id])
  // ...existing encounter relation unchanged...

  @@index([characterId])
  @@unique([encounterId, characterId])
  // Combatant_one_player_per_encounter_key: partial unique index, migration-only
  // (see §3) — Prisma cannot express a filtered @@unique in the schema DSL, same
  // limitation as PartyMember_one_main_per_campaign_key.
  // Combatant_player_has_character_id: CHECK, migration-only — the schema DSL
  // has no CHECK constraints.
}
```

- **Nullable, no default.** Enemies and NPC-derived combatants never have a `Character` — a
  default would be a false claim for every one of those rows (`AGENTS.md`'s own doctrine on
  defaults: "is the default a claim?").
- **`Character?` (optional relation), not `onDelete: Cascade`.** Matches the existing FK-default
  convention in this schema (`RESTRICT`/`CASCADE` per the established pattern) — a `Combatant`
  row is historical combat record; a `Character` being restricted from deletion while referenced
  is consistent with how every other FK to `Character` behaves here.
- **`Combatant_one_player_per_encounter_key`** — added during design review. The three write
  paths in §4 only close the landmine at their own call sites; nothing at the database level
  actually prevented a second `isPlayer: true` row from being created in the first place —
  `resolveEncounterTurnAuthority` only checks at *action* time, not at *creation* time. A partial
  unique index closes the gap at its real source, the same way `PartyMember_one_main_per_campaign_key`
  (DC-PARTY-001) enforces "exactly one MAIN" at the database rather than trusting every future
  caller to maintain it by convention. This constraint does not depend on `characterId` at all —
  it targets `isPlayer` directly — but it belongs in this migration because it protects the exact
  invariant the rest of this design assumes.
- **`Combatant_player_has_character_id`** — added in the final whole-branch review. A CHECK,
  `NOT "isPlayer" OR "characterId" IS NOT NULL`: a player Combatant without its link cannot exist.
  `rollPlayerDeathSave` fails loudly when its `findFirst` finds no row, but
  `mirrorPlayerCombatantHp` and `applyPlayerDowned` do not check their `updateMany` count, so a
  player row with a `NULL` `characterId` would make them silently write nothing. The CHECK closes
  that at the database for every creation path at once, instead of patching each call site. It
  must be added after the §3 backfill (see §3).
- **`@@unique([encounterId, characterId])`** (`Combatant_encounterId_characterId_key`) — also
  added in the final review. The three write paths key on `(encounterId, characterId)`, which
  `Combatant_one_player_per_encounter_key` makes unique only indirectly (today only player rows
  carry a `characterId`, by convention). Unlike that filtered index, Prisma expresses this one
  natively. Postgres treats `NULL`s as distinct in a unique index, so enemy rows (`characterId`
  `NULL`) are not constrained by it.

## 3. Migration and the backfill risk

The column itself is a safe, fast, metadata-only `ADD COLUMN` (nullable, no default, no table
rewrite). The risk is what happens to **rows that already exist**.

Unlike `PartyMember` (a brand-new, empty table when DC-PARTY-001's migration ran), `Combatant`
rows exist right now for historical *and currently-active* encounters. If the migration only adds
the column, every pre-existing row — including a player Combatant in the middle of a live fight at
deploy time — would have `characterId = NULL`. Once the write paths in §4 start scoping their
`updateMany` calls by `characterId` instead of `isPlayer: true`, a `NULL` there means those calls
would match **zero rows** and silently stop landing HP/death-save/downed-state writes for that
combatant — a worse failure than the one this design fixes, because it fails silently instead of
loudly.

**The migration must therefore backfill `characterId` for every existing `isPlayer: true`
Combatant row**, derived from its `Encounter → Campaign → Character` chain (a two-hop join, since
`Combatant` only carries `encounterId`):

```sql
UPDATE "Combatant" AS c
SET "characterId" = camp."characterId"
FROM "Encounter" AS e
JOIN "Campaign" AS camp ON camp."id" = e."campaignId"
WHERE c."encounterId" = e."id"
  AND c."isPlayer" = true
  AND c."characterId" IS NULL;
```

This covers historical rows and currently-active-encounter rows in the same atomic step, exactly
like DC-PARTY-001's `Campaign` backfill.

**`Combatant_one_player_per_encounter_key`** uses the same pre-check-then-constrain shape as
`20260912220000_enforce_single_active_encounter`'s `Encounter_one_active_per_campaign_key` — fail
closed if data already violates the invariant, rather than silently repairing or corrupting it:

```sql
DO $combatant_one_player_per_encounter$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Combatant" WHERE "isPlayer" = true
    GROUP BY "encounterId" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce single-player-per-encounter invariant: duplicate isPlayer rows already exist';
  END IF;
END
$combatant_one_player_per_encounter$;

CREATE UNIQUE INDEX "Combatant_one_player_per_encounter_key"
ON "Combatant" ("encounterId")
WHERE "isPlayer" = true;
```

This pre-check is also the empirical answer to "does any existing data — including the dormant
`spawnCombatEncounter` twin's test fixtures — ever transiently violate this": if it does, the
migration refuses to apply and says so, rather than the question being resolved by code review
alone.

**Deploy order:** the migration (with this backfill) must be applied before the new application
code ships. This is enforced structurally, not just by convention — the generated Prisma Client
will not expose `characterId` on `Combatant` at all until the schema and a matching migration
exist together, so the new code literally cannot run against the old schema. Per `AGENTS.md`, the
migration is written and committed but left unapplied against the real save; the maintainer
applies it, same as DC-PARTY-001.

**Deploy order, the reverse direction** (added in the final whole-branch review). The paragraph
above covers new code meeting the old schema. The opposite window exists too: between
`migrate deploy` and the new application code going live, the *old* code keeps serving requests
and does not know `characterId` exists. An encounter it created in that window would get an
`isPlayer: true` Combatant with `characterId = NULL` *after* the backfill had already run — a row
nothing would ever repair, invisible to the new code's `characterId`-scoped writes. The
`Combatant_player_has_character_id` CHECK constraint (§2) closes this structurally: the old code's
insert fails loudly at the database, rolling back its encounter-creation transaction, rather than
silently orphaning a row. The same constraint fixes an order inside the migration: it is added
*after* the backfill `UPDATE`, because adding it first would validate it against the pre-existing
player rows the backfill has not filled yet, and fail the migration.

## 4. Code changes

All of the following are threading an already-available value one level deeper — verified against
the current source, not assumed. No call site needs to *fetch* anything new.

| File | Change |
|---|---|
| `lib/db/player-hp.ts` | `mirrorPlayerCombatantHp` gains a `characterId: string` parameter; `where` becomes `{ encounterId, characterId }`. `setPlayerHp` already receives `characterId` in its input — it just forwards it. |
| `lib/db/player-downed.ts` | `applyPlayerDowned`'s `input` gains `characterId: string`; `where` becomes `{ encounterId, characterId }`. |
| `lib/db/death-save-transition.ts` | `rollPlayerDeathSave` already has `ctx.characterId`. Its initial `findFirst` and the shared `where` used by both the stable/dead `updateMany` branches move from `isPlayer: true` to `characterId: ctx.characterId`. The `findFirst` isn't itself the dangerous pattern (it doesn't multi-write), but changing it keeps this function internally consistent rather than half-migrated. |
| `lib/rules/combat-pipeline.ts` | `applyCharacterHealing` already receives `characterId` as its own parameter (line 246) — forwards it to both of its `mirrorPlayerCombatantHp` calls (lines 264, 286). The area-spell/attack-damage block (~763-781) already has `playerCharacterId` in scope (used for `setPlayerHp` at 765) — forwards it to `applyPlayerDowned`. |
| `lib/db/enemy-turn-transition.ts` | Both `applyPlayerDowned` call sites (~321, ~390) already have `ctx.characterId` in scope (used directly at line 358 for `setPlayerHp`) — forwards it. |
| `app/api/campaign/[id]/encounter/route.ts` | The player `Combatant` object built at encounter creation gains `characterId: campaign.character.id`. |
| `lib/rules/encounter-service.ts` | Same one-line addition to `spawnCombatEncounter`'s player Combatant object, for the already-dormant duplicate (test-only, not used in production) — kept in sync so it doesn't drift further, not because anything in production depends on it. |

## 5. What does not change

- `resolveEncounterTurnAuthority` and the "exactly one `isPlayer: true`" invariant.
- The enemy-turn chain's target selection, initiative, turn order.
- Victory-condition resolution (`all_enemies_dead`, `player_dead`).
- Every pure *read* lookup that does `find(c => c.isPlayer)` for actor/target identification —
  these aren't the landmine (they don't multi-write) and nothing here requires them to change.
- The action route's request/response contracts, HTTP status codes, or any client-facing shape.
- `PartyMember` — this design still adds no reader of that table from combat code.

## 6. Testing

- **Static schema/migration contract** — same technique as DC-PARTY-001's
  `party-member-migration-contract.test.ts`: the migration contains the `ADD COLUMN`, the backfill
  `UPDATE ... FROM`, and the `Combatant_one_player_per_encounter_key` index, and does not touch
  unrelated tables' DDL.
- **Real-disposable-Postgres backfill proof** — extract the migration's own backfill `UPDATE`
  statement verbatim from the migration file and run it unscoped. Assert the player row was linked
  correctly from the `Campaign` chain, the enemy row in the same encounter stays `NULL`, a second
  run affects zero rows (idempotent), and the new CHECK constraint passes after the backfill.
- **Real-disposable-Postgres constraint proof** — attempt to create a second `isPlayer: true`
  Combatant in an encounter that already has one; confirm Postgres rejects it with a Prisma `P2002`.
  Learned empirically during DC-PARTY-001: Prisma 6.19.2 reports `meta.target` as the raw column
  name array (here, `["encounterId"]`), not the constraint's name — the detection helper must match
  on that, not on a `"Combatant_one_player_per_encounter_key"` substring. RED/GREEN falsification:
  temporarily drop that index, confirm the test goes RED (the insert succeeds instead of throwing),
  restore, confirm GREEN — same technique as DC-PARTY-001's duplicate-membership falsification.
- **The `Combatant_player_has_character_id` CHECK** — a player Combatant without a `characterId`
  is rejected at insert time with a CHECK violation (§2, added in the final whole-branch review).
  The test proves it rejects `isPlayer: true` without `characterId`, permits `isPlayer: true` with
  `characterId`, permits enemies (`isPlayer: false`) without `characterId`, and prevents unlinking
  an already-linked player.
- **The `(encounterId, characterId)` composite unique index** (`Combatant_encounterId_characterId_key`)
  — a duplicate `(encounterId, characterId)` pair is rejected (§2, added in the final review). The
  test proves a player and enemy cannot both link the same Character in one encounter, while
  multiple `NULL`-`characterId` enemy rows in the same encounter remain permitted (NULLs are
  distinct in Postgres unique indexes), and the same Character can be linked in different encounters.
- **The write-function safety property — now a unit test, not an integration test.** Design review
  added `Combatant_one_player_per_encounter_key` (§2), which means two `isPlayer: true` rows with
  different `characterId` can no longer be constructed in a real database — the constraint itself
  is the proof that the bad state can't occur. What's left to verify is narrower and more
  mechanical: a unit test with a fake Prisma `tx` confirming `mirrorPlayerCombatantHp` /
  `applyPlayerDowned` / `rollPlayerDeathSave` build their `where` clause from `{ encounterId,
  characterId }`, not `{ encounterId, isPlayer: true }` — i.e., that the code actually uses the
  identity the database now guarantees is unique, rather than the boolean it no longer needs to
  trust alone. RED/GREEN: revert one function's `where` back to `isPlayer: true`, confirm the
  fake-`tx` assertion goes RED (wrong shape), restore, confirm GREEN.
- **Architecture-fence test** — added during design review to close the residual risk in §7
  directly instead of only documenting it in prose: a static test (same technique as
  `rls-deny-by-default.test.ts`) asserting every file that does `tx.combatant.create` /
  `tx.combatant.createMany` with `isPlayer: true` also sets `characterId` in the same object
  literal. Catches a future third creation path that forgets, at review time rather than at
  runtime.
- **Existing unit tests for the three write functions** (`tests/db/player-hp.test.ts`,
  `tests/db/player-downed.test.ts`, and death-save transition's tests) need their fixtures updated
  to pass `characterId` — expected, mechanical maintenance given the signature change, not new
  design risk.
- **Full regression** — the full `pnpm test:e2e:smoke` suite (exactly what CI runs) must pass
  against a real disposable Postgres. Nine e2e fixtures — the shared `tests/e2e/support/combat-fixture.ts`
  plus eight specs including `area-save-actions.spec.ts` and `combat-hp-concurrency.spec.ts` —
  were modified only to set `characterId` on their player Combatant row; no assertions were
  changed. This was discovered by the final whole-branch review: these fixtures predate the plan,
  and once the new code's write paths scope their `updateMany` calls by `characterId` instead of
  `isPlayer: true`, a player row without a `characterId` is invisible to them — `death-saves.spec.ts`
  failed 4 of 6 against real Postgres before the fix. That is why the regression must run the full
  smoke suite rather than a hand-picked subset: nothing can be ruled out at the fixture level until
  the entire application's real paths are verified.

## 7. Error handling

No new runtime error paths. `characterId` is populated by construction — either backfilled by the
migration or set at the one remaining creation site (`app/api/campaign/[id]/encounter/route.ts`;
`encounter-service.ts`'s twin is dormant). If a future code path ever tries to create a player
Combatant without setting `characterId`, the insert itself now fails
(`Combatant_player_has_character_id`, §2, added in the final whole-branch review). Before that
constraint, the write functions would have matched zero rows — the same failure *mode* this design
is fixing, just from a different cause.

Design review closed two thirds of this gap rather than just documenting it:
`Combatant_one_player_per_encounter_key` (§2/§3) means a second `isPlayer: true` row can never be
created at all, and the architecture-fence test (§6) catches a future creation site that forgets
`characterId` at review time. What's left, genuinely residual: a creation path could still set
`characterId` to the *wrong* Character (not `NULL`, just incorrect) without either safeguard
noticing — nothing here validates that the `characterId` written at creation actually matches
`campaign.characterId`. No guard is added for that; it would need the encounter-creation route to
assert its own input against the campaign it just loaded, which is more than "plumbing" and belongs
in a future task if it ever proves necessary.

## 8. Definition of done

- [ ] `Combatant.characterId` in `schema.prisma`, migration with backfill, both committed
      unapplied per `AGENTS.md`.
- [ ] `Combatant_one_player_per_encounter_key` partial unique index, with its pre-check DO block,
      in the same migration.
- [ ] `Combatant_player_has_character_id` CHECK constraint, placed after the backfill in the
      migration.
- [ ] `@@unique([encounterId, characterId])` / `Combatant_encounterId_characterId_key` composite
      unique index in the migration.
- [ ] `mirrorPlayerCombatantHp`, `applyPlayerDowned`, `rollPlayerDeathSave` scoped by
      `characterId`; all callers updated.
- [ ] Both Combatant-creation sites set `characterId`.
- [ ] Nine e2e fixtures updated to set `characterId` on their player Combatant.
- [ ] Tests per §6: migration contract, real-DB backfill proof, real-DB single-player constraint
      proof with RED/GREEN falsification, `Combatant_player_has_character_id` CHECK proof,
      `(encounterId, characterId)` composite unique index proof, the write-function unit test,
      and the architecture-fence test for creation-site coverage.
- [ ] The full `pnpm test:e2e:smoke` suite passes against a real disposable Postgres.
