/**
 * components/exploration/SurvivalHUD.tsx
 *
 * Read-only Dungeon Clock & Survival panel.
 *
 * Data contract ("State is Truth"):
 *   This component receives all values directly from the database (via the
 *   caller) and renders them as-is. It NEVER mutates state, calls the AI,
 *   or invents values. All display is purely derived from props.
 *
 * Renders:
 *   - Dungeon turn count and elapsed time
 *   - Turns elapsed since the party last rested (informational only)
 *   - Active light source with icon + turns remaining
 *   - Unlit torch and oil flask reserves
 *   - Ration count
 *   - Exhaustion level (hidden when 0)
 */

import React from "react";
import { REST_INTERVAL_TURNS, TURNS_PER_HOUR } from "@/lib/rules/exploration";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SurvivalHUDProps {
  totalTurns:                number;
  totalHours:                number;
  turnsSinceRest:            number;
  activeLightSource:         "torch" | "lantern" | "none";
  lightSourceTurnsRemaining: number;
  torches:                   number;
  oilFlasks:                 number;
  rations:                   number;
  exhaustionLevel:           number;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const LIGHT_ICONS: Record<"torch" | "lantern" | "none", string> = {
  torch:   "🕯️",
  lantern: "🏮",
  none:    "⬛",
};

const LIGHT_LABELS: Record<"torch" | "lantern" | "none", string> = {
  torch:   "Torch",
  lantern: "Lantern",
  none:    "Darkness",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Purely presentational HUD panel. Receives DB-fetched exploration state
 * from the caller; renders it without any side effects.
 */
export default function SurvivalHUD({
  totalTurns,
  totalHours,
  turnsSinceRest,
  activeLightSource,
  lightSourceTurnsRemaining,
  torches,
  oilFlasks,
  rations,
  exhaustionLevel,
}: SurvivalHUDProps) {
  const minutesThisHour = (totalTurns % TURNS_PER_HOUR) * 10;
  // Informational only: the exploration rest cycle carries no mechanical
  // consequence. `restOverdue` is kept solely as a neutral state hook — it must
  // not change the visible text or trigger an alarm style.
  const restOverdue     = turnsSinceRest >= REST_INTERVAL_TURNS;

  const lightIcon  = LIGHT_ICONS[activeLightSource];
  const lightLabel = LIGHT_LABELS[activeLightSource];

  return (
    <div
      className="survival-hud"
      aria-label="Dungeon Clock and Survival Status"
      data-total-turns={totalTurns}
    >
      {/* ── Dungeon Clock ── */}
      <section aria-label="Dungeon Clock">
        <span className="hud-label">Turn</span>
        <span className="hud-value" data-testid="total-turns">
          {totalTurns}
        </span>
        <span className="hud-subvalue" data-testid="elapsed-time">
          {totalHours}h {minutesThisHour}min
        </span>
      </section>

      {/* ── Rest Status ── */}
      <section aria-label="Rest Status">
        <span data-testid="rest-status" data-overdue={restOverdue ? "true" : "false"}>
          {turnsSinceRest} turn{turnsSinceRest !== 1 ? "s" : ""} since last rest
        </span>
      </section>

      {/* ── Exhaustion ── */}
      {exhaustionLevel > 0 && (
        <section aria-label="Exhaustion Level">
          <span
            className="hud-warning"
            data-testid="exhaustion"
            data-level={exhaustionLevel}
          >
            ⚠️ Exhaustion {exhaustionLevel}/6
          </span>
        </section>
      )}

      {/* ── Light Source ── */}
      <section aria-label="Light Source">
        <span data-testid="light-icon">{lightIcon}</span>
        <span data-testid="light-label">{lightLabel}</span>
        {activeLightSource !== "none" && (
          <span data-testid="light-turns-remaining">
            {lightSourceTurnsRemaining} turn{lightSourceTurnsRemaining !== 1 ? "s" : ""}
          </span>
        )}
        <span data-testid="torches">🕯️ ×{torches}</span>
        <span data-testid="oil-flasks">🏮 ×{oilFlasks}</span>
      </section>

      {/* ── Rations ── */}
      <section aria-label="Rations">
        <span className="hud-label">Rations</span>
        <span data-testid="rations">{rations}</span>
      </section>
    </div>
  );
}
