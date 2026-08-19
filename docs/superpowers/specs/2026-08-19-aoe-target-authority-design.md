# Area-of-effect target authority

**Date:** 2026-08-19
**Milestone:** V — The Cartographer & The Chronicler (`docs/MILESTONE_V_SPEC.md` §3–§4)
**Status:** approved design, not yet implemented

## Problem

The spell gate in `app/api/campaign/[id]/action/route.ts` selects targets like this:

```ts
targets = context.activeEncounter.combatants.filter(c => body.targetIds!.includes(c.id));
```

The client sends a list of combatant IDs and the backend applies the spell to exactly that
set. There is no geometric validation, and unlike the attack gate there is no `!isPlayer`
or `hp > 0` filter either. Typing "Cast Fireball" with eight enemies ticked applies 8d6 to
all eight, wherever they stand — `ActionInput.handleSubmit` attaches the ticked targets to
any typed action, so this is reachable, not theoretical.

**The client is deciding a mechanical outcome.** That is the project's non-negotiable rule
violated from the opposite side to the one the August audit closed: there the AI narrated
what the backend had not resolved; here the caller resolves what the backend should own.

The data needed to close it is already persisted and read nowhere: `SrdSpell.data` carries
`area_of_effect` with `{ size, type }`, and combatants carry `x`, `y` and `size`.
`getAoETargets` is specified in `MILESTONE_V_SPEC.md` §3 and does not exist.

## Scope

**In:** area spells. The backend derives who is affected from geometry.

**Out, with reasons:**

- **Spell range from the caster.** `SrdSpell.data.range` is free text and bilingual —
  "30 pies", "120 pies", "Personal", "Lanzador" appear in the same column. A parser for it
  belongs in its own change; a weak one would reject legal spells or admit illegal ones.
- **Non-area spells.** They keep accepting the client's list. Magic Missile has no area and
  strikes up to three chosen creatures, and the SRD cache stores no target count — there is
  no field to validate against. Enforcing "exactly one target" would break a legal spell.
  This is a remaining leak, recorded rather than silenced.
- **`EncounterMap` and bounds validation.** Blocked on issue #64 (Prisma baseline strategy).
- **UI.** `MILESTONE_V_SPEC.md` §5 forbids touching it until the backend is done.

## Architecture

A new pure module, `lib/rules/spell-targeting.ts`, answers one question: **which creatures
does this spell legally affect?** It returns the target set or a typed refusal. No database,
no I/O.

| Module | Owns |
| --- | --- |
| `lib/rules/geometry.ts` | Grid mathematics. Already has `isInSphere`, `isInCone`. Gains cube and line predicates, and nothing else. |
| `lib/rules/spell-targeting.ts` | Composition. Chooses which predicate applies and to whom. Contains no trigonometry of its own. |
| `lib/rules/spell-resolution-service.ts` | Normalising `area_of_effect` into a typed field on `ResolvedSpellEffect`. It already turns raw SRD JSON into a typed effect. |
| `app/api/campaign/[id]/action/route.ts` | Calls `spell-targeting` once and stops deciding. |

Not owned here: slot accounting (`consumeSlot`, via the combat pipeline), damage and saving
throws (`executeCombatAction`), range validation (deferred above).

The split between geometry and composition is practical: shape predicates are tested with
points and numbers, composition is tested with combatants. Each test then fails for one
reason.

The action route is 1037 lines, and the August audit found two defects hiding in its inline
branches — a proficiency bonus hardcoded in two places that could drift apart, and target
filters that differed between gates. Adding area geometry inline would continue that.

## Normalising the SRD area

Queried from the live `SrdSpell` table: **85 spells carry an area, across ten distinct type
strings, in two languages, with neither dominant.**

| Type | Spells | | Type | Spells |
| --- | --- | --- | --- | --- |
| `esfera` | 25 | | `line` | 7 |
| `cubo` | 15 | | `cylinder` | 5 |
| `sphere` | 13 | | `cono` | 5 |
| `cube` | 8 | | `cuadrado` | 3 |
| | | | `cilindro` | 3 |
| | | | `cone` | 1 |

