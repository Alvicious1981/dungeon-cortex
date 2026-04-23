# Milestone V: The Cartographer & The Chronicler
## Phase 0: Technical Specification & Data Architecture

### 1. Architectural Goal
Transition the combat resolution engine from an abstract "Zone" system to a deterministic, coordinate-based Tactical Map (Grid) supporting multi-target AoE calculations, line-of-sight approximations, and precise movement constraints using D&D 5e RAW rules.

### 2. Data Layer Mutations (Prisma)
The following changes will be applied to `schema.prisma` in Phase 1:

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
  - *ADD*: `size` (String, default "Medium"). Required to calculate multi-cell occupancy for Large/Huge creatures.
- **DEPRECATE MODEL: Zone**
  - Remove entire model and its relations.

### 3. Rules Engine Expansion (`lib/rules/geometry.ts`)
Before any UI is touched, the following pure TypeScript functions must be built and tested with Vitest:
- `calculateDistance(x1, y1, x2, y2, gridType)`: Must support Chebyshev distance (Square 1-1-1 or 5e variant 1-2-1) and Hexagonal distance (cube coordinates math).
- `getAoETargets(originX, originY, shape, size, gridType, combatants)`: Deterministically identifies which combatants fall inside a Cone, Sphere, Cube, or Line.
- `validateMovement(combatant, targetX, targetY, map)`: Checks bounds, checks occupancy/collisions, and calculates movement cost against the combatant's speed.

### 4. API & State Mutations
- **Encounter Initialization:** `app/api/campaign/[id]/encounter/route.ts` must generate an `EncounterMap` implicitly when an Encounter starts.
- **Action Route (Move):** A new deterministic action branch inside `app/api/campaign/[id]/action/route.ts` specifically for intent="move". It must validate via `lib/rules/geometry.ts` and mutate `Combatant.x / Combatant.y` inside a `$transaction`.

### 5. Execution Constraints (Backend-First)
- UI and VTT components MUST NOT be altered until the Prisma Schema is migrated, `geometry.ts` has 100% test coverage, and the API correctly mutates coordinates in the database.
- Multi-target spells must ingest the new `getAoETargets` output to populate the `targets[]` SSE payload.
