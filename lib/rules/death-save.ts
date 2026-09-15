/**
 * Death saving throws, D&D 5e SRD 2014
 * (docs/superpowers/specs/2026-09-15-death-saves-design.md §5).
 *
 * @pure — dice are injected; nothing here reads or writes state.
 */

export const DEATH_SAVE_LIMIT = 3;

/** A state the death-save rules must never see. Mapped to 500 DEATH_SAVE_INVARIANT. */
export class DeathSaveInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeathSaveInvariantError";
  }
}

export interface DeathSaveCounters {
  successes: number;
  failures: number;
}

export type DeathSaveResult =
  | { outcome: "revived" }
  | { outcome: "dying" | "stable" | "dead"; successes: number; failures: number };

function assertCounter(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value >= DEATH_SAVE_LIMIT) {
    throw new DeathSaveInvariantError(`${name} ${value} is outside 0..${DEATH_SAVE_LIMIT - 1}.`);
  }
}

function assertDie(faces: number, value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > faces) {
    throw new RangeError(`d${faces} roll ${value} is outside 1..${faces}.`);
  }
}

/** One death save. A save is only rolled while dying, so neither counter is at 3. */
export function resolveDeathSave(state: DeathSaveCounters, natural: number): DeathSaveResult {
  assertCounter("successes", state.successes);
  assertCounter("failures", state.failures);
  assertDie(20, natural);

  if (natural === 20) return { outcome: "revived" };

  let { successes, failures } = state;
  if (natural === 1) failures += 2;
  else if (natural >= 10) successes += 1;
  else failures += 1;

  if (failures >= DEATH_SAVE_LIMIT) return { outcome: "dead", successes, failures: DEATH_SAVE_LIMIT };
  if (successes >= DEATH_SAVE_LIMIT) return { outcome: "stable", successes: DEATH_SAVE_LIMIT, failures };
  return { outcome: "dying", successes, failures };
}

/** The blow that brings the player to 0 HP: massive damage kills outright. */
export function resolveDownedBlow(input: {
  hpBefore: number;
  damage: number;
  maxHp: number;
}): "instant_death" | "dying" {
  const leftover = input.damage - Math.max(0, input.hpBefore);
  return leftover >= input.maxHp ? "instant_death" : "dying";
}

/** The round a stabilised player wakes: the SRD's 1d4 hours, scaled to rounds. */
export function stabilize(round: number, d4: number): number {
  assertDie(4, d4);
  return round + d4;
}

export function shouldWake(
  state: { hp: number; stableWakeRound?: number | null },
  round: number
): boolean {
  if (state.hp > 0) return false;
  const wake = state.stableWakeRound ?? null;
  return wake !== null && round >= wake;
}

export type PlayerLifeState = "conscious" | "dying" | "stable" | "dead";

/**
 * The player's state, derived from persisted fields (spec §4). Missing fields
 * (reduced test doubles, pre-migration rows) read as 0 / NULL.
 */
export function derivePlayerLifeState(row: {
  hp: number;
  deathSaveSuccesses?: number | null;
  deathSaveFailures?: number | null;
  stableWakeRound?: number | null;
}): PlayerLifeState {
  const successes = row.deathSaveSuccesses ?? 0;
  const failures = row.deathSaveFailures ?? 0;
  const wake = row.stableWakeRound ?? null;

  if (row.hp > 0) {
    // Every player HP write resets these (lib/db/player-hp.ts); anything else
    // is a writer that bypassed the single write path.
    if (successes !== 0 || failures !== 0 || wake !== null) {
      throw new DeathSaveInvariantError("A conscious player carries death-save state.");
    }
    return "conscious";
  }
  if (failures >= DEATH_SAVE_LIMIT) return "dead";
  if (wake !== null) return "stable";
  return "dying";
}
