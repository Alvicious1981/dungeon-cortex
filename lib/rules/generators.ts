/**
 * lib/rules/generators.ts
 *
 * Seeded procedural generation — the d100-table paradigm.
 *
 * Architectural contract ("State is Truth"):
 *   The same seed string ALWAYS produces the same output. No randomness is
 *   introduced at call time. Results are fully deterministic and reproducible
 *   from the seed alone, so generated content can be reconstructed from the
 *   database IDs that produced it without storing the output itself.
 *
 * This module is pure: no I/O, no side effects, no external dependencies.
 */

// ---------------------------------------------------------------------------
// PRNG — cyrb53 (string → float in [0, 1))
// ---------------------------------------------------------------------------

/**
 * cyrb53: a fast, high-quality 53-bit string hash by bryc.
 * https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js
 *
 * Returns a non-negative integer in [0, 2^53). We normalise to [0, 1) by
 * dividing by 2^53 so callers can use it like Math.random().
 *
 * The second parameter `seed` is a numeric salt that allows a single string
 * key to produce a family of uncorrelated values (one per distinct salt).
 */
function cyrb53(str: string, salt = 0): number {
  let h1 = 0xdeadbeef ^ salt;
  let h2 = 0x41c6ce57 ^ salt;

  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x85ebca77);
    h2 = Math.imul(h2 ^ ch, 0xc2b2ae3d);
  }

  h1 ^= Math.imul(h1 ^ (h2 >>> 15), 0x735a2d97);
  h2 ^= Math.imul(h2 ^ (h1 >>> 15), 0xcaf649a9);
  h1 ^= h2 >>> 16;
  h2 ^= h1 >>> 16;

  // Combine into a 53-bit value and normalise to [0, 1)
  return (2097152 * (h2 >>> 0) + (h1 >>> 11)) / 9007199254740992;
}

/**
 * Deterministic pseudo-random float in [0, 1) for the given seed string.
 * The `salt` parameter shifts the output so a single seed can drive multiple
 * independent table picks without correlation.
 */
export function seededFloat(seed: string, salt = 0): number {
  return cyrb53(seed, salt);
}

// ---------------------------------------------------------------------------
// d100 tables
// ---------------------------------------------------------------------------

/** Atmospheric adjectives for tavern names. */
export const TAVERN_ADJECTIVES: readonly string[] = [
  "Rusty",
  "Wandering",
  "Broken",
  "Gilded",
  "Forsaken",
  "Howling",
  "Blind",
  "Crimson",
  "Iron",
  "Hollow",
] as const;

/** Evocative nouns for tavern names. */
export const TAVERN_NOUNS: readonly string[] = [
  "Flagon",
  "Specter",
  "Anvil",
  "Lantern",
  "Boar",
  "Gallows",
  "Crow",
  "Cauldron",
  "Dagger",
  "Pilgrim",
] as const;

/** Mundane loot found on defeated enemies or in forgotten corners. */
export const MUNDANE_LOOT: readonly string[] = [
  "a tarnished copper coin stamped with an unknown monarch",
  "a strip of dried meat of indeterminate origin",
  "a folded piece of parchment containing an illegible address",
  "a wooden button carved to resemble a skull",
  "three iron nails bent at odd angles",
  "a stub of tallow candle, half-melted",
  "a cracked leather belt with a broken buckle",
  "a small river stone worn smooth on one side",
  "a rusted fishhook with no line",
  "a handful of coarse grey salt wrapped in cloth",
] as const;

// ---------------------------------------------------------------------------
// Generic picker
// ---------------------------------------------------------------------------

/**
 * Deterministically selects one element from `array` using `seed`.
 *
 * The selection is stable: the same (seed, array) pair always returns the
 * same element regardless of when or where the function is called.
 *
 * @throws {RangeError} if `array` is empty.
 */
export function pickSeeded<T>(seed: string, array: readonly T[]): T {
  if (array.length === 0) {
    throw new RangeError("pickSeeded: array must not be empty.");
  }
  const index = Math.floor(seededFloat(seed) * array.length);
  return array[index] as T;
}

// ---------------------------------------------------------------------------
// Specific generators
// ---------------------------------------------------------------------------

/**
 * Generates a tavern name from a location ID.
 *
 * Uses two independent salts so the adjective and noun picks are
 * uncorrelated — i.e. different salts are used to generate each word,
 * preventing the same relative position from always co-occurring.
 *
 * @example
 * generateTavernName("loc_iron_quarter") // "The Hollow Dagger"
 */
export function generateTavernName(locationId: string): string {
  const adjective = pickSeeded(locationId + ":adj", TAVERN_ADJECTIVES);
  const noun      = pickSeeded(locationId + ":noun", TAVERN_NOUNS);
  return `The ${adjective} ${noun}`;
}

/**
 * Returns a single mundane loot item description seeded by an entity ID
 * (e.g. a defeated combatant's database ID).
 *
 * @example
 * generateMundaneLoot("cmb_abc123") // "a stub of tallow candle, half-melted"
 */
export function generateMundaneLoot(entityId: string): string {
  return pickSeeded(entityId, MUNDANE_LOOT);
}
