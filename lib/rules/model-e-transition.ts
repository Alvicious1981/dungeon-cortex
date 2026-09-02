/**
 * lib/rules/model-e-transition.ts
 *
 * Pure classifier for the Character progression transition to Model E.
 * No database access, no Prisma, no I/O, no AI. Given a character's raw
 * `xp`, `level`, `hitDiceTotal`, `hitDiceRemaining`, it decides whether the
 * row already satisfies Model E, can be converted from the old contract by
 * exactly one unambiguous write, or must be left alone for a human.
 *
 * ─── Model E ────────────────────────────────────────────────────────────────
 *   targetLevel = getLevelFromXP(xp)      — the level the XP supports
 *   level                                 — the last MECHANICALLY APPLIED level
 *   hitDiceTotal === level                — normal persisted state
 *   pendingLevels = targetLevel - level   — ascensions still to apply
 *
 * ─── Why the convertible set is so small ────────────────────────────────────
 * Under the OLD contract every authorized backend sequence leaves
 * `targetLevel === level`: character creation writes `level: 1` with `xp` at
 * its default 0; the XP award of the day wrote `level = getLevelFromXP(newXP)`
 * whenever it crossed a threshold and refused to run at all when it found
 * `getLevelFromXP(xp) > level`; applyLevelUp never writes `level`; the
 * migrations never write `xp` or `level`.
 *
 * That award was `applyExperienceAward`, deleted once it had no caller. This
 * paragraph is about rows already in the database, so its provenance argument
 * stands — but no live code writes `level` on an XP award any more: the only
 * award is `combat-pipeline.ts`, an atomic `xp: { increment }` and nothing
 * else.
 *
 * applyLevelUp writes `hitDiceTotal = level` and `maxHp` in the SAME
 * statement, so `maxHp` always corresponds to `hitDiceTotal`, never to
 * `level`. A row with `targetLevel === level` and `1 < hitDiceTotal < level`
 * can therefore only have been produced by applyLevelUp settling at
 * `hitDiceTotal`, followed by an XP award that advanced `level` without
 * touching the total. Setting `level = hitDiceTotal` grants nothing: it makes
 * `level` agree with the hit points the row already has.
 *
 * Everything else is excluded:
 *   - `hitDiceTotal === 1` is exactly what the column DEFAULT produces, so a
 *     character settled at a higher level whose total was flattened is
 *     indistinguishable from one genuinely applied at level 1. Converting the
 *     former would re-open an ascension already granted and duplicate HP.
 *   - `targetLevel > level` has NO authorized producer at all. When the total
 *     also disagrees with the level the row carries two independent anomalies
 *     and admits several incompatible readings; no level may be inferred.
 *   - `targetLevel < level` cannot be repaired in either direction: lowering
 *     `level` withdraws granted HP, raising `xp` fabricates experience.
 *
 * Reuses MIN_LEVEL / MAX_LEVEL / getLevelFromXP from progression.ts — the
 * single mechanical authority for SRD XP thresholds. This module does not
 * duplicate that table.
 */

import { MIN_LEVEL, MAX_LEVEL, getLevelFromXP } from "@/lib/rules/progression";

export type ModelETransitionCategory =
  | "E_SETTLED"
  | "E_PENDING"
  | "CONVERTIBLE"
  | "AMBIGUOUS"
  | "INVALID_PROGRESSION"
  | "INVALID_HIT_DICE";

export type ModelETransitionReasonCode =
  // E_SETTLED / E_PENDING
  | "SETTLED"
  | "PENDING_LEVELS"
  // CONVERTIBLE
  | "APPLIED_LEVEL_BELOW_XP_LEVEL"
  // AMBIGUOUS
  | "TOTAL_INDISTINGUISHABLE_FROM_DEFAULT"
  | "LEVEL_AHEAD_OF_XP_WITHOUT_AUTHORIZED_PATH"
  // INVALID_PROGRESSION
  | "NON_INTEGER_XP"
  | "NEGATIVE_XP"
  | "NON_INTEGER_LEVEL"
  | "LEVEL_BELOW_MIN"
  | "LEVEL_ABOVE_MAX"
  | "XP_BELOW_APPLIED_LEVEL"
  // INVALID_HIT_DICE
  | "NON_INTEGER_HIT_DICE_TOTAL"
  | "TOTAL_BELOW_MIN"
  | "TOTAL_ABOVE_MAX"
  | "NON_INTEGER_HIT_DICE_REMAINING"
  | "REMAINING_NEGATIVE"
  | "REMAINING_EXCEEDS_TOTAL"
  | "TOTAL_EXCEEDS_LEVEL";

