# Milestone P — Wilderness Exploration & Hexcrawl Engine: Architecture Closure Report

**Date:** 2026-04-15
**Branch:** master
**Status:** Complete — 0 TypeScript errors, 1152 tests passing (1 pre-existing loot failure excluded)

---

## 1. Scope

Milestone P implements a deterministic Hexcrawl and Wilderness Exploration engine. It transposes the time-tracking principles of Milestone O into the overworld, replacing "Turns" with "Watches" (4-hour blocks) and adding spatial navigation across a theoretically infinite, seeded hex grid. The AI narrator is stripped of authority over terrain, weather, and travel progress — the engine computes these, the narrator witnesses them.

---

## 2. Overworld Constants (`lib/rules/wilderness.ts`)

| Constant | Value | Meaning |
|---|---|---|
| `WATCHES_PER_DAY` | 6 | 1 watch = 4 hours |
| `NIGHT_WATCH_INDEX` | 5 | The 6th watch (00:00–04:00) is mandatory rest |
| `WILDERNESS_RATION_INTERVAL` | 6 | Rations consumed once every 6 watches (24h) |
| `WEATHER_RECALC_INTERVAL` | 6 | Weather recalculated once per day |
| `MAX_TRAVEL_WATCHES` | 2 | Marching > 2 watches/day (8h) triggers exhaustion risk |
| `SCOUTING_RADIUS` | 1 | Scouting reveals all adjacent (r=1) hexes |
| `NORMAL_PACE` | 1 hex/watch | Standard travel speed |
| `FAST_PACE` | 2 hexes/watch | Double speed; −5 Perception; +5 Foraging DC |
| `SLOW_PACE` | 0.5 hex/watch | Half speed; allow foraging while moving; Stealth advantage |

---

## 3. Data Layer (`prisma/schema.prisma`)

### New Model: `WildernessMap`
Stores the realized state of the world grid. Hexes are "real" only once this record exists.
```prisma
model WildernessMap {
  campaignId String
  q, r       Int      // Cube coordinates
  terrain    String   // plains | forest | hills | mountain | swamp | etc.
  biome      String   // Narrative flavor (e.g. "Alpine Highland")
  discovered Boolean  // True if physically occupied
  scouted    Boolean  // True if seen from afar
  feature    String?  // dungeon_entrance | village | ruins | shrine
  seed       String   // deterministic hash
  @@unique([campaignId, q, r])
}
```

### New Model: `TravelState`
Tracks the party's overworld temporal and spatial position.
```prisma
model TravelState {
  currentQ, currentR     Int
  currentWatch           Int      // 0–5 (Dawn/Morning/Midday/Afternoon/Evening/Night)
  totalWatches, totalDays Int
  watchesTraveledToday   Int      // Counter for exhaustion gate
  weatherCondition       String   // clear | overcast | rain | storm | fog | snow
  weatherIntensity       Int      // 0–2 (mild, moderate, severe)
  partyPace              String   // slow | normal | fast
}
```

---

## 4. AI Tool (`lib/ai/tools/wilderness.ts`)

### `executeTravelWatch`

The sole gateway for overworld progression. The AI Narrator **MUST** call this for every activity (traveling, foraging, resting, scouting).

**Execution Logic:**
1. **Gate:** If `currentWatch === 5` (Night) and action is not `"rest"`, execution is blocked (mandatory sleep).
2. **Terrain Generation:** Uses `seededFloat(campaignId:q:r)` to derive elevation/moisture axes and map them to deterministic terrain type and biome.
3. **Weather Engine:** Every 6 watches, transitions weather based on a severity ladder (Clear ↔ Overcast ↔ Rain ↔ Storm).
4. **Movement Resolution:**
   - `travel`: Updates `currentQ/R` based on pace and weather. Halves speed in rain/snow; blocks movement in severe storms or at the coast.
   - `scout`: Reveals adjacent hexes without moving.
5. **Encounter Engine:** Rolls d6 on destination. Triggered on 1 (normal) or 1–2 (dangerous terrain: mountain/swamp).
6. **Feature Discovery:** 5% deterministic chance per hex of a "Point of Interest".

---

## 5. UI Component (`components/exploration/WildernessHUD.tsx`)

A read-only status panel that maps DB state to visual tokens.

| Prop | Test ID | Mapping/Identity |
|---|---|---|
| `currentQ`, `currentR` | `hex-position` | (q, r) |
| `terrain`, `biome` | `terrain` | e.g., "mountain (Barren Mountain)" |
| `watchIndex` | `watch-name` | Maps [0..5] to ["Dawn".."Night"] |
| `weatherCondition` | `weather` | clear / rain / storm / etc. |
| `rations` | `rations` | Party resource reserve |
| `featureHere` | `feature` | Renders "Notable feature present" highlight |

---

## 6. Test Coverage

| Suite | File | Count |
|---|---|---|
| Rules Engine | `tests/rules/wilderness.test.ts` | 142 |
| AI Tool logic | `tests/ai/tools/wilderness.test.ts` | 38 |
| HUD Component | `tests/components/WildernessHUD.test.tsx` | 25 |
| **Total (full suite)** | — | **1152 passing** |

*Excluded: `loot.test.ts` (pre-existing Magic Item validation failure — out of scope).*

---

## 7. Architecture Closure — "Code is Law"

- **Zero AI Invention:** The Narrator cannot decide what is in a hex or how fast the party moves. It only receives the `terrain`, `movementBlocked`, and `featureDiscovered` flags from the tool.
- **Seeded Determinism:** The world is stable. Returning to hex (12, -4) will always reveal the same mountain peak and taiga forest.
- **Temporal Enforcement:** The "Night Watch" rest gate is enforced at the DB level, preventing the AI from narrating a 24-hour forced march without mechanical consequences.
