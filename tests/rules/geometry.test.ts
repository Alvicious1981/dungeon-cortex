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