export interface ModelETransitionInput {
  xp: number;
  level: number;
  hitDiceTotal: number;
  hitDiceRemaining: number;
}

/**
 * The only write this transition may ever propose.
 *
 * The type deliberately admits a single field: a patch that cannot express
 * `xp`, `hitDiceTotal`, `hitDiceRemaining`, `hp` or `maxHp` cannot carry them
 * by accident.
 */
export interface ModelETransitionPatch {
  level: number;
}

export interface ModelETransitionResult {
  category: ModelETransitionCategory;
  reason: ModelETransitionReasonCode;
  /** The row exactly as received. Never mutated. */
  current: ModelETransitionInput;
  /**
   * getLevelFromXP(xp), or null when `xp` itself is unusable and the
   * derivation could not be attempted.
   */
  targetLevel: number | null;
  /**
   * Raw `targetLevel - level`, or null when `targetLevel` is null. Only
   * meaningful (and non-negative) outside INVALID_PROGRESSION: a negative
   * value is itself the XP_BELOW_APPLIED_LEVEL anomaly.
   */
  pendingLevels: number | null;
  /** Present only for CONVERTIBLE. */
  patch?: ModelETransitionPatch;
}

function invalidProgression(
  current: ModelETransitionInput,
  reason: ModelETransitionReasonCode,
  targetLevel: number | null
): ModelETransitionResult {
  return {
    category: "INVALID_PROGRESSION",
    reason,
    current,
    targetLevel,
    pendingLevels: targetLevel === null ? null : targetLevel - current.level,
  };
}

function invalidHitDice(
  current: ModelETransitionInput,
  reason: ModelETransitionReasonCode,
  targetLevel: number
): ModelETransitionResult {
  return {
    category: "INVALID_HIT_DICE",
    reason,
    current,
    targetLevel,
    pendingLevels: targetLevel - current.level,
  };
}

/**
 * Classifies a Character row for the transition to Model E and, only when the
 * conversion is unambiguous, proposes the single write that performs it.
 *
 * Evaluation order (first match wins):
 *   1. INVALID_PROGRESSION — `xp` / `level` are structurally unusable.
 *   2. INVALID_HIT_DICE    — `hitDiceTotal` / `hitDiceRemaining` are out of
 *                            contract on their own terms.
 *   3. INVALID_PROGRESSION — targetLevel < level. Never repaired.
 *   4. INVALID_HIT_DICE    — hitDiceTotal > level. Never repaired here:
 *                            forcing the total down to `level` would assert a
 *                            settled level this classifier cannot verify.
 *   5. E_SETTLED / E_PENDING — hitDiceTotal === level. Both semantics of
 *                            `level` agree on the same number, so there is
 *                            nothing to write. E_PENDING is a valid Model E
 *                            state: the XP is ahead and the ascensions are
 *                            simply not applied yet.
 *   6. AMBIGUOUS           — targetLevel > level with a disagreeing total.
 *   7. AMBIGUOUS           — hitDiceTotal === 1 at level >= 2, i.e. the value
 *                            the column DEFAULT produces.
 *   8. CONVERTIBLE         — the remainder: targetLevel === level and
 *                            1 < hitDiceTotal < level.
 */