Three consequences.

**Two shapes the milestone spec does not list.** `cylinder`/`cilindro` (8 spells) is a real
SRD area; on a flat grid its footprint is a circle, so it normalises to a sphere of the same
radius, ignoring height. `cuadrado` (3 spells) is not an SRD area type and looks like a
translation artifact of "cube", so it maps to cube. Both are house rulings, documented where
they are made.

**Sizes reach 5,280 ft (`cubo`) and 40,000 ft (`cube`)** — a mile and seven miles. So
`getAoETargets` must **test each combatant against the shape**, never enumerate the squares
of the shape: a 40,000 ft cube on a 5 ft grid is 8,000 × 8,000 = 64 million cells, and an
implementation that walks the area hangs. `isInSphere` and `isInCone` already work
point-wise; the constraint is not to deviate. No size cap is needed — evaluated point-wise, a
mile-wide effect simply includes everyone in the encounter, which is correct.

**`size` means different things per shape**, and this must be fixed explicitly: radius for
sphere and cylinder, edge length for cube, length for cone, length for line (with 5 ft width
implied). These map directly onto the existing signatures `isInSphere(radiusFt)` and
`isInCone(lengthFt)`.

The result is `ResolvedSpellEffect.area: { shape, sizeFt } | null`, where `shape` is one of
exactly four values — **`sphere`, `cube`, `cone`, `line`**. The ten source strings collapse
onto them: `esfera`/`sphere`/`cylinder`/`cilindro` → `sphere`; `cubo`/`cube`/`cuadrado` →
`cube`; `cono`/`cone` → `cone`; `line` → `line`.

**An unrecognised type fails closed and the cast is refused.** All ten observed strings are
covered, so a new value means the data changed underneath us. Treating it as "no area" would
hand target selection back to the client and reopen the hole this change exists to close.

## Origin and direction

The SRD splits area shapes into two families, and the rule differs between them:

- **Point-anchored** — `sphere` and `cube` (cylinders have already normalised to spheres by
  this stage). The caster picks a point within range; the origin is that point.
- **Caster-anchored and directional** — `cone` and `line`. These emanate from the caster:
  "a line 100 feet long that originates from you." They are not placed anywhere.

So origin derivation is two steps.

**Step 1 — derive an aim point.** Use `body.targetX`/`targetY` when supplied (both integers).
Otherwise use the square of the creature the action names, when it resolves to exactly one
combatant. The search covers **every combatant in the encounter**, not only living hostiles:
centring a blast on an ally's square, or on a fallen creature's, is a legal and sometimes
deliberate aim. Otherwise refuse. `ActionBody` already carries `targetX`/`targetY` and
`BattleGrid` already converts a pointer to a cell for the Move macro, so the transport exists
and is unused for spells.

**Step 2 — apply the family.** For point-anchored shapes the origin is the aim point. For
cone and line the origin is the caster's square and the aim point supplies only the
direction. Aiming at the caster's own square is refused: `isInCone` guards a zero-length
vector already, but a stated refusal beats a silently empty set.

### Who ends up in the set

Every combatant whose footprint intersects the area — **the caster and their allies
included, and creatures already at 0 hp included**. A fireball affects each creature in its
radius; excluding the party would be exactly the kind of silent mechanical decision this
change exists to remove, only made by the backend instead of the client.

Intersection is by footprint, not centre: a combatant counts as affected when *any* square it
occupies falls inside the area, reusing `getCombatantOccupiedSquares`. This matters for Large
and bigger creatures, whose 2×2 or 3×3 footprint can catch the edge of a blast their centre
square misses.

**One thing implementation must verify rather than assume:** whether `executeCombatAction`
handles a caster caught in their own area, and damage applied to a creature already at 0 hp.
Neither path is exercised today. If either misbehaves, that is a defect to surface and fix or
record — not a reason to quietly drop those combatants from the set, which would reintroduce
the hole from the other side.

