# Geometry Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `lib/rules/geometry.ts` — a pure, deterministic tactical grid geometry engine for D&D 5e combat (Milestone V).

**Architecture:** Pure functions module with no I/O or side effects. Operates on raw `GridPoint` / `GridCombatant` value types (below the zone-graph abstraction of `spatial.ts`). Chebyshev distance governs movement/range checks; Euclidean governs AoE sphere templates; RAW-strict cone uses Chebyshev for length gating + `arctan(0.5)` half-angle for angular gating.

**Tech Stack:** TypeScript, Vitest (`pnpm test` / `pnpm exec vitest run tests/rules/geometry.test.ts`)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `lib/rules/geometry.ts` | All exported types + pure geometry functions |
| Create | `tests/rules/geometry.test.ts` | Exhaustive unit tests — all suites from spec §5 |

No other files are touched.

---

### Task 1: Scaffold types and distance functions

**Files:**
- Create: `lib/rules/geometry.ts`
- Create: `tests/rules/geometry.test.ts`

- [ ] **Step 1.1 — Write the failing distance tests first (TDD)**

Create `tests/rules/geometry.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import {
  chebyshevSquares,
  gridDistanceFt,
  GridPoint,
} from "@/lib/rules/geometry"

// ---------------------------------------------------------------------------
// chebyshevSquares
// ---------------------------------------------------------------------------

describe("chebyshevSquares", () => {
  it("returns 0 for the same point", () => {
    expect(chebyshevSquares({ x: 3, y: 3 }, { x: 3, y: 3 })).toBe(0)
  })

  it("returns 1 for an orthogonal neighbour (right)", () => {
    expect(chebyshevSquares({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(1)
  })

  it("returns 1 for an orthogonal neighbour (down)", () => {
    expect(chebyshevSquares({ x: 0, y: 0 }, { x: 0, y: 1 })).toBe(1)
  })

  it("returns 1 for a diagonal neighbour — Chebyshev diagonal = 1", () => {
    expect(chebyshevSquares({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(1)
  })

  it("returns max(Δx, Δy) for an L-shaped offset (Δx > Δy)", () => {
    expect(chebyshevSquares({ x: 0, y: 0 }, { x: 3, y: 1 })).toBe(3)
  })

  it("returns max(Δx, Δy) for an L-shaped offset (Δy > Δx)", () => {
    expect(chebyshevSquares({ x: 0, y: 0 }, { x: 1, y: 3 })).toBe(3)
  })

  it("is commutative — chebyshevSquares(A,B) === chebyshevSquares(B,A)", () => {
    const a: GridPoint = { x: 0, y: 0 }
    const b: GridPoint = { x: 5, y: 3 }
    expect(chebyshevSquares(a, b)).toBe(chebyshevSquares(b, a))
  })

  it("handles large distances", () => {
    expect(chebyshevSquares({ x: 0, y: 0 }, { x: 0, y: 10 })).toBe(10)
  })

  it("handles negative coordinate offsets symmetrically", () => {
    expect(chebyshevSquares({ x: -3, y: 0 }, { x: 3, y: 0 })).toBe(6)
  })
})

// ---------------------------------------------------------------------------
// gridDistanceFt
// ---------------------------------------------------------------------------

describe("gridDistanceFt", () => {
  it("1 square orthogonal → 5 ft", () => {
    expect(gridDistanceFt({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(5)
  })

  it("1 square diagonal → 5 ft (Chebyshev: diagonal costs 1 square)", () => {
    expect(gridDistanceFt({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(5)
  })

  it("3 squares orthogonal → 15 ft", () => {
    expect(gridDistanceFt({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(15)
  })

  it("same point → 0 ft", () => {
    expect(gridDistanceFt({ x: 2, y: 4 }, { x: 2, y: 4 })).toBe(0)
  })
})
```

- [ ] **Step 1.2 — Run tests to confirm they fail (import missing)**

```bash
cd D:/dungeon-cortex && pnpm exec vitest run tests/rules/geometry.test.ts
```

Expected: error `Cannot find module '@/lib/rules/geometry'` or similar.

- [ ] **Step 1.3 — Implement types + distance functions**

