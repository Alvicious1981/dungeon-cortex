/**
 * lib/rules/progression.ts
 *
 * Character progression rules — D&D 5e 2014 SRD experience thresholds.
 * All functions are pure; no database access or side effects.
 *
 * Source: Player's Handbook (2014) Table: "Character Advancement" p. 15
 */

// ---------------------------------------------------------------------------
// XP thresholds per level (index = level, value = XP required to reach that level)
// ---------------------------------------------------------------------------

/** XP required to *reach* a given level (1-indexed; index 0 is unused). */
const XP_THRESHOLDS: readonly number[] = [
  0,      // [0] unused — levels are 1-based
  0,      // [1]  Level 1 — starts here
  300,    // [2]  Level 2
  900,    // [3]  Level 3
  2_700,  // [4]  Level 4
  6_500,  // [5]  Level 5
  14_000, // [6]  Level 6
  23_000, // [7]  Level 7
  34_000, // [8]  Level 8
  48_000, // [9]  Level 9
  64_000, // [10] Level 10
  85_000, // [11] Level 11
  100_000,// [12] Level 12
  120_000,// [13] Level 13
  140_000,// [14] Level 14
  165_000,// [15] Level 15
  195_000,// [16] Level 16
  225_000,// [17] Level 17
  265_000,// [18] Level 18
  305_000,// [19] Level 19
  355_000,// [20] Level 20
] as const;

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 20;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the character level that corresponds to the given total XP amount,
 * using the 5e 2014 SRD experience thresholds.
 *
 * @throws {RangeError} if `xp` is negative.
 */
export function getLevelFromXP(xp: number): number {
  if (xp < 0) {
    throw new RangeError(`XP cannot be negative; got ${xp}.`);
  }

  // Walk backwards from level 20 — return the first level whose threshold is met.
  for (let level = MAX_LEVEL; level >= MIN_LEVEL; level--) {
    if (xp >= XP_THRESHOLDS[level]) {
      return level;
    }
  }

  // xp >= 0 always satisfies the level-1 threshold (0), so this is unreachable.
  return MIN_LEVEL;
}

/**
 * Returns true when the character has accumulated enough XP to advance beyond
 * their `currentLevel`.
 *
 * @throws {RangeError} if `currentXP` is negative.
 * @throws {RangeError} if `currentLevel` is outside [1, 20].
 */
export function canLevelUp(currentXP: number, currentLevel: number): boolean {
  if (currentXP < 0) {
    throw new RangeError(`XP cannot be negative; got ${currentXP}.`);
  }
  if (currentLevel < MIN_LEVEL || currentLevel > MAX_LEVEL) {
    throw new RangeError(
      `Level must be between ${MIN_LEVEL} and ${MAX_LEVEL}; got ${currentLevel}.`
    );
  }

  // Already at level cap — cannot level up further.
  if (currentLevel === MAX_LEVEL) return false;

  return currentXP >= XP_THRESHOLDS[currentLevel + 1];
}

/**
 * Returns the XP required to reach `level`.
 * Useful for UI progress bars.
 *
 * @throws {RangeError} if `level` is outside [1, 20].
 */
export function xpForLevel(level: number): number {
  if (level < MIN_LEVEL || level > MAX_LEVEL) {
    throw new RangeError(
      `Level must be between ${MIN_LEVEL} and ${MAX_LEVEL}; got ${level}.`
    );
  }
  return XP_THRESHOLDS[level];
}

// ---------------------------------------------------------------------------
// Orchestration helpers (pure — no DB access)
// ---------------------------------------------------------------------------

export interface XPAwardResult {
  /** Total XP after the award. */
  newXP: number;
  /** Character level derived from `newXP` via the SRD threshold table. */
  newLevel: number;
  /** True when `newLevel` exceeds `currentLevel` (level-up occurred). */
  leveledUp: boolean;
}

/**
 * Computes the result of awarding XP to a character.
 *
 * This is the pure calculation used by the `awardXP` AI tool before any
 * database write. Callers are responsible for persisting the returned state.
 *
 * @throws {RangeError} if `amount` is not a positive integer.
 * @pure — deterministic, no side effects.
 */
export function computeXPAward(
  currentXP: number,
  currentLevel: number,
  amount: number
): XPAwardResult {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new RangeError(
      `XP award amount must be a positive integer; got ${amount}.`
    );
  }
  const newXP = currentXP + amount;
  const newLevel = getLevelFromXP(newXP);
  const leveledUp = newLevel > currentLevel;
  return { newXP, newLevel, leveledUp };
}
