/** Presentation only: the thresholds colour a gauge; the numbers beside it carry the meaning. */
export function hpColor(hp: number, maxHp: number): string {
  const percentage = maxHp > 0 ? hp / maxHp : 1;
  if (percentage <= 0.25) return "var(--dc-error)";
  if (percentage <= 0.5) return "var(--dc-warning)";
  return "var(--dc-success)";
}

export function hpRatio(hp: number, maxHp: number): number {
  if (maxHp <= 0) return 0;
  return Math.min(1, Math.max(0, hp / maxHp));
}