Create `lib/rules/geometry.ts`:

```ts
/**
 * lib/rules/geometry.ts
 *
 * Tactical Grid Geometry Engine — Milestone V
 *
 * Design contract ("Code is Law"):
 *   AoE membership, distance calculation, and collision detection are resolved
 *   by pure deterministic logic here — not by the AI narrator.
 *
 * Grid convention: 1 square = 5 ft. Coordinates are 0-based integers.
 * Anchor convention: (x, y) is the top-left corner of a creature's footprint.
 *
 * This module is pure: no I/O, no side effects, no external dependencies.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A coordinate on the tactical grid. 1 square = 5 ft. */
export interface GridPoint {
  x: number
  y: number
}

/**
 * D&D 5e 2014 size categories.
 * Mirrors the `size` field on the `Combatant` Prisma model.
 */
export type SizeCategory =
  | "Tiny"
  | "Small"
  | "Medium"
  | "Large"
  | "Huge"
  | "Gargantuan"

/**
 * Minimum combatant slice required for collision queries.
 * Does not import Prisma — remains a pure value type.
 *
 * Anchor: (x, y) is the top-left corner of the creature's footprint.
 */
export interface GridCombatant {
  id: string
  x: number
  y: number
  size: SizeCategory
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Half-angle of a D&D 5e 2014 RAW cone in radians.
 * Derived from "width at distance d = d" → tan(θ) = 0.5 → θ = arctan(0.5).
 * ≈ 26.565°
 */
export const CONE_HALF_ANGLE_RAD: number = Math.atan(0.5)

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

/**
 * Returns the Chebyshev distance between two grid points in squares.
 *
 * Chebyshev distance treats diagonal movement as 1 square, matching D&D 5e's
 * optional grid rules (PHB p.192 "Variant: Playing on a Grid").
 *
 * Formula: max(|Δx|, |Δy|)
 *
 * @pure — deterministic, no side effects.
 */
export function chebyshevSquares(a: GridPoint, b: GridPoint): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
}

/**
 * Returns the Chebyshev distance between two grid points in feet (1 sq = 5 ft).
 *
 * @pure — deterministic, no side effects.
 */
export function gridDistanceFt(a: GridPoint, b: GridPoint): number {
  return chebyshevSquares(a, b) * 5
}
```

- [ ] **Step 1.4 — Run tests: distance suites must pass**

```bash
cd D:/dungeon-cortex && pnpm exec vitest run tests/rules/geometry.test.ts
```

Expected: 13 tests pass, 0 fail.

- [ ] **Step 1.5 — Typecheck**

```bash
cd D:/dungeon-cortex && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 1.6 — Commit**

```bash
cd D:/dungeon-cortex && git add lib/rules/geometry.ts tests/rules/geometry.test.ts && git commit -m "feat(geometry): add GridPoint types and Chebyshev distance functions"
```

---

### Task 2: Sphere AoE

**Files:**
- Modify: `lib/rules/geometry.ts` (append `isInSphere`)
- Modify: `tests/rules/geometry.test.ts` (append sphere suite)

- [ ] **Step 2.1 — Add failing sphere tests**

Append to `tests/rules/geometry.test.ts`:

```ts
import {
  chebyshevSquares,
  gridDistanceFt,
  isInSphere,            // add this import
  GridPoint,
} from "@/lib/rules/geometry"

// ---------------------------------------------------------------------------
// isInSphere
// ---------------------------------------------------------------------------

