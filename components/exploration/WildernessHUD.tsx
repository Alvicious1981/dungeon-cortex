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
import { 
  MapPin, 
  Trees, 
  Mountain, 
  Waves, 
  Cloud, 
  Sun, 
  Sunrise, 
  Sunset, 
  Moon, 
  CloudRain, 
  Zap, 
  CloudSnow, 
  CloudFog, 
  Footprints, 
  Beef,
  Star
} from "lucide-react";

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
// Constants & Helpers
// ---------------------------------------------------------------------------

const WATCH_DATA = [
  { name: "Dawn",      icon: Sunrise, color: "var(--color-dawn)" },
  { name: "Morning",   icon: Sun,     color: "var(--color-morning)" },
  { name: "Midday",    icon: Sun,     color: "var(--color-day)" },
  { name: "Afternoon", icon: Sun,     color: "var(--color-afternoon)" },
  { name: "Evening",   icon: Sunset,  color: "var(--color-evening)" },
  { name: "Night",     icon: Moon,    color: "var(--color-night)" },
] as const;

const WEATHER_ICONS: Record<string, React.ElementType> = {
  clear:  Sun,
  rain:   CloudRain,
  storm:  Zap,
  snow:   CloudSnow,
  fog:    CloudFog,
  cloudy: Cloud,
};

