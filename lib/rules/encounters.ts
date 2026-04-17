/**
 * lib/rules/encounters.ts
 *
 * Encounter building rules — 5e 2014 SRD CR/XP budget math.
 * All functions are pure; no database access or side effects.
 *
 * Source: Dungeon Master's Guide (2014), "Creating Encounters", pp. 82–84
 */

import type { Monster } from "@/lib/rules/srd";
import { z } from "zod";

// ---------------------------------------------------------------------------
// XP values by Challenge Rating — DMG 2014, p. 275
// ---------------------------------------------------------------------------

const CR_XP_TABLE: ReadonlyMap<number, number> = new Map([
  [0,       10],
  [0.125,   25],
  [0.25,    50],
  [0.5,    100],
  [1,      200],
  [2,      450],
  [3,      700],
  [4,    1_100],
  [5,    1_800],
  [6,    2_300],
  [7,    2_900],
  [8,    3_900],
  [9,    5_000],
  [10,   5_900],
  [11,   7_200],
  [12,   8_400],
  [13,  10_000],
  [14,  11_500],
  [15,  13_000],
  [16,  15_000],
  [17,  18_000],
  [18,  20_000],
  [19,  22_000],
  [20,  25_000],
  [21,  33_000],
  [22,  41_000],
  [23,  50_000],
  [24,  62_000],
  [25,  75_000],
  [26,  90_000],
  [27, 105_000],
  [28, 120_000],
  [29, 135_000],
  [30, 155_000],
]);

/**
 * Returns the XP award for a given Challenge Rating.
 * For non-standard CR values, falls back to the nearest key in the table.
 *
 * @throws {RangeError} if cr is negative.
 */
export function xpForCR(cr: number): number {
  if (cr < 0) throw new RangeError(`CR cannot be negative; got ${cr}.`);

  const exact = CR_XP_TABLE.get(cr);
  if (exact !== undefined) return exact;

  // Nearest-key fallback for non-standard CRs
  let best = 10;
  let bestDiff = Infinity;
  for (const [key, val] of CR_XP_TABLE) {
    const diff = Math.abs(key - cr);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = val;
    }
  }
  return best;
}

/**
 * Returns the encounter XP multiplier for a given number of monsters.
 *
 * The multiplier accounts for the action-economy advantage that a group of
 * enemies has against a single party. Source: DMG p. 82, "Encounter Multipliers".
 */
export function encounterMultiplier(monsterCount: number): number {
  if (monsterCount <= 1)  return 1.0;
  if (monsterCount === 2) return 1.5;
  if (monsterCount <= 6)  return 2.0;
  if (monsterCount <= 10) return 2.5;
  if (monsterCount <= 14) return 3.0;
  return 4.0;
}

/** Maximum number of monsters per generated encounter. */
export const MAX_ENCOUNTER_SIZE = 6;

// ---------------------------------------------------------------------------
// Tool Input Schemas (Single Source of Truth)
// ---------------------------------------------------------------------------

export const SpawnEncounterInputSchema = z.object({
  targetCR: z
    .number()
    .min(0)
    .max(30)
    .describe(
      "Target Challenge Rating for the encounter (0–30). " +
      "Match roughly to party level and danger intent."
    ),
  theme: z
    .string()
    .optional()
    .describe(
      "Optional creature type filter, e.g. 'undead', 'beast', 'humanoid', 'dragon'."
    ),
}).strict();

export type SpawnEncounterInput = z.infer<typeof SpawnEncounterInputSchema>;

/**
 * Builds an encounter using a greedy CR/XP budget algorithm.
 *
 * Algorithm:
 *   1. Filter the pool by optional `themeType` (case-insensitive exact type match).
 *   2. Compute `targetXP` from the CR/XP table.
 *   3. Iteratively select the highest-CR monster whose raw XP fits within the
 *      remaining budget (adjusted for the multiplier at the projected count).
 *      Stop when:
 *        - The budget is exhausted (no candidate fits).
 *        - The adjusted XP reaches ≥80% of target — encounter is filled.
 *        - `MAX_ENCOUNTER_SIZE` is hit.
 *   4. Fallback: if no monster fit, return the cheapest monster in the pool.
 *
 * Invariant: `sum(monsterXPs) × multiplier(count) ≤ targetXP` for any result.
 *
 * @param targetCR - Desired encounter difficulty expressed as a Challenge Rating.
 * @param availableMonsters - Pool of valid monsters to select from.
 * @param themeType - Optional creature type filter (case-insensitive, e.g. "undead").
 * @returns A flat Monster[] — may contain the same entry multiple times for groups.
 *
 * @throws {RangeError} if targetCR is negative.
 * @pure — deterministic, no side effects.
 */
export function buildEncounter(
  targetCR: number,
  availableMonsters: Monster[],
  themeType?: string
): Monster[] {
  if (targetCR < 0) {
    throw new RangeError(`targetCR cannot be negative; got ${targetCR}.`);
  }

  const pool = themeType
    ? availableMonsters.filter(
        (m) => m.type?.toLowerCase() === themeType.toLowerCase()
      )
    : availableMonsters;

  if (pool.length === 0) return [];

  const targetXP = xpForCR(targetCR);
  if (targetXP <= 0) return [];

  const selected: Monster[] = [];

  for (let i = 0; i < MAX_ENCOUNTER_SIZE; i++) {
    const nextCount = selected.length + 1;
    const mult = encounterMultiplier(nextCount);
    const currentRawXP = selected.reduce(
      (sum, m) => sum + xpForCR(m.challenge_rating ?? 0),
      0
    );

    // How much raw XP can we still add before adjusted total exceeds targetXP?
    const rawBudgetForNext = targetXP / mult - currentRawXP;
    if (rawBudgetForNext <= 0) break;

    // Pick the highest-CR monster whose XP fits within the remaining budget
    const candidate = pool
      .filter((m) => xpForCR(m.challenge_rating ?? 0) <= rawBudgetForNext)
      .sort((a, b) => (b.challenge_rating ?? 0) - (a.challenge_rating ?? 0))[0];

    if (!candidate) break;

    selected.push(candidate);

    // Early exit: adjusted XP has reached ≥80% of target — encounter is filled
    const newRawXP = selected.reduce(
      (sum, m) => sum + xpForCR(m.challenge_rating ?? 0),
      0
    );
    if (newRawXP * encounterMultiplier(selected.length) >= targetXP * 0.8) break;
  }

  // Fallback: if nothing fit the budget, return the single cheapest monster
  if (selected.length === 0) {
    const cheapest = pool
      .slice()
      .sort((a, b) => (a.challenge_rating ?? 0) - (b.challenge_rating ?? 0))[0];
    return cheapest ? [cheapest] : [];
  }

  return selected;
}