export function classifyModelETransition(
  input: ModelETransitionInput
): ModelETransitionResult {
  const { xp, level, hitDiceTotal, hitDiceRemaining } = input;
  const current = { xp, level, hitDiceTotal, hitDiceRemaining };

  // ─── 1. INVALID_PROGRESSION — xp / level unusable ──────────────────────────
  // These run before the derivation because getLevelFromXP throws on negative
  // xp and returns nothing meaningful for a non-integer.
  if (!Number.isInteger(xp)) return invalidProgression(current, "NON_INTEGER_XP", null);
  if (xp < 0) return invalidProgression(current, "NEGATIVE_XP", null);
  if (!Number.isInteger(level))
    return invalidProgression(current, "NON_INTEGER_LEVEL", null);
  if (level < MIN_LEVEL) return invalidProgression(current, "LEVEL_BELOW_MIN", null);
  if (level > MAX_LEVEL) return invalidProgression(current, "LEVEL_ABOVE_MAX", null);

  // `xp` is a non-negative integer from here on, so the derivation is safe.
  const targetLevel = getLevelFromXP(xp);

  // ─── 2. INVALID_HIT_DICE — hit dice out of contract on their own terms ─────
  if (!Number.isInteger(hitDiceTotal))
    return invalidHitDice(current, "NON_INTEGER_HIT_DICE_TOTAL", targetLevel);
  if (hitDiceTotal < 1) return invalidHitDice(current, "TOTAL_BELOW_MIN", targetLevel);
  if (hitDiceTotal > MAX_LEVEL)
    return invalidHitDice(current, "TOTAL_ABOVE_MAX", targetLevel);
  if (!Number.isInteger(hitDiceRemaining))
    return invalidHitDice(current, "NON_INTEGER_HIT_DICE_REMAINING", targetLevel);
  if (hitDiceRemaining < 0)
    return invalidHitDice(current, "REMAINING_NEGATIVE", targetLevel);
  if (hitDiceRemaining > hitDiceTotal)
    return invalidHitDice(current, "REMAINING_EXCEEDS_TOTAL", targetLevel);

  const pendingLevels = targetLevel - level;

  // ─── 3. XP behind the applied level ────────────────────────────────────────
  // No authorized path lowers xp or raises level past its XP. Lowering `level`
  // would withdraw granted HP; raising `xp` would fabricate experience.
  if (targetLevel < level)
    return invalidProgression(current, "XP_BELOW_APPLIED_LEVEL", targetLevel);

  // ─── 4. Total above the level ──────────────────────────────────────────────
  // applyLevelUp writes hitDiceTotal = level, and the migrations write either
  // 1 or the level itself, so no authorized writer produces this.
  if (hitDiceTotal > level)
    return invalidHitDice(current, "TOTAL_EXCEEDS_LEVEL", targetLevel);

  // ─── 5. Already Model E — nothing to write ─────────────────────────────────
  // With hitDiceTotal === level both readings of `level` (derived from XP, and
  // last applied) name the same number, and maxHp corresponds to it under
  // either. The classification is inert, so provenance cannot matter.
  if (hitDiceTotal === level) {
    return targetLevel === level
      ? { category: "E_SETTLED", reason: "SETTLED", current, targetLevel, pendingLevels }
      : {
          category: "E_PENDING",
          reason: "PENDING_LEVELS",
          current,
          targetLevel,
          pendingLevels,
        };
  }

  // hitDiceTotal < level from here on.

  // ─── 6. Level ahead of XP with a disagreeing total ─────────────────────────
  // targetLevel > level has no authorized producer whatsoever. Combined with a
  // total below the level the row carries two independent anomalies —
  // corrupt total, manual edit, partial transition, unknown history — and no
  // applied level may be inferred from any of them.
  if (targetLevel > level) {
    return {
      category: "AMBIGUOUS",
      reason: "LEVEL_AHEAD_OF_XP_WITHOUT_AUTHORIZED_PATH",
      current,
      targetLevel,
      pendingLevels,
    };
  }

  // ─── 7. Indistinguishable from the column DEFAULT ──────────────────────────
  // hitDiceTotal === 1 is precisely what @default(1) and the ADD COLUMN
  // DEFAULT 1 produce, regardless of level. A character settled at `level`
  // whose total was flattened is byte-identical to one genuinely applied at
  // level 1. Converting the former would duplicate HP.
  if (hitDiceTotal === 1) {
    return {
      category: "AMBIGUOUS",
      reason: "TOTAL_INDISTINGUISHABLE_FROM_DEFAULT",
      current,
      targetLevel,
      pendingLevels,
    };
  }

  // ─── 8. The only automatic conversion ──────────────────────────────────────
  // targetLevel === level && 1 < hitDiceTotal < level.
  return {
    category: "CONVERTIBLE",
    reason: "APPLIED_LEVEL_BELOW_XP_LEVEL",
    current,
    targetLevel,
    pendingLevels,
    patch: { level: hitDiceTotal },
  };
}
