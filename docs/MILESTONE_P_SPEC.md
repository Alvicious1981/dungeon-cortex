# Milestone P — Wilderness Exploration & Hexcrawl Engine: Finalized Specification

> **Precedence:** Subordinate to `PROJECT_CONTEXT.md` §25 (Precedence Order) and explicit user instructions.
> **Status:** LOCKED — Architect Decisions Q1–Q5 resolved. Ready for Slice 1 implementation.
> **Prerequisite:** Milestone O (Exploration & Time Engine) — confirmed 100% closed (commit `7dd2733`).
> **Terrain Reference:** Azgaar's Fantasy Map Generator principles — hex grid topology, biome
> classification, and seeded determinism — serve as the sole canonical baseline for all terrain data.

---

## 1. Objective

Milestone O established the **Dungeon Clock**: a 10-minute turn-based time system governing torchlight,
rest, random encounters, and ration consumption inside enclosed spaces. Milestone P extends the engine to
the **Overworld**: a hex-grid wilderness where the atomic unit of time is the **Watch** (4 hours), and
the party navigates terrain, manages food and weather, and discovers the world one hex at a time.

The three design pillars inherited from Milestone O apply without exception:

1. **Code is Law** — the AI narrator voices outcomes; it never owns travel pace calculation, foraging
   resolution, or weather state. `executeTravelWatch` is the sole authority for overworld time progression.
2. **State is Truth** — all hex discovery, terrain data, weather conditions, and watch counts live in
   Prisma. The narrator may not invent what a hex contains before `WildernessMap` has been written.
3. **Pure functions own determinism** — `lib/rules/wilderness.ts` contains zero database I/O. All Prisma
   writes live in `lib/ai/narrator.ts` inside the `executeTravelWatch` tool execute closure.

---

## 2. Time Scale: Dungeon Turns → Wilderness Watches

| Unit | Duration | Dungeon Turns | Notes |
|---|---|---|---|
| 1 Dungeon Turn | 10 min | 1 | Base atomic unit (Milestone O) |
| 1 Hour | 60 min | 6 | `TURNS_PER_HOUR = 6` |
| 1 Wilderness Watch | 4 hours | 24 | New atomic unit for overworld |
| 1 Wilderness Day | 24 hours | 144 | Equals `RATION_INTERVAL_TURNS` (1 ration/day) |
| 6 Watches per Day | 24 hours | 144 | Day partitioned into 6 named watches |

### Watch Schedule

| Watch Index | Time Window | Default Activity |
|---|---|---|
| 0 — Dawn | 04:00–08:00 | Travel or Foraging |
| 1 — Morning | 08:00–12:00 | Travel or Foraging |
| 2 — Midday | 12:00–16:00 | Travel or Foraging |
| 3 — Afternoon | 16:00–20:00 | Travel or Foraging |
| 4 — Evening | 20:00–24:00 | Camp Setup or Scouting |
| 5 — Night | 00:00–04:00 | Rest (mandatory) |

**Night Watch Rule:** `currentWatch === 5` is mandatory rest. Any non-rest action is refused by
`executeTravelWatch` with `{ error: "restRequired" }`. No state mutation on refusal. Mirrors the
`restRequired` gate already in `executeExplorationTurn`.

### Cross-System Handoff (Dungeon ↔ Wilderness)

When the party enters a dungeon entrance (`WildernessMap.feature === "dungeon_entrance"`), the
Wilderness Watch system freezes; `CampaignTime` (Milestone O) resumes dungeon-turn accumulation.
On dungeon exit: elapsed dungeon turns are converted back — `watchesElapsed = Math.floor(turnsElapsed / 24)` —
and `TravelState.totalWatches` is advanced accordingly. Rations (`PartyInventory.rations`) are shared
across both systems.

---

## 3. Architect Decisions — Locked

These supersede the Open Questions from the draft.

