/**
 * lib/rules/hit-dice-integrity.ts
 *
 * Pure classifier for the Character progression / hit dice contract.
 * No database access, no Prisma, no I/O, no AI. Given a character's raw
 * `xp`, `level`, `hitDiceTotal`, `hitDiceRemaining`, it determines whether
 * the row is in a valid state, unambiguously repairable, ambiguous, or
 * carrying an untrustworthy `level`.
 *
 * Reuses MIN_LEVEL / MAX_LEVEL / getLevelFromXP from progression.ts — the
 * single mechanical authority for SRD XP thresholds. This module does not
 * duplicate that table.
 */

import { MIN_LEVEL, MAX_LEVEL, getLevelFromXP } from "@/lib/rules/progression";

export type HitDiceIntegrityStatus =
  | "VALID_SETTLED"
  | "VALID_PENDING"
  | "REPAIRABLE"
  | "AMBIGUOUS"
  | "INVALID_PROGRESSION";

export type HitDiceIntegrityReasonCode =
  | "SETTLED"
  | "PENDING_LEVEL_UP"
  | "LEVEL_ONE_TOTAL_MISMATCH"
  | "TOTAL_EXCEEDS_LEVEL"
  | "REMAINING_OUT_OF_RANGE"
  | "PENDING_BELOW_LEVEL_MINUS_ONE"
  | "NON_INTEGER_XP"
  | "NEGATIVE_XP"
  | "NON_INTEGER_LEVEL"
  | "LEVEL_BELOW_MIN"
  | "LEVEL_ABOVE_MAX"
  | "NON_INTEGER_HIT_DICE_TOTAL"
  | "NON_INTEGER_HIT_DICE_REMAINING"
  | "XP_LEVEL_MISMATCH";

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
 *   2. AMBIGUOUS — `hitDiceTotal` below the legitimate pending threshold;
 *      indistinguishable from a multi-level XP award that never granted
 *      physical hit dice. Never auto-repaired.
 *   3. VALID_SETTLED / VALID_PENDING — hitDiceTotal matches the contract and
 *      hitDiceRemaining is in range.
 *   4. REPAIRABLE — hitDiceTotal and/or hitDiceRemaining diverge from the
 *      contract in a way with exactly one correct value.
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
  if (getLevelFromXP(xp) !== level) return invalid(current, "XP_LEVEL_MISMATCH");

  // ─── 2. AMBIGUOUS ──────────────────────────────────────────────────────────
  // Below the legitimate pending threshold: could be a multi-level XP award
  // that never granted physical hit dice, or historical corruption. Neither
  // hitDiceTotal nor hitDiceRemaining is touched.
  if (level >= 2 && hitDiceTotal < level - 1) {
    return { status: "AMBIGUOUS", reason: "PENDING_BELOW_LEVEL_MINUS_ONE", current };
  }

  // ─── 3. Determine the contractually correct total ─────────────────────────
  let totalFinal: number;
  let settledReason: HitDiceIntegrityReasonCode;
  const patch: HitDiceIntegrityPatch = {};

  if (level === 1) {
    totalFinal = 1;
    settledReason = "SETTLED";
    if (hitDiceTotal !== 1) {
      patch.hitDiceTotal = 1;
    }
  } else if (hitDiceTotal > level) {
    totalFinal = level;
    settledReason = "SETTLED";
    patch.hitDiceTotal = level;
  } else if (hitDiceTotal === level) {
    totalFinal = level;
    settledReason = "SETTLED";
  } else {
    // level >= 2 && hitDiceTotal === level - 1 (AMBIGUOUS already ruled out
    // hitDiceTotal < level - 1 above).
    totalFinal = level - 1;
    settledReason = "PENDING_LEVEL_UP";
  }

  // ─── 4. Determine the contractually correct remaining ─────────────────────
  const remainingFinal = Math.min(Math.max(hitDiceRemaining, 0), totalFinal);
  if (remainingFinal !== hitDiceRemaining) {
    patch.hitDiceRemaining = remainingFinal;
  }

  const hasPatch = patch.hitDiceTotal !== undefined || patch.hitDiceRemaining !== undefined;

  if (!hasPatch) {
    return {
      status: settledReason === "PENDING_LEVEL_UP" ? "VALID_PENDING" : "VALID_SETTLED",
      reason: settledReason,
      current,
    };
  }

  const reason: HitDiceIntegrityReasonCode =
    patch.hitDiceTotal !== undefined
      ? level === 1
        ? "LEVEL_ONE_TOTAL_MISMATCH"
        : "TOTAL_EXCEEDS_LEVEL"
      : "REMAINING_OUT_OF_RANGE";

  return { status: "REPAIRABLE", reason, current, patch };
}