describe("isInSphere", () => {
  // Center (0,0), radius 10 ft

  it("center point is always inside the sphere", () => {
    expect(isInSphere({ x: 0, y: 0 }, { x: 0, y: 0 }, 10)).toBe(true)
  })

  it("point exactly at radius is included (boundary inclusive)", () => {
    // (2,0): Euclidean = 2×5 = 10 ft = radius
    expect(isInSphere({ x: 2, y: 0 }, { x: 0, y: 0 }, 10)).toBe(true)
  })

  it("point 1 ft beyond radius is excluded", () => {
    // (3,0): Euclidean = 3×5 = 15 ft > 10 ft
    expect(isInSphere({ x: 3, y: 0 }, { x: 0, y: 0 }, 10)).toBe(false)
  })

  it("diagonal point within radius is included (Euclidean, not Chebyshev)", () => {
    // (1,1): Euclidean = sqrt(50) ≈ 7.07 ft ≤ 10 ft → inside
    expect(isInSphere({ x: 1, y: 1 }, { x: 0, y: 0 }, 10)).toBe(true)
  })

  it("diagonal point just beyond radius is excluded", () => {
    // (2,2): Euclidean = sqrt(200) ≈ 14.14 ft > 10 ft → outside
    expect(isInSphere({ x: 2, y: 2 }, { x: 0, y: 0 }, 10)).toBe(false)
  })

  it("radius 0 includes only the center", () => {
    expect(isInSphere({ x: 0, y: 0 }, { x: 0, y: 0 }, 0)).toBe(true)
    expect(isInSphere({ x: 1, y: 0 }, { x: 0, y: 0 }, 0)).toBe(false)
  })

  it("works with a non-origin center", () => {
    // center (5,5), radius 5 ft
    expect(isInSphere({ x: 5, y: 5 }, { x: 5, y: 5 }, 5)).toBe(true)
    expect(isInSphere({ x: 6, y: 5 }, { x: 5, y: 5 }, 5)).toBe(true)  // 5 ft
    expect(isInSphere({ x: 7, y: 5 }, { x: 5, y: 5 }, 5)).toBe(false) // 10 ft
  })
})
```

- [ ] **Step 2.2 — Run to confirm sphere tests fail**

```bash
cd D:/dungeon-cortex && pnpm exec vitest run tests/rules/geometry.test.ts
```

Expected: sphere suite errors (import not found / function not exported).

- [ ] **Step 2.3 — Implement `isInSphere`**

Append to `lib/rules/geometry.ts` (after `gridDistanceFt`):

```ts
// ---------------------------------------------------------------------------
// AoE: Sphere / Circle
// ---------------------------------------------------------------------------

/**
 * Returns true if `point` lies within a sphere (circle on a flat grid) centered
 * at `center` with radius `radiusFt` feet.
 *
 * Uses Euclidean distance — matching the SRD "true circle" template where a
 * square is affected if its center falls within the radius.
 *
 * Boundary is inclusive: a target exactly at `radiusFt` is affected.
 *
 * @pure — deterministic, no side effects.
 */
export function isInSphere(
  point: GridPoint,
  center: GridPoint,
  radiusFt: number
): boolean {
  const dx = (point.x - center.x) * 5
  const dy = (point.y - center.y) * 5
  return Math.sqrt(dx * dx + dy * dy) <= radiusFt
}
```

- [ ] **Step 2.4 — Run tests: all suites must pass**

```bash
cd D:/dungeon-cortex && pnpm exec vitest run tests/rules/geometry.test.ts
```

Expected: 20 tests pass, 0 fail.

- [ ] **Step 2.5 — Typecheck**

```bash
cd D:/dungeon-cortex && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 2.6 — Commit**

```bash
cd D:/dungeon-cortex && git add lib/rules/geometry.ts tests/rules/geometry.test.ts && git commit -m "feat(geometry): add isInSphere (Euclidean AoE, SRD true-circle template)"
```

---

### Task 3: Cone AoE (RAW strict)

**Files:**
- Modify: `lib/rules/geometry.ts` (append `isInCone`)
- Modify: `tests/rules/geometry.test.ts` (append cone suite)

- [ ] **Step 3.1 — Add failing cone tests**

Append to `tests/rules/geometry.test.ts`. Update the import line to include `isInCone` and `CONE_HALF_ANGLE_RAD`:

