---
title: Decision — Experience (XP) Award Authority
status: Accepted — Phase 1 (combat only)
date: 2026-08-14
scope: Backend progression authority, combat XP award, encounter finalization, AI narration boundary
---

# Decision — Experience (XP) Award Authority

## 0. Status and scope

This decision is **subordinate to** `docs/DECISION_5E_SRD_API.md` and does not amend it. Where any
statement here could be read as conflicting with that document, `docs/DECISION_5E_SRD_API.md`
governs.

Precedence order for this document, unchanged from the project canon:

1. Explicit user instruction in the active conversation.
2. `docs/DECISION_5E_SRD_API.md`.
3. `MASTER_ARCH_GUIDE.md`.
4. `PROJECT_CONTEXT.md`.
5. This document.
6. Current implementation and tests.
7. Historical planning artifacts.

**In scope:** who may authorize an XP award, from what backend-resolved fact, with what value, and
how a single award is prevented from being granted twice.

**Out of scope** (see §15): quest/mission XP, exploration XP, multi-character party composition and
XP distribution, combat outcomes other than `all_enemies_dead`, and any 2024-rules variant.

This is a specification decision. As of this writing **no code, schema, or test in the repository
implements the productions described here.** `applyExperienceAward` exists and is contract-tested,
but nothing in the reachable production path calls it. Sections 2–13 fix the contract a future,
separately reviewed implementation must satisfy; they do not describe current runtime behavior.

## 1. Non-negotiable invariants

Restated from `docs/DECISION_5E_SRD_API.md` §6–§7 and `PROJECT_CONTEXT.md` §4, applied specifically
to XP:

- The backend is the sole mechanical authority. It calculates and persists XP; the AI narrates
  outcomes already resolved by backend facts.
- `awardXP` (the narrator tool in `lib/ai/tools/progression.ts`) **remains inactive**. It is absent
  from `ACTIVE_NARRATOR_TOOL_NAMES` (`lib/ai/tool-policy.ts`) and its builder has no production
  importer. This decision does not reactivate it.
- No narration, no narrator tool, no UI action, and no client-supplied field may grant or influence
  the amount of an XP award.
- Granting XP never directly modifies `Character.level`. Under Model E, `level` is the last
  mechanically applied level; XP only ever changes what level the character is *entitled* to reach
  (`targetLevel = getLevelFromXP(xp)`).
- The Model E contracts (`lib/rules/progression-service.ts`, `lib/rules/level-up-service.ts`,
  `lib/actions/backend-presentation-resolution.ts`) are unchanged by this decision and remain closed
  contracts, not to be reopened here.

## 2. Phase 1 production trigger

The only production authorized in Phase 1 is **certified combat victory**:

```
resolveEncounterEnd(...).reason === "all_enemies_dead"
```

evaluated inside `finalizeEncounterTurn` (`lib/rules/combat-pipeline.ts`), the single point in the
reachable action pipeline where the backend deterministically knows, inside a transaction, that a
combat encounter ended in victory.

This is a **Phase 1 technical limitation**, not a redefinition of what counts as victory under D&D
5e/SRD 2014 in general. See §3 for the outcomes this phase does not yet cover.

- `player_dead` never grants XP.
- No other backend signal (quest completion, exploration event, narrative claim) authorizes a
  production in Phase 1.

## 3. Postponed victory conditions

Under 5e/SRD 2014, overcoming a threat without killing it — subduing, routing, capturing, talking it
down, evading it definitively — can also warrant XP. This decision does not deny that; it is
**postponed**, for a specific and verifiable reason:

**The engine cannot yet represent those outcomes with deterministic persisted state.**
`Encounter.status` admits the value `"fled"` in its type signature
(`lib/rules/combat.ts`, `lib/rules/combat-pipeline.ts`), but no code path in `lib/` or `app/` ever
writes it. No `surrendered`, `captured`, or `pacified` state exists at all.

**Unblocking condition:** before extending the trigger, the engine must persist those outcomes as
deterministic states equivalent in reliability to `all_enemies_dead` — i.e., reached only through
backend-resolved mechanics, never through narrative claim.

## 4. Award recipient

**Current repository contract: one mechanical Character per Campaign.**

`Campaign.characterId` is a required, singular field; both reachable encounter-creation paths create
exactly one `isPlayer: true` combatant; every consumer in the combat pipeline (including
`resolveEncounterEnd`) resolves the player combatant via a singular lookup.

Phase 1 therefore grants the award to `campaign.characterId`.

**This is an architectural limitation of the current codebase, not a general XP distribution rule.**
Under 5e/SRD 2014, XP is shared among party participants. Before this production is extended to
support multiple characters, the implementation must separately define: (a) which participants of an
encounter are authoritative for the award, and (b) the distribution rule among them. Neither is
defined here.

## 5. Provenance of `Combatant.xpValue`

**Decision: persist a snapshot, `xpValue`, on `Combatant`, fixed once at encounter creation.**

Its only permitted origin is a value **the backend has already resolved** from an authorized
mechanical source. Concretely:

