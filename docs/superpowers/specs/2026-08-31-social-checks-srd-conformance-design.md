# Social checks — SRD conformance and wiring

Date: 2026-08-31
Status: Approved for implementation (increment 1)

## Why

The social system is built at both ends and missing its middle.

The front end is live. `app/campaign/[id]/page.tsx:361` renders
`DialogueOverlayController`, and `DialogueOverlay` has a disposition meter,
persuade/intimidate/deceive controls, and a rumour action gated on
disposition. `NPCRoster` renders each NPC's disposition band.

The back end exists and is tested. `lib/rules/social-logic.ts` resolves a
social check; `lib/rules/social-service.ts` persists one; `npc-service.ts`
establishes an initial disposition.

Between them there is nothing:

| Link | State |
| --- | --- |
| `dialogue_open` frame | Declared in `lib/events/game-events.ts:172`, consumed in `ActionInput.tsx:173`, **emitted by nobody** |
| Social intent | `IntentSchema.actionType` has nine values, none social |
| Social gate | The action route has eight gates; none is social |

So `DialogueOverlayController` returns `null` forever — the overlay never
opens. It is a consumer with no producer, at the scale of a whole feature.

The reason is recoverable from history: the tool that drove this was the AI's
`socialCheck`, and SEC-AI-001 removed the narrator's state-changing tools
permanently and correctly, without building a replacement control.

The maintainer has decided the game should have social checks and NPC
disposition. This spec covers making the rules SRD-conformant first, then
building the missing middle.

## Rules decisions

Four decisions were taken during design. All four are recorded here because
each has a canon dimension.

### 1. Conform to the SRD before wiring

The existing `resolveSocialCheck` deviates from D&D 5e/SRD 2014 in three ways:
it applies critical success/failure to an ability check, it uses a bare
Charisma modifier with no proficiency bonus, and it derives an unbounded DC
from a −10..10 track. All three are corrected before anything is wired, so no
deviation reaches a live path and no persisted result has to be reinterpreted
later.

### 2. Attitude selects a DC from the SRD table

`lib/rules/ability-check.ts` already holds `DIFFICULTY_DC`, the SRD's Typical
Difficulty Classes. Attitude selects a band from it:

| Attitude | Band | DC |
| --- | --- | --- |
| Hostile | `hard` | 20 |
| Indifferent | `medium` | 15 |
| Friendly | `easy` | 10 |

Only canonical values are used, and the DC is bounded.

**Accepted consequence:** asking for directions and asking someone to betray
their liege carry the same DC. Difficulty comes from attitude alone. An
alternative — base DC by request difficulty, adjusted by attitude — was
considered and rejected as inventing a margin the SRD does not sanction.

### 3. Three 5e attitudes

`Hostile | Indifferent | Friendly` replaces the current five-step
`Hostile / Unfriendly / Indifferent / Friendly / Helpful`, which is the
3.5e/Pathfinder Diplomacy ladder rather than a 5e construct.

### 4. One bounded step per check, set by the backend

`SocialCheckInputSchema.dispositionDelta` — **a caller-supplied magnitude** —
is removed. It let the AI tool decide how far a mechanical outcome moved,
which the project's own authority rule forbids.

The backend sets it, by outcome alone:

| Outcome | Shift |
| --- | --- |
| Success | `+4` |
| Failure | `−4` |

Clamped to −10..10. Each band is seven points wide, so ±4 moves attitude by at
most one step from any starting value — the bound the decision requires.

**Approach does not affect the shift.** Persuade, intimidate and deceive
differ in which skill is rolled, and therefore in who is good at them; they do
not differ in what a success or a failure is worth. This is a deliberate
change from the current code, where failing to persuade cost nothing and only
a failed intimidate cost standing. Every attempt now carries the same stake,
which is what makes the choice of approach a question of the character's
skills rather than of which failure is cheapest.

Attitude change is not in the SRD — the DMG's social interaction rules are not
part of SRD 5.1. This is therefore a declared house rule: small, bounded, and
recorded here as such.

## Increment 1 — rules conformance

Pure functions and their consumers. No route changes, no new intent, no event
emission.

### The check delegates to the existing engine

The largest change is subtraction. `resolveSocialCheck` stops being its own
dice engine and becomes an adapter over `resolveAbilityCheck`:

- approach maps to a skill — persuade → `Persuasion`, intimidate →
  `Intimidation`, deceive → `Deception`. All three are already in
  `SKILL_ABILITY`, all three already resolve to `CHA`.
- attitude maps to a `DifficultyBand` per the table above.
- `resolveAbilityCheck` then supplies the ability, the proficiency bonus,
  advantage/disadvantage and the roll.

`computeSocialDC` is deleted along with its three terms: the unbounded
disposition penalty, the `(attempt − 1) × 3` ambition penalty, and the
intimidate `−2`.

### Criticals become narration, not mechanics

`AbilityCheckResult` reports `isCriticalSuccess` / `isCriticalFailure`.
Reporting that the die showed a 20 is a fact and may reach the narrator.
**The attitude shift must ignore both fields.** In 5e a natural 20 or 1 has no
special effect on an ability check; the shift depends on nothing but whether
the check succeeded.

### Attitude derives from the stored number

`NPC.disposition` stays `Int?` in the −10..10 range. **No migration.**

| Disposition | Attitude |
| --- | --- |
| ≤ −4 | Hostile |
| −3..3 | Indifferent |
| ≥ 4 | Friendly |