| # | Decision | Value | Rationale |
|---|---|---|---|
| Q1 | **World size** | Infinite — hexes generated on first visit | Bounded maps create artificial walls; on-demand generation from seed is stateless and cheap |
| Q2 | **Ration pool** | Shared with `PartyInventory.rations` | One source of truth; prevents ration-tracking divergence between dungeon and wilderness |
| Q3 | **Starting hex** | Origin `(0, 0)` bootstrapped at campaign creation with `terrain = "plains"` | Guarantees first hex is always traversable; avoids invalid starting state |
| Q4 | **Foraging dice** | Single Survival check (1d20 + survivalMod vs DC); success yields `max(1, 1d6 + survivalMod)` rations | Simpler; survivalMod rewarded twice (check + yield) |
| Q5 | **Season system** | Fixed `seasonIndex` at campaign creation; weather recalculated **every 6 watches** (once per day) | Eliminates season-drift complexity in Slice 1; per-day weather is realistic and auditable |
| Q6 | **Travel pace** | Normal = 1 hex/watch; Fast = 2 hexes/watch with −5 to passive Perception and foraging; Slow = 1 hex per 2 watches (tracked via `partialHexProgress`) | Architect explicit decision |
| Q7 | **Travel limit** | Traveling more than `MAX_TRAVEL_WATCHES_PER_DAY` (2) in one day triggers a Constitution saving throw signal; failure = Exhaustion increment | Architect explicit decision; pure function signals risk, tool resolves the save |

---

## 4. Azgaar's Fantasy Map Generator — Canonical Terrain Baseline

Azgaar's principles inform the terrain model — its runtime is never imported.

### Coordinate System

Cube coordinates `(q, r, s)` where `q + r + s = 0`. Only `q` and `r` are stored; `s = −q − r` is always derived.

### Hex Neighbor Directions

| Direction Index | Name | Δq | Δr |
|---|---|---|---|
| 0 | Northeast | +1 | −1 |
| 1 | East | +1 | 0 |
| 2 | Southeast | 0 | +1 |
| 3 | Southwest | −1 | +1 |
| 4 | West | −1 | 0 |
| 5 | Northwest | 0 | −1 |

### Terrain Types

| Terrain | Elevation | Moisture | Dangerous? | Forage DC |
|---|---|---|---|---|
| `plains` | Low | Low–Mid | No | 10 |
| `forest` | Low–Mid | High | No | 10 |
| `hills` | Mid | Any | No | 15 |
| `mountain` | High | Any | Yes | 15 |
| `swamp` | Low | Very High | Yes | 15 |
| `desert` | Low–Mid | Very Low | No | 15 |
| `coast` | 0 | — | No | 15 |
| `tundra` | Any | Low | No | 15 |
| `taiga` | Mid–High | Mid | No | 10 |
| `coast` | — | — | — | Impassable (requires vessel) |

**Dangerous terrain** (`mountain`, `swamp`) triggers encounters on a 1d6 roll of 1 or 2; others trigger on 1.

### Seeded Hex Identity

Each `WildernessMap` record has a `seed` derived from `SHA1(campaignId + ":" + q + ":" + r)` truncated
to 12 characters. The same coordinate in the same campaign always produces identical terrain, biome,
elevation, and moisture. No randomness leaks into geography.

---

## 5. Mechanical Constants (`lib/rules/wilderness.ts`)

| Constant | Value | Description |
|---|---|---|
| `WATCHES_PER_DAY` | 6 | Watches in a 24-hour period |
| `TURNS_PER_WATCH` | 24 | Dungeon turns in one watch |
| `NIGHT_WATCH_INDEX` | 5 | Watch index that is mandatory rest |
| `WILDERNESS_RATION_INTERVAL_WATCHES` | 6 | Ration consumed once per day (every 6 watches) |
| `WEATHER_RECALC_INTERVAL_WATCHES` | 6 | Weather recalculated once per day |
| `NORMAL_PACE_HEXES_PER_WATCH` | 1 | Normal pace: 1 hex per watch |
| `FAST_PACE_HEXES_PER_WATCH` | 2 | Fast pace: 2 hexes per watch |
| `FAST_PACE_PERCEPTION_PENALTY` | −5 | Passive Perception penalty at fast pace |
| `FAST_PACE_FORAGING_PENALTY` | −5 | Foraging DC added at fast pace |
| `MAX_TRAVEL_WATCHES_PER_DAY` | 2 | Travel beyond this triggers Con save signal |
| `FORAGE_DC_NORMAL` | 10 | Survival DC for easy terrain |
| `FORAGE_DC_HARSH` | 15 | Survival DC for difficult terrain |
| `FORAGE_DC_WEATHER_PENALTY` | 5 | Additional DC during heavy rain or storm |
| `SCOUTING_REVEAL_RADIUS` | 1 | Hexes revealed around current position on Scout action |
| `WILDERNESS_ENCOUNTER_NORMAL` | 1 | 1d6 trigger for normal terrain |
| `WILDERNESS_ENCOUNTER_DANGEROUS` | 2 | 1d6 trigger threshold for dangerous terrain |

---

## 6. State Layer — Prisma Model Specifications

### 6.1 `WildernessMap`

