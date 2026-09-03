# Wilderness travel, SRD 2014 — design

**Date:** 2026-09-03
**Status:** approved, pending implementation plan
**Baseline:** `master` at `c51b5ad`

## 1. The canonical decision this records

`prisma/migrations/20260805090000_reconcile_nonlegacy_schema_preserving_combat_state`
excludes six tables by name — `CampaignTime`, `PartyInventory`, `WildernessMap`,
`TravelState`, `Haven`, `Retainer` — calling them "the six preserved retro
structures" and deferring them "pending a separate 5e/SRD 2014 decision".

**This document is that decision, for the wilderness half of it.**

The decision is: **the game gets SRD 2014 travel, and does not get a hexcrawl.**
No hexes, no four-hour watches, no ten-minute dungeon turns, no per-watch
resource attrition. Those are the retro structures the exclusion was protecting
against, and nothing here reinstates them.

The remaining five excluded tables are untouched and stay excluded. This
decision does not extend to them.

### Consequences for existing code

`lib/rules/wilderness.ts` (548 lines), `lib/rules/wilderness-service.ts` (798)
and `lib/ai/tools/wilderness.ts` (68) implement the hexcrawl model. They have
never executed in production: their tables do not exist, `resolveDb` throws
`LEGACY_SUBSYSTEM_DISABLED`, and the tool is not in the narrator boundary.

This design does **not** modify or delete them. Retiring them is a separate
increment, and it should be a separate one: it is a 1,414-line deletion whose
only justification is this decision, and mixing it into the feature would make
both harder to review. It is recorded here as the natural follow-up.

One exception, in scope because it is a live falsehood rather than dead code:

> `formatIronLaws()` ends with `Wilderness day structure is fixed at
> ${WATCHES_PER_DAY} watches.` (`lib/memory/formatter.ts:85`). This reaches the
> narrator on **every single turn** — it is part of the Iron Laws, not a
> conditional section. Today it describes a subsystem that cannot run. Under
> this design it becomes actively wrong: the day is eight hours of marching,
> not six watches. The line is removed, and `WATCHES_PER_DAY` stops being
> imported by the formatter.

## 2. Problem

There is no way to travel between locations.

`moveCampaignToNode` writes only `currentNodeId` — movement *within* a location.
`currentLocationId` is written only by `exploration-service` when it *generates*
a location. The party therefore appears in new places and never journeys to a
known one.

Meanwhile `Character.exhaustionLevel` is a complete loop missing exactly one
piece:

| Role | Status |
| --- | --- |
| Consumer | **Live.** `evaluateAbilityCheckAdvantage(conditions, exhaustionLevel)` at `action/route.ts:473`; `lib/rules/conditions.ts` imposes disadvantage at level 1+ |
| Reducer | **Live.** `resolveRest` reduces it on a long rest; wired to the `rest` intent |
| Producer | **None.** Nothing in the game has ever raised it |

SRD forced march is the canonical producer. Connecting travel closes that loop
with no invented mechanic.

## 3. Scope

### In

- Travel to a location the campaign already knows.
- Journey duration in days at the SRD normal pace.
- Forced march as an explicit player choice, with SRD Constitution saves and
  exhaustion.
- Removal of the watches line from the Iron Laws.

### Out, and why

| Excluded | Reason |
| --- | --- |
| Fast/slow pace | Their SRD side effects are −5 passive Perception and the ability to travel stealthily. **Neither has a live consumer:** passive Perception exists only in the character-sheet view model and PDF, and no rule reads a travel stealth flag. Offering the choice without its costs would make "fast" strictly optimal and the decision fake |
| Weather, foraging, random encounters, scouting | No consumer, and each is its own feature |
| Hex map, watches, dungeon turns | Excluded by §1 |
| A campaign clock | Not needed; see §4.3 |
| Death at exhaustion 6 | See §7 |

## 4. The rule — `lib/rules/travel.ts`

Pure. No I/O, no Prisma, deterministic for the same inputs.

### 4.1 Distance

```
travelDistanceMiles(seedA: string, seedB: string): number
```

Derived from the two location seeds, **sorted before seeding**, so that A→B and
B→A are the same journey. Range 12–48 miles inclusive.

`Location` has no coordinates and no distance column, and this design adds
none: derivation from seeds is the convention the repository already uses for
names (`generateLocationName`), loot flavour (`generateMundaneLoot`) and
encounter tension.

### 4.2 Duration

SRD normal pace: 3 miles per hour, 24 miles in an eight-hour travel day.

- **Normal travel:** `days = ceil(distance / 24)`. No exhaustion. Camping
  between days is assumed and needs no state.
- **Forced march:** the whole distance in one day.
  `hours = ceil(distance / 3)`; every hour beyond the eighth is a forced hour.

For any distance of 24 miles or less both options are one day and identical —
there is nothing to force. The choice only bites above 24 miles.

### 4.3 Why no persisted clock

Forced march is defined per day. A journey is self-contained: it begins and ends
within this resolution, so the hours it costs never need to outlive it. This is
what keeps the increment free of a migration.

**Known limit, accepted:** two short journeys on the same in-fiction day do not
accumulate toward the eight-hour threshold. Closing that would require a
persisted hours-travelled-today column on `Campaign`, reset by the long rest.
That is a deliberate deferral, not an oversight.

### 4.4 Forced march

SRD: for each hour beyond eight, each character makes a Constitution saving
throw at the end of the hour, DC `10 + 1 per hour past 8`. A failure is one
level of exhaustion.

So the ninth hour is DC 11, the tenth DC 12, and so on.

```
resolveJourney(input: {
  distanceMiles: number;
  forceMarch: boolean;
  conModifier: number;
}): JourneyOutcome
```

