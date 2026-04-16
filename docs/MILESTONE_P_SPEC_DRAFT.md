# Milestone P — Wilderness Exploration & Hexcrawl Engine: Specification Draft

> **Precedence:** Subordinate to `PROJECT_CONTEXT.md` §25 (Precedence Order) and explicit user instructions.
> **Status:** DRAFT — Open Architect Questions must be resolved before Slice 1 implementation begins.
> **Prerequisite:** Milestone O (Exploration & Time Engine) — confirmed 100% closed (commit `7dd2733`).
> **Terrain Reference:** Azgaar's Fantasy Map Generator principles — hex grid topology, biome classification,
> and seeded determinism — serve as the sole canonical baseline for all terrain data in this milestone.

---

## 1. Objective

Milestone O established the **Dungeon Clock**: a 10-minute turn-based time system governing torchlight, rest,
random encounters, and ration consumption inside enclosed spaces. Milestone P extends the engine to the
**Overworld**: a hex-grid wilderness where the atomic unit of time is the **Watch** (4 hours), and the party
navigates terrain, manages food and weather, and discovers the world one hex at a time.

The three design pillars inherited from Milestone O apply without exception:

1. **Code is Law** — the AI narrator voices outcomes; it never owns travel pace calculation, foraging
   resolution, or weather state. `executeTravelWatch` is the sole authority for overworld time progression.
2. **State is Truth** — all hex discovery, terrain data, weather conditions, and watch counts live in
   Prisma. The narrator may not invent what a hex contains before `WildernessHex` has been written.
3. **Pure functions own determinism** — `lib/rules/wilderness.ts` contains zero database I/O. All Prisma
   writes live in `lib/ai/narrator.ts` inside the `executeTravelWatch` tool execute closure.

---

## 2. Time Scale: Dungeon Turns → Wilderness Watches

The two time systems share a common root: 1 dungeon turn = 10 minutes. The overworld simply operates at
a coarser granularity.

### Derivation Table

| Unit | Duration | Dungeon Turns | Notes |
|---|---|---|---|
| 1 Dungeon Turn | 10 min | 1 | Base atomic unit (Milestone O) |
| 1 Hour | 60 min | 6 | `TURNS_PER_HOUR = 6` |
| 1 Wilderness Watch | 4 hours | 24 | New atomic unit for overworld |
| 1 Wilderness Day | 24 hours | 144 | Equals `RATION_INTERVAL_TURNS` (1 ration/day) |
| 6 Watches per Day | 24 hours | 144 | Day partitioned into 6 named watches |

### Watch Names and Default Activities

| Watch Index | Time Window | Default Activity |
|---|---|---|
| 0 — Dawn | 04:00–08:00 | Travel or Foraging |
| 1 — Morning | 08:00–12:00 | Travel or Foraging |
| 2 — Midday | 12:00–16:00 | Travel or Foraging |
| 3 — Afternoon | 16:00–20:00 | Travel or Foraging |
| 4 — Evening | 20:00–24:00 | Camp Setup or Scouting |
| 5 — Night | 00:00–04:00 | Rest (mandatory; skipping triggers exhaustion per Milestone O rules) |

**Night Watch Rule:** Watch index 5 (Night) is functionally equivalent to the dungeon system's mandatory
rest turn. If the party attempts any action other than `rest` during Watch 5, the `executeTravelWatch`
tool must refuse and return `{ error: "restRequired", message: "The party must rest during the Night watch." }`.
This mirrors the `restRequired` flag already implemented in Milestone O and ensures exhaustion rules
remain consistent across both time scales.

### Cross-System Handoff

When the party enters a dungeon entrance (`WildernessHex.feature === "dungeon_entrance"`), the time
system transitions from Wilderness Watches to Dungeon Turns. The current `TravelState.totalWatches` is
frozen; `CampaignTime` resumes its dungeon-turn accumulation from where it left off. On exit, the elapsed
dungeon time (in turns) is converted back to watches elapsed: `watchesElapsed = floor(turnsElapsed / 24)`.
`TravelState.totalWatches` is then advanced by that count, and `CampaignTime` is frozen again. This ensures
rations, rest cycles, and weather persist coherently across both modes.

---

## 3. Azgaar's Fantasy Map Generator — Canonical Terrain Baseline

