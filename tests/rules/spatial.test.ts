import { describe, it, expect } from "vitest";
import {
  canMove,
  calculateDistance,
  isWithinRange,
  moveCombatant,
  Zone,
  GridZone,
  CombatantPosition,
} from "@/lib/rules/spatial";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeGridZone(
  id: string,
  x: number,
  y: number,
  connectedZoneIds: string[] = []
): GridZone {
  return {
    id,
    name: `Zone ${id}`,
    x,
    y,
    type: "Near",
    connectedZoneIds,
  };
}

// A 3×3 grid: ids z00..z22 (row_col)
const z00 = makeGridZone("z00", 0, 0, ["z01", "z10", "z11"]);
const z01 = makeGridZone("z01", 1, 0, ["z00", "z02", "z10", "z11", "z12"]);
const z02 = makeGridZone("z02", 2, 0, ["z01", "z11", "z12"]);
const z10 = makeGridZone("z10", 0, 1, ["z00", "z01", "z11", "z20", "z21"]);
const z11 = makeGridZone("z11", 1, 1, ["z00", "z01", "z02", "z10", "z12", "z20", "z21", "z22"]);
const z12 = makeGridZone("z12", 2, 1, ["z01", "z02", "z11", "z21", "z22"]);
const z20 = makeGridZone("z20", 0, 2, ["z10", "z11", "z21"]);
const z21 = makeGridZone("z21", 1, 2, ["z10", "z11", "z12", "z20", "z22"]);
const z22 = makeGridZone("z22", 2, 2, ["z11", "z12", "z21"]);

// ---------------------------------------------------------------------------
// canMove — adjacency graph tests
// ---------------------------------------------------------------------------