### What `targetIds` means now

For an area spell it no longer selects. Its only remaining job is supplying the aim point
when no coordinates are sent, and only when it resolves to exactly one creature; with several
and no coordinates the aim is unknowable, so the cast is refused — the same "exactly one or
nothing" rule the attack gate already applies.

For a non-area spell it still selects, per the scope note above.

### Refusals

All 400, in the style of the existing gates:

| Code | When |
| --- | --- |
| Unsupported area shape | `area_of_effect.type` is outside the closed set |
| Aim required | Area spell with neither coordinates nor a resolvable creature |
| Aim ambiguous | Several candidate creatures and no coordinates |
| Degenerate direction | Cone or line aimed at the caster's own square |

Per `MILESTONE_V_SPEC.md` §4, the derived set populates `targets[]` in the SSE payload: what
the narrator receives becomes what the geometry decided.

## Testing

`MILESTONE_V_SPEC.md` §5 requires the geometry proven before anything else. Three layers,
each able to fail for a single reason.

**Shape predicates** (`tests/rules/geometry.test.ts`, extended): cube and line, with points
and numbers, no combatants. Includes the scale guard — a 40,000 ft area with three combatants
must resolve correctly. It does not directly assert "does not enumerate cells"; what it does
is make a reimplementation that walks the area exhaust the test timeout. Stated plainly
rather than claimed as more than it is.

**Composition** (`tests/rules/spell-targeting.test.ts`, new): both origin families, the
caster-anchored direction, and the four refusals. The two that close the hole, in both
directions:

- a creature **outside** the area is **not** returned, even when the client named it;
- a creature **inside** **is** returned, even when the client did not — an ally caught in the
  blast included.

The second exists to stop a later "fix" that intersects the client's list with the geometric
set. That would let a player spare allies by not ticking them, which is the same class of
client-side mechanical decision this change removes.

**Normalisation** (`tests/rules/spell-resolution-service.test.ts`, extended): all ten observed
strings map to their shape, and an unknown string fails closed. This table is the guard
against the bilingual data — if `línea` appears tomorrow it surfaces here, not in play.

**End to end** (`tests/api/action-intent-contract.test.ts`, real `parseIntent`): a Fireball
whose `targetIds` include a creature outside the radius — that one takes no damage — and a
creature inside that nobody named — that one does. This is the regression that would have
caught the original hole.

**Structural guard**, in the style of `tests/architecture/intent-gate-exhaustiveness.test.ts`:
every shape in the closed set must have a predicate. Adding a shape to the enum without
geometry fails here.

### One existing test must change

`tests/api/action-intent-contract.test.ts` currently asserts that a spell resolves against
both client-supplied `targetIds`, with no positions given. Under the new rule that test
documents the hole — the same way an earlier test asserted that `search` reached a gate that
did not exist. It gains positions and becomes: both creatures are inside the radius, both are
hit. Same intent, now honest.

### Verification

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm check-retro && pnpm build
```

Baseline before this work: 2889 tests in 145 files, all other checks clean.

## Related

- `docs/MILESTONE_V_SPEC.md` §3–§5 — the specification this implements a slice of.
- Issue #64 — Prisma baseline strategy; blocks the `EncounterMap` half of the milestone.
- `AGENTS.md` "Dormant defects" — `area_of_effect` is a textbook instance: correct data,
  persisted, read by nothing, harmless until something depends on it.

## Observation, not in scope

`lib/rules/magic-service.ts` (`castSpell`) and the inline gate each consume spell slots
independently, both calling `consumeSlot`. The service is narrower than it first appears — it
handles slot accounting only, not targets or damage — so this is not two rival
implementations. But it is one rule implemented in two places, and `/api/campaign/[id]/magic/cast`
has no caller in the UI. Worth its own task.