Azgaar's Fantasy Map Generator is the established project reference (documented in
`docs/planning/Analisis_Recursos_Externos.md`) for procedural hex-grid world maps. Its principles —
not its runtime — inform the terrain model for this milestone.

### Adopted Principles

**Coordinate System:** Cube coordinates `(q, r, s)` where `q + r + s = 0`. Only `q` and `r` are stored;
`s` is always derived as `−q − r`. This is the same system Azgaar uses internally and enables all six
neighbor directions to be expressed as simple integer additions.

**Six Neighbor Directions:** A hex at `(q, r)` has exactly six neighbors, addressed by direction index:

| Direction Index | Name | Delta (Δq, Δr) |
|---|---|---|
| 0 | Northeast | (+1, −1) |
| 1 | East | (+1,  0) |
| 2 | Southeast | ( 0, +1) |
| 3 | Southwest | (−1, +1) |
| 4 | West | (−1,  0) |
| 5 | Northwest | ( 0, −1) |

**Biome Classification:** Terrain type is determined by two axes — elevation (0–100) and moisture (0–100) —
following Azgaar's biome matrix. The system does not import Azgaar data at runtime; instead, it replicates
the biome-determination logic using a seeded PRNG (`seededFloat` from `lib/rules/generators.ts`). The same
world seed always produces the same biome at the same coordinates.

**Terrain Types (canonical set for this milestone):**

| Terrain Type | Elevation Range | Moisture Range | Movement Cost (watches/hex) |
|---|---|---|---|
| `plains` | Low (0–30) | Low–Mid (20–60) | 1 |
| `forest` | Low–Mid (0–50) | High (60–100) | 2 |
| `hills` | Mid (30–60) | Any | 2 |
| `mountain` | High (60–100) | Any | 3 |
| `swamp` | Low (0–20) | Very high (80–100) | 3 |
| `desert` | Low–Mid (0–50) | Very low (0–20) | 2 |
| `coast` | 0 (sea level) | — | Impassable (requires vessel) |
| `tundra` | Any | Low (0–30) | 2 |
| `taiga` | Mid–High (40–80) | Mid (30–60) | 2 |

Movement cost is the baseline number of watches to traverse one hex at normal pace. This table is the
authoritative source; `calculateTravelPace` applies pace and weather modifiers on top of it.

**Seeded Hex Generation:** Each `WildernessHex` record has a `seed` field derived as
`SHA1(campaignId + ":" + q + ":" + r)` truncated to 12 characters. This seed deterministically reproduces
the hex's terrain, elevation, moisture, biome, and any feature (dungeon entrance, ruin, settlement). The
same party exploring the same world coordinate always encounters identical terrain — no randomness leaks
into the geography layer.

---

## 4. Open Architect Questions

These questions must be resolved by the Architect before Slice 1 implementation begins. Do not default;
do not guess. Each answer locks in a behavioral invariant.

| # | Question | Options | Impact |
|---|---|---|---|
| Q1 | **World Size:** Is the wilderness map bounded (finite hex grid) or unbounded (infinite procedural generation on demand)? | A) Fixed grid seeded at campaign creation (e.g., 20×20 hexes) B) Infinite: hexes are generated and persisted on first visit | Affects WildernessHex schema (total row count, spatial index strategy) and whether campaign creation pre-generates a map or defers to first travel |
| Q2 | **Ration Continuity:** Do wilderness watches share the same ration pool as the dungeon (`PartyInventory.rations`) or is there a separate overworld food track? | A) Shared pool: 1 ration/watch-day deducted from `PartyInventory.rations` B) Separate track stored on `TravelState` | Affects whether executeTravelWatch writes to `PartyInventory` (Milestone O model) or a new field |
| Q3 | **Starting Hex:** Where does the party begin on the overworld map? | A) Campaign creation places the party at `(0, 0)` — always a settlement or safe terrain B) The party's first `TravelState` is bootstrapped by an `enterWilderness` tool call that sets the origin hex from a named settlement seed | Affects tool design and campaign onboarding flow |
| Q4 | **Foraging Dice:** Is foraging resolved with a single Survival ability check (1d20 + survivalMod vs DC) or a two-step roll (Survival check to attempt, then 1d6 for yield)? | A) Single check: success = 1d6+survivalMod rations; failure = 0 B) Two-step: DC check enables a separate yield roll | Affects `resolveForaging` return shape and test coverage requirements |
| Q5 | **Season System:** Is season modeled as a game state variable that advances with total watch count, or is it fixed at campaign creation? | A) Dynamic: season advances every 24×6=144 watches (≈ 1 in-game season per 144 game-days) B) Fixed at campaign creation via a `startingSeasonIndex` input | Affects `TravelState` fields and `generateWeatherCheck` inputs |