```ts
import {
  chebyshevSquares,
  gridDistanceFt,
  isInSphere,
  isInCone,
  CONE_HALF_ANGLE_RAD,
  GridPoint,
} from "@/lib/rules/geometry"

// ---------------------------------------------------------------------------
// isInCone  (origin = {0,0}, direction = East {1,0}, lengthFt = 20)
// ---------------------------------------------------------------------------

describe("isInCone", () => {
  const origin: GridPoint = { x: 0, y: 0 }
  const east: GridPoint = { x: 1, y: 0 }

  it("excludes the origin square itself (SRD: origin not included)", () => {
    expect(isInCone(origin, origin, east, 20)).toBe(false)
  })

  it("includes a point on the axis within length", () => {
    // (2,0): cheb=2 → 10 ft ≤ 20 ft; angle=0° ≤ 26.57°
    expect(isInCone({ x: 2, y: 0 }, origin, east, 20)).toBe(true)
  })

  it("includes a point at exactly the boundary angle arctan(0.5) ≈ 26.57°", () => {
    // (2,1): angle = atan2(1,2) = atan(0.5) = CONE_HALF_ANGLE_RAD; cheb=2 → 10 ft ≤ 20 ft
    expect(isInCone({ x: 2, y: 1 }, origin, east, 20)).toBe(true)
  })

  it("includes a point with a smaller angle than 26.57°", () => {
    // (3,1): angle = atan2(1,3) ≈ 18.43° < 26.57°; cheb=3 → 15 ft ≤ 20 ft
    expect(isInCone({ x: 3, y: 1 }, origin, east, 20)).toBe(true)
  })

  it("excludes a point whose angle exceeds 26.57° (45° diagonal)", () => {
    // (1,1): angle = 45° > 26.57°; cheb=1 → 5 ft ≤ 20 ft
    expect(isInCone({ x: 1, y: 1 }, origin, east, 20)).toBe(false)
  })

  it("excludes a point beyond the Chebyshev length gate", () => {
    // (5,0): cheb=5 → 25 ft > 20 ft (length gate fails)
    expect(isInCone({ x: 5, y: 0 }, origin, east, 20)).toBe(false)
  })

  it("excludes a point directly behind the origin (opposite direction)", () => {
    // (-1,0): angle = 180° > 26.57°
    expect(isInCone({ x: -1, y: 0 }, origin, east, 20)).toBe(false)
  })

  it("works with a non-axis direction (diagonal NE = {1,-1})", () => {
    // direction NE, point along that axis should be inside
    // origin (0,0), dir (1,-1), point (2,-2): cheb=2, angle=0 → inside
    expect(isInCone({ x: 2, y: -2 }, origin, { x: 1, y: -1 }, 20)).toBe(true)
  })

  it("works with an integer direction vector that is not unit length", () => {
    // direction (3,0) should behave identically to (1,0) after normalisation
    expect(isInCone({ x: 2, y: 0 }, origin, { x: 3, y: 0 }, 20)).toBe(true)
    expect(isInCone({ x: 1, y: 1 }, origin, { x: 3, y: 0 }, 20)).toBe(false)
  })

  it("returns false for a zero-length direction vector (degenerate input)", () => {
    expect(isInCone({ x: 1, y: 0 }, origin, { x: 0, y: 0 }, 20)).toBe(false)
  })

  it("cone at exactly max Chebyshev range is included", () => {
    // (4,0): cheb=4 → 20 ft = lengthFt (boundary inclusive)
    expect(isInCone({ x: 4, y: 0 }, origin, east, 20)).toBe(true)
  })
})
```

- [ ] **Step 3.2 — Run to confirm cone tests fail**

```bash
cd D:/dungeon-cortex && pnpm exec vitest run tests/rules/geometry.test.ts
```

Expected: cone suite errors (function not exported yet).

- [ ] **Step 3.3 — Implement `isInCone`**

Append to `lib/rules/geometry.ts` (after `isInSphere`):

