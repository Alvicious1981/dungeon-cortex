/**
 * Dice resolution module — Dungeon Cortex rules engine.
 *
 * All randomness flows through rollDie(). Every public function returns a
 * typed result struct so callers can log, display, or audit every component
 * of a roll without re-parsing raw numbers.
 *
 * Notation supported: "1d20", "2d6", "1d8+3", "1d6-1", "d20" (implicit 1 die).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single resolved die roll with its face count and result. */
export interface DieResult {
  faces: number;
  result: number;
}

/** Full result of evaluating a dice notation expression. */
export interface RollResult {
  /** Original notation string, e.g. "2d6+3". */
  notation: string;
  /** Individual die results. */
  dice: DieResult[];
  /** Raw sum of all dice before modifier. */
  diceTotal: number;
  /** Flat modifier (may be negative, zero, or positive). */
  modifier: number;
  /** Final value: diceTotal + modifier. */
  total: number;
}

/** Result of a d20 check against a Difficulty Class. */
export interface CheckResult {
  roll: RollResult;
  /** Ability or skill modifier applied on top of the notation modifier. */
  abilityModifier: number;
  dc: number;
  /** Natural 20 on the d20 die itself. */
  isCriticalSuccess: boolean;
  /** Natural 1 on the d20 die itself. */
  isCriticalFailure: boolean;
  success: boolean;
}