---

## 5. Mechanical Constants

All constants live in `lib/rules/wilderness.ts` as named exports.

| Constant | Value | Rationale |
|---|---|---|
| `WATCHES_PER_DAY` | 6 | 24 hours ÷ 4 hours per watch |
| `TURNS_PER_WATCH` | 24 | 4 hours × 6 turns/hour |
| `NIGHT_WATCH_INDEX` | 5 | Watch 5 (00:00–04:00) is mandatory rest |
| `WILDERNESS_RATION_INTERVAL_WATCHES` | 6 | 1 ration consumed per day = every 6 watches |
| `WILDERNESS_ENCOUNTER_CHANCE_NORMAL` | 1 | 1d6 roll of 1 triggers encounter (normal terrain) |
| `WILDERNESS_ENCOUNTER_CHANCE_DANGEROUS` | 2 | 1d6 roll of 1–2 triggers encounter (mountain/swamp) |
| `FORAGE_DC_PLAINS` | 10 | Survival DC for plains/forest foraging |
| `FORAGE_DC_HARSH` | 15 | Survival DC for mountain/desert/swamp foraging |
| `FORAGE_DC_WEATHER_PENALTY` | 5 | Added to foraging DC during heavy rain or storm |
| `SCOUTING_REVEAL_RADIUS` | 1 | Scouting reveals all hexes within 1 step of current position |
| `INITIAL_RATIONS_PER_PLAYER` | 7 | Inherited from Milestone O (shared pool per Q2-A answer) |

---

## 6. State Layer — Prisma Model Specifications

### 6.1 `WildernessHex`

One record per unique hex coordinate per campaign. Created on first visit (if Q1=B/infinite) or at
campaign creation (if Q1=A/bounded). The AI narrator may NOT invent what a hex contains — it reads only
what exists in this table.

**Fields:**

| Field | Type | Default | Description |
|---|---|---|---|
| `id` | String (cuid) | — | Primary key |
| `campaignId` | String | — | Foreign key → Campaign |
| `q` | Int | — | Cube coordinate Q axis |
| `r` | Int | — | Cube coordinate R axis (s = −q − r, derived) |
| `terrain` | String | — | One of the canonical terrain types (§3) |
| `biome` | String | — | Azgaar biome label for narrative flavor |
| `elevation` | Int | 0 | 0–100 scale; used to derive terrain + biome |
| `moisture` | Int | 0 | 0–100 scale; used to derive terrain + biome |
| `discovered` | Boolean | false | True once the party has stood in this hex |
| `scouted` | Boolean | false | True if revealed from an adjacent hex (fog-of-war lite) |
| `feature` | String? | null | `"dungeon_entrance"` \| `"village"` \| `"ruins"` \| `"shrine"` \| null |
| `locationId` | String? | null | Links to `Location` record if a feature has been generated |
| `seed` | String | — | Deterministic content seed; derived from campaignId + q + r |
| `createdAt` | DateTime | now() | — |

**Constraints:**
- Unique index on `(campaignId, q, r)` — each coordinate is unique per campaign.
- Index on `campaignId` for efficient fog-of-war queries.
- `discovered` and `scouted` are write-once-forward: they never revert to false.

### 6.2 `TravelState`

One record per campaign. Tracks all overworld temporal and spatial state. Mutations occur exclusively
inside `executeTravelWatch` via `prisma.$transaction`.

**Fields:**

| Field | Type | Default | Description |
|---|---|---|---|
| `id` | String (cuid) | — | Primary key |
| `campaignId` | String (unique) | — | Foreign key → Campaign |
| `currentQ` | Int | 0 | Party's current hex cube-Q coordinate |
| `currentR` | Int | 0 | Party's current hex cube-R coordinate |
| `currentWatch` | Int | 0 | Watch index within the current day (0–5) |
| `totalWatches` | Int | 0 | Monotonically increasing; never decremented |
| `totalDays` | Int | 0 | Floor(totalWatches / 6) — stored for query efficiency |
| `watchesSinceRation` | Int | 0 | Resets to 0 after ration consumption fires |
| `partyPace` | String | `"normal"` | `"slow"` \| `"normal"` \| `"fast"` — persisted between watches |
| `weatherCondition` | String | `"clear"` | Current weather condition string |
| `weatherIntensity` | Int | 0 | 0 = mild, 1 = moderate, 2 = severe |
| `seasonIndex` | Int | 0 | 0=spring, 1=summer, 2=autumn, 3=winter |
| `updatedAt` | DateTime | — | Auto-updated on every write |

