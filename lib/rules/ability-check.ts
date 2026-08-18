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
  /** Difficulty band. Defaults to "medium". Ignored when `opposition` is set. */
  band?: DifficultyBand;
  /**
   * Creatures resisting the attempt. When present the DC is derived from their
   * own ability scores instead of a band — hiding from an alert guard is harder
   * than hiding from an oblivious one, and the difference comes from the
   * guard's real statistics rather than from a label.
   */
  opposition?: ContestedOpposition;
  /** Roll two dice and keep the higher / lower. */
  advantage?: boolean;
  disadvantage?: boolean;
}

export interface ContestedOpposition {
  /** Ability scores of each creature resisting. Missing entries default to 10. */
  opponents: ReadonlyArray<Partial<Record<Ability, number>>>;
  /**
   * Skills the opposition may resist with. The best passive score among every
   * opponent and every listed skill sets the DC, so a contest is only as easy
   * as the most capable creature makes it.
   */
  skills: readonly Skill[];
}

export interface AbilityCheckResult {
  ability: Ability;
  skill: Skill | null;
  /** The band that set the DC, or null when a contest set it instead. */
  band: DifficultyBand | null;
  /**
   * Where the DC came from. Reported so the outcome can be audited: a player
   * shown "DC 14" is entitled to know whether that is a difficulty label or a
   * specific creature resisting.
   */
  dcSource: "band" | "contest";
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
 * The passive score for a skill: 10 + the relevant ability modifier.
 *
 * SRD passive checks are 10 + every modifier that applies, proficiency
 * included. Monster skill proficiencies are not persisted anywhere in this
 * project, so only the ability modifier is available and a creature trained in
 * Perception is rated as if it were not. That understates alert guards; it is
 * recorded here rather than papered over with an invented bonus, and stops
 * being an approximation the day monster proficiencies are stored.
 */
export function passiveSkillScore(
  stats: Partial<Record<Ability, number>>,
  skill: Skill
): number {
  return 10 + abilityModifier(stats[SKILL_ABILITY[skill]] ?? 10);
}

/**
 * The DC an opposed attempt must beat.
 *
 * Every opponent is rated on every skill they may resist with, and the best
 * result wins: sneaking past a patrol is as hard as its sharpest sentry, and
 * the SRD lets a creature resist a shove with either Athletics or Acrobatics,
 * whichever serves it better.
 *
 * ─── A deliberate simplification ─────────────────────────────────────────────
 * The SRD resolves shoving and grappling as an *active* contest: both sides
 * roll. This uses the passive score instead, as the SRD itself does for Stealth
 * and Sleight of Hand. One player action then resolves with one die, and there
 * is no tie rule to invent. The trade is that a shoved creature never rolls
 * well or badly — it defends at its average.
 *
 * With no opponents the attempt is unopposed, and the caller should fall back
 * to a difficulty band rather than treat DC 10 as "nobody is watching".
 */
export function contestedCheckDC(opposition: ContestedOpposition): number {
  const scores = opposition.opponents.flatMap((opponent) =>
    opposition.skills.map((skill) => passiveSkillScore(opponent, skill))
  );
  return scores.length > 0 ? Math.max(...scores) : DIFFICULTY_DC[DEFAULT_DIFFICULTY_BAND];
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

  // A contest overrides the band: when a specific creature is resisting, its
  // own statistics are a better answer to "how hard is this" than a label.
  // With no opponents listed there is nothing to contest, so the band stands.
  const isContested = (input.opposition?.opponents.length ?? 0) > 0;
  const band = isContested ? null : input.band ?? DEFAULT_DIFFICULTY_BAND;
  const dc = isContested
    ? contestedCheckDC(input.opposition!)
    : computeAbilityCheckDC(band ?? undefined);

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
    dcSource: isContested ? "contest" : "band",
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