- **SRD monsters:** `xpValue` is populated from the canonical SRD XP figure the backend already
  resolves for that monster record — the same figure already stored on the SRD monster record and
  already surfaced through the backend's monster-lookup path. No new external source, no new
  computation, is introduced by this decision.
- **The client request never supplies or overrides `xpValue`.** No request field is read for this
  purpose, under any name, at any point in the encounter-creation flow.

Prohibited, without exception:

- inferring XP from a creature's name;
- accepting an XP value chosen through the UI;
- asking the AI model to estimate XP;
- re-querying the SRD source, ambiguously or otherwise, at combat end to reconstruct a value that
  was not captured at encounter creation.

## 6. Custom / ad-hoc enemies

An enemy created without a canonical SRD reference may carry `xpValue` **only if** a
backend-authorized, validated configuration already determines that value for it, at or before
encounter creation.

If no such source exists: `xpValue = unavailable` for that combatant.

**If a single relevant enemy in the encounter has `xpValue = unavailable`, the entire encounter
grants zero automatic XP.** No partial award. Fail-closed applies at the encounter level, not the
per-creature level — a partial, silent award would be a mechanism a player could learn to exploit by
composing encounters with unrated filler enemies.

## 7. Award formula

```
combatAward = Σ Combatant.xpValue
              over every Combatant in the encounter with isPlayer === false
```

In Phase 1, because the trigger is `all_enemies_dead`, every enemy combatant is, by definition,
defeated — "every enemy" and "every defeated enemy" coincide in this phase only. This equivalence
must not be assumed to generalize once §3's postponed victory conditions are unblocked, where an
encounter could end with some enemies still standing (fled, captured, unengaged).

The finalizer that computes this award:

- does **not** derive XP from Challenge Rating;
- does **not** call `xpForCR`;
- does **not** use `adjustedXP`;
- does **not** use `encounterMultiplier`.

`adjustedXP` and any encounter multiplier remain exclusively encounter-difficulty tools, never
reward-authority tools.

## 8. Role of `computeCombatXP`

`computeCombatXP` (`lib/rules/progression.ts`) is **not** the implementation of the award, and is
**not** a universal validator of `xpValue` snapshot equivalence.

Reason: Challenge Rating alone does not always determine XP unambiguously, and `xpForCR`
(`lib/rules/encounters.ts`) falls back to a **nearest-key approximation** for CR values outside its
table — a lossy derivation the persisted `xpValue` snapshot does not carry.

Residual role of `computeCombatXP`:

- a pure reference helper expressing the historical SRD policy (sum of individual creature XP
  values, no encounter multiplier) for the CR values it represents;
- retains its existing test coverage;
- does **not** participate in the finalizer;
- does **not** authorize or reconstruct the persisted snapshot.

The exact source of the award is always `Combatant.xpValue`, backend-authorized at encounter
creation, per §5–§6.

## 9. Claim and idempotency (same encounter)

`Encounter.status` **does not mean "XP paid."** It is a claim: whoever wins the transition owns the
right to *evaluate* the award, not a record of payment.

Contract:

- The claim is the conditional transition `active → resolved`, using a conditional write whose
  affected-row count is observable (i.e., a form that reports how many rows matched, not a plain
  `update`).
- `count === 1`: this transaction may evaluate and, if warranted, grant the award.
- `count === 0`: this transaction grants nothing.
- The claim and the award evaluation happen inside the **same transaction**. If that transaction
  fails, everything rolls back and the encounter remains claimable.
- Winning the claim does not imply paying: `player_dead` wins the claim and pays 0 (§2);
  a legacy or `xpValue`-incomplete encounter wins the claim and pays 0 (§10).

This reuses, without new columns, tables, or migrations, the same pattern already proven for
level-up concurrency (`lib/rules/level-up-service.ts`): the pre-transition state is consumed by the
transition itself, under the database's default read-committed isolation, so a second concurrent
writer finds nothing left to match.

## 10. Invariant: single producer of `resolved`

> **Every mechanical transition of an `Encounter` to `resolved` must go through the authorized
> backend finalizer** (`finalizeEncounterTurn`, `lib/rules/combat-pipeline.ts`).

No other code path may write `status = "resolved"` directly. Doing so would bypass the claim
mechanism in §9, permanently consuming the encounter's claimable state without ever evaluating the
award — breaking idempotency and reward together, silently and irreversibly for that encounter.

**Current state (informational, not itself part of the decision):** as of this writing, exactly one
write of `status: "resolved"` exists in the entire reachable codebase, and it already lives inside
`finalizeEncounterTurn`. This invariant is stated to prevent regression, not to describe a gap.

A future architecture fence test should scan production source for direct `status: "resolved"`
writes outside the authorized finalizer module, following the existing pattern of this repository's
`tests/architecture/*-no-direct-prisma.test.ts` suite.

## 11. Fail-closed, terminal

If the encounter is legacy, is missing `xpValue` on any relevant enemy, or its reward source is not
authorized:

- the encounter resolves mechanically as normal — combat is never blocked or left in an inconsistent
  state by a missing reward source;
- it grants **0** XP;
- it does not invent a value and does not grant a partial award;
- **this resolution is terminal for the automatic award.**

