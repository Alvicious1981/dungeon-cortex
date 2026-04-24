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
    return false // defensive guard (origin case already handled above)
  }
  const ptNx = dx / ptMag
  const ptNy = dy / ptMag

  // Dot product of unit vectors = cos(angle between them).
  // Compare directly in cosine space instead of calling acos:
  //   angle ≤ CONE_HALF_ANGLE_RAD  ↔  dot ≥ cos(CONE_HALF_ANGLE_RAD)
  // This avoids acos entirely and eliminates IEEE-754 drift at the exact boundary
  // (acos and atan use different code paths and can differ by one ULP).
  const dot = Math.min(1, Math.max(-1, dirNx * ptNx + dirNy * ptNy))

  return dot >= Math.cos(CONE_HALF_ANGLE_RAD)
}

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
