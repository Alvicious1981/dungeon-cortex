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

export const SIZE_CATEGORIES: readonly SizeCategory[] = [
  "Tiny",
  "Small",
  "Medium",
  "Large",
  "Huge",
  "Gargantuan",
]

export type TacticalGridType = "SQUARE" | "HEX"

export interface TacticalMap {
  gridType: TacticalGridType
  width: number
  height: number
  cellSize: number
}

export type AreaShape = "CONE" | "SPHERE" | "CUBE" | "LINE"

export interface AreaEffect {
  /** Center for SPHERE, north-west corner for CUBE, source for CONE/LINE. */
  origin: GridPoint
  /** Required for CONE and LINE. It need not be normalized. */
  direction?: GridPoint
  shape: AreaShape
  /** Radius for SPHERE, length for CONE/LINE, side length for CUBE. */
  sizeFt: number
  gridType: TacticalGridType
  cellSize: number
}

export interface ValidateMovementInput {
  combatant: GridCombatant
  target: GridPoint
  map: TacticalMap
  combatants: readonly GridCombatant[]
  speedFt: number
}

export type MovementFailureCode =
  | "INVALID_COORDINATES"
  | "INVALID_MAP"
  | "INVALID_SPEED"
  | "NO_MOVEMENT"
  | "OUT_OF_BOUNDS"
  | "SPEED_EXCEEDED"
  | "OCCUPIED"

export type MovementValidation =
  | { valid: true; distanceFt: number }
  | {
      valid: false
      code: MovementFailureCode
      message: string
      distanceFt?: number
    }

export function normalizeSizeCategory(size: string): SizeCategory {
  return SIZE_CATEGORIES.includes(size as SizeCategory)
    ? (size as SizeCategory)
    : "Medium"
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

const GEOMETRY_EPSILON = 1e-9

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

function assertFinitePoint(point: GridPoint, label: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError(`${label} coordinates must be finite numbers.`)
  }
}

function assertCellSize(cellSize: number): void {
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new RangeError("cellSize must be a positive finite number.")
  }
}

/**
 * Returns tactical distance in feet.
 *
 * SQUARE uses the D&D 5e 2014 1-1-1 diagonal convention (Chebyshev). HEX uses
 * axial q/r coordinates converted to cube coordinates for exact hex distance.
 */
export function calculateDistance(
  from: GridPoint,
  to: GridPoint,
  gridType: TacticalGridType,
  cellSize = 5
): number {
  assertFinitePoint(from, "from")
  assertFinitePoint(to, "to")
  assertCellSize(cellSize)

  if (gridType === "SQUARE") {
    return chebyshevSquares(from, to) * cellSize
  }

  const dq = from.x - to.x
  const dr = from.y - to.y
  const ds = -(from.x + from.y) - (-(to.x + to.y))
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds)) * cellSize
}

/**
 * Returns the Chebyshev distance between two grid points in feet (1 sq = 5 ft).
 *
 * @pure — deterministic, no side effects.
 */
