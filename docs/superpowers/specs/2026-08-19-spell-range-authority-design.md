# Spell range and targeting authority

**Date:** 2026-08-19
**Milestone:** V — The Cartographer & The Chronicler (`docs/MILESTONE_V_SPEC.md` §3–§4)
**Status:** approved design, not yet implemented
**Follows:** `docs/superpowers/specs/2026-08-19-aoe-target-authority-design.md`, which deferred this

## Problem

The area-of-effect work made the backend decide *who* a spell hits. Nothing yet
decides *whether the caster could reach that point at all*. A Fireball can be
aimed at a square on the far side of the map, and a spell whose SRD range is
"Personal" — meaning it affects only the caster — can be aimed at an enemy.

That range was deferred because `SrdSpell.data.range` is free text and bilingual,
and a weak parser would reject legal spells or admit illegal ones. Querying the
live table rather than sampling it shows the field is worse than "free text with
units", and better than it looks:

| Bucket | Spells | Values |
| --- | --- | --- |
| Numeric distance | 180 | `60 pies` (55), `30 pies` (47), `120 pies` (31), `90 pies`, `10 pies`, `150 pies`, `300 pies`, `100 pies`, `500 pies`, `5 pies`, and `60 feet` (2) |
| Touch | 66 | `Toque` (64), `Touch` (2) |
| Caster only | 56 | `Lanzador` (49), `Personal` (4), `Self` (2), `Autolanzado` (1) |
| Caster only, shape in the text | 3 | `Lanzador (línea recta de 60 pies)`, `Lanzador (radio de 5 millas)`, `Personal (radio de 15 pies)` |
| Miles | 3 | `1 milla` (2), `500 millas` (1) |
| No enforceable distance | 4 | `Vista` (2), `Especial` (1), `Ilimitado` (1) |
| Missing | 4 | `null` |

**26 distinct values across 316 spells, and 122 of them — 39% — are not
distances at all.** `Toque` and `Lanzador`/`Personal` encode targeting rules.
So this is not "validate a distance"; it is "classify how a spell may be aimed".
A parser that only reads feet would leave 39% of the catalogue unconstrained,
including every self-only spell.

## Scope

**In:** classifying the whole targeting rule — distance, touch, caster-only, or
unenforceable — and enforcing all three enforceable kinds.

**Out, with reasons:**

- **Line of sight.** `Vista` means "anything you can see"; no visibility model
  exists and inventing one is its own subsystem.
- **`EncounterMap` and grid bounds.** Blocked on issue #64.
- **UI.** `MILESTONE_V_SPEC.md` §5 forbids it until the backend is done.
- **The remaining non-area leak.** Range now constrains non-area spells, but the
  SRD cache still stores no target *count*, so a single-target spell can still be
  cast at three creatures that are all in range. Narrowed, not closed.

## Architecture

Same shape as the area work, deliberately, so the next reader learns one pattern
rather than two.

| Module | Owns |
| --- | --- |
| `lib/rules/spell-resolution-service.ts` | `parseSpellRange` — raw SRD text to a closed type. Sits beside `parseSpellArea`. |
| `lib/rules/spell-targeting.ts` | The range rule, as a function exported beside `resolveAreaTargets`. Pure composition over geometry. |
| `lib/rules/geometry.ts` | Unchanged. `gridDistanceFt` and `getCombatantOccupiedSquares` already do what is needed. |
| `app/api/campaign/[id]/action/route.ts` | Calls the check and obeys it. |

The check lives beside `resolveAreaTargets` rather than in its own module because
both answer a targeting question from the same inputs — caster, aim, combatants —
and both are pure composition. A file holding one function tends to attract
things that do not belong to it.

`ResolvedSpellEffect` gains a required `range` field, required for the same
reason `area` is: a fixture that forgets it should fail loudly rather than
silently resolve as unconstrained.

### The closed type

```ts
export type SpellRange =
  | { kind: "distance"; feetFromCaster: number }   // 183 = 180 in feet + 3 in miles
  | { kind: "touch" }                              //  66
  | { kind: "self" }                               //  59
  | { kind: "unenforceable"; raw: string | null }  //   8
```

`touch` is its own case although it is mechanically 5 ft. The numeric comparison
is shared, so the duplication is in the name only; what it buys is a message the
player can act on — "you have to be adjacent" rather than "out of range".

