/**
 * lib/rules/spatial.ts
 *
 * Abstract Spatial Graph — Node-based Zone system inspired by Watabou's
 * zone-adjacency model.
 *
 * Design contract ("Code is Law"):
 *   Movement legality is resolved by pure deterministic logic here — not by
 *   the AI narrator. The AI may describe a move; this module decides whether
 *   it is possible.
 *
 * This module is pure: no I/O, no side effects, no external dependencies.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A Zone represents a spatial region on the battlefield or in a location.
 *
 * Zones are connected via adjacency lists rather than metric coordinates.
 * "Engaged" zones are melee range; "Near" zones require movement; "Far" zones
 * are out of reach without dedicated movement actions.
 */
export interface Zone {
  id: string;
  name: string;
  /** IDs of zones directly reachable from this zone in a single move. */
  connectedZoneIds: string[];
  type: "Engaged" | "Near" | "Far";
}

// ---------------------------------------------------------------------------
// Pure spatial logic
// ---------------------------------------------------------------------------

/**
 * Returns `true` if `targetZoneId` is directly reachable from `currentZone`
 * in a single movement action.
 *
 * A zone is reachable if and only if its ID appears in `currentZone.connectedZoneIds`.
 * Moving to the zone you are already in is always legal (no-op move).
 *
 * @example
 * const hallway: Zone = { id: "z_hall", name: "Hallway", type: "Near",
 *   connectedZoneIds: ["z_chamber", "z_stair"] };
 *
 * canMove(hallway, "z_chamber") // true
 * canMove(hallway, "z_vault")   // false
 * canMove(hallway, "z_hall")    // true  (staying put)
 */
export function canMove(currentZone: Zone, targetZoneId: string): boolean {
  if (currentZone.id === targetZoneId) {
    return true; // staying in the current zone is always valid
  }
  return currentZone.connectedZoneIds.includes(targetZoneId);
}
