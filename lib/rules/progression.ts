/**
 * lib/rules/progression.ts
 *
 * Character progression rules — D&D 5e 2014 SRD experience thresholds.
 * All functions are pure; no database access or side effects.
 *
 * Source: Player's Handbook (2014) Table: "Character Advancement" p. 15
 */

import { z } from "zod";
import type { CharacterClass } from "@/lib/rules/proficiency";
import { roll } from "@/lib/rules/dice";
import { xpForCR } from "@/lib/rules/encounters";

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

// ---------------------------------------------------------------------------
// Milestone L — Slice 1: Data Layer
// ---------------------------------------------------------------------------

/**
 * Hit die size per character class — 5e 2014 SRD.
 * Maps CharacterClass to the die face count used for HP rolls on level-up
 * and short-rest healing.
 */
export const HIT_DIE_MAP: Readonly<Record<CharacterClass, number>> = {
  barbarian: 12,
  bard:       8,
  cleric:     8,
  druid:      8,
  fighter:   10,
  monk:       8,
  paladin:   10,
  ranger:    10,
  rogue:      8,
  sorcerer:   6,
  warlock:    8,
  wizard:     6,
} as const;

/**
 * XP awarded per exploration event type.
 * Tuned for a solo-character campaign where combat XP averages 200–1800
 * per encounter (CR 1–5).
 */
export const EXPLORATION_XP = {
  /** Discovering any new node for the first time. */
  node_discovery:   25,
  /** Revealing a hidden passage (passageType === "hidden"). */
  hidden_passage:   75,
  /** Opening a locked passage (passageType === "locked"). */
  locked_passage:   50,
  /** Surviving a hazard node (feature === "hazard"). */
  hazard_survived: 100,
  /** Reaching an exit node (feature === "exit") — completing the location. */
  exit_reached:    150,
  /** Discovering a treasure node (feature === "treasure"). */
  treasure_found:   50,
  /** Finding a quest hook node (feature === "quest_hook"). */
  quest_hook_found: 50,
} as const;

export type ExplorationXPEvent = keyof typeof EXPLORATION_XP;

// ---------------------------------------------------------------------------
// Zod schemas — Tool I/O contracts
// ---------------------------------------------------------------------------

export const TriggerLevelUpInputSchema = z.object({
  characterId: z
    .string()
    .min(1)
    .describe(
      "The character's ID from the Character State section. " +
      "MUST match the character who just leveled up."
    ),
  useAverage: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "If true, use the average HP roll (ceil(hitDie/2) + 1) instead of rolling. " +
      "Default: false (roll the hit die)."
    ),
});

export type TriggerLevelUpInput = z.infer<typeof TriggerLevelUpInputSchema>;

export const LevelUpPayloadSchema = z.object({
  characterId:     z.string(),
  previousLevel:   z.number().int().min(1).max(19),
  newLevel:        z.number().int().min(2).max(20),
  hitDie:          z.string().describe("e.g. '1d10'"),
  hpRoll:          z.number().int().min(1),
  conModifier:     z.number().int(),
  hpGained:        z.number().int().min(1),
  previousMaxHp:   z.number().int().min(1),
  newMaxHp:        z.number().int().min(2),
  newHitDiceTotal: z.number().int().min(2),
  className:       z.string(),
});

export type LevelUpPayload = z.infer<typeof LevelUpPayloadSchema>;

export const CombatXPInputSchema = z.object({
  enemyCRs: z
    .array(z.number().min(0).max(30))
    .min(1)
    .describe("Array of Challenge Ratings for every defeated enemy in the encounter."),
});

export type CombatXPInput = z.infer<typeof CombatXPInputSchema>;

export const ExplorationXPInputSchema = z.object({
  event: z
    .enum([
      "node_discovery",
      "hidden_passage",
      "locked_passage",
      "hazard_survived",
      "exit_reached",
      "treasure_found",
      "quest_hook_found",
    ])
    .describe("The type of exploration achievement triggered."),
  nodeIndex: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Index of the node/edge involved, for dedup tracking."),
});

export type ExplorationXPInput = z.infer<typeof ExplorationXPInputSchema>;