Existing rows stay valid, and `DialogueOverlay`'s meter arithmetic
(`(disposition + 10) / 20 × 100`) is unaffected.

### Targeted cleanups this work carries

Each of these is inside the blast radius of the change; none is opportunistic
refactoring.

- `DISPOSITION_BANDS.min` / `.max` are never read — `getDispositionBand`
  hardcodes its thresholds. The constant is reduced to what is consumed.
- `components/NPCRoster.tsx:104` holds a **second copy** of
  `getDispositionBand`. It is deleted and the module's function imported,
  restoring the lib→UI direction the project mandates.
- `prisma/schema.prisma`'s `disposition` doc-comment still credits
  `rollReaction` — the AD&D 2d6 reaction roll that
  `docs/DECISION_5E_SRD_API.md` §3 prohibits by name. The function is gone
  from `lib/` and `app/`; the comment is re-founded on the 5e basis. Stale
  `rollReaction` mentions in `DispositionBadge.tsx:60` and
  `DialogueOverlay.tsx:38` go with it.
- `check-retro` scans four paths and covers neither `schema.prisma` nor
  `components/`, which is why that vocabulary survived. Extending its scope is
  **out of scope here** and noted for its own increment.

### Consumers

| File | State | What changes |
| --- | --- | --- |
| `lib/memory/formatter.ts` | **Live** — narrator context | `DISPOSITION_ICONS` is `Record<DispositionBand, string>`, so three attitudes is a compile error here. Icons reduce to three. The secret currently revealed at `Helpful` re-points to **Friendly**. |
| `components/NPCRoster.tsx` | **Live** (`page.tsx:933`) | Duplicate banding deleted; palette to three |
| `components/social/DialogueOverlay.tsx` | Rendered, never opens | Follows the type. The `npc.disposition < 3` rumour gate becomes an attitude comparison rather than a magic number |
| `components/npc/DispositionBadge.tsx` | **Dead** — nothing renders it | Has real tests in `tests/components/DispositionBadge.test.tsx`, so deleting is not free. Updated in place; its deletion is a separate decision |
| `lib/rules/social-service.ts` | Dead — reachable only from the removed AI tool | Kept compiling. Whether the gate calls it or replaces it is decided in increment 2 |

`formatter.ts` is the one that matters: a wrong value there does not crash, it
tells the narrator something false. It gets its own assertions, not just a
compile fix.

### Testing

Three of the four changes are removals, and a removed term is easy to test
vacuously. Every test below is falsified by breaking the line it guards,
separately, per `AGENTS.md`.

| Target | Assertion | Falsified by |
| --- | --- | --- |
| DC per attitude | The exact SRD value for each | Changing each constant alone — only its test may die |
| **No criticals** | A natural 20 that misses the DC is a failure; a natural 1 that beats it is a success | Reintroducing the crit branch |
| Proficiency | Same Charisma, one proficient → different totals | Dropping the proficiency term |
| Backend-set shift | The `.strict()` schema **rejects** a supplied `dispositionDelta` | Without this the removal is only a compile-time fact |
| Shift is outcome-only | All three approaches shift identically on the same outcome | Reintroducing any per-approach branch |
| One-step bound | From **every** disposition in −10..10, one check moves attitude at most one step | Stated as an invariant, not sampled |
| Formatter | The constraint line names the right attitude; the secret is withheld below Friendly and present at Friendly | The only path where a wrong value reaches the narrator silently |

The no-criticals test pins the die with `vi.spyOn(Math, "random")`.
`AGENTS.md` records the matching failure on the attack side: an assertion that
depends on the roll landing a certain way proves nothing about the rule.

One architecture guard, shaped like
`tests/architecture/srd-monster-single-lookup.test.ts`: **`getDispositionBand`
is defined in exactly one module.** That is what stops `NPCRoster`'s copy
coming back, binding both ends rather than trusting nobody duplicates it
again.

## Increment 2 — the bridge (not in this plan)

Recorded so increment 1's decisions have their destination, and planned
separately:

- a social value in `IntentSchema.actionType` with deterministic
  classification, respecting `tests/architecture/intent-gate-exhaustiveness.test.ts`
- a social gate in `app/api/campaign/[id]/action/route.ts` that resolves the
  target NPC, calls the rule, persists disposition in a transaction, and emits
  deterministic events before narration
- emission of `dialogue_open` and `dialogue_update`, which the front end
  already consumes
- the decision on whether the gate uses `social-service.resolveSocialCheck` or
  replaces it

Two known unknowns for that increment: resolving a free-text NPC name to a
row, and whether the overlay's dispatched sentences classify reliably.

## Out of scope

- Rumours (`resolveRumors`) beyond keeping them compiling
- The fate of the dead AI tool surface — 24 tools across seven builders,
  tracked in `AGENTS.md`
- Extending `check-retro`'s scan paths
- Deleting `DispositionBadge.tsx`
- Any migration

## Risks

- **`formatter.ts` feeds the narrator.** A wrong attitude reaches the model as
  an authoritative fact and is narrated as true. The compile error catches the
  shape; the assertions catch the value.
- **Attitude change is a declared house rule.** It is bounded and recorded,
  but it is not SRD. If that is later judged to breach §3's prohibition on
  reaction and loyalty procedures, the fallback is decision 4's rejected
  option: attitude set once at first meeting and never moved by a check.
- **The same DC for every request** is a real modelling loss, accepted
  knowingly under decision 2.
