"use client";

import React, { memo } from "react";
import type { CombatConsequencePayload } from "@/lib/events/game-events";
import { hpColor, hpRatio } from "./ZoneGrid";

// ---------------------------------------------------------------------------
// Beat catalogue
// ---------------------------------------------------------------------------

export type BeatKey = "opening" | "first_blood" | "turning_point" | "climax" | "aftermath";

export const BEAT_META: Record<BeatKey, { label: string; bg: string; border: string; color: string; glyph: string }> = {
  opening:       { label: "OPENING",       glyph: "◈", bg: "rgba(20,20,42,0.95)",  border: "rgba(99,102,241,0.45)",  color: "#818CF8" },
  first_blood:   { label: "FIRST BLOOD",   glyph: "✦", bg: "rgba(58,8,8,0.95)",    border: "rgba(239,68,68,0.5)",    color: "#F87171" },
  turning_point: { label: "TURNING POINT", glyph: "⚔", bg: "rgba(58,38,0,0.95)",   border: "rgba(245,158,11,0.5)",   color: "#FCD34D" },
  climax:        { label: "CLIMAX",        glyph: "☆", bg: "rgba(38,8,58,0.95)",   border: "rgba(167,139,250,0.55)", color: "#C4B5FD" },
  aftermath:     { label: "AFTERMATH",     glyph: "☽", bg: "rgba(6,14,10,0.95)",   border: "rgba(74,222,128,0.35)",  color: "#6EE7B7" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derive current beat heuristically from consequence history. */
export function deriveBeat(
  entries: CombatConsequencePayload[],
  round: number
): BeatKey {
  if (entries.length === 0) return "opening";
  const hasKill  = entries.some((e) => e.isKill);
  const hasCrit  = entries.some((e) => e.isCrit);
  const last     = entries[0];
  if (last?.isKill || hasKill) return "aftermath";
  if (hasCrit && round >= 3) return "climax";
  if (hasCrit || round >= 2) return "turning_point";
  return "first_blood";
}

// ---------------------------------------------------------------------------
// Consequence Log Entry
// ---------------------------------------------------------------------------


export const ConsequenceEntry = memo(function ConsequenceEntry({
  entry,
  index,
}: {
  entry: CombatConsequencePayload;
  index: number;
}) {
  const isNew = index === 0;
  const targets = entry.targets && entry.targets.length > 0
    ? entry.targets
    : [{
        targetId: entry.targetId,
        targetName: entry.targetName,
        damage: entry.damage,
        hpAfter: entry.hpAfter,
        targetMaxHp: entry.targetMaxHp,
        isKill: entry.isKill,
        isCrit: entry.isCrit,
        isFumble: entry.isFumble,
        hitLocation: entry.hitLocation || "body",
        narrativeTags: entry.narrativeTags || [],
        naturalRoll: entry.naturalRoll || 10,
        conditionsApplied: [],
      }];

  const overallCrit = targets.some(t => t.isCrit);
  const overallKill = targets.some(t => t.isKill);

  return (
    <li
      style={{
        background: overallKill
          ? "rgba(30,8,8,0.85)"
          : overallCrit
          ? "rgba(22,14,38,0.85)"
          : "rgba(10,10,20,0.75)",
        border: overallKill
          ? "1px solid rgba(239,68,68,0.3)"
          : overallCrit
          ? "1px solid rgba(167,139,250,0.3)"
          : "1px solid rgba(60,46,20,0.35)",
        borderRadius: "4px",
        padding: "7px 9px",
        opacity: isNew ? 1 : Math.max(0.4, 1 - index * 0.15),
        transition: "opacity 0.4s",
        animation: isNew ? "consequence-appear 0.35s ease-out" : "none",
      }}
    >
      {/* Attacker Header */}
      <div className="flex items-center gap-1.5 mb-2 pb-1 border-b border-white/5">
        <span
          style={{
            fontFamily: "var(--font-cinzel)",
            fontSize: "0.7rem",
            color: overallCrit ? "#C4B5FD" : overallKill ? "#F87171" : "#B38B2D",
          }}
          aria-hidden="true"
        >
          {overallKill ? "☠" : overallCrit ? "✦" : "⚔"}
        </span>
        <span
          style={{
            fontFamily: "var(--font-cinzel)",
            fontSize: "0.6rem",
            fontWeight: 600,
            color: "#C49A2A",
            letterSpacing: "0.04em",
          }}
        >
          {entry.attackerName}
        </span>
        <span className="ml-2 text-[10px] text-white/30 uppercase tracking-tighter">
          Action Outcome ({targets.length} {targets.length === 1 ? "Target" : "Targets"})
        </span>
      </div>

      {/* Target List */}
      <div className="space-y-3">
        {targets.map((t, tIdx) => {
          const barPct = hpRatio(t.hpAfter, t.targetMaxHp);
          const barColor = hpColor(t.hpAfter, t.targetMaxHp);
          const visibleTags = t.narrativeTags.slice(0, 3);
          const hiddenTagCount = Math.max(0, t.narrativeTags.length - visibleTags.length);

          return (
            <div key={`${t.targetId}-${tIdx}`} className="group">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span
                  style={{
                    fontFamily: "var(--font-cinzel)",
                    fontSize: "0.6rem",
                    fontWeight: 600,
                    color: t.isKill ? "#F87171" : "#D1918A",
                    letterSpacing: "0.04em",
                  }}
                >
                  {t.targetName}
                </span>
                <span style={{ fontSize: "0.55rem", color: "rgba(179,139,45,0.4)" }}>→</span>
                <span
                  className="ml-auto shrink-0 rounded px-1.5 py-0.5"
                  style={{
                    fontFamily: "var(--font-cinzel)",
                    fontSize: "0.65rem",
                    fontWeight: 700,
                    background: t.isCrit
                      ? "rgba(124,58,237,0.25)"
                      : "rgba(60,30,6,0.6)",
                    border: t.isCrit
                      ? "1px solid rgba(167,139,250,0.35)"
                      : "1px solid rgba(179,139,45,0.3)",
                    color: t.isCrit ? "#C4B5FD" : "#E8C84A",
                  }}
                >
                  {t.damage}
                  {t.isCrit && (
                    <span
                      style={{
                        marginLeft: "3px",
                        fontSize: "0.5rem",
                        color: "#A78BFA",
                        verticalAlign: "super",
                      }}
                    >
                      CRIT
                    </span>
                  )}
                </span>
              </div>

              <div className="mt-1 flex items-center gap-2">
                <span
                  style={{
                    fontFamily: "var(--font-crimson)",
                    fontSize: "0.6rem",
                    fontStyle: "italic",
                    color: "rgba(200,184,152,0.6)",
                    width: "45px",
                    textAlign: "right"
                  }}
                >
                  {t.hitLocation}
                </span>
                <div
                  className="flex-1 h-1 rounded-full overflow-hidden"
                  style={{ background: "rgba(20,14,6,0.7)" }}
                  aria-hidden="true"
                >
                  <div
                    className="h-full w-full rounded-full motion-safe:transition-transform motion-safe:duration-500"
                    style={{
                      transform: `scaleX(${barPct})`,
                      transformOrigin: "left center",
                      background: `linear-gradient(90deg, ${barColor}77, ${barColor})`,
                    }}
                  />
                </div>
                <span
                  style={{
                    fontFamily: "var(--font-crimson)",
                    fontSize: "0.55rem",
                    color: "rgba(179,139,45,0.5)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {t.hpAfter}/{t.targetMaxHp}
                </span>
              </div>

              {t.narrativeTags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1" aria-label="Narrative tags">
                  {visibleTags.map((tag, tagIndex) => (
                    <span
                      key={`${tag}-${tagIndex}`}
                      style={{
                        fontFamily: "var(--font-crimson)",
                        fontSize: "0.5rem",
                        fontStyle: "italic",
                        color: "rgba(214,193,148,0.9)",
                        background: "rgba(42,30,10,0.6)",
                        border: "1px solid rgba(120,90,30,0.3)",
                        padding: "0px 4px",
                        borderRadius: "2px"
                      }}
                    >
                      {tag.replace(/_/g, " ")}
                    </span>
                  ))}
                  {hiddenTagCount > 0 && (
                    <span style={{ fontSize: "0.5rem", opacity: 0.5 }}>+{hiddenTagCount}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </li>
  );
});
