/**
 * components/character/XPProgressBar.tsx
 *
 * Milestone L Slice 3 — XP Progress Bar
 *
 * Displays the character's XP progress toward the next level.
 * Animates smoothly on value change via CSS transition on the fill width.
 *
 * No "use client" needed — CSS transitions run in the browser regardless
 * of whether the component is server- or client-rendered. The Next.js
 * router.refresh() re-renders the page with new XP values, and the
 * browser animates the width change automatically.
 *
 * Model E: `level` is the last MECHANICALLY APPLIED level, not a value derived
 * from `xp`. `targetLevel = getLevelFromXP(xp)` may run ahead of it by any
 * number of levels. When it does, XP progress toward "the next threshold"
 * is meaningless — the threshold has already been passed and one or more
 * ascensions are simply waiting on backend resolution. The bar reports that
 * state as full (100%) rather than computing a percentage against a level
 * that isn't the applied one; it never presents a pending ascension as if it
 * had already been applied.
 */

import { xpForLevel, getLevelFromXP, MAX_LEVEL } from "@/lib/rules/progression";

interface XPProgressBarProps {
  xp: number;
  level: number;
}

export default function XPProgressBar({ xp, level }: XPProgressBarProps) {
  const isMaxLevel = level >= MAX_LEVEL;
  const targetLevel = getLevelFromXP(xp);
  const pendingLevels = Math.max(0, targetLevel - level);
  const hasPending = !isMaxLevel && pendingLevels > 0;

  const currentLevelFloor = xpForLevel(level);
  const nextLevelThreshold = isMaxLevel ? null : xpForLevel(level + 1);

  const fillPercent =
    isMaxLevel || hasPending
      ? 100
      : nextLevelThreshold !== null && nextLevelThreshold > currentLevelFloor
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round(
              ((xp - currentLevelFloor) / (nextLevelThreshold - currentLevelFloor)) * 100
            )
          )
        )
      : 0;

  // hasPending guarantees xp >= nextLevelThreshold (that's what "pending"
  // means), so using xp as the meter ceiling keeps valuenow === valuemax —
  // a full bar — instead of a max that valuenow would exceed.
  const meterMax = isMaxLevel ? xp : hasPending ? xp : nextLevelThreshold ?? xp;

  const pendingLabel = `${pendingLevels} Level-Up${pendingLevels === 1 ? "" : "s"} Pending`;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <span
          className="text-[10px] uppercase tracking-widest font-semibold"
          style={{ fontFamily: "var(--font-cinzel)", color: "#7A5C1E" }}
        >
          Experience
        </span>
        {isMaxLevel ? (
          <span
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ fontFamily: "var(--font-cinzel)", color: "#B38B2D" }}
          >
            Ascended
          </span>
        ) : hasPending ? (
          <span
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ fontFamily: "var(--font-cinzel)", color: "#B38B2D" }}
          >
            {pendingLabel}
          </span>
        ) : (
          <span className="text-xs tabular-nums" style={{ color: "#7A5C1E" }}>
            <span style={{ color: "#B38B2D" }}>{xp.toLocaleString()}</span>
            <span style={{ color: "#3A2E14" }}>
              {" / "}
              {nextLevelThreshold?.toLocaleString()} xp
            </span>
          </span>
        )}
      </div>

      <div
        role="meter"
        aria-valuenow={xp}
        aria-valuemin={currentLevelFloor}
        aria-valuemax={meterMax}
        aria-label={
          isMaxLevel
            ? "Experience: maximum level reached"
            : hasPending
            ? `Experience: ${xp.toLocaleString()} XP — ${pendingLevels} level-up(s) pending backend resolution (supports level ${targetLevel})`
            : `Experience: ${xp.toLocaleString()} of ${nextLevelThreshold?.toLocaleString()} XP toward level ${level + 1}`
        }
        className="relative h-2.5 overflow-hidden rounded-full"
        style={{
          background: "rgba(20,14,6,0.9)",
          border: "1px solid rgba(80,55,14,0.35)",
        }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${fillPercent}%`,
            background: "linear-gradient(90deg, #92610A, #D4A017, #E8C84A)",
            boxShadow: "0 0 8px rgba(228,168,50,0.35)",
            transition: "width 0.7s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        />
      </div>

      <p
        className="mt-1 text-right text-[10px] tabular-nums"
        style={{ color: "#3A2E14" }}
      >
        {fillPercent}%
      </p>
    </div>
  );
}