One record per unique hex coordinate per campaign. Created on first visit (Q1: infinite map).

**Prisma fields:**

| Field | Type | Default | Description |
|---|---|---|---|
| `id` | String (cuid) | — | Primary key |
| `campaignId` | String | — | FK → Campaign |
| `q` | Int | — | Cube coordinate Q |
| `r` | Int | — | Cube coordinate R (s = −q − r, never stored) |
| `terrain` | String | — | One of the 9 canonical terrain types |
| `biome` | String | — | Azgaar biome label for narrative flavor |
| `elevation` | Int | 0 | 0–100 scale |
| `moisture` | Int | 0 | 0–100 scale |
| `discovered` | Boolean | false | Party has stood in this hex |
| `scouted` | Boolean | false | Revealed from adjacent hex (fog-of-war lite) |
| `feature` | String? | null | `"dungeon_entrance"` \| `"village"` \| `"ruins"` \| `"shrine"` \| null |
| `locationId` | String? | null | FK → Location if feature has been expanded |
| `seed` | String | — | Deterministic seed derived from campaignId + q + r |
| `createdAt` | DateTime | now() | — |

**Indexes/Constraints:**
- `@@unique([campaignId, q, r])` — one hex per coordinate per campaign
- `@@index([campaignId])` — fog-of-war and campaign map queries

Relations on `Campaign`: `wildernessMap WildernessMap[]`

### 6.2 `TravelState`

One record per campaign. All mutations occur inside `executeTravelWatch` via `prisma.$transaction`.

**Prisma fields:**

| Field | Type | Default | Description |
|---|---|---|---|
| `id` | String (cuid) | — | Primary key |
| `campaignId` | String (unique) | — | FK → Campaign |
| `currentQ` | Int | 0 | Party's current hex Q |
| `currentR` | Int | 0 | Party's current hex R |
| `currentWatch` | Int | 0 | Watch index within the current day (0–5) |
| `totalWatches` | Int | 0 | Monotonically increasing; never decremented |
| `totalDays` | Int | 0 | `floor(totalWatches / 6)` — stored for query efficiency |
| `watchesTraveledToday` | Int | 0 | Travel watches this day; resets at Dawn (watch 0) |
| `watchesSinceRation` | Int | 0 | Resets to 0 after ration consumption fires |
| `weatherWatchCounter` | Int | 0 | Watches since last weather recalculation |
| `partialHexProgress` | Float | 0.0 | Sub-hex movement accumulator for Slow pace (0.0–<1.0) |
| `partyPace` | String | `"normal"` | `"slow"` \| `"normal"` \| `"fast"` — persisted between watches |
| `weatherCondition` | String | `"clear"` | Current weather condition |
| `weatherIntensity` | Int | 0 | 0 = mild, 1 = moderate, 2 = severe |
| `seasonIndex` | Int | 0 | 0=spring, 1=summer, 2=autumn, 3=winter (fixed at campaign creation) |
| `updatedAt` | DateTime | — | Auto-updated |

Relations on `Campaign`: `travelState TravelState?`

**Coexistence with `CampaignTime`:** Both records live on the same `Campaign`. The active time system
is context-inferred: if `Campaign.currentLocationId` is non-null, `CampaignTime` governs; if null and
`TravelState` exists, `TravelState` governs.

---

## 7. Rules Layer — Pure Function Specifications

All in `lib/rules/wilderness.ts`. Zero database I/O. All randomness injectable via `forcedRoll`
parameters for deterministic testing. Import `rollDie` from `@/lib/rules/dice`.

### 7.1 `calculateTravelProgress`

**Purpose:** Given terrain, pace, weather, and how many watches the party has already traveled today,
determines hex progress for this watch and signals any travel-limit risk.

**Signature:**
```
calculateTravelProgress(
  terrain: TerrainType,
  pace: TravelPace,
  weatherCondition: WeatherCondition,
  weatherIntensity: WeatherIntensity,
  watchesTraveledToday?: number,   // defaults to 0
): TravelProgressResult
```

**`TravelProgressResult` fields:**

| Field | Type | Description |
|---|---|---|
| `hexesThisWatch` | number | Hex progress this watch (0, 0.5, 1, or 2) |
| `blocked` | boolean | Movement impossible (coast or storm intensity 2) |
| `stealthAdvantage` | boolean | True when pace is `"slow"` |
| `perceptionPenalty` | number | 0 normally; −5 at fast pace |
| `foragingDCPenalty` | number | 0 normally; −5 (i.e. +5 to DC) at fast pace |
| `canForageWhileTraveling` | boolean | True only at slow pace |
| `overTravelLimit` | boolean | True when `watchesTraveledToday >= MAX_TRAVEL_WATCHES_PER_DAY` |

