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
}
```

- **Nullable, no default.** Enemies and NPC-derived combatants never have a `Character` — a
  default would be a false claim for every one of those rows (`AGENTS.md`'s own doctrine on
  defaults: "is the default a claim?").
- **`Character?` (optional relation), not `onDelete: Cascade`.** Matches the existing FK-default
  convention in this schema (`RESTRICT`/`CASCADE` per the established pattern) — a `Combatant`
  row is historical combat record; a `Character` being restricted from deletion while referenced
  is consistent with how every other FK to `Character` behaves here.

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

**Deploy order:** the migration (with this backfill) must be applied before the new application
code ships. This is enforced structurally, not just by convention — the generated Prisma Client
will not expose `characterId` on `Combatant` at all until the schema and a matching migration
exist together, so the new code literally cannot run against the old schema. Per `AGENTS.md`, the
migration is written and committed but left unapplied against the real save; the maintainer
applies it, same as DC-PARTY-001.

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
  `party-member-migration-contract.test.ts`: the migration contains the `ADD COLUMN` and the
  backfill `UPDATE ... FROM`, and does not touch unrelated tables' DDL.
- **Real-disposable-Postgres backfill proof** — create a `Combatant` row directly (bypassing the
  migration's backfill, simulating a pre-existing row), run the backfill `UPDATE` against it,
  confirm `characterId` lands correctly from the `Campaign` chain. Mocks cannot prove this; it
  needs the real join.
- **The actual safety property, proven directly:** construct an encounter with two Combatant rows
  that both have `isPlayer: true` but different `characterId` (a state that shouldn't occur in
  today's product, but is exactly the scenario this design defuses) and confirm
  `mirrorPlayerCombatantHp` / `applyPlayerDowned` / `rollPlayerDeathSave` only touch the one whose
  `characterId` matches, not both. This is the one new behavior worth asserting directly, and it's
  the natural RED/GREEN falsification target: temporarily revert one function's `where` back to
  `isPlayer: true`, confirm this test goes RED (both rows get written), restore, confirm GREEN.
- **Existing unit tests for the three write functions** (`tests/db/player-hp.test.ts`,
  `tests/db/player-downed.test.ts`, and death-save transition's tests) need their fixtures updated
  to pass `characterId` — expected, mechanical maintenance given the signature change, not new
  design risk.
- **Full regression** — the existing unit suite, `pnpm build`, and the e2e combat specs
  (`enemy-attack-profile.spec.ts`, `area-save-actions.spec.ts`, `combat-hp-concurrency.spec.ts`,
  `critical-path.spec.ts`) must all pass unmodified against a real disposable Postgres. Since
  nothing here changes observable combat behavior, any pass is direct evidence of that.

## 7. Error handling

No new runtime error paths. `characterId` is populated by construction — either backfilled by the
migration or set at the one remaining creation site (`app/api/campaign/[id]/encounter/route.ts`;
`encounter-service.ts`'s twin is dormant). If a future code path ever created a player Combatant
without setting `characterId`, the write functions would silently match zero rows — the same
failure *mode* this design is fixing, just from a different cause. No speculative runtime guard is
added for that (nothing today can trigger it, and the two creation sites are both covered by this
design); it's recorded here as a residual risk for whoever adds a third creation path later.

## 8. Definition of done

- [ ] `Combatant.characterId` in `schema.prisma`, migration with backfill, both committed
      unapplied per `AGENTS.md`.
- [ ] `mirrorPlayerCombatantHp`, `applyPlayerDowned`, `rollPlayerDeathSave` scoped by
      `characterId`; all callers updated.
- [ ] Both Combatant-creation sites set `characterId`.
- [ ] Tests per §6, including the two-Combatant safety test and its RED/GREEN falsification.
- [ ] Full existing suite (unit + e2e, including against real disposable Postgres) passes
      unmodified.