`unenforceable` carries the raw value. Without it the result could say the range
went unchecked but not why, and `Ilimitado` (the spell's actual rule) and `null`
(a data gap) are different situations.

## Normalising the 26 values

**Bilingual, as the area field was, and again with no dominant language:**
`Toque`/`Touch`, `Lanzador`/`Self`, `pies`/`feet`, plus `Personal` and
`Autolanzado` as further synonyms for caster-only. None can be dropped.

**Units:** `pies` and `feet` pass through; `milla`/`millas` multiply by 5,280. No
cap is needed — `Proyectar Imagen` at 500 miles simply never fails the check,
which is correct.

**Check order is the trap in this field.** Three values are caster-only *with a
number inside them*:

```
Lanzador (línea recta de 60 pies)
Lanzador (radio de 5 millas)
Personal (radio de 15 pies)
```

A parser that looks for "number + pies" first classifies `Espíritus Guardianes`
as a 15 ft range instead of caster-only, and the spell becomes aimable 15 ft away
when it actually emanates from the caster. So the `self` and `touch` keywords are
matched **before** any distance, and three tests pin those exact strings.

**The parenthetical also carries the area.** Of those three spells,
`Ráfaga de Viento` already has `area_of_effect` populated, but **`Controlar el
clima` and `Espíritus Guardianes` do not — the parenthetical is the only place
their area lives.** Without extracting it, `Espíritus Guardianes`, an ordinary
combat spell, falls to the no-area path and accepts the client's target list
again — the hole the previous increment closed.

So `parseSpellRange` also extracts that shape when present, and `area_of_effect`
takes precedence when both exist. It is a second small parser over three known
strings; the alternative is a silent gap in a spell people cast.

The three strings map as follows, and nothing else is recognised:

| Parenthetical | Extracted area |
| --- | --- |
| `radio de 15 pies` | `{ shape: "sphere", sizeFt: 15 }` |
| `radio de 5 millas` | `{ shape: "sphere", sizeFt: 26400 }` |
| `línea recta de 60 pies` | `{ shape: "line", sizeFt: 60 }` |

"radio" is a radius, so it becomes a sphere with that radius — the same meaning
`size` carries for a sphere in `area_of_effect`. A parenthetical whose wording is
not one of these two forms extracts nothing and the spell simply has no area,
which is the current behaviour for all three.

**A deliberate asymmetry with the previous increment.** An unrecognised *area
shape* refuses the cast; an unrecognised *range* allows it and says so. That is
not an inconsistency. Without the shape the target set cannot be computed, so
proceeding hands selection back to the client. Without the range, one constraint
is missing while the target set is still entirely backend-derived. The rule
follows the failure surface.

## Where the check applies

**Range gates the point of origin, not the targets.** A Fireball cast at 120 ft
has a 20 ft radius and legitimately reaches something 140 ft away. Measuring the
targets would reject legal spells, and it is the easy mistake here.

- **Area spell:** measure caster → aim point.
- **Non-area spell:** measure caster → each target in the set the gate already
  resolved, whether that came from `targetIds` or from the named creature. This
  constrains non-area spells for the first time. A spell that resolved to no
  targets at all — a self-buff with neither area nor selection — has nothing to
  measure and passes.
- **`self`:** the origin *is* the caster, so the distance is zero and always
  passes. A supplied aim point is **ignored, not refused** — a self spell has no
  point to choose, and refusing would punish the player for sending an irrelevant
  field.
- **`touch`:** the same comparison at 5 ft.

**The check runs before the target set is derived.** Out of range is the more
useful diagnostic and the cheaper one: a player told "that is 40 ft away and the
spell reaches 30" knows what to do, whereas computing a set first and refusing
afterwards risks reporting "the spell hit nobody" for what is really a reach
problem.

**Distance is measured between footprints, not anchors.** Caster and target may
be Large or bigger, and comparing anchor square to anchor square gives the wrong
number — the same error a reviewer caught in the area work. The correct measure is
the **minimum** `gridDistanceFt` between any square of the caster's footprint and
any square of the target's, reusing `getCombatantOccupiedSquares`. An ogre
occupying 2×2 has an edge closer than its anchor.

`gridDistanceFt` is Chebyshev × 5, which is the 5e grid rule where a diagonal
costs 5 ft. Verified in the source rather than assumed.

### Refusals

**One code, `OUT_OF_RANGE`,** with the message distinguishing touch from
distance — "you need to be adjacent" against "that is 40 ft away and the spell
reaches 30". Two codes for one comparison would be duplication in the name with
nothing behind it.

**`AIM_AMBIGUOUS` narrows to area spells.** The previous increment fired it
whenever a name matched several creatures. That is wrong for a spell with no area:
naming two creatures there is a legitimate multi-target selection, not an
ambiguous point of origin. Only an area spell needs one unambiguous square, so
only an area spell refuses for it. This is a behaviour change to code merged in
#94, deliberate and small.

For a non-area spell with several targets where one is out of range, **the whole
cast is refused** rather than dropping that target and resolving the rest.
Dropping it silently would be the backend altering the player's selection without
telling them — the same quiet mechanical decision this work keeps removing.

**The unenforceable case declares itself.** When `range.kind` is
`unenforceable`, the gate writes a system line to the game log saying the range
was not verified and naming the raw value, so `Ilimitado` and `null` remain
distinguishable. Only in that case: doing it for the other 308 spells would be
noise. `combat-pipeline` and the `SPELL_CAST` payload are deliberately untouched
— the game log is already where this route declares resolved facts, as the
ability check does.

## Testing

Five layers, each able to fail for one reason.

**The normalisation table** (`tests/rules/spell-resolution-service.test.ts`): all
26 observed values against their kind. This is the guard against the bilingual
data. Three entries carry the ordering trap and must assert `self` rather than
`distance`; miles convert; `null` yields `unenforceable` with a null raw.

**Footprint measurement** (`tests/rules/spell-targeting.test.ts`) — and this one
must genuinely discriminate. A Large caster at (0,0) occupies out to (1,1); a
target sits at (8,0). Anchor to anchor is 40 ft; footprint to footprint is 35 ft.
With a 35 ft range, an anchor-measuring implementation **refuses a legal spell**
and the test catches it. Without that case, measuring anchors would pass.

**Origin against targets:** a Fireball at exactly its maximum range whose radius
reaches beyond it. The cast must be allowed and the edge targets must still take
damage. An implementation that checks targets instead of the origin fails here.

**The three behaviours:** a `self` spell with coordinates across the map resolves
at the caster and ignores them; a non-area spell with one out-of-range target is
refused entirely, with nothing mutated and no narration; an `unenforceable` spell
resolves and leaves the raw value in the log.

**Structural guard** (`tests/architecture/`): every `SpellRange` kind must be
handled by the check. Adding a case to the union without a rule behind it fails
there, as the area-shape guard does.

### Cross-cutting fixture fallout

An earlier draft of this spec claimed the area fixtures merged in #94 would start
returning `OUT_OF_RANGE`, because they place the caster 200 ft from the aim while
Fireball reaches 150. **That was wrong, and checking beat reasoning:** none of
those fixtures declares a `range` in its spell `data` at all, so every one of them
classifies as `unenforceable` and passes untouched.

The real consequence is quieter and worse. Those fixtures would sail through
without ever exercising the new code, and each would emit an "range not verified"
log line for a spell whose range is perfectly well defined in the real SRD. So the
work includes giving the existing spell fixtures a `range` that matches the spell
they claim to be — `150 pies` for Fireball — and repositioning the caster inside
it. (10,0) works for the area tests: 45 ft to the aim, within 150 and clear of the
20 ft radius.

A fixture that omits a field the production data always carries is the same
hazard this repository keeps rediscovering: the test passes, and it passes for a
reason unrelated to what it claims to prove.

### Verification

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm check-retro && pnpm build
```

Baseline before this work: 2932 tests in 147 files, all other checks clean.

## Related

- `docs/superpowers/specs/2026-08-19-aoe-target-authority-design.md` — the
  increment that deferred this, and whose fixtures this one disturbs.
- `AGENTS.md` "Dormant defects" — `range` is another instance: correct data,
  persisted, read by nothing.
- Issue #64 — Prisma baseline strategy; blocks the `EncounterMap` half of the
  milestone.
