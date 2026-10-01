"use client";

import React, { memo } from "react";
import type { CombatConsequencePayload } from "@/lib/events/game-events";
import { conditionLabel } from "@/lib/character-sheet/condition-labels";

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
  const hasKill = entries.some((entry) =>
    entry.targets.some((target) => target.isKill)
  );
  const hasCrit = entries.some((entry) =>
    entry.targets.some((target) => target.isCrit)
  );
  const latestHasKill = entries[0]?.targets.some((target) => target.isKill);
  if (latestHasKill || hasKill) return "aftermath";
  if (hasCrit && round >= 3) return "climax";
  if (hasCrit || round >= 2) return "turning_point";
  return "first_blood";
}

// ---------------------------------------------------------------------------
// Consequence Log Entry
// ---------------------------------------------------------------------------


export const ConsequenceEntry = memo(function ConsequenceEntry({
  entry,
}: {
  entry: CombatConsequencePayload;
  index: number;
}) {
  return (
    <li className="rounded border border-amber-900/40 bg-black/15 px-3 py-2 text-sm text-neutral-200">
      <p className="mb-1 font-semibold text-amber-200">{entry.attackerName}</p>
      <div className="space-y-2">
        {entry.targets.map((target, index) => (
          <div key={`${target.targetId}-${index}`} className="space-y-1">
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-medium">{target.targetName}</span>
              <span>{target.damage} de daño</span>
              <span className="tabular-nums">{target.hpAfter}/{target.targetMaxHp} PG</span>
              {target.isCrit && <strong className="text-violet-300">Crítico</strong>}
              {target.isFumble && <strong className="text-orange-300">Pifia</strong>}
              {target.isKill && <strong className="text-red-300">Derrotado</strong>}
            </p>
            {target.conditionsApplied.length > 0 && (
              <p className="text-neutral-300">Condiciones aplicadas: {target.conditionsApplied.map(conditionLabel).join(", ")}</p>
            )}
          </div>
        ))}
      </div>
    </li>
  );
});