```ts
// ---------------------------------------------------------------------------
// AoE: Cone
// ---------------------------------------------------------------------------

/**
 * Returns true if `point` lies within a D&D 5e 2014 RAW cone.
 *
 * A point is inside the cone when BOTH conditions hold:
 *   1. Length gate:  chebyshevSquares(origin, point) × 5 ≤ lengthFt
 *      (Chebyshev — keeps the cone boundary coherent with movement cost)
 *   2. Angle gate:   angle between `direction` and (point − origin) ≤ CONE_HALF_ANGLE_RAD
 *      (arctan(0.5) ≈ 26.57° — "width at distance d = d" per SRD)
 *
 * The origin square itself is excluded per SRD convention.
 *
 * `direction` may be any non-zero integer or floating-point vector; it is
 * normalised internally. Examples: {x:1,y:0} = East, {x:-1,y:1} = SW.
 *
 * @pure — deterministic, no side effects.
 */
export function isInCone(
  point: GridPoint,
  origin: GridPoint,
  direction: GridPoint,
  lengthFt: number
): boolean {
  // Exclude the origin itself
  if (point.x === origin.x && point.y === origin.y) {
    return false
  }

  // Gate 1: Chebyshev length
  if (chebyshevSquares(origin, point) * 5 > lengthFt) {
    return false
  }

  // Gate 2: Angle — normalise direction vector
  const dirMag = Math.sqrt(direction.x * direction.x + direction.y * direction.y)
  if (dirMag === 0) {
    return false // degenerate zero-length direction
  }
  const dirNx = direction.x / dirMag
  const dirNy = direction.y / dirMag

  // Unit vector from origin to point
  const dx = point.x - origin.x
  const dy = point.y - origin.y
  const ptMag = Math.sqrt(dx * dx + dy * dy)
  if (ptMag === 0) {
    return false // already handled above, defensive guard
  }
  const ptNx = dx / ptMag
  const ptNy = dy / ptMag

  // Dot product of unit vectors = cos(angle between them)
  // Clamp to [-1, 1] to guard against floating-point drift before acos
  const dot = Math.min(1, Math.max(-1, dirNx * ptNx + dirNy * ptNy))
  const angle = Math.acos(dot)

  return angle <= CONE_HALF_ANGLE_RAD
}
```

- [ ] **Step 3.4 — Run tests: all suites must pass**

```bash
cd D:/dungeon-cortex && pnpm exec vitest run tests/rules/geometry.test.ts
```

Expected: 31 tests pass, 0 fail.

- [ ] **Step 3.5 — Typecheck**

```bash
cd D:/dungeon-cortex && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3.6 — Commit**

```bash
cd D:/dungeon-cortex && git add lib/rules/geometry.ts tests/rules/geometry.test.ts && git commit -m "feat(geometry): add isInCone (RAW strict arctan(0.5) half-angle, Chebyshev length gate)"
```

---

### Task 4: Size-based collision detection

**Files:**
- Modify: `lib/rules/geometry.ts` (append collision functions)
- Modify: `tests/rules/geometry.test.ts` (append collision suites)

- [ ] **Step 4.1 — Add failing collision tests**

Append to `tests/rules/geometry.test.ts`. Update the import line to include all collision exports:

```ts
import {
  chebyshevSquares,
  gridDistanceFt,
  isInSphere,
  isInCone,
  CONE_HALF_ANGLE_RAD,
  sizeToSquares,
  getCombatantOccupiedSquares,
  isOccupied,
  GridPoint,
  GridCombatant,
  SizeCategory,
} from "@/lib/rules/geometry"

// ---------------------------------------------------------------------------
// sizeToSquares
// ---------------------------------------------------------------------------

describe("sizeToSquares", () => {
  const cases: [SizeCategory, number][] = [
    ["Tiny",       1],
    ["Small",      1],
    ["Medium",     1],
    ["Large",      2],
    ["Huge",       3],
    ["Gargantuan", 4],
  ]

  it.each(cases)("%s → %i squares", (size, expected) => {
    expect(sizeToSquares(size)).toBe(expected)
  })
})

// ---------------------------------------------------------------------------
// getCombatantOccupiedSquares
// ---------------------------------------------------------------------------

