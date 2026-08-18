/**
 * lib/rules/ability-check.ts
 *
 * Generic SRD 5e ability check resolution — the universal fallback mechanic.
 *
 * A rules engine cannot enumerate every action a player might attempt. SRD 5e
 * solves that with the ability check: any action without a dedicated rule is
 * adjudicated as d20 + ability modifier (+ proficiency, if applicable) against
 * a Difficulty Class. This module is that fallback, so an unclassifiable action
 * can be resolved by the dice instead of refused.
 *
 * Architecture contract:
 *   - The DC is derived here, from a fixed band table. Callers may propose a
 *     band; they may never supply a raw DC.
 *   - The AI layer may propose ability, skill and band. It never rolls, never
 *     sets a number, and never decides the outcome.
 *   - This module is pure: it rolls and reports, and mutates no state.
 */

import { abilityModifier, d20Check, rollWithAdvantage, rollWithDisadvantage } from "./dice";
import { proficiencyBonus } from "./proficiency";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const ABILITIES = ["STR", "DEX", "CON", "INT", "WIS", "CHA"] as const;
export type Ability = (typeof ABILITIES)[number];

/**
 * The eighteen SRD skills and the ability each one keys off.
 * Canonical SRD 5e data — not a project-specific invention.
 */
export const SKILL_ABILITY = {
  Athletics: "STR",
  Acrobatics: "DEX",
  "Sleight of Hand": "DEX",
  Stealth: "DEX",
  Arcana: "INT",
  History: "INT",
  Investigation: "INT",
  Nature: "INT",
  Religion: "INT",
  "Animal Handling": "WIS",
  Insight: "WIS",
  Medicine: "WIS",
  Perception: "WIS",
  Survival: "WIS",
  Deception: "CHA",
  Intimidation: "CHA",
  Performance: "CHA",
  Persuasion: "CHA",
} as const satisfies Record<string, Ability>;

export type Skill = keyof typeof SKILL_ABILITY;

export const SKILLS = Object.keys(SKILL_ABILITY) as Skill[];

/**
 * Difficulty bands and their Difficulty Classes (DMG "Typical Difficulty Classes").
 *
 * Callers select a band, never a number. This keeps the range of possible
 * difficulties to six rules-legal values, so a proposal originating outside the
 * backend cannot invent an arbitrary DC.
 */
export const DIFFICULTY_DC = {
  very_easy: 5,
  easy: 10,
  medium: 15,
  hard: 20,
  very_hard: 25,
  nearly_impossible: 30,
} as const;

export type DifficultyBand = keyof typeof DIFFICULTY_DC;

export const DIFFICULTY_BANDS = Object.keys(DIFFICULTY_DC) as DifficultyBand[];

/** Default band for an improvised action with no stated difficulty. */
export const DEFAULT_DIFFICULTY_BAND: DifficultyBand = "medium";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AbilityCheckActor {
  /** Ability scores, e.g. { STR: 14, DEX: 12, ... }. Missing entries default to 10. */
  stats: Partial<Record<Ability, number>>;
  /** Character level, used for the proficiency bonus. */
  level: number;
  /** Skills the character is proficient in. Absent or empty means no proficiency. */
  skillProficiencies?: readonly Skill[];
}

export interface AbilityCheckInput {
  /**
   * The skill being used, when one applies. Determines the ability and whether
   * the proficiency bonus is added.
   */
  skill?: Skill;
  /**
   * The ability to use when no skill applies (a raw Strength check, say).
   * Ignored when `skill` is present, since the skill determines its own ability.
   */
  ability?: Ability;
  /** Difficulty band. Defaults to "medium". */
  band?: DifficultyBand;
  /** Roll two dice and keep the higher / lower. */
  advantage?: boolean;
  disadvantage?: boolean;
}

export interface AbilityCheckResult {
  ability: Ability;
  skill: Skill | null;
  band: DifficultyBand;
  dc: number;
  /** The natural d20 result, before modifiers. */
  roll: number;
  abilityModifier: number;
  /** Proficiency actually applied (0 when not proficient or no skill was used). */
  proficiencyApplied: number;
  /** Natural roll + ability modifier + proficiency. */
  total: number;
  success: boolean;
  isCriticalSuccess: boolean;
  isCriticalFailure: boolean;
  /** Which die-rolling mode was used, for narration and audit. */
  rollMode: "normal" | "advantage" | "disadvantage";
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolves the DC for a difficulty band.
 *
 * Unknown or absent bands fall back to "medium" rather than throwing, so a
 * malformed proposal degrades to a legal check instead of failing the action.
 */
export function computeAbilityCheckDC(band?: DifficultyBand): number {
  return DIFFICULTY_DC[band ?? DEFAULT_DIFFICULTY_BAND] ?? DIFFICULTY_DC[DEFAULT_DIFFICULTY_BAND];
}

/**
 * Resolves an ability or skill check for an improvised action.
 *
 * @example
 * // "I try to disarm the goblin"
 * resolveAbilityCheck({ skill: "Athletics", band: "medium" }, hero)
 */
export function resolveAbilityCheck(
  input: AbilityCheckInput,
  actor: AbilityCheckActor
): AbilityCheckResult {
  const skill = input.skill ?? null;
  const ability: Ability = skill ? SKILL_ABILITY[skill] : input.ability ?? "STR";
  const band = input.band ?? DEFAULT_DIFFICULTY_BAND;
  const dc = computeAbilityCheckDC(band);

  const abilityMod = abilityModifier(actor.stats[ability] ?? 10);

  // Proficiency only ever applies through a skill the character is proficient in.
  const isProficient = skill !== null && (actor.skillProficiencies ?? []).includes(skill);
  const proficiencyApplied = isProficient ? proficiencyBonus(actor.level) : 0;

  const totalModifier = abilityMod + proficiencyApplied;

  // Advantage and disadvantage cancel out, per SRD.
  const advantage = input.advantage === true && input.disadvantage !== true;
  const disadvantage = input.disadvantage === true && input.advantage !== true;
  const rollMode: AbilityCheckResult["rollMode"] = advantage
    ? "advantage"
    : disadvantage
      ? "disadvantage"
      : "normal";

  let natural: number;
  let total: number;
  if (advantage || disadvantage) {
    const rollResult = advantage
      ? rollWithAdvantage(20, totalModifier)
      : rollWithDisadvantage(20, totalModifier);
    natural = rollResult.dice[0]!.result;
    total = rollResult.total;
  } else {
    const checkResult = d20Check(totalModifier, dc);
    natural = checkResult.roll.dice[0]!.result;
    total = checkResult.roll.total;
  }

  const isCriticalSuccess = natural === 20;
  const isCriticalFailure = natural === 1;

  return {
    ability,
    skill,
    band,
    dc,
    roll: natural,
    abilityModifier: abilityMod,
    proficiencyApplied,
    total,
    // Natural 20 always succeeds; natural 1 always fails.
    success: isCriticalSuccess || (!isCriticalFailure && total >= dc),
    isCriticalSuccess,
    isCriticalFailure,
    rollMode,
  };
}
