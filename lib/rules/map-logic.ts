import { getNeighbors } from "./hex-grid";

export type HexVisibilityStatus = "discovered" | "scouted";

export interface VisibilityUpdate {
  q: number;
  r: number;
  status: HexVisibilityStatus;
}

/**
 * Calculates the set of hexes that should be revealed when a party occupies (q, r).
 * Returns the central hex as 'discovered' and all 6 neighbors as 'scouted'.
 *
 * This function is pure and only calculates the target visibility state.
 * The caller (e.g. the executeTravelWatch tool) is responsible for applying
 * these states to the WildernessMap database table using upserts that respect
 * state progression (scouted -> discovered is valid, but discovered -> scouted is ignored).
 *
 * @param q Current party position Q axis (axial/cube).
 * @param r Current party position R axis (axial/cube).
 */
export function calculateVisibilityBatch(q: number, r: number): VisibilityUpdate[] {
  const updates: VisibilityUpdate[] = [];

  // Central hex is always discovered when occupied.
  updates.push({ q, r, status: "discovered" });

  // All immediate neighbors are scouted (fog-of-war reveal radius 1).
  const neighbors = getNeighbors(q, r);
  for (const n of neighbors) {
    updates.push({ q: n.q, r: n.r, status: "scouted" });
  }

  return updates;
}
