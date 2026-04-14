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
 */

import { xpForLevel, MAX_LEVEL } from "@/lib/rules/progression";

interface XPProgressBarProps {
  xp: number;
  level: number;
}

export default function XPProgressBar({ xp, level }: XPProgressBarProps) {
  const isMaxLevel = level >= MAX_LEVEL;
  const currentLevelFloor = xpForLevel(level);
  const nextLevelThreshold = isMaxLevel ? null : xpForLevel(level + 1);

  const fillPercent = isMaxLevel
    ? 100
    : nextLevelThreshold !== null && nextLevelThreshold > currentLevelFloor
    ? Math.min(
        100,
        Math.round(
          ((xp - currentLevelFloor) / (nextLevelThreshold - currentLevelFloor)) * 100
        )
      )
    : 0;

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
        aria-valuemax={nextLevelThreshold ?? xp}
        aria-label={
          isMaxLevel
            ? "Experience: maximum level reached"
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