**Movement rules:**
- Coast: always `blocked = true`
- Storm intensity 2: `blocked = true`
- Slow pace: `hexesThisWatch = 0.5` (tracked via `partialHexProgress`)
- Normal pace: `hexesThisWatch = NORMAL_PACE_HEXES_PER_WATCH` (1)
- Fast pace: `hexesThisWatch = FAST_PACE_HEXES_PER_WATCH` (2)
- Heavy rain (intensity ≥ 1) or storm (intensity 1): normal and slow movement halved (minimum 0)
- Snow (intensity ≥ 1): same penalty as heavy rain

### 7.2 `resolveForaging`

**Purpose:** Resolves a foraging attempt. Returns ration yield, DC, roll details, and a diegetic
description string for the narrator to voice verbatim.

**Signature:**
```
resolveForaging(
  survivalMod: number,
  terrain: TerrainType,
  weatherCondition: WeatherCondition,
  weatherIntensity: WeatherIntensity,
  dcModifier?: number,      // Caller passes pace-based DC penalty (default 0)
  forcedRoll?: number,      // d20 override for testing
  forcedYieldRoll?: number, // yield die override for testing
): ForagingResult
```

**`ForagingResult` fields:**

| Field | Type | Description |
|---|---|---|
| `success` | boolean | Check cleared the DC |
| `dc` | number | Target DC (includes terrain + weather + pace modifiers) |
| `roll` | number | Raw d20 result |
| `total` | number | `roll + survivalMod` |
| `rationGain` | number | 0 on failure; `max(1, 1d6 + survivalMod)` on success |
| `description` | string | One-line diegetic result string |

**DC resolution:**
1. Base DC from terrain: `plains/forest/taiga → FORAGE_DC_NORMAL (10)`; all others → `FORAGE_DC_HARSH (15)`
2. Weather penalty: if `(condition === "rain" && intensity >= 1) || condition === "storm"`, add `FORAGE_DC_WEATHER_PENALTY (5)`
3. Pace modifier: add `dcModifier` (caller provides +5 if fast pace; 0 otherwise)

**Yield on success:** `max(1, rollDie(6) + survivalMod)`

### 7.3 `generateWeatherCheck`

**Purpose:** Determines weather for the upcoming day (called every 6 watches). Returns new weather
state. Transitions follow a biome-gated probability matrix.

**Signature:**
```
generateWeatherCheck(
  biome: string,
  seasonIndex: number,           // 0=spring, 1=summer, 2=autumn, 3=winter
  previousCondition: WeatherCondition,
  previousIntensity: WeatherIntensity,
  forcedRoll?: number,           // d20 override for testing
): WeatherResult
```

**`WeatherResult` fields:**

| Field | Type | Description |
|---|---|---|
| `condition` | WeatherCondition | New weather condition |
| `intensity` | WeatherIntensity | 0 / 1 / 2 severity |
| `changed` | boolean | True if differs from previous |
| `description` | string | One-sentence diegetic string |

**Transition rules (roll 1d20):**
- 1–4 (20%): Worsen — advance along the severity ladder
- 5–14 (50%): Persist — condition and intensity unchanged
- 15–20 (30%): Improve — step back along the severity ladder

**Severity ladder:** clear → overcast → rain(0) → rain(1) → storm(1) → storm(2)

**Biome/season gates:**
- `snow` replaces `rain` only in biomes `taiga`, `tundra`, `mountain` during `seasonIndex === 3` (winter)
- `storm` intensity 2 carries 75% persistence (roll 1–15 = persist, 16–20 = improve, regardless of ladder)
- `clear` carries 60% persistence (roll 1–12 = persist, 13–20 = transition)

**`WeatherCondition` string union:** `"clear"` | `"overcast"` | `"rain"` | `"storm"` | `"fog"` | `"snow"`

---

## 8. AI Tool Layer — `executeTravelWatch` (Slice 2)

Resides in `lib/ai/narrator.ts` → `buildTools()`. Slice 2 deliverable.

### Input Schema

| Field | Type | Required | Notes |
|---|---|---|---|
| `action` | enum | Yes | `"travel"` \| `"forage"` \| `"rest"` \| `"camp"` \| `"scout"` |
| `direction` | int 0–5 | Only for `"travel"` | Hex direction index |
| `pace` | enum | No | Overrides persisted `partyPace` for this watch only |