**Relation to CampaignTime:** `TravelState` and `CampaignTime` (Milestone O) coexist on the same
`Campaign`. Neither deletes the other. The active time system is inferred from context: if the party is
in a `Location` (dungeon/village/etc.), `CampaignTime` is authoritative; if `TravelState` exists and
`Campaign.currentLocationId` is null, `TravelState` is authoritative.

---

## 7. Rules Layer — Pure Function Specifications

All functions reside in `lib/rules/wilderness.ts`. Zero database I/O. All randomness is seeded or
injectable via `forcedRoll` parameters for deterministic testing.

### 7.1 `calculateTravelPace`

**Purpose:** Given terrain, party pace, and weather, determines how many hexes can be traversed in a
single watch and whether movement is blocked entirely.

**Inputs:**

| Parameter | Type | Description |
|---|---|---|
| `terrain` | `TerrainType` | One of the canonical terrain strings (§3) |
| `pace` | `"slow"` \| `"normal"` \| `"fast"` | Party's declared travel pace |
| `weatherCondition` | `WeatherCondition` | Current weather string |
| `weatherIntensity` | `0 \| 1 \| 2` | Severity of the weather condition |

**Output shape — `TravelPaceResult`:**

| Field | Type | Description |
|---|---|---|
| `watchesPerHex` | number | Watches required to cross one hex (inverse of speed) |
| `hexesThisWatch` | number | Hexes traversable in the current watch (may be 0 or fractional) |
| `blocked` | boolean | True if movement is impossible (impassable terrain or severe storm) |
| `stealthAdvantage` | boolean | True if pace is `"slow"` — Slow pace grants Stealth advantage |
| `perceptionPenalty` | boolean | True if pace is `"fast"` — Fast pace imposes −5 passive Perception |
| `canForageWhileTraveling` | boolean | True only if pace is `"slow"` |

**Pace modifiers (applied on top of terrain base cost):**
- `slow`: `watchesPerHex × 2` (half speed); enables foraging while traveling
- `normal`: `watchesPerHex × 1` (base terrain cost)
- `fast`: `watchesPerHex × 0.67` (1.5× speed, rounded to nearest watch); imposes −5 passive Perception

**Weather modifiers:**
- `rain` intensity 1 or `fog` intensity 1: +1 watch per hex to base cost
- `storm` intensity 2 or `snow` intensity 2: movement blocked (`blocked = true`)

### 7.2 `resolveForaging`

**Purpose:** Resolves a party foraging attempt during a watch. Returns ration yield (which may be zero on
failure). Consumes the full watch — the party cannot also travel during a foraging watch unless pace is `"slow"`.

**Inputs:**

| Parameter | Type | Description |
|---|---|---|
| `survivalMod` | number | Character's Wisdom (Survival) modifier |
| `terrain` | `TerrainType` | Terrain type of the current hex |
| `weatherCondition` | `WeatherCondition` | Current weather (affects DC) |
| `weatherIntensity` | `0 \| 1 \| 2` | Weather severity (heavy rain/storm adds DC penalty) |
| `forcedRoll` | number? | Optional override for the d20 check (for testing) |
| `forcedYieldRoll` | number? | Optional override for the yield die (for testing) |

**Output shape — `ForagingResult`:**

| Field | Type | Description |
|---|---|---|
| `success` | boolean | Whether the Survival check cleared the DC |
| `dc` | number | The DC that was targeted |
| `roll` | number | The raw d20 result before modifier |
| `total` | number | `roll + survivalMod` |
| `rationGain` | number | Rations found (0 on failure; `1d6 + survivalMod` clamped to min 1 on success) |
| `description` | string | One-line diegetic result string for narrator to voice verbatim |

**DC table (per Q4 resolution — single-check model):**