describe("getCombatantOccupiedSquares", () => {
  it("Medium combatant at (0,0) occupies exactly 1 square", () => {
    const c: GridCombatant = { id: "c1", x: 0, y: 0, size: "Medium" }
    expect(getCombatantOccupiedSquares(c)).toEqual([{ x: 0, y: 0 }])
  })

  it("Small combatant at (3,4) occupies exactly 1 square", () => {
    const c: GridCombatant = { id: "c2", x: 3, y: 4, size: "Small" }
    expect(getCombatantOccupiedSquares(c)).toEqual([{ x: 3, y: 4 }])
  })

  it("Large combatant at (2,3) occupies 4 squares (2×2)", () => {
    const c: GridCombatant = { id: "c3", x: 2, y: 3, size: "Large" }
    const squares = getCombatantOccupiedSquares(c)
    expect(squares).toHaveLength(4)
    expect(squares).toContainEqual({ x: 2, y: 3 })
    expect(squares).toContainEqual({ x: 3, y: 3 })
    expect(squares).toContainEqual({ x: 2, y: 4 })
    expect(squares).toContainEqual({ x: 3, y: 4 })
  })

  it("Huge combatant at (0,0) occupies 9 squares (3×3)", () => {
    const c: GridCombatant = { id: "c4", x: 0, y: 0, size: "Huge" }
    const squares = getCombatantOccupiedSquares(c)
    expect(squares).toHaveLength(9)
    // Spot-check corners
    expect(squares).toContainEqual({ x: 0, y: 0 })
    expect(squares).toContainEqual({ x: 2, y: 0 })
    expect(squares).toContainEqual({ x: 0, y: 2 })
    expect(squares).toContainEqual({ x: 2, y: 2 })
  })

  it("Gargantuan combatant at (1,1) occupies 16 squares (4×4)", () => {
    const c: GridCombatant = { id: "c5", x: 1, y: 1, size: "Gargantuan" }
    const squares = getCombatantOccupiedSquares(c)
    expect(squares).toHaveLength(16)
    expect(squares).toContainEqual({ x: 1, y: 1 })
    expect(squares).toContainEqual({ x: 4, y: 4 })
  })
})

// ---------------------------------------------------------------------------
// isOccupied
// ---------------------------------------------------------------------------

describe("isOccupied", () => {
  it("returns false for an empty combatant list", () => {
    expect(isOccupied({ x: 0, y: 0 }, [])).toBe(false)
  })

  it("returns true for a Medium combatant's exact square", () => {
    const c: GridCombatant = { id: "m1", x: 1, y: 1, size: "Medium" }
    expect(isOccupied({ x: 1, y: 1 }, [c])).toBe(true)
  })

  it("returns false for an adjacent square not occupied by Medium", () => {
    const c: GridCombatant = { id: "m2", x: 1, y: 1, size: "Medium" }
    expect(isOccupied({ x: 2, y: 1 }, [c])).toBe(false)
  })

  it("returns true for a square within a Large combatant's 2×2 footprint", () => {
    const c: GridCombatant = { id: "l1", x: 2, y: 3, size: "Large" }
    expect(isOccupied({ x: 3, y: 4 }, [c])).toBe(true)  // bottom-right square
    expect(isOccupied({ x: 3, y: 3 }, [c])).toBe(true)  // top-right square
  })

  it("returns false for a square just outside a Large combatant's footprint", () => {
    const c: GridCombatant = { id: "l2", x: 2, y: 3, size: "Large" }
    expect(isOccupied({ x: 4, y: 3 }, [c])).toBe(false) // one to the right of footprint
  })

  it("returns true when multiple combatants are present and one occupies the point", () => {
    const a: GridCombatant = { id: "a", x: 0, y: 0, size: "Medium" }
    const b: GridCombatant = { id: "b", x: 5, y: 5, size: "Medium" }
    expect(isOccupied({ x: 5, y: 5 }, [a, b])).toBe(true)
    expect(isOccupied({ x: 0, y: 0 }, [a, b])).toBe(true)
    expect(isOccupied({ x: 3, y: 3 }, [a, b])).toBe(false)
  })
})
```

- [ ] **Step 4.2 — Run to confirm collision tests fail**

```bash
cd D:/dungeon-cortex && pnpm exec vitest run tests/rules/geometry.test.ts
```

Expected: collision suite errors (functions not exported yet).

- [ ] **Step 4.3 — Implement collision functions**

Append to `lib/rules/geometry.ts` (after `isInCone`):

```ts
// ---------------------------------------------------------------------------
// Collision: size-based footprint
// ---------------------------------------------------------------------------

