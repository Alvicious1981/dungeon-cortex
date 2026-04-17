import { describe, it, expect } from "vitest";
import { cubeToPixel, pixelToCube, hexRound, getNeighbors } from "../../lib/rules/hex-grid";

describe("Hex Grid Math (Pointy-Top)", () => {
  const SIZE = 50;

  describe("cubeToPixel", () => {
    it("converts origin (0,0) to (0,0)", () => {
      const { x, y } = cubeToPixel(0, 0, SIZE);
      expect(x).toBeCloseTo(0);
      expect(y).toBeCloseTo(0);
    });

    it("converts (1,0) to correct EAST pixel position", () => {
      // x = 50 * (sqrt(3)*1 + sqrt(3)/2*0) = 50 * sqrt(3) ≈ 86.6
      // y = 50 * (3/2 * 0) = 0
      const { x, y } = cubeToPixel(1, 0, SIZE);
      expect(x).toBeCloseTo(50 * Math.sqrt(3));
      expect(y).toBeCloseTo(0);
    });

    it("converts (0,1) to correct SOUTHEAST pixel position", () => {
      // x = 50 * (sqrt(3)*0 + sqrt(3)/2*1) = 25 * sqrt(3) ≈ 43.3
      // y = 50 * (3/2 * 1) = 75
      const { x, y } = cubeToPixel(0, 1, SIZE);
      expect(x).toBeCloseTo(25 * Math.sqrt(3));
      expect(y).toBeCloseTo(75);
    });
  });

  describe("hexRound", () => {
    it("rounds (0, 0, 0) to (0, 0, 0)", () => {
      const result = hexRound(0, 0, 0);
      expect(result).toEqual({ q: 0, r: 0, s: 0 });
    });

    it("rounds fractional coordinates correctly (case 1)", () => {
      // q=0.7, r=0.2, s=-0.9
      const result = hexRound(0.7, 0.2, -0.9);
      expect(result).toEqual({ q: 1, r: 0, s: -1 });
    });

    it("preserves q+r+s=0 constraint even on unstable inputs", () => {
      // q=1.0, r=1.0, s=-2.0 (perfect)
      // q=1.2, r=1.2, s=-2.4 (unstable rounds to 1, 1, -2)
      const result = hexRound(1.2, 1.2, -2.4);
      expect(result.q + result.r + result.s).toBe(0);
    });
  });

  describe("Rounding Stability (Double Conversion)", () => {
    it("returns original coordinates when converting cube -> pixel -> cube", () => {
      const testCases = [
        { q: 0, r: 0 },
        { q: 5, r: -2 },
        { q: -10, r: 4 },
        { q: 1, r: 1 },
        { q: 0, r: -1 },
      ];

      for (const { q, r } of testCases) {
        const pixel = cubeToPixel(q, r, SIZE);
        const cube = pixelToCube(pixel.x, pixel.y, SIZE);
        expect(cube.q).toBe(q);
        expect(cube.r).toBe(r);
      }
    });

    it("handles large coordinates without floating point drift", () => {
      const q = 1000;
      const r = -500;
      const pixel = cubeToPixel(q, r, SIZE);
      const cube = pixelToCube(pixel.x, pixel.y, SIZE);
      expect(cube.q).toBe(q);
      expect(cube.r).toBe(r);
    });
  });

  describe("getNeighbors", () => {
    it("returns 6 neighbors", () => {
      expect(getNeighbors(0, 0)).toHaveLength(6);
    });

    it("returns correct neighbor coordinates for (0,0)", () => {
      const neighbors = getNeighbors(0, 0);
      // Northeast: dq: +1, dr: -1
      expect(neighbors).toContainEqual({ q: 1, r: -1 });
      // East: dq: +1, dr: 0
      expect(neighbors).toContainEqual({ q: 1, r: 0 });
      // Southeast: dq: 0, dr: +1
      expect(neighbors).toContainEqual({ q: 0, r: 1 });
      // Southwest: dq: -1, dr: +1
      expect(neighbors).toContainEqual({ q: -1, r: 1 });
      // West: dq: -1, dr: 0
      expect(neighbors).toContainEqual({ q: -1, r: 0 });
      // Northwest: dq: 0, dr: -1
      expect(neighbors).toContainEqual({ q: 0, r: -1 });
    });
  });
});
