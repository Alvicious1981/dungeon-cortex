# Geometry Engine — Design Spec
**Date:** 2026-04-24
**Milestone:** V — Tactical Combat Geometry
**Status:** Approved

---

## 1. Purpose

Implement `lib/rules/geometry.ts`: a pure, deterministic geometry engine for the tactical combat grid. This module operates on raw `(x, y)` combatant coordinates (one level below `spatial.ts`, which handles zone-graph adjacency) and provides:

- Chebyshev grid distance
- AoE area membership (sphere, cone)
- Size-based collision detection

All functions are side-effect-free and have no I/O dependencies. This is a "Code is Law" rules module — the AI narrator must never resolve AoE membership or collision; it calls these functions.

---

## 2. Architectural Boundary

| Module | Abstraction level | Input type |
|--------|------------------|------------|
| `lib/rules/spatial.ts` | Zone graph | `GridZone` (has adjacency list) |
| `lib/rules/geometry.ts` | Precise grid coordinates | `GridPoint` / `GridCombatant` |
| `lib/rules/hex-grid.ts` | Hex/cube overworld | `CubeCoordinates` |

No overlap. `geometry.ts` does not import `spatial.ts` and vice versa.

---

## 3. Types

```ts
/** A coordinate on the tactical grid. 1 square = 5 ft. */
export interface GridPoint {
  x: number
  y: number
}

/**
 * D&D 5e 2014 size categories, mirroring Combatant.size in schema.prisma.
 * Controls how many squares a creature occupies (sizeToSquares).
 */
export type SizeCategory =
  | "Tiny" | "Small" | "Medium" | "Large" | "Huge" | "Gargantuan"

/**
 * Minimum slice of a Combatant required for collision detection.
 * Does not import Prisma — remains a pure value type.
 */
export interface GridCombatant {
  id: string
  x: number   // top-left corner of footprint (0-based grid column)
  y: number   // top-left corner of footprint (0-based grid row)
  size: SizeCategory
}
```

---

## 4. Functions

### 4.1 Distance

#### `chebyshevSquares(a, b): number`
Returns the Chebyshev distance in grid squares.

```
max(|a.x - b.x|, |a.y - b.y|)
```

Pure, integer-result, commutative.

#### `gridDistanceFt(a, b): number`
Returns the Chebyshev distance in feet (5e standard: 1 square = 5 ft).

```
chebyshevSquares(a, b) × 5
```

---

### 4.2 AoE: Sphere / Circle

#### `isInSphere(point, center, radiusFt): boolean`

A square is in the sphere's area if its center-point is within `radiusFt` feet of the sphere's `center`, using **Euclidean** distance. This matches the SRD "true circle" template.

```
√( (Δx × 5)² + (Δy × 5)² ) ≤ radiusFt
```

Boundary is **inclusive** (`≤`): a target exactly at range is affected.

---

### 4.3 AoE: Cone

#### `isInCone(point, origin, direction, lengthFt): boolean`

Implements D&D 5e RAW "width = distance" cone.

Two independent conditions — **both** must be true:

1. **Length gate (Chebyshev):** `chebyshevSquares(origin, point) × 5 ≤ lengthFt`
   Keeps cone length coherent with movement cost on the grid.

2. **Angle gate (RAW strict):** angle between `direction` and the vector `(point - origin)` must be ≤ `arctan(0.5) ≈ 26.57°`.
   Computed via dot product + `Math.atan2`. `direction` is normalized internally — callers may pass integer deltas (e.g. `{x:1, y:0}` for East).

The origin square itself is **excluded** per SRD ("a cone's point of origin is not included").

**Half-angle constant:** `CONE_HALF_ANGLE_RAD = Math.atan(0.5)` — exported for test transparency.

---

### 4.4 Size-Based Collision

#### `sizeToSquares(size): number`

| Size | Squares (side) | Footprint |
|------|---------------|-----------|
| Tiny | 1 | 1×1 |
| Small | 1 | 1×1 |
| Medium | 1 | 1×1 |
| Large | 2 | 2×2 |
| Huge | 3 | 3×3 |
| Gargantuan | 4 | 4×4 |

#### `getCombatantOccupiedSquares(combatant): GridPoint[]`

Returns all `GridPoint`s in the combatant's footprint. Anchor `(x, y)` = top-left corner. A `Large` combatant at `(2,3)` occupies `[(2,3),(3,3),(2,4),(3,4)]`.

```
for row in [y .. y+s-1]
  for col in [x .. x+s-1]
    yield { x: col, y: row }
```

where `s = sizeToSquares(combatant.size)`.

#### `isOccupied(point, combatants): boolean`

Returns `true` if any combatant in `combatants` has `point` in its occupied squares. O(n × s²) — acceptable for typical encounter sizes (≤ 20 combatants).

---

## 5. Test Plan — `tests/rules/geometry.test.ts`

Framework: **Vitest**, `@/` alias, no mocking needed (pure functions).

| Suite | Key cases |
|-------|-----------|
| `chebyshevSquares` | same point → 0; orthogonal → 1; diagonal → 1 (Chebyshev); L-shape → max(Δx, Δy); commutative |
| `gridDistanceFt` | 1 sq → 5 ft; 3 sq → 15 ft; diagonal 1 sq → 5 ft |
| `isInSphere` | center → true; exact boundary → true (inclusive); 1 ft beyond → false; radius 0 → only center |
| `isInCone` | on axis within length → true; at exactly 26.57° → true; at 30° → false; beyond length → false; origin excluded |
| `sizeToSquares` | all 6 categories → correct integer |
| `getCombatantOccupiedSquares` | Medium → 1 point; Large → 4 points; Huge → 9 points; correct coordinates |
| `isOccupied` | point in Large footprint → true; adjacent point → false; empty list → false |

---

## 6. Non-Goals (this iteration)

- No line AoE (Lightning Bolt) — deferred.
- No cube AoE — deferred.
- No movement path validation — handled by `spatial.ts:canMove`.
- No UI changes.
- No Prisma queries — callers load combatants; this module validates geometry only.
