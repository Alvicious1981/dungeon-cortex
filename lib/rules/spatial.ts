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

/**
 * A Zone that also carries grid coordinates (x, y) in square units.
 * Corresponds to the `Zone` Prisma model (`x` / `y` columns).
 *
 * Grid squares are 5 ft each (5e standard). Extends Zone so all graph-based
 * functions (`canMove`) still work with GridZone values.
 */
export interface GridZone extends Omit<Zone, "connectedZoneIds" | "type"> {
  connectedZoneIds: string[];
  type: "Engaged" | "Near" | "Far";
  /** Grid column (0-based, left → right). */
  x: number;
  /** Grid row (0-based, top → bottom). */
  y: number;
}

/** Minimal combatant shape required by the zone-placement functions. */
export interface CombatantPosition {
  zoneId: string | null;
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

/**
 * Returns the distance in feet between two grid zones using Chebyshev distance
 * (diagonals cost 1 square, i.e. 5 ft — the standard D&D 5e optional "Variant:
 * Playing on a Grid" rule).
 *
 * Formula: max(|Δx|, |Δy|) × 5
 *
 * @pure — deterministic, no side effects.
 */
export function calculateDistance(zoneA: GridZone, zoneB: GridZone): number {
  const dx = Math.abs(zoneA.x - zoneB.x);
  const dy = Math.abs(zoneA.y - zoneB.y);
  return Math.max(dx, dy) * 5;
}

/**
 * Returns true if the distance between `combatantZone` and `targetZone` is
 * at or within `rangeInFeet`.
 *
 * @pure — deterministic, no side effects.
 */
export function isWithinRange(
  combatantZone: GridZone,
  targetZone: GridZone,
  rangeInFeet: number
): boolean {
  return calculateDistance(combatantZone, targetZone) <= rangeInFeet;
}

/**
 * Returns a new combatant-like object with `zoneId` updated to `targetZoneId`.
 *
 * This is a pure placement function — it does NOT validate movement legality
 * (use `canMove` for that). Call this after rules validation has confirmed the
 * move is legal and before persisting via `prisma.combatant.update`.
 *
 * The original object is never mutated.
 *
 * @pure — deterministic, no side effects.
 */
export function moveCombatant<T extends CombatantPosition>(
  combatant: T,
  targetZoneId: string
): T {
  return { ...combatant, zoneId: targetZoneId };
}