Schema must be `strict()`.

### Return Payload (Slice 2)

```
{
  action, watchIndex, totalWatches, totalDays,
  position: { q, r }, terrain, biome,
  featureDiscovered,
  encounter: { triggered, roll } | null,
  weather: { condition, intensity, changed, description },
  rationsDepleted, restRequired, movementBlocked,
  exhaustionRisk,          // true if overTravelLimit triggered
  foragingResult | null,
  warnings: string[],
}
```

---

## 9. Context Injection — `formatWildernessHUD` (Slice 2)

Mirrors `formatSurvivalHUD` (Milestone O) in `lib/memory/formatter.ts`. Slice 2 deliverable.

### `WildernessHUDContext` Interface

| Field | Description |
|---|---|
| `currentQ`, `currentR` | Current hex coordinates |
| `terrain`, `biome` | Terrain type and Azgaar biome label |
| `watchIndex` | 0–5 |
| `totalDays` | Elapsed in-game days |
| `weatherCondition`, `weatherIntensity` | Current weather state |
| `partyPace` | Current pace |
| `rations` | From `PartyInventory.rations` |
| `featureHere` | Feature string or null |

### Iron Laws Mandate (Slice 2)

> "**Wilderness Exploration Mandate:** Every overworld action — travel, foraging, scouting, resting,
> making camp — MUST be resolved by calling `executeTravelWatch`. NEVER narrate hex discovery, terrain
> features, weather changes, ration depletion, or encounter triggers without a tool response confirming
> it. The hex does not exist for the party until `WildernessMap.discovered` is true. NEVER describe
> what lies in an undiscovered hex. Code is Law."

---

## 10. Presentation Layer — `WildernessHUD` Component (Slice 2)

`components/exploration/WildernessHUD.tsx` — read-only. Slice 2 deliverable.

**Required `data-testid` elements:**
`hex-position`, `terrain`, `watch-name`, `watch-index`, `total-days`, `weather`, `weather-intensity`,
`party-pace`, `rations`, `feature` (conditional on non-null).

Root: `aria-label="Wilderness and Travel Status"`, `data-watch-index={watchIndex}`.

---

## 11. Test Requirements

### Slice 1 — `tests/rules/wilderness.test.ts` (90+ tests)

| Domain | Coverage |
|---|---|
| Constants | All 16 constants exported and match spec values |
| `calculateTravelProgress` | All 9 terrain types × 3 paces; coast blocked; storm 2 blocked; weather halving; penalty flags; `overTravelLimit` signal |
| `resolveForaging` | DC 10 + DC 15 terrain; weather DC penalty; dcModifier (fast pace); survivalMod applied; min yield 1; fail = 0; all terrain types DC mapping; forcedRoll injection |
| `generateWeatherCheck` | Persist path (roll 5–14); worsen path (roll 1–4); improve path (roll 15–20); snow biome gate; storm intensity 2 persistence; `changed` flag accuracy; all 6 conditions reachable |
| Hex direction math | All 6 direction deltas produce correct `(q, r)` neighbors |

### Slice 2 — Additional tests (see §9 of this spec)

---

## 12. Slice Breakdown

### Slice 1 — Data Layer & Rules Engine ← CURRENT

1. Prisma schema: `WildernessMap`, `TravelState`, Campaign relations
2. `npx prisma db push`
3. `lib/rules/wilderness.ts`: all constants, types, 3 pure functions
4. `tests/rules/wilderness.test.ts`: 90+ tests passing
5. `pnpm exec tsc --noEmit`: 0 errors

**Negative constraint:** No AI tooling, no formatter, no UI.

### Slice 2 — AI Tool & UI Integration

1. `executeTravelWatch` in `lib/ai/narrator.ts`
2. `formatWildernessHUD` + mandate in `lib/memory/formatter.ts`
3. `components/exploration/WildernessHUD.tsx`
4. Formatter and component tests
5. Full suite must remain green

---

## 13. Validation Criteria

Milestone P is complete only when:
1. `pnpm exec tsc --noEmit` exits 0
2. `pnpm vitest run` passes all existing tests plus 130+ new
3. Same `(q, r)` + campaign seed always produces identical terrain (determinism)
4. `executeTravelWatch` refuses non-rest actions during Night Watch 5
5. Rations deducted from `PartyInventory.rations` exactly once per 6 watches
6. Travel limit signals correctly when `watchesTraveledToday >= 2`

---

*Finalized: 2026-04-15. Architect Decisions Q1–Q7 locked. Slice 1 in progress.*