| Terrain | Base DC | Weather Penalty (heavy rain/storm) | Effective DC |
|---|---|---|---|
| `plains`, `forest`, `taiga` | 10 | +5 | 10 or 15 |
| `hills`, `tundra`, `desert` | 15 | +5 | 15 or 20 |
| `mountain`, `swamp` | 15 | +5 | 15 or 20 |
| `coast` | 15 | +5 | 15 or 20 |

### 7.3 `generateWeatherCheck`

**Purpose:** Determines weather for the upcoming watch based on biome, season, and the previous watch's
weather. Weather is not independently random each watch — it transitions probabilistically using a seeded
roll, producing realistic multi-watch weather patterns (a storm persists; clear skies tend to hold).

**Inputs:**

| Parameter | Type | Description |
|---|---|---|
| `biome` | string | Azgaar biome label of the current hex |
| `seasonIndex` | `0 \| 1 \| 2 \| 3` | 0=spring, 1=summer, 2=autumn, 3=winter |
| `previousCondition` | `WeatherCondition` | Last watch's weather condition |
| `previousIntensity` | `0 \| 1 \| 2` | Last watch's intensity |
| `forcedRoll` | number? | Optional d20 override for testing |

**Output shape — `WeatherResult`:**

| Field | Type | Description |
|---|---|---|
| `condition` | `WeatherCondition` | New weather condition for the upcoming watch |
| `intensity` | `0 \| 1 \| 2` | Severity of the new condition |
| `changed` | boolean | True if condition or intensity differs from previous watch |
| `description` | string | One-sentence diegetic description for narrator |

**Weather condition set — `WeatherCondition` (string union):**
`"clear"` \| `"overcast"` \| `"rain"` \| `"storm"` \| `"fog"` \| `"snow"`

**Transition logic (biome + season gates):**
- `snow` is only possible in `tundra`, `taiga`, or `mountain` biomes, and only during `seasonIndex 3` (winter).
- `storm` intensity 2 carries a 75% persistence probability (it continues the next watch unless the roll
  explicitly transitions out).
- `clear` weather also carries high persistence (60%) — settled weather holds.
- Transitions are encoded as a biome-indexed probability matrix seeded by `forcedRoll ?? rollDie(20)`.
  The exact matrix values are left for implementation but must be deterministic per roll.

---

## 8. AI Tool Layer — `executeTravelWatch`

Resides in `lib/ai/narrator.ts` within `buildTools()`. Identical structural pattern to `executeExplorationTurn` from Milestone O.

### 8.1 Input Schema

| Field | Type | Required | Description |
|---|---|---|---|
| `action` | enum | Yes | `"travel"` \| `"forage"` \| `"rest"` \| `"camp"` \| `"scout"` |
| `direction` | integer 0–5 | Only for `"travel"` | Hex direction index (see §3 direction table) |
| `pace` | enum | No | `"slow"` \| `"normal"` \| `"fast"` — overrides persisted `partyPace` for this watch only |

The schema must be `strict()` (no extra keys). `direction` must be absent for all non-travel actions.

### 8.2 Execute Flow

The execute closure performs the following in sequence. If any DB fetch fails, the tool returns a
structured error object — it never throws.

**Step 1 — Fetch state:** Load `TravelState`, `PartyInventory`, and the active `Character` (for
Survival modifier derivation) from the database.

**Step 2 — Night Watch Gate:** If `currentWatch === NIGHT_WATCH_INDEX` and `action !== "rest"`,
return `{ error: "restRequired" }` immediately. No state mutation.

**Step 3 — Action branch:**

- **`"rest"`:** Advance `currentWatch` to 0 (next day) and increment `totalDays`. Reset
  `CampaignTime.turnsSinceRest` to 0 (shared exhaustion system). Consume 1 ration per
  `WILDERNESS_RATION_INTERVAL_WATCHES` elapsed.

- **`"travel"`:** Call `calculateTravelPace(terrain, pace, weather, intensity)`. If `blocked`, return
  `{ error: "movementBlocked" }`. Otherwise advance `(q, r)` by one hex in the given direction.
  Upsert the destination `WildernessHex` (generate if first visit). Mark as `discovered`. Conditionally
  mark adjacent hexes as `scouted`. Roll wilderness encounter check (1d6 vs terrain-appropriate threshold).

- **`"forage"`:** Call `resolveForaging(survivalMod, terrain, weather, intensity)`. If `success`, add
  `rationGain` to `PartyInventory.rations`. No hex position change.

