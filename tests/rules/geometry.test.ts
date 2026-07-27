import { describe, it, expect } from "vitest"
import {
  calculateDistance,
  calculateFootprintDistance,
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
  findAvailablePosition,
  getAoETargets,
  isPlacementWithinMap,
  normalizeSizeCategory,
  validateMovement,
  type TacticalMap,
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

describe("calculateFootprintDistance", () => {
  it("uses the nearest occupied squares instead of persistence anchors", () => {
    expect(calculateFootprintDistance(
      { id: "large-attacker", x: 0, y: 0, size: "Large" },
      { id: "target", x: 3, y: 0, size: "Medium" },
      "SQUARE",
      5
    )).toBe(10)
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

// ---------------------------------------------------------------------------
// isInSphere
// ---------------------------------------------------------------------------

describe("isInSphere", () => {
  // center (0,0), radius 10 ft

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
    expect(isInSphere({ x: 6, y: 5 }, { x: 5, y: 5 }, 5)).toBe(true)  // 5 ft exactly
    expect(isInSphere({ x: 7, y: 5 }, { x: 5, y: 5 }, 5)).toBe(false) // 10 ft
  })
})

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
    // (2,1): angle = atan2(1,2) = atan(0.5) = CONE_HALF_ANGLE_RAD
    // cheb = max(2,1) = 2 → 10 ft ≤ 20 ft
    expect(isInCone({ x: 2, y: 1 }, origin, east, 20)).toBe(true)
  })

  it("includes a point with a smaller angle than 26.57°", () => {
    // (3,1): angle = atan2(1,3) ≈ 18.43° < 26.57°; cheb=3 → 15 ft ≤ 20 ft
    expect(isInCone({ x: 3, y: 1 }, origin, east, 20)).toBe(true)
  })

  it("excludes a point whose angle exceeds 26.57° (45° diagonal)", () => {
    // (1,1): angle = 45° > 26.57°; cheb=1 → 5 ft ≤ 20 ft — angle gate fails
    expect(isInCone({ x: 1, y: 1 }, origin, east, 20)).toBe(false)
  })

  it("excludes a point beyond the Chebyshev length gate", () => {
    // (5,0): cheb=5 → 25 ft > 20 ft — length gate fails
    expect(isInCone({ x: 5, y: 0 }, origin, east, 20)).toBe(false)
  })

  it("excludes a point directly behind the origin (opposite direction)", () => {
    // (-1,0): angle = 180° > 26.57°
    expect(isInCone({ x: -1, y: 0 }, origin, east, 20)).toBe(false)
  })

  it("includes a point at exactly max Chebyshev range (boundary inclusive)", () => {
    // (4,0): cheb=4 → 20 ft = lengthFt; angle=0 → true
    expect(isInCone({ x: 4, y: 0 }, origin, east, 20)).toBe(true)
  })

  it("works with a non-axis direction (diagonal NE = {1,-1})", () => {
    // direction NE, point along that axis should be inside
    // origin (0,0), dir (1,-1), point (2,-2): cheb=2, angle=0 → inside
    expect(isInCone({ x: 2, y: -2 }, origin, { x: 1, y: -1 }, 20)).toBe(true)
    // (1,0) from origin with NE direction: angle from (1,-1) to (1,0) = 45° > 26.57° → outside
    expect(isInCone({ x: 1, y: 0 }, origin, { x: 1, y: -1 }, 20)).toBe(false)
  })

  it("works with an integer direction vector that is not unit length (normalised internally)", () => {
    // direction (3,0) must behave identically to (1,0) after normalisation
    expect(isInCone({ x: 2, y: 0 }, origin, { x: 3, y: 0 }, 20)).toBe(true)
    expect(isInCone({ x: 1, y: 1 }, origin, { x: 3, y: 0 }, 20)).toBe(false)
  })

  it("returns false for a zero-length direction vector (degenerate input)", () => {
    expect(isInCone({ x: 1, y: 0 }, origin, { x: 0, y: 0 }, 20)).toBe(false)
  })

  it("CONE_HALF_ANGLE_RAD constant equals atan(0.5)", () => {
    expect(CONE_HALF_ANGLE_RAD).toBeCloseTo(0.4636476090008257, 10)
  })
})

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

  it.each(cases)("%s → %i squares (side length)", (size, expected) => {
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

  it("Small combatant at (3,4) occupies exactly 1 square at its anchor", () => {
    const c: GridCombatant = { id: "c2", x: 3, y: 4, size: "Small" }
    expect(getCombatantOccupiedSquares(c)).toEqual([{ x: 3, y: 4 }])
  })

  it("Large combatant at (2,3) occupies 4 squares (2×2)", () => {
    const c: GridCombatant = { id: "c3", x: 2, y: 3, size: "Large" }
    const squares = getCombatantOccupiedSquares(c)
    expect(squares).toHaveLength(4)
    expect(squares).toContainEqual({ x: 2, y: 3 }) // top-left
    expect(squares).toContainEqual({ x: 3, y: 3 }) // top-right
    expect(squares).toContainEqual({ x: 2, y: 4 }) // bottom-left
    expect(squares).toContainEqual({ x: 3, y: 4 }) // bottom-right
  })

  it("Huge combatant at (0,0) occupies 9 squares (3×3)", () => {
    const c: GridCombatant = { id: "c4", x: 0, y: 0, size: "Huge" }
    const squares = getCombatantOccupiedSquares(c)
    expect(squares).toHaveLength(9)
    expect(squares).toContainEqual({ x: 0, y: 0 }) // top-left corner
    expect(squares).toContainEqual({ x: 2, y: 0 }) // top-right corner
    expect(squares).toContainEqual({ x: 0, y: 2 }) // bottom-left corner
    expect(squares).toContainEqual({ x: 2, y: 2 }) // bottom-right corner
    expect(squares).toContainEqual({ x: 1, y: 1 }) // center
  })

  it("Gargantuan combatant at (1,1) occupies 16 squares (4×4)", () => {
    const c: GridCombatant = { id: "c5", x: 1, y: 1, size: "Gargantuan" }
    const squares = getCombatantOccupiedSquares(c)
    expect(squares).toHaveLength(16)
    expect(squares).toContainEqual({ x: 1, y: 1 }) // top-left anchor
    expect(squares).toContainEqual({ x: 4, y: 4 }) // bottom-right corner
    expect(squares).toContainEqual({ x: 4, y: 1 }) // top-right corner
    expect(squares).toContainEqual({ x: 1, y: 4 }) // bottom-left corner
  })

  it("does not mutate the combatant object", () => {
    const c: GridCombatant = { id: "c6", x: 0, y: 0, size: "Large" }
    getCombatantOccupiedSquares(c)
    expect(c.x).toBe(0)
    expect(c.y).toBe(0)
    expect(c.size).toBe("Large")
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

  it("returns false for a square adjacent to a Medium combatant", () => {
    const c: GridCombatant = { id: "m2", x: 1, y: 1, size: "Medium" }
    expect(isOccupied({ x: 2, y: 1 }, [c])).toBe(false)
    expect(isOccupied({ x: 1, y: 2 }, [c])).toBe(false)
  })

  it("returns true for every square within a Large combatant's 2×2 footprint", () => {
    const c: GridCombatant = { id: "l1", x: 2, y: 3, size: "Large" }
    expect(isOccupied({ x: 2, y: 3 }, [c])).toBe(true) // top-left
    expect(isOccupied({ x: 3, y: 3 }, [c])).toBe(true) // top-right
    expect(isOccupied({ x: 2, y: 4 }, [c])).toBe(true) // bottom-left
    expect(isOccupied({ x: 3, y: 4 }, [c])).toBe(true) // bottom-right
  })

  it("returns false for a square just outside a Large combatant's footprint", () => {
    const c: GridCombatant = { id: "l2", x: 2, y: 3, size: "Large" }
    expect(isOccupied({ x: 4, y: 3 }, [c])).toBe(false) // one to the right
    expect(isOccupied({ x: 2, y: 5 }, [c])).toBe(false) // one below
    expect(isOccupied({ x: 1, y: 3 }, [c])).toBe(false) // one to the left
  })

  it("returns true when one of multiple combatants occupies the point", () => {
    const a: GridCombatant = { id: "a", x: 0, y: 0, size: "Medium" }
    const b: GridCombatant = { id: "b", x: 5, y: 5, size: "Medium" }
    expect(isOccupied({ x: 5, y: 5 }, [a, b])).toBe(true)
    expect(isOccupied({ x: 0, y: 0 }, [a, b])).toBe(true)
    expect(isOccupied({ x: 3, y: 3 }, [a, b])).toBe(false)
  })

  it("correctly resolves occupation for a Huge combatant (3×3)", () => {
    const c: GridCombatant = { id: "h1", x: 0, y: 0, size: "Huge" }
    // All 9 squares occupied
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        expect(isOccupied({ x: col, y: row }, [c])).toBe(true)
      }
    }
    // Square just outside the footprint
    expect(isOccupied({ x: 3, y: 0 }, [c])).toBe(false)
    expect(isOccupied({ x: 0, y: 3 }, [c])).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Milestone V complete geometry contract
// ---------------------------------------------------------------------------

describe("calculateDistance", () => {
  it("uses Chebyshev distance and the supplied cell size for square grids", () => {
    expect(calculateDistance({ x: 0, y: 0 }, { x: 3, y: 2 }, "SQUARE", 10)).toBe(30)
  })

  it("uses axial/cube distance for hex grids", () => {
    expect(calculateDistance({ x: 0, y: 0 }, { x: 2, y: -1 }, "HEX", 5)).toBe(10)
    expect(calculateDistance({ x: 1, y: -2 }, { x: -1, y: 1 }, "HEX", 5)).toBe(15)
  })

  it("rejects non-finite coordinates and invalid cell sizes", () => {
    expect(() => calculateDistance({ x: Number.NaN, y: 0 }, { x: 0, y: 0 }, "SQUARE")).toThrow(/finite/)
    expect(() => calculateDistance({ x: 0, y: 0 }, { x: 0, y: 0 }, "SQUARE", 0)).toThrow(/positive/)
  })
})

describe("normalizeSizeCategory", () => {
  it("preserves canonical sizes and defaults unknown data to Medium", () => {
    expect(normalizeSizeCategory("Huge")).toBe("Huge")
    expect(normalizeSizeCategory("Colossal")).toBe("Medium")
  })
})

describe("getAoETargets", () => {
  const combatants: GridCombatant[] = [
    { id: "source", x: 0, y: 0, size: "Medium" },
    { id: "axis", x: 3, y: 0, size: "Medium" },
    { id: "boundary", x: 2, y: 1, size: "Medium" },
    { id: "outside", x: 1, y: 1, size: "Medium" },
  ]

  it("selects square-grid sphere targets by radius", () => {
    const result = getAoETargets({
      origin: { x: 2, y: 0 },
      shape: "SPHERE",
      sizeFt: 5,
      gridType: "SQUARE",
      cellSize: 5,
    }, combatants)
    expect(result.map((target) => target.id)).toEqual(["axis", "boundary"])
  })

  it("uses hex distance for a hex-grid sphere", () => {
    const result = getAoETargets({
      origin: { x: 0, y: 0 },
      shape: "SPHERE",
      sizeFt: 5,
      gridType: "HEX",
      cellSize: 5,
    }, [
      { id: "adjacent", x: 1, y: -1, size: "Medium" },
      { id: "far", x: 2, y: -1, size: "Medium" },
    ])
    expect(result.map((target) => target.id)).toEqual(["adjacent"])
  })

  it("selects a cone from its source and direction", () => {
    const result = getAoETargets({
      origin: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
      shape: "CONE",
      sizeFt: 15,
      gridType: "SQUARE",
      cellSize: 5,
    }, combatants)
    expect(result.map((target) => target.id)).toEqual(["axis", "boundary"])
  })


  it("uses grid distance for a diagonal cone's inclusive length", () => {
    const result = getAoETargets({
      origin: { x: 0, y: 0 },
      direction: { x: 1, y: 1 },
      shape: "CONE",
      sizeFt: 20,
      gridType: "SQUARE",
      cellSize: 5,
    }, [
      { id: "boundary", x: 4, y: 4, size: "Medium" },
    ])
    expect(result.map((target) => target.id)).toEqual(["boundary"])
  })
  it("projects cone direction correctly on a hex grid", () => {
    const result = getAoETargets({
      origin: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
      shape: "CONE",
      sizeFt: 10,
      gridType: "HEX",
      cellSize: 5,
    }, [
      { id: "axis", x: 2, y: 0, size: "Medium" },
      { id: "off-axis", x: 0, y: 1, size: "Medium" },
    ])
    expect(result.map((target) => target.id)).toEqual(["axis"])
  })

  it("selects a cube from its north-west anchor and intersects footprints", () => {
    const result = getAoETargets({
      origin: { x: 1, y: 1 },
      shape: "CUBE",
      sizeFt: 10,
      gridType: "SQUARE",
      cellSize: 5,
    }, [
      { id: "large-intersection", x: 0, y: 0, size: "Large" },
      { id: "inside", x: 2, y: 2, size: "Medium" },
      { id: "outside", x: 3, y: 3, size: "Medium" },
    ])
    expect(result.map((target) => target.id)).toEqual(["large-intersection", "inside"])
  })

  it("selects a one-cell-wide line and excludes its source", () => {
    const result = getAoETargets({
      origin: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
      shape: "LINE",
      sizeFt: 20,
      gridType: "SQUARE",
      cellSize: 5,
    }, combatants)

    expect(result.map((target) => target.id)).toEqual(["axis"])
  })

  it("rejects directional targets behind the source or beyond grid range", () => {
    const rejected = getAoETargets({
      origin: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
      shape: "LINE",
      sizeFt: 10,
      gridType: "SQUARE",
      cellSize: 5,
    }, [
      { id: "behind", x: -1, y: 0, size: "Medium" },
      { id: "beyond", x: 3, y: 0, size: "Medium" },
    ])

    expect(rejected).toEqual([])
  })

  it("rejects invalid area contracts", () => {
    expect(() => getAoETargets({
      origin: { x: 0, y: 0 }, shape: "CONE", sizeFt: 10, gridType: "SQUARE", cellSize: 5,
    }, [])).toThrow(/direction/)
    expect(() => getAoETargets({
      origin: { x: 0, y: 0 }, shape: "SPHERE", sizeFt: -1, gridType: "SQUARE", cellSize: 5,
    }, [])).toThrow(/non-negative/)
    expect(() => getAoETargets({
      origin: { x: 0, y: 0 }, direction: { x: 0, y: Number.NaN }, shape: "LINE", sizeFt: 10, gridType: "SQUARE", cellSize: 5,
    }, [])).toThrow(/finite/)
  })

  it("returns no directional targets for a zero vector", () => {
    expect(getAoETargets({
      origin: { x: 0, y: 0 }, direction: { x: 0, y: 0 }, shape: "LINE", sizeFt: 10, gridType: "SQUARE", cellSize: 5,
    }, combatants)).toEqual([])
  })
})

describe("validateMovement", () => {
  const map: TacticalMap = { gridType: "SQUARE", width: 5, height: 5, cellSize: 5 }
  const mover: GridCombatant = { id: "mover", x: 0, y: 0, size: "Medium" }
  const blocker: GridCombatant = { id: "blocker", x: 2, y: 0, size: "Medium" }

  it("accepts an in-bounds, unoccupied move within speed", () => {
    expect(validateMovement({ combatant: mover, target: { x: 1, y: 1 }, map, combatants: [mover, blocker], speedFt: 30 }))
      .toEqual({ valid: true, distanceFt: 5 })
  })

  it.each([
    [{ x: 1.5, y: 1 }, map, 30, "INVALID_COORDINATES"],
    [{ x: 1, y: 1 }, { ...map, width: 0 }, 30, "INVALID_MAP"],
    [{ x: 1, y: 1 }, map, Number.NaN, "INVALID_SPEED"],
    [{ x: 0, y: 0 }, map, 30, "NO_MOVEMENT"],
    [{ x: -1, y: 0 }, map, 30, "OUT_OF_BOUNDS"],
    [{ x: 4, y: 4 }, map, 15, "SPEED_EXCEEDED"],
    [{ x: 2, y: 0 }, map, 30, "OCCUPIED"],
  ] as const)("rejects %o with %s", (target, testMap, speedFt, code) => {
    const result = validateMovement({ combatant: mover, target, map: testMap, combatants: [mover, blocker], speedFt })
    expect(result).toMatchObject({ valid: false, code })
  })

  it("checks the complete footprint against map bounds", () => {
    const large: GridCombatant = { id: "large", x: 0, y: 0, size: "Large" }
    expect(validateMovement({ combatant: large, target: { x: 4, y: 4 }, map, combatants: [large], speedFt: 30 }))
      .toMatchObject({ valid: false, code: "OUT_OF_BOUNDS" })
  })

  it("supports hex movement cost", () => {
    const hexMap: TacticalMap = { ...map, gridType: "HEX" }
    expect(validateMovement({ combatant: mover, target: { x: 2, y: 1 }, map: hexMap, combatants: [mover], speedFt: 15 }))
      .toEqual({ valid: true, distanceFt: 15 })
  })
})

describe("map placement", () => {
  const map: TacticalMap = { gridType: "SQUARE", width: 2, height: 2, cellSize: 5 }

  it("validates footprint boundaries", () => {
    expect(isPlacementWithinMap({ x: 0, y: 0 }, "Large", map)).toBe(true)
    expect(isPlacementWithinMap({ x: 1, y: 1 }, "Large", map)).toBe(false)
    expect(isPlacementWithinMap({ x: 0.5, y: 0 }, "Medium", map)).toBe(false)
  })

  it("finds the first row-major empty position or null when full", () => {
    const occupied: GridCombatant[] = [{ id: "first", x: 0, y: 0, size: "Medium" }]
    expect(findAvailablePosition(map, "Medium", occupied)).toEqual({ x: 1, y: 0 })
    expect(findAvailablePosition(map, "Large", occupied)).toBeNull()
  })
})
