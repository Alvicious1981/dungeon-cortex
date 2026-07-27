export function hpColor(hp: number, maxHp: number): string {
  const pct = maxHp > 0 ? hp / maxHp : 1;
  if (pct <= 0.25) return "#EF4444";
  if (pct <= 0.5) return "#F59E0B";
  return "#4ADE80";
}

export function hpRatio(hp: number, maxHp: number): number {
  if (maxHp <= 0) return 0;
  return Math.min(1, Math.max(0, hp / maxHp));
}