- **`"scout"`:** Mark all hexes within radius `SCOUTING_REVEAL_RADIUS` as `scouted`. Upsert each.
  No position change; takes the full watch.

- **`"camp"`:** Identical to `"rest"` for time purposes but does not reset exhaustion counters.
  Used for extended stays at a safe hex without triggering the full long-rest recovery.

**Step 4 — Weather update:** Call `generateWeatherCheck(biome, seasonIndex, previousCondition, previousIntensity)`.
Update `TravelState.weatherCondition` and `TravelState.weatherIntensity` with the result.

**Step 5 — Advance watch:** Increment `TravelState.currentWatch` (modulo 6). If it wraps to 0,
increment `totalDays` and check ration consumption.

**Step 6 — Atomic write:** All mutations committed inside `prisma.$transaction`. No partial writes.

### 8.3 Return Payload

```
{
  action,
  watchIndex,          // New currentWatch after advancing
  totalWatches,        // Monotonic count
  totalDays,
  position: { q, r }, // New party position
  terrain,             // Terrain of the current hex
  biome,               // Biome label for narration flavor
  featureDiscovered,   // Feature string if a new feature was revealed, else null
  encounter: { triggered: boolean, roll: number } | null,
  weather: { condition, intensity, changed, description },
  rationsDepleted,     // true if rations hit 0 this watch
  restRequired,        // true if currentWatch === NIGHT_WATCH_INDEX
  movementBlocked,     // true if terrain + weather made travel impossible
  foragingResult,      // ForagingResult | null
  warnings,            // string[] — diegetic events for narrator to voice
}
```

---

## 9. Context Injection — `formatWildernessHUD`

Mirrors the pattern of `formatSurvivalHUD` (Milestone O) in `lib/memory/formatter.ts`.

### 9.1 `WildernessHUDContext` Interface

Passed into `formatSystemPrompt` as `context.wildernessHUD?: WildernessHUDContext`.

| Field | Description |
|---|---|
| `currentQ`, `currentR` | Party's current hex coordinates |
| `terrain` | Terrain type string |
| `biome` | Azgaar biome label |
| `watchIndex` | Current watch (0–5) with name |
| `totalDays` | Elapsed in-game days |
| `weatherCondition` | Current weather string |
| `weatherIntensity` | 0–2 severity |
| `partyPace` | Current pace setting |
| `rations` | Current ration count (from PartyInventory) |
| `featureHere` | Feature string if present on current hex, else null |

### 9.2 Section Output Format

```
## 🗺️ Wilderness Status
**Position:** (Q: {q}, R: {r}) — {biome} {terrain}
**Watch:** {watchName} ({watchIndex}/5) | Day {totalDays}
**Weather:** {condition} (intensity {intensity}) — {description}
**Pace:** {partyPace}
**Rations:** {rations}
{featureHere ? "**Feature:** " + featureHere : ""}
```

### 9.3 Iron Laws Mandate (Wilderness Exploration Mandate)

The following text is appended to `formatIronLaws()` in `lib/memory/formatter.ts`:

> "**Wilderness Exploration Mandate:** Every overworld action the party takes — travel, foraging,
> scouting, resting, making camp — MUST be resolved by calling `executeTravelWatch`. NEVER narrate
> hex discovery, terrain features, weather changes, ration depletion, or encounter triggers without
> a tool response confirming it. The hex does not exist for the party until `WildernessHex.discovered`
> is true. NEVER describe what lies in an undiscovered hex. Voice only the `warnings[]` and
> `featureDiscovered` returned by the tool. Code is Law."

---

## 10. Presentation Layer — `WildernessHUD` Component

A new read-only React component at `components/exploration/WildernessHUD.tsx`, following the exact
structural and semantic pattern of `SurvivalHUD.tsx` (Milestone O).

**Required `data-testid` attributes:**

| `data-testid` | Content | Conditional? |
|---|---|---|
| `hex-position` | `(Q:{q}, R:{r})` | Always |
| `terrain` | Terrain type string | Always |
| `watch-name` | Named watch (e.g., "Morning") | Always |
| `watch-index` | Watch index 0–5 | Always |
| `total-days` | Elapsed day count | Always |
| `weather` | Condition string | Always |
| `weather-intensity` | 0–2 numeric value | Always |
| `party-pace` | Pace string | Always |
| `rations` | Ration count | Always |
| `feature` | Feature string | Only when `featureHere !== null` |