**A later backfill does not reopen a resolved `Encounter` to grant XP retroactively.** Once the claim
in §9 is consumed, there is no state left to re-claim from — this is a structural consequence of the
transition being single-use, not a rule that depends on future code remembering to respect it.

Any future compensation for XP not granted must be a **new, separately authorized award** with its
own authority and its own idempotency identity — never a reinterpretation of an already-resolved
encounter.

## 12. Concurrency across distinct awards

No serialization across distinct awards on the same `Character` currently exists in the repository:
a `Character` can belong to more than one active `Campaign` (`Campaign.characterId` is not unique and
campaign creation does not check for it), so two independently resolved encounters can legitimately
attempt to grant XP to the same `Character.xp` at the same time. These are two different awards, not
a duplicate of the same one — §9's per-encounter claim does not, and should not, deduplicate them.

**Strategy selected: atomic increment of `Character.xp`, with the post-update value as
authoritative.** Not compare-and-swap with retry.

Contract:

1. Increment `Character.xp` atomically.
2. Take the post-update value returned by that operation as authoritative.
3. Derive `newXP`, `targetLevel`, `pendingLevels`, and `levelUpAvailable` **from that post-update
   value**.
4. **Never** derive them from the pre-increment snapshot.
5. `previousXP` may be recovered exactly as `postUpdate.xp - xpAmount`, since XP additions are
   integer and the increment amount is known.

This is not new engineering: the repository already applies this exact form for `Campaign.gold` in
`grantLoot` (`lib/rules/loot-service.ts`) — an atomic increment whose returned post-update value is
used as the authoritative figure for everything derived afterward.

Compare-and-swap with retry is not the selected strategy for this production. It is not needed
because `Character.xp` is monotonically non-decreasing and `getLevelFromXP` is a monotonically
non-decreasing function of XP: any precondition validated against a snapshot that could go stale
during a race (e.g., "the applied level does not exceed what the XP supports") remains true, or
becomes more clearly true, once the concurrent increment lands. A retry would add complexity without
correcting anything a plain atomic increment does not already guarantee.

## 13. Downstream chain — level-up presentation

After an XP grant commits, the existing, closed chain is reused exactly as-is:

```
detectPendingLevelUp → level_up_available (SSE frame) → player confirmation UI
  → POST /api/campaign/[id]/level-up (single-level CAS application)
```

No second ascension route is introduced. Because the award commits inside the same backend gate that
already precedes the action route's fresh-state read for `detectPendingLevelUp`
(`app/api/campaign/[id]/action/route.ts`), a level-up made available by this award surfaces to the
player within the same request that produced it.

## 14. Minimum required tests for the future implementation

1. The client cannot select `xpValue` — a request body carrying it does not alter the persisted
   value.
2. A custom enemy without a backend-authorized XP source resolves normally and grants 0.
3. A single enemy missing `xpValue` reduces the total award to 0, never a partial amount.
4. A resolved legacy encounter cannot later receive a retroactive award.
5. Two workers racing on the same `Encounter` produce exactly one winning claim/award.
6. Two legitimate, distinct awards on the same `Character` both accumulate correctly, with no lost
   update.
7. The award computation uses persisted `xpValue` snapshots only — never `adjustedXP` or an encounter
   multiplier.
8. No alternate code path can resolve an `Encounter` while bypassing the authorized finalizer
   (architecture fence test, §10).
9. `awardXP` remains outside the active narrator toolset.
10. A certified victory grants exactly `Σ xpValue`, exactly once.
11. `player_dead` grants 0.
12. Granting XP never changes `Character.level`.
13. `level_up_available` appears in the same request/response cycle when the award crosses a
    threshold.
14. Existing Model E contract tests remain green and unmodified in intent
    (`tests/rules/model-e-progression-contract.test.ts`).
15. Existing AI tool-containment guards remain green
    (`tests/ai/tool-policy.test.ts`, `tests/ai/narrator.test.ts`,
    `tests/ai/narrator-active-tools.test.ts`,
    `tests/architecture/narrator-tool-containment.test.ts`).

## 15. Out of scope

This decision does not define, and must not be read as implicitly deciding:

- Quest/mission XP and who authorizes it.
- Exploration XP (`EXPLORATION_XP`, `buildExplorationXpHints`) as a production, including the
  missing per-node visit tracking needed to prevent farming.
- Party composition and XP distribution among multiple player characters.
- Any postponed victory condition from §3 (subdual, rout, capture, negotiated resolution).
- Any 2024-rules variant of XP or advancement.
- Any advancement mechanic that ties XP to non-combat currency conversion, which
  `docs/DECISION_5E_SRD_API.md` §3 already places out of scope for the project as a primary
  advancement mechanic.

## 16. Definition of done for this decision

This decision is fully specified when:

- a future implementation can be reviewed strictly against §2–§13 without needing to invent policy;
- no code, schema, or test changes accompany this document at the time of its acceptance;
- the invariants in §1 are unchanged in code at acceptance time.

Implementation against this decision is separate work, subject to its own review, and must satisfy
at minimum the tests in §14.
