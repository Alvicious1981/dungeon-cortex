/**
 * lib/rules/exhaustion.ts
 *
 * The D&D 5e 2014 SRD exhaustion table, as one pure lookup.
 *
 * | Level | Effect                                          |
 * | ----- | ----------------------------------------------- |
 * | 1     | Disadvantage on ability checks                  |
 * | 2     | Speed halved                                    |
 * | 3     | Disadvantage on attack rolls and saving throws  |
 * | 4     | Hit point maximum halved                        |
 * | 5     | Speed reduced to 0                              |
 * | 6     | Death                                           |
 *
 * The effects are cumulative: a creature at level 4 suffers levels 1–4.
 *
 * Until this module existed only level 1 had a consumer, while forced march
 * (`lib/rules/travel.ts`) could raise `Character.exhaustionLevel` all the way
 * to 6 — a value produced with most of its meaning never read. Every rule that
 * applies an exhaustion effect asks this module rather than comparing the
 * level against a literal, so the thresholds live in exactly one place.
 *
 * @pure — no I/O, deterministic.
 */

export const MAX_EXHAUSTION_LEVEL = 6;

export interface ExhaustionEffects {
  /** The level these effects were derived from, clamped to 0–6. */
  level: number;
  /** Level 1+. */
  abilityCheckDisadvantage: boolean;
  /** Level 2+ halves speed; level 5+ reduces it to 0. */
  speedMultiplier: 1 | 0.5 | 0;
  /** Level 3+. */
  attackDisadvantage: boolean;
  /** Level 3+. Death saving throws are saving throws, so they are included. */
  savingThrowDisadvantage: boolean;
  /** Level 4+. */
  hitPointMaximumHalved: boolean;
  /** Level 6. */
  dead: boolean;
}

/**
 * Normalises a persisted level. A missing, fractional or out-of-range value
 * is read as the nearest legal level so that a malformed row can never grant
 * a benefit (a negative level) or skip past death (a level above 6).
 */
export function normalizeExhaustionLevel(level: number | null | undefined): number {
  if (typeof level !== "number" || !Number.isFinite(level)) return 0;
  return Math.min(MAX_EXHAUSTION_LEVEL, Math.max(0, Math.floor(level)));
}

export function exhaustionEffects(level: number | null | undefined): ExhaustionEffects {
  const l = normalizeExhaustionLevel(level);
  return {
    level: l,
    abilityCheckDisadvantage: l >= 1,
    speedMultiplier: l >= 5 ? 0 : l >= 2 ? 0.5 : 1,
    attackDisadvantage: l >= 3,
    savingThrowDisadvantage: l >= 3,
    hitPointMaximumHalved: l >= 4,
    dead: l >= MAX_EXHAUSTION_LEVEL,
  };
}

/**
 * Walking speed after exhaustion, in feet.
 *
 * Rounded down to a whole 5-foot square: the combat grid moves in squares, so
 * a halved 25 ft speed (12.5 ft) buys two squares, not two and a half.
 */
export function exhaustedSpeedFt(baseSpeedFt: number, level: number | null | undefined): number {
  const { speedMultiplier } = exhaustionEffects(level);
  return Math.floor((baseSpeedFt * speedMultiplier) / 5) * 5;
}

/**
 * The hit point maximum that currently applies.
 *
 * `Character.maxHp` keeps the unreduced value: the reduction lasts only while
 * the character is at level 4 or higher, so storing the halved figure would
 * lose the real maximum the moment a long rest lowered the level again.
 * Every place that caps healing asks this function instead of reading
 * `maxHp` directly. Halved rounding down, never below 1.
 */
export function effectiveMaxHp(maxHp: number, level: number | null | undefined): number {
  if (!exhaustionEffects(level).hitPointMaximumHalved) return maxHp;
  return Math.max(1, Math.floor(maxHp / 2));
}

/**
 * One line of backend-resolved fact for the narrator, naming exactly the
 * effects that apply at this level. `null` at level 0.
 */
export function describeExhaustion(level: number | null | undefined): string | null {
  const effects = exhaustionEffects(level);
  if (effects.level === 0) return null;
  if (effects.dead) return `Level 6 — the character has died of exhaustion.`;

  const parts = ["ability checks are at disadvantage"];
  if (effects.speedMultiplier === 0) parts.push("speed is 0");
  else if (effects.speedMultiplier === 0.5) parts.push("speed is halved");
  if (effects.attackDisadvantage) parts.push("attack rolls and saving throws are at disadvantage");
  if (effects.hitPointMaximumHalved) parts.push("hit point maximum is halved");
  return `Level ${effects.level} — ${parts.join("; ")}.`;
}