describe("canMove", () => {
  it("returns true when targetZoneId is in connectedZoneIds", () => {
    expect(canMove(z00, "z01")).toBe(true);
    expect(canMove(z00, "z10")).toBe(true);
    expect(canMove(z00, "z11")).toBe(true);
  });

  it("returns false when targetZoneId is not adjacent", () => {
    expect(canMove(z00, "z02")).toBe(false);
    expect(canMove(z00, "z20")).toBe(false);
    expect(canMove(z00, "z22")).toBe(false);
  });

  it("returns true when staying in the current zone (no-op move)", () => {
    expect(canMove(z00, "z00")).toBe(true);
    expect(canMove(z11, "z11")).toBe(true);
  });

  it("returns false for a completely unknown zone ID", () => {
    expect(canMove(z11, "z99")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// calculateDistance — Chebyshev grid distance
// ---------------------------------------------------------------------------

describe("calculateDistance", () => {
  it("returns 0 for the same zone", () => {
    expect(calculateDistance(z00, z00)).toBe(0);
    expect(calculateDistance(z11, z11)).toBe(0);
  });

  it("returns 5 ft for an orthogonal neighbour (1 square)", () => {
    expect(calculateDistance(z00, z01)).toBe(5); // right
    expect(calculateDistance(z00, z10)).toBe(5); // down
    expect(calculateDistance(z22, z21)).toBe(5); // left
    expect(calculateDistance(z22, z12)).toBe(5); // up
  });

  it("returns 5 ft for a diagonal neighbour (Chebyshev: diagonal = 1 square)", () => {
    expect(calculateDistance(z00, z11)).toBe(5);
    expect(calculateDistance(z02, z11)).toBe(5);
    expect(calculateDistance(z20, z11)).toBe(5);
    expect(calculateDistance(z22, z11)).toBe(5);
  });

  it("returns 10 ft for 2 squares orthogonally", () => {
    expect(calculateDistance(z00, z02)).toBe(10); // 2 right
    expect(calculateDistance(z00, z20)).toBe(10); // 2 down
  });

  it("returns 10 ft for 2 squares diagonally (Chebyshev: 2 diagonal = 2 squares)", () => {
    expect(calculateDistance(z00, z22)).toBe(10);
  });

  it("is commutative — distance(A,B) === distance(B,A)", () => {
    expect(calculateDistance(z00, z22)).toBe(calculateDistance(z22, z00));
    expect(calculateDistance(z01, z20)).toBe(calculateDistance(z20, z01));
  });

  it("returns correct distance for L-shaped path (max of Δx, Δy)", () => {
    // z00 (0,0) to z21 (1,2): Δx=1, Δy=2 → max=2 → 10 ft
    expect(calculateDistance(z00, z21)).toBe(10);
    // z02 (2,0) to z20 (0,2): Δx=2, Δy=2 → max=2 → 10 ft
    expect(calculateDistance(z02, z20)).toBe(10);
  });

  it("scales linearly beyond 3×3 grid", () => {
    const a = makeGridZone("a", 0, 0);
    const b = makeGridZone("b", 0, 10); // 10 squares away
    expect(calculateDistance(a, b)).toBe(50); // 10 × 5 ft
  });

  it("handles negative coordinate offsets symmetrically", () => {
    const west  = makeGridZone("w", -3, 0);
    const east  = makeGridZone("e", 3, 0);
    expect(calculateDistance(west, east)).toBe(30); // 6 squares × 5 ft
  });
});

// ---------------------------------------------------------------------------
// isWithinRange
// ---------------------------------------------------------------------------

describe("isWithinRange", () => {
  it("returns true when distance equals rangeInFeet exactly (inclusive boundary)", () => {
    // z00 → z01 = 5 ft; range 5 ft
    expect(isWithinRange(z00, z01, 5)).toBe(true);
  });

  it("returns true when target is within range", () => {
    // z00 → z22 = 10 ft; range 30 ft
    expect(isWithinRange(z00, z22, 30)).toBe(true);
  });

  it("returns false when target is beyond range", () => {
    // z00 → z22 = 10 ft; range 5 ft
    expect(isWithinRange(z00, z22, 5)).toBe(false);
  });

  it("returns true for a combatant attacking themselves (range 0, same zone)", () => {
    expect(isWithinRange(z11, z11, 0)).toBe(true);
  });

  it("melee range (5 ft) reaches adjacent orthogonal zone", () => {
    expect(isWithinRange(z10, z11, 5)).toBe(true);
  });

  it("melee range (5 ft) reaches adjacent diagonal zone (Chebyshev)", () => {
    expect(isWithinRange(z00, z11, 5)).toBe(true);
  });

  it("melee range (5 ft) does NOT reach 2-square-away zone", () => {
    expect(isWithinRange(z00, z02, 5)).toBe(false);
  });

  it("ranged attack (60 ft) reaches across a large grid", () => {
    const archer = makeGridZone("archer", 0, 0);
    const target = makeGridZone("target", 8, 8); // 8 squares diagonal = 40 ft
    expect(isWithinRange(archer, target, 60)).toBe(true);
  });

  it("ranged attack (60 ft) does not reach beyond its range", () => {
    const archer = makeGridZone("archer", 0, 0);
    const target = makeGridZone("target", 13, 0); // 13 squares = 65 ft
    expect(isWithinRange(archer, target, 60)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// moveCombatant
// ---------------------------------------------------------------------------

describe("moveCombatant", () => {
  it("returns a new object with zoneId updated", () => {
    const combatant: CombatantPosition = { zoneId: "z00" };
    const moved = moveCombatant(combatant, "z01");
    expect(moved.zoneId).toBe("z01");
  });

  it("does not mutate the original combatant", () => {
    const combatant: CombatantPosition = { zoneId: "z00" };
    moveCombatant(combatant, "z11");
    expect(combatant.zoneId).toBe("z00");
  });

  it("preserves all other fields on the combatant", () => {
    const combatant = { zoneId: "z00", name: "Gorak", hp: 18, isPlayer: true };
    const moved = moveCombatant(combatant, "z11");
    expect(moved.name).toBe("Gorak");
    expect(moved.hp).toBe(18);
    expect(moved.isPlayer).toBe(true);
  });

  it("can move a combatant with a null zoneId into a zone", () => {
    const combatant: CombatantPosition = { zoneId: null };
    const placed = moveCombatant(combatant, "z11");
    expect(placed.zoneId).toBe("z11");
  });

  it("is idempotent when targeting the current zone", () => {
    const combatant: CombatantPosition = { zoneId: "z11" };
    const result = moveCombatant(combatant, "z11");
    expect(result.zoneId).toBe("z11");
  });
});