/**
 * Returns the side length in grid squares for a given D&D 5e size category.
 *
 * | Size        | Side | Footprint |
 * |-------------|------|-----------|
 * | Tiny        |  1   |  1 × 1   |
 * | Small       |  1   |  1 × 1   |
 * | Medium      |  1   |  1 × 1   |
 * | Large       |  2   |  2 × 2   |
 * | Huge        |  3   |  3 × 3   |
 * | Gargantuan  |  4   |  4 × 4   |
 *
 * Source: D&D 5e 2014 SRD "Creature Size" table.
 *
 * @pure — deterministic, no side effects.
 */
export function sizeToSquares(size: SizeCategory): number {
  switch (size) {
    case "Tiny":
    case "Small":
    case "Medium":
      return 1
    case "Large":
      return 2
    case "Huge":
      return 3
    case "Gargantuan":
      return 4
  }
}

/**
 * Returns every grid square occupied by `combatant`.
 *
 * Anchor: `(x, y)` is the top-left corner of the footprint. A Large combatant
 * at (2, 3) occupies [(2,3), (3,3), (2,4), (3,4)].
 *
 * @pure — deterministic, no side effects.
 */
export function getCombatantOccupiedSquares(
  combatant: GridCombatant
): GridPoint[] {
  const s = sizeToSquares(combatant.size)
  const squares: GridPoint[] = []
  for (let row = combatant.y; row < combatant.y + s; row++) {
    for (let col = combatant.x; col < combatant.x + s; col++) {
      squares.push({ x: col, y: row })
    }
  }
  return squares
}

/**
 * Returns true if `point` is occupied by any combatant in `combatants`.
 *
 * O(n × s²) — acceptable for typical encounter sizes (≤ 20 combatants,
 * maximum s = 4 → Gargantuan, worst case 16 squares per combatant).
 *
 * @pure — deterministic, no side effects.
 */
export function isOccupied(
  point: GridPoint,
  combatants: GridCombatant[]
): boolean {
  return combatants.some((c) => {
    const squares = getCombatantOccupiedSquares(c)
    return squares.some((sq) => sq.x === point.x && sq.y === point.y)
  })
}
```

- [ ] **Step 4.4 — Run full test suite: all tests must pass**

```bash
cd D:/dungeon-cortex && pnpm exec vitest run tests/rules/geometry.test.ts
```

Expected: all tests pass (≥ 47 total across all suites), 0 fail.

- [ ] **Step 4.5 — Typecheck**

```bash
cd D:/dungeon-cortex && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4.6 — Run the full project test suite (regression check)**

```bash
cd D:/dungeon-cortex && pnpm test
```

Expected: all existing tests still pass, geometry tests pass.

- [ ] **Step 4.7 — Commit**

```bash
cd D:/dungeon-cortex && git add lib/rules/geometry.ts tests/rules/geometry.test.ts && git commit -m "feat(geometry): add size-based collision detection — sizeToSquares, getCombatantOccupiedSquares, isOccupied"
```

---

## Self-Review

**Spec coverage:**
- [x] §3 Types: `GridPoint`, `SizeCategory`, `GridCombatant` — Task 1
- [x] §4.1 `chebyshevSquares` + `gridDistanceFt` — Task 1
- [x] §4.2 `isInSphere` (Euclidean, inclusive boundary) — Task 2
- [x] §4.3 `isInCone` (RAW strict arctan(0.5), Chebyshev length gate, origin excluded) — Task 3
- [x] §4.4 `sizeToSquares`, `getCombatantOccupiedSquares`, `isOccupied` — Task 4
- [x] `CONE_HALF_ANGLE_RAD` exported constant — Task 1 (constant defined), used in Task 3 tests
- [x] §5 All test suites covered across Tasks 1–4

**Placeholder scan:** No TBDs, no "similar to Task N" references, all code blocks complete.

**Type consistency:** `GridPoint` defined in Task 1, used in Tasks 2–4. `SizeCategory` and `GridCombatant` defined in Task 1, used in Task 4. `CONE_HALF_ANGLE_RAD` defined in Task 1, imported in Task 3 tests.
