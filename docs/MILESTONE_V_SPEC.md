# Milestone V: The Cartographer & The Chronicler
## Phase 0: Technical Specification & Data Architecture

> **Execution contract (2026-07-25).** The repository already contains the
> first pure-geometry slice (`chebyshevSquares`, sphere/cone membership and
> footprint collision), but still persists one `Zone` row per cell, duplicates
> map size in the UI, and mutates movement without an authoritative map-boundary
> check. Milestone V is complete only when the acceptance criteria at the end of
> this document pass. This note supersedes the older assumption that
> `geometry.ts` had not yet been started.

### 1. Architectural Goal
Transition the combat resolution engine from an abstract "Zone" system to a deterministic, coordinate-based Tactical Map (Grid) supporting multi-target AoE calculations, line-of-sight approximations, and precise movement constraints using D&D 5e RAW rules.

### 2. Data Layer Mutations (Prisma)
The following changes are applied to `schema.prisma` in Phase 1:

- **ENUM: GridType**
  - Values: `SQUARE`, `HEX`
- **NEW MODEL: EncounterMap**
  - `id` (String, cuid)
  - `encounterId` (String, Unique FK -> Encounter)
  - `gridType` (GridType, default SQUARE)
  - `width` (Int, number of columns)
  - `height` (Int, number of rows)
  - `cellSize` (Int, default 5, representing feet per cell)
- **MUTATE MODEL: Combatant**
  - *DEPRECATE & REMOVE*: `zoneId` field and relation.
  - *KEEP & ENFORCE*: `x` (Int) and `y` (Int). These are now strictly validated against `EncounterMap` boundaries.
  - *KEEP*: `size` (String, default "Medium"). Required to calculate multi-cell occupancy for Large/Huge creatures.
- **DEPRECATE MODEL: Zone**
  - Remove entire model and its relations.

### 3. Rules Engine Expansion (`lib/rules/geometry.ts`)
Before any UI is touched, the following pure TypeScript functions must be built and tested with Vitest:
- `calculateDistance(from, to, gridType, cellSize)`: supports Chebyshev
  distance for square grids and axial/cube distance for hex grids.
- `getAoETargets(area, combatants)`: deterministically identifies which
  combatant footprints intersect a Cone, Sphere, Cube, or Line. `sizeFt`
  follows the canonical 5e API meaning for each shape (radius for sphere;
  length for cone/line; side length for cube).
- `validateMovement(input)`: checks integer coordinates, map bounds including
  creature footprint, occupancy/collisions, no-op movement, and movement cost
  against speed.

All geometry inputs carry `cellSize`; no rule function assumes a UI-only map
dimension. New encounters use `SQUARE`, 5-foot cells. `HEX` is supported by the
pure distance/AoE contract but is not exposed as an encounter-creation UI
choice in this milestone.

### 4. API & State Mutations
- **Encounter Initialization:** `app/api/campaign/[id]/encounter/route.ts` must generate an `EncounterMap` implicitly when an Encounter starts.
- **Action Route (Move):** The deterministic `action="Move"` branch must
  validate via `lib/rules/geometry.ts` and mutate `Combatant.x / Combatant.y`
  inside a `$transaction`.
- **Spell areas:** Cached canonical `area_of_effect` metadata is projected into
  the resolved spell effect. A selected target is the deterministic anchor
  (sphere/cube) or direction (cone/line); the backend derives the affected
  `targets[]` from current coordinates before the combat pipeline runs.

### 5. Execution Constraints (Backend-First)
- UI and VTT components MUST NOT be altered until the Prisma Schema is migrated, `geometry.ts` has 100% test coverage, and the API correctly mutates coordinates in the database.
- Multi-target spells must ingest the new `getAoETargets` output to populate the `targets[]` SSE payload.

### 6. Migration and compatibility

- Existing `Combatant.x/y` values are preserved.
- Every existing encounter receives one `EncounterMap` before `Zone` and
  `Combatant.zoneId` are dropped.
- Backfilled maps are at least 10×10 and expand to include every persisted
  coordinate. This preserves the current 10×10 VTT projection while making the
  dimension authoritative.
- The migration is forward-only. Rollback requires restoring the database
  backup because dropping `Zone` is intentionally destructive after backfill.

### 7. Acceptance criteria

1. Prisma schema and migration contain `GridType` and one optional
   `Encounter.map` / unique `EncounterMap.encounterId` relation; `Zone` and
   `Combatant.zoneId` no longer exist.
2. Geometry unit tests cover square/hex distance, all four AoE shapes,
   footprint intersection, bounds, speed, collision, and invalid inputs.
3. Encounter creation persists the map and non-overlapping combatant
   coordinates in one transaction.
4. `Move` reads the persisted map, validates entirely in the rules layer, and
   writes coordinates inside the same transaction.
5. Area spells derive their backend target set from SRD area metadata and map
   coordinates; narration receives only the resolved consequences.
6. `BattleGrid` renders the persisted width, height, and cell size rather than
   a hard-coded 10×10 contract.
7. Typecheck, tests, build, canon check, rules audit, and an authenticated
   multi-target combat smoke test pass before the milestone commit is prepared.
