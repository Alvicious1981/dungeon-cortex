/**
 * components/exploration/WildernessHUD.tsx
 *
 * Read-only Wilderness & Travel Status panel.
 *
 * Data contract ("State is Truth"):
 *   This component receives all values directly from the database (via the
 *   caller) and renders them as-is. It NEVER mutates state, calls the AI,
 *   or invents values. All display is purely derived from props.
 *
 * Renders:
 *   - Current hex position (cube coordinates)
 *   - Terrain and biome
 *   - Watch name and index (Dawn / Morning / Midday / Afternoon / Evening / Night)
 *   - Day counter
 *   - Weather condition and intensity
 *   - Party pace
 *   - Ration count
 *   - Feature present indicator (conditional)
 */

import React from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WildernessHUDProps {
  currentQ:         number;
  currentR:         number;
  terrain:          string;
  biome:            string;
  watchIndex:       number;
  totalDays:        number;
  weatherCondition: string;
  weatherIntensity: number;
  partyPace:        string;
  rations:          number;
  featureHere:      boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WATCH_NAMES = ["Dawn", "Morning", "Midday", "Afternoon", "Evening", "Night"] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Purely presentational HUD panel. Receives DB-fetched travel state from
 * the caller; renders it without any side effects.
 */
export default function WildernessHUD({
  currentQ,
  currentR,
  terrain,
  biome,
  watchIndex,
  totalDays,
  weatherCondition,
  weatherIntensity,
  partyPace,
  rations,
  featureHere,
}: WildernessHUDProps) {
  const watchName = WATCH_NAMES[watchIndex] ?? "Unknown";

  return (
    <div
      className="wilderness-hud"
      aria-label="Wilderness and Travel Status"
      data-watch-index={watchIndex}
    >
      {/* ── Hex Position ── */}
      <section aria-label="Hex Position">
        <span className="hud-label">Position</span>
        <span className="hud-value" data-testid="hex-position">
          ({currentQ}, {currentR})
        </span>
      </section>

      {/* ── Terrain & Biome ── */}
      <section aria-label="Terrain">
        <span data-testid="terrain">{terrain}</span>
        <span className="hud-subvalue">{biome}</span>
      </section>

      {/* ── Watch & Day ── */}
      <section aria-label="Watch and Day">
        <span className="hud-label">Watch</span>
        <span className="hud-value" data-testid="watch-name">
          {watchName}
        </span>
        <span className="hud-subvalue" data-testid="watch-index">
          {watchIndex + 1}/6
        </span>
        <span data-testid="total-days">Day {totalDays}</span>
      </section>

      {/* ── Weather ── */}
      <section aria-label="Weather">
        <span className="hud-label">Weather</span>
        <span data-testid="weather">{weatherCondition}</span>
        <span data-testid="weather-intensity" data-intensity={weatherIntensity}>
          {weatherIntensity > 0 ? `(Intensity ${weatherIntensity})` : ""}
        </span>
      </section>

      {/* ── Pace & Rations ── */}
      <section aria-label="Travel Pace and Rations">
        <span className="hud-label">Pace</span>
        <span data-testid="party-pace">{partyPace}</span>
        <span className="hud-label">Rations</span>
        <span data-testid="rations">{rations}</span>
      </section>

      {/* ── Feature (conditional) ── */}
      {featureHere && (
        <section aria-label="Feature Present">
          <span
            className="hud-highlight"
            data-testid="feature"
          >
            Notable feature present
          </span>
        </section>
      )}
    </div>
  );
}
