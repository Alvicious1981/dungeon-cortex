import { HEX_DIRECTIONS } from "./wilderness";

export interface Point {
  x: number;
  y: number;
}

export interface CubeCoordinates {
  q: number;
  r: number;
  s: number;
}

/**
 * Converts cube coordinates (q, r) to pixel coordinates (x, y) for a Pointy-Top hex grid.
 * @param q Axial/Cube Q coordinate.
 * @param r Axial/Cube R coordinate.
 * @param size Circumradius of the hex (center to vertex distance).
 */
export function cubeToPixel(q: number, r: number, size: number): Point {
  const x = size * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r);
  const y = size * (3 / 2) * r;
  return { x, y };
}

/**
 * Converts pixel coordinates (x, y) to rounded cube coordinates (q, r, s).
 * @param x Pixel X.
 * @param y Pixel Y.
 * @param size Circumradius of the hex.
 */
export function pixelToCube(x: number, y: number, size: number): CubeCoordinates {
  const q = ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / size;
  const r = ((2 / 3) * y) / size;
  return hexRound(q, r, -q - r);
}

/**
 * Rounds fractional cube coordinates to the nearest integer cube coordinates
 * while maintaining the q + r + s = 0 constraint.
 */
export function hexRound(q: number, r: number, s: number): CubeCoordinates {
  let rq = Math.round(q) || 0;
  let rr = Math.round(r) || 0;
  let rs = Math.round(s) || 0;

  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);

  if (dq > dr && dq > ds) {
    rq = (-rr - rs) || 0;
  } else if (dr > ds) {
    rr = (-rq - rs) || 0;
  } else {
    rs = (-rq - rr) || 0;
  }

  return { q: rq, r: rr, s: rs };
}

/**
 * Returns the 6 adjacent cube coordinates for a given hex.
 */
export function getNeighbors(q: number, r: number): { q: number; r: number }[] {
  return HEX_DIRECTIONS.map((d) => ({
    q: q + d.dq,
    r: r + d.dr,
  }));
}