export function gridDistanceFt(a: GridPoint, b: GridPoint): number {
  return calculateDistance(a, b, "SQUARE", 5)
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
  radiusFt: number,
  cellSize = 5
): boolean {
  const dx = (point.x - center.x) * cellSize
  const dy = (point.y - center.y) * cellSize
  return Math.sqrt(dx * dx + dy * dy) <= radiusFt + GEOMETRY_EPSILON
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
  lengthFt: number,
  cellSize = 5
): boolean {
  // Exclude the origin itself
  if (point.x === origin.x && point.y === origin.y) {
    return false
  }

  // Gate 1: Chebyshev length
  if (chebyshevSquares(origin, point) * cellSize > lengthFt) {
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

// ---------------------------------------------------------------------------
// Area targeting
// ---------------------------------------------------------------------------

function pointToCartesian(point: GridPoint, gridType: TacticalGridType): GridPoint {
  if (gridType === "SQUARE") return point
  return {
    x: point.x + point.y / 2,
    y: point.y * Math.sqrt(3) / 2,
  }
}

function isInDirectionalArea(
  point: GridPoint,
  area: AreaEffect,
  shape: "CONE" | "LINE"
): boolean {
  const direction = area.direction!

  const originCartesian = pointToCartesian(area.origin, area.gridType)
  const targetCartesian = pointToCartesian(point, area.gridType)
  const directionEndpoint = pointToCartesian(
    {
      x: area.origin.x + direction.x,
      y: area.origin.y + direction.y,
    },
    area.gridType
  )
  const dirX = directionEndpoint.x - originCartesian.x
  const dirY = directionEndpoint.y - originCartesian.y
  const dirMagnitude = Math.hypot(dirX, dirY)
  if (dirMagnitude === 0) return false

  const pointX = targetCartesian.x - originCartesian.x
  const pointY = targetCartesian.y - originCartesian.y
  if (Math.abs(pointX) <= GEOMETRY_EPSILON && Math.abs(pointY) <= GEOMETRY_EPSILON) {
    return false
  }

  const unitX = dirX / dirMagnitude
  const unitY = dirY / dirMagnitude
  const projectionCells = pointX * unitX + pointY * unitY
  const distanceFt = calculateDistance(
    area.origin, point, area.gridType, area.cellSize
  )
  if (projectionCells < -GEOMETRY_EPSILON
    || distanceFt > area.sizeFt + GEOMETRY_EPSILON) {
    return false
  }

  const perpendicularCells = Math.abs(pointX * unitY - pointY * unitX)
  if (shape === "LINE") {
    return perpendicularCells <= 0.5 + GEOMETRY_EPSILON
  }

  const pointMagnitude = Math.hypot(pointX, pointY)
  const cosine = Math.min(1, Math.max(-1, projectionCells / pointMagnitude))
  return cosine + GEOMETRY_EPSILON >= Math.cos(CONE_HALF_ANGLE_RAD)
}

function isPointInArea(point: GridPoint, area: AreaEffect): boolean {
  if (area.shape === "SPHERE") {
    if (area.gridType === "HEX") {
      return calculateDistance(
        area.origin,
        point,
        area.gridType,
        area.cellSize
      ) <= area.sizeFt + GEOMETRY_EPSILON
    }
    return isInSphere(point, area.origin, area.sizeFt, area.cellSize)
  }

  if (area.shape === "CUBE") {
    const sideCells = Math.ceil(area.sizeFt / area.cellSize)
    return point.x >= area.origin.x
      && point.x < area.origin.x + sideCells
      && point.y >= area.origin.y
      && point.y < area.origin.y + sideCells
  }

  return isInDirectionalArea(point, area, area.shape)
}

/** Returns combatants whose occupied footprint intersects the supplied area. */
export function getAoETargets(
  area: AreaEffect,
  combatants: readonly GridCombatant[]
): GridCombatant[] {
  assertFinitePoint(area.origin, "area origin")
  assertCellSize(area.cellSize)
  if (!Number.isFinite(area.sizeFt) || area.sizeFt < 0) {
    throw new RangeError("area sizeFt must be a non-negative finite number.")
  }
  if ((area.shape === "CONE" || area.shape === "LINE") && !area.direction) {
    throw new RangeError(`${area.shape} requires a direction.`)
  }
  if (area.direction) assertFinitePoint(area.direction, "area direction")

  return combatants.filter((combatant) =>
    getCombatantOccupiedSquares(combatant).some((point) =>
      isPointInArea(point, area)
    )
  )
}

// ---------------------------------------------------------------------------
// Authoritative movement validation
// ---------------------------------------------------------------------------

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

export function isPlacementWithinMap(
  point: GridPoint,
  size: SizeCategory,
  map: TacticalMap
): boolean {
  if (!Number.isInteger(point.x) || !Number.isInteger(point.y)) return false
  const side = sizeToSquares(size)
  return point.x >= 0
    && point.y >= 0
    && point.x + side <= map.width
    && point.y + side <= map.height
}

export function validateMovement(input: ValidateMovementInput): MovementValidation {
  const { combatant, target, map, combatants, speedFt } = input

  if (!Number.isInteger(target.x) || !Number.isInteger(target.y)) {
    return {
      valid: false,
      code: "INVALID_COORDINATES",
      message: "Move requires integer target coordinates.",
    }
  }

  if (!isPositiveInteger(map.width)
    || !isPositiveInteger(map.height)
    || !Number.isFinite(map.cellSize)
    || map.cellSize <= 0) {
    return {
      valid: false,
      code: "INVALID_MAP",
      message: "Encounter map dimensions and cell size must be positive.",
    }
  }

  if (!Number.isFinite(speedFt) || speedFt < 0) {
    return {
      valid: false,
      code: "INVALID_SPEED",
      message: "Combatant speed must be a non-negative finite number.",
    }
  }

  if (combatant.x === target.x && combatant.y === target.y) {
    return {
      valid: false,
      code: "NO_MOVEMENT",
      message: "Already at that position.",
    }
  }

  if (!isPlacementWithinMap(target, combatant.size, map)) {
    return {
      valid: false,
      code: "OUT_OF_BOUNDS",
      message: "Target footprint is outside the encounter map.",
    }
  }

  const distanceFt = calculateDistance(combatant, target, map.gridType, map.cellSize)
  if (distanceFt > speedFt) {
    return {
      valid: false,
      code: "SPEED_EXCEEDED",
      message: `Movement exceeds speed. Distance: ${distanceFt} ft, speed: ${speedFt} ft.`,
      distanceFt,
    }
  }

  const destination: GridCombatant = { ...combatant, x: target.x, y: target.y }
  const destinationSquares = getCombatantOccupiedSquares(destination)
  const occupied = combatants
    .filter((other) => other.id !== combatant.id)
    .some((other) => {
      const otherSquares = getCombatantOccupiedSquares(other)
      return destinationSquares.some((square) =>
        otherSquares.some((occupiedSquare) =>
          occupiedSquare.x === square.x && occupiedSquare.y === square.y
        )
      )
    })

  if (occupied) {
    return {
      valid: false,
      code: "OCCUPIED",
      message: "Target footprint is occupied.",
      distanceFt,
    }
  }

  return { valid: true, distanceFt }
}

/** Finds the first deterministic row-major placement that fits and is empty. */
export function findAvailablePosition(
  map: TacticalMap,
  size: SizeCategory,
  combatants: readonly GridCombatant[]
): GridPoint | null {
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const candidate: GridCombatant = { id: "candidate", x, y, size }
      if (!isPlacementWithinMap(candidate, size, map)) continue
      const overlaps = getCombatantOccupiedSquares(candidate).some((point) =>
        isOccupied(point, [...combatants])
      )
      if (!overlaps) return { x, y }
    }
  }
  return null
}