Root element: `aria-label="Wilderness and Travel Status"`, `data-watch-index={watchIndex}`.

---

## 11. Test Requirements

### 11.1 Pure Rules Tests (`tests/rules/wilderness.test.ts`)

Minimum test count: **90 tests**. Vitest `node` environment. All random rolls injectable via
`forcedRoll` parameters.

| Domain | Test Scenarios |
|---|---|
| Constants | All 10 constants are exported and match spec values |
| `calculateTravelPace` | All 9 terrain types × 3 pace levels; weather blocking (storm/severe snow); slow pace enables foraging flag; fast pace sets Perception penalty |
| `resolveForaging` | DC 10 terrain success/failure; DC 15 terrain success/failure; weather penalty (+5 DC); forced roll boundary cases; yield clamped to min 1 on success; survivalMod applied |
| `generateWeatherCheck` | Persistence probability for storm and clear; snow gated to correct biomes/seasons; all 6 conditions reachable; `changed` flag accuracy |
| Hex neighbor math | All 6 direction deltas produce correct adjacent (q, r) |

### 11.2 Formatter Tests (`tests/memory/formatter.test.ts`)

Append to existing suite. Minimum **10 new tests** covering:
- Wilderness Exploration Mandate present in Iron Laws output
- `formatWildernessHUD` renders all fields correctly
- `formatWildernessHUD` omits feature line when `featureHere` is null
- `formatSystemPrompt` includes wilderness HUD block when `wildernessHUD` provided
- `formatSystemPrompt` excludes wilderness HUD block when absent

### 11.3 Component Tests (`tests/components/WildernessHUD.test.tsx`)

Vitest `jsdom` environment. Minimum **30 tests** covering:
- Root element aria-label and `data-watch-index`
- All `data-testid` elements present with correct values
- `feature` element absent when null
- Weather intensity boundaries (0, 1, 2)
- All 6 watch index names render correctly

---

## 12. Slice Breakdown

This milestone is implemented in two slices, matching the Milestone O execution model.

### Slice 1 — Data Layer & Rules Engine

**Deliverables:**
1. Resolve Open Architect Questions Q1–Q5 and lock them in this spec.
2. Prisma schema: add `WildernessHex` model, `TravelState` model, and `wilderness WildernessHex[]` + `travelState TravelState?` relations on `Campaign`. Apply via `npx prisma db push`.
3. Implement `lib/rules/wilderness.ts`: all constants, type definitions, and the three pure functions.
4. Implement `tests/rules/wilderness.test.ts`: 90+ tests, all passing.
5. Run `pnpm exec tsc --noEmit` — 0 errors required.

**Negative constraint:** No AI tooling, no formatter changes, no UI components.

### Slice 2 — AI Tool & UI Integration

**Deliverables:**
1. Implement `executeTravelWatch` tool in `lib/ai/narrator.ts` → `buildTools()`.
2. Update `lib/memory/formatter.ts`: add Wilderness Exploration Mandate to `formatIronLaws()`; add `WildernessHUDContext` interface and `formatWildernessHUD()` function; update `formatSystemPrompt` signature.
3. Implement `components/exploration/WildernessHUD.tsx`.
4. Implement `tests/memory/formatter.test.ts` additions (10+ tests).
5. Implement `tests/components/WildernessHUD.test.tsx` (30+ tests).
6. Run full test suite — existing 1069 tests must remain passing; 0 TypeScript errors.

**Negative constraint:** No core dungeon-turn system modifications. Milestone O code is frozen.

---

## 13. Validation Criteria

Milestone P is **not complete** until:

1. `pnpm exec tsc --noEmit` exits 0.
2. `pnpm vitest run` passes all existing 1069 tests plus the 130+ new tests.
3. `executeTravelWatch` correctly refuses to advance time during Night Watch unless action is `"rest"`.
4. A hex at any `(q, r)` coordinate, given the same campaign seed, always produces identical terrain, biome, elevation, and moisture — verified by repeating generation with the same inputs.
5. The AI narrator, given only the tool's return payload and the wilderness HUD context, cannot narrate undiscovered hex contents (the prompt mandate enforces this; a spot-check during manual QA is required).
6. Ration consumption fires exactly once per 6 watches, integrated correctly with `PartyInventory.rations`.

---

*Drafted: 2026-04-15. Status: DRAFT — awaiting Architect Q1–Q5 resolution before Slice 1 execution.*