/** Result of an attack roll against an Armor Class. */
export interface AttackRollResult {
  roll: RollResult;
  /** Proficiency + ability modifier applied to the attack. */
  attackModifier: number;
  targetAC: number;
  isCriticalHit: boolean;
  isCriticalMiss: boolean;
  hits: boolean;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Notation regex: optional count, "d", faces, optional sign+modifier. */
const NOTATION_RE = /^(\d+)?d(\d+)([+-]\d+)?$/i;

/**
 * Returns a cryptographically-weak but statistically uniform integer in
 * [1, faces]. Swap this implementation for a seeded PRNG in tests.
 */
export function rollDie(faces: number): number {
  if (faces < 2) throw new RangeError(`Die must have at least 2 faces; got ${faces}.`);
  return Math.floor(Math.random() * faces) + 1;
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Parse and roll a standard dice notation string.
 *
 * @example
 * roll("1d20+5")  // one d20, add 5
 * roll("2d6")     // two d6, no modifier
 * roll("d8-1")    // one d8, subtract 1
 */
export function roll(notation: string): RollResult {
  const match = notation.trim().match(NOTATION_RE);
  if (!match) {
    throw new SyntaxError(`Invalid dice notation: "${notation}". Expected format: [N]dF[+/-M]`);
  }

  const count = match[1] !== undefined ? parseInt(match[1], 10) : 1;
  const faces = parseInt(match[2], 10);
  const modifier = match[3] !== undefined ? parseInt(match[3], 10) : 0;

  if (count < 1) throw new RangeError(`Die count must be at least 1; got ${count}.`);
  if (faces < 2) throw new RangeError(`Die faces must be at least 2; got ${faces}.`);

  const dice: DieResult[] = Array.from({ length: count }, () => ({
    faces,
    result: rollDie(faces),
  }));

  const diceTotal = dice.reduce((sum, d) => sum + d.result, 0);

  return {
    notation,
    dice,
    diceTotal,
    modifier,
    total: diceTotal + modifier,
  };
}

/**
 * Roll a single die of the given face count with an optional flat modifier.
 * Convenience wrapper around roll() for the common single-die case.
 *
 * @example
 * rollN(20)      // 1d20
 * rollN(6, 3)    // 1d6+3
 * rollN(8, -1)   // 1d8-1
 */
export function rollN(faces: number, modifier = 0): RollResult {
  const sign = modifier >= 0 ? `+${modifier}` : `${modifier}`;
  const notation = modifier === 0 ? `1d${faces}` : `1d${faces}${sign}`;
  return roll(notation);
}

/**
 * Roll multiple dice of the same face count and return the combined result.
 *
 * @example
 * rollMany(2, 6)      // 2d6
 * rollMany(3, 4, 2)   // 3d4+2
 */
export function rollMany(count: number, faces: number, modifier = 0): RollResult {
  const sign = modifier >= 0 ? `+${modifier}` : `${modifier}`;
  const notation = modifier === 0 ? `${count}d${faces}` : `${count}d${faces}${sign}`;
  return roll(notation);
}

/**
 * Roll a d20 with Advantage: roll twice, keep the highest.
 * Both dice results are returned in the result for transparency.
 */
export function rollWithAdvantage(faces: number, modifier = 0): RollResult {
  const d1 = rollDie(faces);
  const d2 = rollDie(faces);
  const chosen = Math.max(d1, d2);
  const sign = modifier >= 0 ? "+" : "";
  const notation = `1d${faces}${modifier !== 0 ? sign + modifier : ""} (Adv)`;

  return {
    notation,
    dice: [
      { faces, result: d1 },
      { faces, result: d2 },
    ],
    diceTotal: chosen,
    modifier,
    total: chosen + modifier,
  };
}

/**
 * Roll a d20 with Disadvantage: roll twice, keep the lowest.
 * Both dice results are returned in the result for transparency.
 */
export function rollWithDisadvantage(faces: number, modifier = 0): RollResult {
  const d1 = rollDie(faces);
  const d2 = rollDie(faces);
  const chosen = Math.min(d1, d2);
  const sign = modifier >= 0 ? "+" : "";
  const notation = `1d${faces}${modifier !== 0 ? sign + modifier : ""} (Dis)`;

  return {
    notation,
    dice: [
      { faces, result: d1 },
      { faces, result: d2 },
    ],
    diceTotal: chosen,
    modifier,
    total: chosen + modifier,
  };
}

// ---------------------------------------------------------------------------
// D&D-specific helpers
// ---------------------------------------------------------------------------

/**
 * Standard D&D ability score modifier: floor((score - 10) / 2).
 */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/**
 * Roll 1d20 + abilityMod against a Difficulty Class.
 * Returns full breakdown including critical success/failure detection.
 *
 * @example
 * d20Check(3, 15)   // Perception check with +3 mod vs DC 15
 */
export function d20Check(abilityMod: number, dc: number): CheckResult {
  const rollResult = roll("1d20");
  const natural = rollResult.dice[0].result;
  const isCriticalSuccess = natural === 20;
  const isCriticalFailure = natural === 1;
  const finalTotal = rollResult.total + abilityMod;

  return {
    roll: {
      ...rollResult,
      total: finalTotal,
    },
    abilityModifier: abilityMod,
    dc,
    isCriticalSuccess,
    isCriticalFailure,
    // Natural 20 always succeeds; natural 1 always fails.
    success: isCriticalSuccess || (!isCriticalFailure && finalTotal >= dc),
  };
}

/**
 * Roll a d20 attack against a target's Armor Class.
 * Critical hit on natural 20; critical miss on natural 1.
 *
 * @param attackMod  Proficiency bonus + ability modifier for this attack.
 * @param targetAC   The defender's Armor Class.
 *
 * @example
 * attackRoll(5, 16)   // +5 to hit vs AC 16
 */
export function attackRoll(attackMod: number, targetAC: number): AttackRollResult {
  const rollResult = roll("1d20");
  const natural = rollResult.dice[0].result;
  const isCriticalHit = natural === 20;
  const isCriticalMiss = natural === 1;
  const finalTotal = rollResult.total + attackMod;

  return {
    roll: {
      ...rollResult,
      total: finalTotal,
    },
    attackModifier: attackMod,
    targetAC,
    isCriticalHit,
    isCriticalMiss,
    hits: isCriticalHit || (!isCriticalMiss && finalTotal >= targetAC),
  };
}

/**
 * Roll damage, doubling the dice on a critical hit (5e RAW: re-roll all dice,
 * do not double the modifier).
 *
 * @param notation    Damage notation, e.g. "1d8+3".
 * @param isCritical  If true, each die in the notation is rolled twice.
 *
 * @example
 * damageRoll("1d8+3")               // normal longsword hit
 * damageRoll("1d8+3", true)         // critical hit — 2d8+3
 */
export function damageRoll(notation: string, isCritical = false): RollResult {
  if (!isCritical) return roll(notation);

  const match = notation.trim().match(NOTATION_RE);
  if (!match) {
    throw new SyntaxError(`Invalid damage notation: "${notation}".`);
  }

  const count = match[1] !== undefined ? parseInt(match[1], 10) : 1;
  const faces = parseInt(match[2], 10);
  const modifier = match[3] !== undefined ? parseInt(match[3], 10) : 0;

  // 5e RAW: double the number of dice, keep modifier as-is.
  return rollMany(count * 2, faces, modifier);
}
