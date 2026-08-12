/**
 * lib/rules/hit-dice-integrity.ts
 *
 * Pure classifier for the Character progression / hit dice contract.
 * No database access, no Prisma, no I/O, no AI. Given a character's raw
 * `xp`, `level`, `hitDiceTotal`, `hitDiceRemaining`, it determines whether
 * the row is in a valid state, unambiguously repairable, ambiguous, or
 * carrying an untrustworthy `level`.
 *
 * Model E contract:
 *   - `level` is the last mechanically applied level;
 *   - `getLevelFromXP(xp) >= level` (XP may run ahead by any number of levels);
 *   - the settled hit-dice state is `hitDiceTotal === level`, because
 *     applyLevelUp advances both fields in the same conditional write;
 *   - `0 <= hitDiceRemaining <= hitDiceTotal`.
 *
 * Fail-closed: any disagreement between `hitDiceTotal` and `level`, in either
 * direction, is AMBIGUOUS and never auto-repaired. Only `hitDiceRemaining`
 * drifting out of `[0, hitDiceTotal]` while the total already agrees with the
 * level has a single provably correct value.
 *
 * Reuses MIN_LEVEL / MAX_LEVEL / getLevelFromXP from progression.ts — the
 * single mechanical authority for SRD XP thresholds. This module does not
 * duplicate that table.
 */

import { MIN_LEVEL, MAX_LEVEL, getLevelFromXP } from "@/lib/rules/progression";

export type HitDiceIntegrityStatus =
  | "VALID_SETTLED"
  | "REPAIRABLE"
  | "AMBIGUOUS"
  | "INVALID_PROGRESSION";

export type HitDiceIntegrityReasonCode =
  | "SETTLED"
  | "REMAINING_OUT_OF_RANGE"
  | "TOTAL_BELOW_LEVEL"
  | "TOTAL_ABOVE_LEVEL"
  | "NON_INTEGER_XP"
  | "NEGATIVE_XP"
  | "NON_INTEGER_LEVEL"
  | "LEVEL_BELOW_MIN"
  | "LEVEL_ABOVE_MAX"
  | "NON_INTEGER_HIT_DICE_TOTAL"
  | "NON_INTEGER_HIT_DICE_REMAINING"
  | "XP_BELOW_APPLIED_LEVEL";

export interface HitDiceIntegrityInput {
  xp: number;
  level: number;
  hitDiceTotal: number;
  hitDiceRemaining: number;
}

export interface HitDiceIntegrityPatch {
  hitDiceTotal?: number;
  hitDiceRemaining?: number;
}

export interface HitDiceIntegrityResult {
  status: HitDiceIntegrityStatus;
  reason: HitDiceIntegrityReasonCode;
  current: HitDiceIntegrityInput;
  /** Present only for REPAIRABLE; contains only fields that would actually change. */
  patch?: HitDiceIntegrityPatch;
}

function invalid(
  current: HitDiceIntegrityInput,
  reason: HitDiceIntegrityReasonCode
): HitDiceIntegrityResult {
  return { status: "INVALID_PROGRESSION", reason, current };
}

/**
 * Classifies a Character's progression/hit-dice state and, when the repair
 * is unambiguous, proposes the minimal patch to fix it.
 *
 * Evaluation order (first match wins):
 *   1. INVALID_PROGRESSION — `level` cannot be trusted, so it cannot be used
 *      to judge hit dice at all.
 *   2. AMBIGUOUS — `hitDiceTotal !== level`, in either direction. A total
 *      below the level is indistinguishable from old-contract residue or
 *      corruption; a total above the level is indistinguishable from a
 *      manual edit or a rebased `level` that lost its own history. Neither
 *      direction has a single correct value this classifier can prove, so
 *      neither is ever auto-repaired.
 *   3. VALID_SETTLED — hitDiceTotal === level and hitDiceRemaining is in range.
 *   4. REPAIRABLE — hitDiceRemaining out of range while hitDiceTotal already
 *      agrees with level; the only remaining divergence with one correct value.
 */
export function classifyHitDiceIntegrity(
  input: HitDiceIntegrityInput
): HitDiceIntegrityResult {
  const { xp, level, hitDiceTotal, hitDiceRemaining } = input;
  const current = { xp, level, hitDiceTotal, hitDiceRemaining };

  // ─── 1. INVALID_PROGRESSION ───────────────────────────────────────────────
  // level must be demonstrably trustworthy before it can be used to judge
  // (let alone repair) hit dice.
  if (!Number.isInteger(xp)) return invalid(current, "NON_INTEGER_XP");
  if (xp < 0) return invalid(current, "NEGATIVE_XP");
  if (!Number.isInteger(level)) return invalid(current, "NON_INTEGER_LEVEL");
  if (level < MIN_LEVEL) return invalid(current, "LEVEL_BELOW_MIN");
  if (level > MAX_LEVEL) return invalid(current, "LEVEL_ABOVE_MAX");
  if (!Number.isInteger(hitDiceTotal))
    return invalid(current, "NON_INTEGER_HIT_DICE_TOTAL");
  if (!Number.isInteger(hitDiceRemaining))
    return invalid(current, "NON_INTEGER_HIT_DICE_REMAINING");
  // Model E: XP may run ahead of the applied level by any number of levels;
  // only XP *behind* the applied level is impossible.
  if (getLevelFromXP(xp) < level) return invalid(current, "XP_BELOW_APPLIED_LEVEL");

  // ─── 2. AMBIGUOUS ──────────────────────────────────────────────────────────
  // Under Model E the settled state is hitDiceTotal === level, because
  // applyLevelUp advances both in the same write. Any disagreement is
  // therefore old-contract residue, historical corruption, or a manual edit —
  // never something this classifier may resolve on its own:
  //   - raising a lagging total would grant a hit die never earned;
  //   - lowering an excess total would assert a settled level this classifier
  //     cannot verify, and belongs to classifyModelETransition, not here.
  // Neither hitDiceTotal nor hitDiceRemaining is touched in either direction.
  if (hitDiceTotal < level) {
    return { status: "AMBIGUOUS", reason: "TOTAL_BELOW_LEVEL", current };
  }
  if (hitDiceTotal > level) {
    return { status: "AMBIGUOUS", reason: "TOTAL_ABOVE_LEVEL", current };
  }

  // ─── 3. hitDiceTotal === level from here on — determine remaining ─────────
  const remainingFinal = Math.min(Math.max(hitDiceRemaining, 0), hitDiceTotal);

  if (remainingFinal === hitDiceRemaining) {
    return { status: "VALID_SETTLED", reason: "SETTLED", current };
  }

  // ─── 4. REPAIRABLE — only hitDiceRemaining diverges, with one correct value.
  return {
    status: "REPAIRABLE",
    reason: "REMAINING_OUT_OF_RANGE",
    current,
    patch: { hitDiceRemaining: remainingFinal },
  };
}
