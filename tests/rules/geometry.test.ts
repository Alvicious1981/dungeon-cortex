import { describe, it, expect } from "vitest"
import {
  chebyshevSquares,
  gridDistanceFt,
  isInSphere,
  isInCone,
  isInCube,
  isInLine,
  CONE_HALF_ANGLE_RAD,
  sizeToSquares,
  getCombatantOccupiedSquares,
  isOccupied,
  getAoETargets,
  minFootprintDistanceFt,
  GridPoint,
  GridCombatant,
  SizeCategory,
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
// isInCube
// ---------------------------------------------------------------------------

describe("isInCube", () => {
  const origin = { x: 5, y: 5 }

  it("covers a 3x3 window for a 15 ft cube", () => {
    // 15 ft / 5 = 3 squares per side, centred on the origin.
    expect(isInCube({ x: 5, y: 5 }, origin, 15)).toBe(true)
    expect(isInCube({ x: 4, y: 4 }, origin, 15)).toBe(true)
    expect(isInCube({ x: 6, y: 6 }, origin, 15)).toBe(true)
    expect(isInCube({ x: 3, y: 5 }, origin, 15)).toBe(false)
    expect(isInCube({ x: 5, y: 7 }, origin, 15)).toBe(false)
  })

  it("gives the extra square to the positive side when the side is even", () => {
    // A 10 ft cube is 2 squares wide and cannot centre on one square.
    // The house ruling: the extra square goes +x / +y. Documented in the source.
    expect(isInCube({ x: 5, y: 5 }, origin, 10)).toBe(true)
    expect(isInCube({ x: 6, y: 6 }, origin, 10)).toBe(true)
    expect(isInCube({ x: 4, y: 5 }, origin, 10)).toBe(false)
  })

  it("never collapses below a single square", () => {
    expect(isInCube({ x: 5, y: 5 }, origin, 0)).toBe(true)
    expect(isInCube({ x: 6, y: 5 }, origin, 0)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isInLine
// ---------------------------------------------------------------------------

describe("isInLine", () => {
  const origin = { x: 0, y: 0 }
  const east = { x: 1, y: 0 }

  it("covers squares along the ray up to its length", () => {
    expect(isInLine({ x: 1, y: 0 }, origin, east, 20)).toBe(true)
    expect(isInLine({ x: 4, y: 0 }, origin, east, 20)).toBe(true)
    expect(isInLine({ x: 5, y: 0 }, origin, east, 20)).toBe(false)
  })

  it("excludes the origin square", () => {
    expect(isInLine({ x: 0, y: 0 }, origin, east, 20)).toBe(false)
  })

  it("excludes squares off the 5 ft width", () => {
    expect(isInLine({ x: 2, y: 1 }, origin, east, 20)).toBe(false)
  })

  it("excludes squares behind the caster", () => {
    expect(isInLine({ x: -2, y: 0 }, origin, east, 20)).toBe(false)
  })

  it("refuses a zero-length direction instead of matching everything", () => {
    expect(isInLine({ x: 1, y: 0 }, origin, { x: 0, y: 0 }, 20)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getAoETargets
// ---------------------------------------------------------------------------

describe("getAoETargets", () => {
  const at = (id: string, x: number, y: number, size: SizeCategory = "Medium") =>
    ({ id, x, y, size })

  it("returns combatants inside a sphere and omits those outside", () => {
    const combatants = [at("in", 5, 5), at("edge", 7, 5), at("out", 9, 5)]
    const hit = getAoETargets({
      shape: "sphere",
      origin: { x: 5, y: 5 },
      sizeFt: 10,
      combatants,
    })
    expect(hit.map((c) => c.id)).toEqual(["in", "edge"])
  })

  it("catches a Large creature by its footprint, not its anchor square", () => {
    // Anchor (3,3) is 14.14 ft from the centre (5,5) — outside the 10 ft
    // radius. But the footprint corner (4,4) is only 7.07 ft away — inside.
    // Testing only the anchor would miss the edge of every blast.
    const large = at("ogre", 3, 3, "Large") // occupies (3,3),(4,3),(3,4),(4,4)
    const hit = getAoETargets({
      shape: "sphere",
      origin: { x: 5, y: 5 },
      sizeFt: 10,
      combatants: [large],
    })
    expect(hit.map((c) => c.id)).toEqual(["ogre"])
  })

  it("uses the direction for a cone and ignores creatures behind the caster", () => {
    const combatants = [at("ahead", 3, 0), at("behind", -3, 0)]
    const hit = getAoETargets({
      shape: "cone",
      origin: { x: 0, y: 0 },
      sizeFt: 30,
      direction: { x: 1, y: 0 },
      combatants,
    })
    expect(hit.map((c) => c.id)).toEqual(["ahead"])
  })

  it("returns nothing for a directional shape with no direction", () => {
    const hit = getAoETargets({
      shape: "line",
      origin: { x: 0, y: 0 },
      sizeFt: 30,
      combatants: [at("target", 2, 0)],
    })
    expect(hit).toEqual([])
  })

  it("resolves a mile-wide area without walking its squares", () => {
    // The SRD cache holds areas up to 40,000 ft. On a 5 ft grid that is
    // 8,000 x 8,000 = 64 million cells, so an implementation that enumerates
    // the shape hangs here rather than returning. This test does not assert
    // the algorithm directly; it makes the wrong one exhaust the timeout.
    const combatants = [at("near", 1, 1), at("far", 200, 200)]
    const hit = getAoETargets({
      shape: "cube",
      origin: { x: 0, y: 0 },
      sizeFt: 40000,
      combatants,
    })
    expect(hit.map((c) => c.id)).toEqual(["near", "far"])
  })
})

describe("minFootprintDistanceFt", () => {
  const medium = (id: string, x: number, y: number): GridCombatant =>
    ({ id, x, y, size: "Medium" })

  it("measures between the nearest squares, not the anchors", () => {
    // A Large caster anchored at (0,0) occupies (0,0),(1,0),(0,1),(1,1). Its
    // nearest square to a target at (8,0) is (1,0) — 7 squares, 35 ft. Measuring
    // anchor to anchor would report 8 squares, 40 ft, and wrongly refuse a
    // 35 ft spell.
    const largeCaster: GridCombatant = { id: "ogre", x: 0, y: 0, size: "Large" }
    expect(minFootprintDistanceFt(largeCaster, medium("t", 8, 0))).toBe(35)
  })

  it("is zero when the footprints overlap", () => {
    expect(minFootprintDistanceFt(medium("a", 3, 3), medium("b", 3, 3))).toBe(0)
  })

  it("counts a diagonal as 5 ft, per the grid rule", () => {
    expect(minFootprintDistanceFt(medium("a", 0, 0), medium("b", 1, 1))).toBe(5)
  })

  it("accepts a bare point as the destination", () => {
    // The aim point of an area spell is a square, not a creature.
    expect(minFootprintDistanceFt(medium("a", 0, 0), { x: 4, y: 0 })).toBe(20)
  })

  it("shrinks as the source creature grows", () => {
    // A Gargantuan creature reaches further from the same anchor, because more
    // of its body is closer. This is the property that makes anchor-measuring
    // wrong rather than merely imprecise.
    const target = medium("t", 10, 0)
    const asMedium = minFootprintDistanceFt(medium("c", 0, 0), target)
    const asGargantuan = minFootprintDistanceFt(
      { id: "c", x: 0, y: 0, size: "Gargantuan" },
      target
    )
    expect(asGargantuan).toBeLessThan(asMedium)
    expect(asMedium).toBe(50)
    expect(asGargantuan).toBe(35)
  })
})