`JourneyOutcome` carries: `days`, `hours`, `forcedHours`, `saves` (one entry per
forced hour with its DC, roll, total and success), `exhaustionGained`.

Each save delegates to the existing `resolveSavingThrow(abilityMod, dc,
advantage, disadvantage)` in `lib/rules/combat.ts`. The travel module does not
roll dice itself; SRD saving throws already have one implementation and this
does not become a second.

`exhaustionGained` is capped so that `current + gained` never exceeds 6, the SRD
maximum. The rule never throws.

**On `conModifier`.** The route computes it from the character's Constitution
score and passes a single number, matching how `resolveSavingThrow` is already
called everywhere else. Saving-throw proficiency is **not** modelled anywhere in
this project — there is no per-class save-proficiency table — so this is not an
omission specific to travel, and adding one here would be a rules change
smuggled into a feature.

**On "each character".** The SRD says every character saves. This game has one
character per campaign, so the rule takes one modifier and returns one
exhaustion figure. If a party ever becomes plural, this signature changes; it
is not designed around a party today because pretending otherwise would be
building ahead of demand.

## 5. The route gate

In `app/api/campaign/[id]/action/route.ts`, shaped after the `equip` gate — the
one that won the comparison against `equipment-service` in #103 for being
transactional and deriving its values rather than accepting them.

```
if (intent.actionType === "travel" && intent.destination) { … }
```

1. Resolve the destination: `prisma.location.findFirst({ where: { campaignId,
   name: { equals: destination, mode: "insensitive" } } })`.
2. Read the origin location's seed and the character's CON.
3. Call `travelDistanceMiles` then `resolveJourney`.
4. In **one** `prisma.$transaction`:
   - `character.update` — the new exhaustion level, only when it changed;
   - `campaign.update` — `currentLocationId` and `currentNodeId`, the latter
     being the destination's lowest-index node, matching what
     `exploration-service` does with `initialNodeId` on generation;
   - `gameLog.create` — the system line in §6.

Auth, ownership and the active-campaign check are the route's existing ones,
already applied before any gate runs.

### No new game event

`PLAYER_MOVE` is emitted today and **no client consumes it** — a grep across
`app/` and `components/` finds no handler. Adding a `PARTY_TRAVELED` event would
be dormant from its first commit. The live channel is the log line, which the
narrator reads through `recentLogs`.

## 6. What the narrator receives

A deterministic system log line, in the shape the ability-check gate already
uses:

```
Travel: The Sable Crypt → The Gilded Boar, 37 mi at normal pace, 2 days.
```

and when the march was forced:

```
Travel: The Sable Crypt → The Gilded Boar, 37 mi forced march, 13 h.
Forced march: 5 h, DC 11/12/13/14/15 → 2 failed, exhaustion 0 → 2.
```

Every number is resolved before the line is written. The narrator describes the
journey; it decides nothing about it.

## 7. Error handling

| Case | Response | Writes |
| --- | --- | --- |
| Destination not among the campaign's locations | 400, naming the known locations — it is the player's own campaign, so this leaks nothing | none |
| Destination is the current location | 400 | none |
| The party has no current location (`currentLocationId` is null) | 400 — there is no origin to measure from, which happens before any location has been generated | none |
| Destination has no nodes | 409 — a malformed row, not a player error | none |
| Campaign missing / not owned / inactive | Handled upstream by the route | none |

The rule itself never throws.

**Recorded gap:** SRD exhaustion level 6 is death, and this game does not
implement death by exhaustion. The rule writes up to 6 and the log line records
it; what happens at 6 is a separate increment. This is stated rather than
silently capped at 5, which would be inventing a rule.

## 8. Intent

`lib/ai/intent.ts` gains `travel` in its action-type enum, a deterministic
pattern for it, and a boolean for forcing the march. `parseIntent` has been
deterministic and fail-closed since #80, so this is a real change to the
classifier and not an enum entry.

An unrecognised travel phrasing must fall through to `mechanical_ambiguous`
rather than guessing a destination.

## 9. Testing

### Pure rule

- Distance is symmetric: `travelDistanceMiles(a, b) === travelDistanceMiles(b, a)`.
- Distance is deterministic and within 12–48.
- `days` for a distance under, exactly at, and over 24 miles.
- Forced march DC progression is 11, 12, 13… for the ninth hour onward.
- Exhaustion accumulates one level per failed save.
- `current + gained` never exceeds 6.
- A journey of 24 miles or less produces no forced hours even when
  `forceMarch` is true.

### Route

- A normal journey moves the party and writes **no** exhaustion.
- A forced march persists the exhaustion the rule resolved.
- An unknown destination returns 400 and writes **nothing**.
- The party lands on the destination's lowest-index node.
- The log line contains the resolved figures.

### Falsification plan

Every test must be shown to fail when the wire it covers is cut:

| Cut | Must kill |
| --- | --- |
| Stop sorting the seeds | the symmetry test, and only it |
| Pin `exhaustionGained` to 0 | the forced-march persistence test, and only it |
| Remove the unknown-destination guard | the "writes nothing" test |
| Pin the DC to a constant | the DC progression test |

A test that survives its cut does not cover what it claims. Note in particular
that a "returns null / writes nothing" test cannot fail against a gate that
never writes at all; each such test needs its populated twin.

## 10. Follow-ups, not in this increment

1. Retire `lib/rules/wilderness.ts`, `wilderness-service.ts` and
   `lib/ai/tools/wilderness.ts` — 1,414 lines whose model this decision
   rejects.
2. Death at exhaustion level 6.
3. A persisted hours-travelled-today counter, if the §4.3 limit proves to
   matter in play.
4. `explorationHUD`, still without a producer, blocked by the same excluded
   `CampaignTime` and `PartyInventory` tables and therefore by a decision this
   document deliberately does not make.