const TERRAIN_ICONS: Record<string, React.ElementType> = {
  forest:   Trees,
  mountain: Mountain,
  coast:    Waves,
  plains:   Trees, // Or Map icon
  swamp:    CloudFog,
  desert:   Sun,
  tundra:   CloudSnow,
  taiga:    Trees,
  hills:    Mountain,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Premium Wilderness & Travel Status HUD.
 * Renders a glassmorphic panel with dynamic icons and real-time state.
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
  const watch = WATCH_DATA[watchIndex] ?? WATCH_DATA[0];
  const WatchIcon = watch.icon;
  const WeatherIcon = WEATHER_ICONS[weatherCondition] || Cloud;
  const TerrainIcon = TERRAIN_ICONS[terrain] || MapPin;

  return (
      <div
        className="wilderness-hud"
        aria-label="Wilderness and Travel Status"
        data-watch-index={watchIndex}
      >
        <style>{`
          .wilderness-hud {
            --glass-bg: rgba(15, 15, 20, 0.75);
            --glass-border: rgba(255, 255, 255, 0.1);
            --accent-gold: #eab308;
            --accent-blue: #3b82f6;
            --accent-red: #ef4444;
            --color-dawn: #f59e0b;
            --color-morning: #fbbf24;
            --color-day: #fbbf24;
            --color-afternoon: #f59e0b;
            --color-evening: #fb7185;
            --color-night: #818cf8;

            position: fixed;
            top: 1rem;
            right: 1rem;
            width: 320px;
            background: var(--glass-bg);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid var(--glass-border);
            border-radius: 12px;
            padding: 1.25rem;
            color: #f8fafc;
            font-family: 'Inter', system-ui, sans-serif;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
            display: flex;
            flex-direction: column;
            gap: 1rem;
            z-index: 1000;
            animation: hud-slide-in 0.4s cubic-bezier(0.16, 1, 0.3, 1);
          }

          @keyframes hud-slide-in {
            from { opacity: 0; transform: translateX(20px); }
            to { opacity: 1; transform: translateX(0); }
          }

          .hud-section {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            padding-bottom: 0.75rem;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          }

          .hud-section:last-child {
            border-bottom: none;
            padding-bottom: 0;
          }

          .hud-icon-wrapper {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 36px;
            height: 36px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 8px;
            color: var(--accent-gold);
          }

          .hud-content {
            display: flex;
            flex-direction: column;
            flex: 1;
          }

          .hud-label {
            font-size: 0.7rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #94a3b8;
            font-weight: 600;
          }

          .hud-value {
            font-size: 0.95rem;
            font-weight: 500;
            color: #f1f5f9;
          }

          .hud-subvalue {
            font-size: 0.75rem;
            color: #64748b;
          }

          .badge-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 0.5rem;
            margin-top: 0.25rem;
          }

          .hud-badge {
            display: flex;
            align-items: center;
            gap: 0.4rem;
            background: rgba(255, 255, 255, 0.05);
            padding: 0.25rem 0.5rem;
            border-radius: 6px;
            font-size: 0.75rem;
            border: 1px solid rgba(255, 255, 255, 0.05);
          }

          .hud-highlight {
            color: var(--accent-gold);
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            animation: pulse 2s infinite;
          }

          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
          }

          [data-intensity="1"] { color: #fde047; }
          [data-intensity="2"] { color: #fbbf24; }
          [data-intensity="3"] { color: #f59e0b; }
        `}</style>

        {/* ── Header: Location & Hex ── */}
        <section className="hud-section" aria-label="Hex Position">
          <div className="hud-icon-wrapper">
            <TerrainIcon size={20} />
          </div>
          <div className="hud-content">
            <span className="hud-label">Position</span>
            <div className="hud-value">
              <span data-testid="hex-position">({currentQ}, {currentR})</span>
              <span className="mx-2 text-slate-600">•</span>
              <span data-testid="terrain" style={{ textTransform: 'capitalize' }}>{terrain}</span>
            </div>
            <span className="hud-subvalue">{biome}</span>
          </div>
        </section>

        {/* ── Time: Watch & Day ── */}
        <section className="hud-section" aria-label="Watch and Day">
          <div className="hud-icon-wrapper" style={{ color: watch.color }}>
            <WatchIcon size={20} />
          </div>
          <div className="hud-content">
            <span className="hud-label">Watch</span>
            <div className="hud-value flex items-center justify-between">
              <span data-testid="watch-name">{watch.name}</span>
              <span className="hud-subvalue" data-testid="watch-index">
                {watchIndex + 1}/6
              </span>
            </div>
            <span className="hud-subvalue" data-testid="total-days">Day {totalDays}</span>
          </div>
        </section>

        {/* ── Weather ── */}
        <section className="hud-section" aria-label="Weather">
          <div className="hud-icon-wrapper" style={{ color: "var(--accent-blue)" }}>
            <WeatherIcon size={20} />
          </div>
          <div className="hud-content">
            <span className="hud-label">Weather</span>
            <div className="hud-value flex items-center gap-2">
              <span data-testid="weather" style={{ textTransform: 'capitalize' }}>{weatherCondition}</span>
              <span 
                data-testid="weather-intensity" 
                data-intensity={weatherIntensity}
                className="text-xs font-bold"
              >
                {weatherIntensity > 0 ? `Intensity ${weatherIntensity}` : ""}
              </span>
            </div>
          </div>
        </section>

        {/* ── Survival Stats ── */}
        <section className="hud-section" aria-label="Travel Pace and Rations">
          <div className="badge-grid w-full">
            <div className="hud-badge">
              <Footprints size={14} className="text-slate-400" />
              <span className="text-slate-500 uppercase text-[10px] font-bold">Pace</span>
              <span data-testid="party-pace" className="ml-auto font-medium">{partyPace}</span>
            </div>
            <div className="hud-badge">
              <Beef size={14} className="text-slate-400" />
              <span className="text-slate-500 uppercase text-[10px] font-bold">Food</span>
              <span data-testid="rations" className="ml-auto font-medium">{rations}</span>
            </div>
          </div>
        </section>

        {/* ── Feature (conditional) ── */}
        {featureHere && (
          <section className="hud-section" aria-label="Feature Present">
            <div className="hud-highlight" data-testid="feature">
              <Star size={16} fill="currentColor" />
              <span>Notable feature nearby</span>
            </div>
          </section>
        )}
      </div>
  );
}