export const AwardXPInputSchema = z.object({
  characterId: z
    .string()
    .min(1)
    .describe("The character's ID from the Character State section."),
  amount: z
    .number()
    .int()
    .positive()
    .describe("XP to award. Typical ranges: minor (10–50), moderate (100–300), major (300–1000)."),
  reason: z
    .string()
    .min(1)
    .max(200)
    .describe("Brief reason for the award."),
}).strict();

export type AwardXPInput = z.infer<typeof AwardXPInputSchema>;

export const UpdateQuestStatusInputSchema = z.object({
  questId: z
    .string()
    .min(1)
    .describe("The quest ID from the ## Active Quests section."),
  status: z.enum(["completed", "failed"]),
}).strict();

export type UpdateQuestStatusInput = z.infer<typeof UpdateQuestStatusInputSchema>;

// ---------------------------------------------------------------------------
// Milestone L — Slice 2: The Forge Engine (pure functions)
// ---------------------------------------------------------------------------

/**
 * Computes the HP gained when a character levels up.
 *
 * @param className   - The character's class, used to look up the hit die size.
 * @param conModifier - The character's CON modifier (may be negative).
 * @param useAverage  - If true, use the PHB average column instead of rolling.
 * @returns `hpRoll` (the raw die result) and `hpGained` (clamped to minimum 1).
 *
 * @pure — deterministic when `useAverage` is true; uses `roll()` randomness otherwise.
 */
export function rollHitPointGain(
  className: CharacterClass,
  conModifier: number,
  useAverage = false,
): { hpRoll: number; hpGained: number } {
  const hitDie = HIT_DIE_MAP[className];
  const hpRoll = useAverage
    ? Math.ceil(hitDie / 2) + 1   // 5e PHB "average" column
    : roll(`1d${hitDie}`).total;  // random roll
  // A character always gains at least 1 HP per level, even with a negative CON modifier.
  const hpGained = Math.max(1, hpRoll + conModifier);
  return { hpRoll, hpGained };
}

/**
 * Computes the total XP award for a combat encounter from an array of enemy CRs.
 *
 * Per 5e 2014 SRD (DMG p. 260): the encounter multiplier adjusts *difficulty*,
 * not XP payout. Each monster's individual XP is awarded as listed in the CR table.
 *
 * @param enemyCRs - Challenge Ratings of all defeated enemies (≥ 1 element).
 * @pure — deterministic given the same inputs.
 */
export function computeCombatXP(enemyCRs: number[]): number {
  return enemyCRs.reduce((sum, cr) => sum + xpForCR(cr), 0);
}

/**
 * Returns the XP award for a specific exploration event type.
 *
 * @pure — trivial constant lookup, always deterministic.
 */
export function computeExplorationXP(event: ExplorationXPEvent): number {
  return EXPLORATION_XP[event];
}

/**
 * Assembles the complete LevelUpPayload for both the AI tool response and
 * the Ascension Overlay UI. Validates the result against LevelUpPayloadSchema
 * before returning so callers get a type-safe, schema-valid object.
 *
 * @nearly-pure — randomness may enter via `rollHitPointGain()` when `useAverage` is false.
 * @throws {Error} if the assembled payload fails Zod validation (indicates a bug).
 */
export function buildLevelUpPayload(input: {
  characterId: string;
  className: CharacterClass;
  previousLevel: number;
  newLevel: number;
  currentMaxHp: number;
  conModifier: number;
  useAverage?: boolean;
}): LevelUpPayload {
  const hitDie = HIT_DIE_MAP[input.className];
  const { hpRoll, hpGained } = rollHitPointGain(
    input.className,
    input.conModifier,
    input.useAverage,
  );
  const newMaxHp = input.currentMaxHp + hpGained;
  // Per 5e SRD: hit dice count always equals character level.
  const newHitDiceTotal = input.newLevel;

  const payload = {
    characterId:     input.characterId,
    previousLevel:   input.previousLevel,
    newLevel:        input.newLevel,
    hitDie:          `1d${hitDie}`,
    hpRoll,
    conModifier:     input.conModifier,
    hpGained,
    previousMaxHp:   input.currentMaxHp,
    newMaxHp,
    newHitDiceTotal,
    className:       input.className,
  };

  // Validate — this should never fail; a failure indicates a programming error.
  return LevelUpPayloadSchema.parse(payload);
}
