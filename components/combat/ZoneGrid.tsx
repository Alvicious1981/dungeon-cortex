"use client";

import React, { memo, useMemo } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CombatantData {
  id: string;
  name: string;
  isPlayer: boolean;
  hp: number;
  maxHp: number;
  ac: number;
  initiativeTotal: number;
  x: number;
  y: number;
  size: string;
}

export interface ZoneData {
  id: string;
  name: string;
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function hpColor(hp: number, maxHp: number): string {
  const pct = maxHp > 0 ? hp / maxHp : 1;
  if (pct <= 0.25) return "#EF4444";
  if (pct <= 0.5)  return "#F59E0B";
  return "#4ADE80";
}

export function hpRatio(hp: number, maxHp: number): number {
  if (maxHp <= 0) return 0;
  return Math.min(1, Math.max(0, hp / maxHp));
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

export const CombatantToken = memo(function CombatantToken({
  combatant,
  isActive,
}: {
  combatant: CombatantData;
  isActive: boolean;
}) {
  const pct  = hpRatio(combatant.hp, combatant.maxHp);
  const bar  = hpColor(combatant.hp, combatant.maxHp);
  const dead = combatant.hp <= 0;

  const tokenGradient = combatant.isPlayer
    ? dead
      ? "radial-gradient(circle at 35% 30%, #6B7280, #374151)"
      : "radial-gradient(circle at 35% 30%, #F59E0B, #78350F)"
    : dead
    ? "radial-gradient(circle at 35% 30%, #6B7280, #1F2937)"
    : "radial-gradient(circle at 35% 30%, #DC2626, #7F1D1D)";

  const ringBorder = isActive
    ? "2px solid #F59E0B"
    : combatant.isPlayer
    ? "1px solid rgba(245,158,11,0.4)"
    : "1px solid rgba(239,68,68,0.35)";

  return (
    <div
      className="flex flex-col items-center gap-1"
      aria-label={`${combatant.name}${isActive ? " — current turn" : ""}${dead ? " — defeated" : ""}`}
      style={{ opacity: dead ? 0.45 : 1 }}
    >
      {/* Token medallion */}
      <div
        className="relative flex h-11 w-11 items-center justify-center rounded-full"
        style={{
          background: tokenGradient,
          border: ringBorder,
          boxShadow: isActive
            ? "0 0 0 3px rgba(245,158,11,0.2), 0 0 16px rgba(245,158,11,0.3)"
            : combatant.isPlayer
            ? "0 2px 8px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,220,80,0.15)"
            : "0 2px 8px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,80,80,0.1)",
        }}
      >
        {/* Initials */}
        <span
          style={{
            fontFamily: "var(--font-cinzel)",
            fontSize: "0.625rem",
            fontWeight: 700,
            color: dead ? "#6B7280" : combatant.isPlayer ? "#FEF3C7" : "#FEE2E2",
            letterSpacing: "0.05em",
            lineHeight: 1,
          }}
        >
          {initials(combatant.name)}
        </span>

        {/* AC badge — small diamond in bottom-right */}
        <span
          aria-label={`AC ${combatant.ac}`}
          className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-sm"
          style={{
            background: "rgba(10,10,18,0.92)",
            border: "1px solid rgba(179,139,45,0.5)",
            boxShadow: "0 1px 4px rgba(0,0,0,0.6)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-cinzel)",
              fontSize: "0.45rem",
              fontWeight: 700,
              color: "#B38B2D",
              lineHeight: 1,
            }}
          >
            {combatant.ac}
          </span>
        </span>

        {/* Active-turn pulse ring */}
        {isActive && (
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full motion-safe:animate-ping"
            style={{
              border: "2px solid rgba(245,158,11,0.5)",
              animationDuration: "1.6s",
            }}
          />
        )}
      </div>

      {/* Name */}
      <span
        className="max-w-[56px] truncate text-center leading-none"
        style={{
          fontFamily: "var(--font-cinzel)",
          fontSize: "0.55rem",
          fontWeight: 600,
          color: combatant.isPlayer ? "#C49A2A" : "#D1918A",
          letterSpacing: "0.04em",
        }}
        title={combatant.name}
      >
        {combatant.name}
      </span>

      {/* HP bar */}
      <div
        role="meter"
        aria-valuenow={combatant.hp}
        aria-valuemin={0}
        aria-valuemax={combatant.maxHp}
        aria-label={`${combatant.hp} / ${combatant.maxHp} HP`}
        className="h-1 w-11 overflow-hidden rounded-full"
        style={{
          background: "rgba(20,14,6,0.8)",
          border: "1px solid rgba(60,40,10,0.5)",
        }}
      >
        <div
          className="h-full w-full rounded-full motion-safe:transition-transform motion-safe:duration-700"
          style={{
            transform: `scaleX(${pct})`,
            transformOrigin: "left center",
            background: `linear-gradient(90deg, ${bar}88, ${bar})`,
            boxShadow: `0 0 4px ${bar}66`,
          }}
        />
      </div>

      {/* HP numbers */}
      <span
        className="tabular-nums leading-none"
        style={{
          fontFamily: "var(--font-crimson)",
          fontSize: "0.625rem",
          color: dead ? "#4B5563" : bar,
        }}
      >
        {combatant.hp}/{combatant.maxHp}
      </span>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Zone Grid
// ---------------------------------------------------------------------------

export const ZoneGrid = memo(function ZoneGrid({
  zones,
  combatants,
  activeCombatantId,
}: {
  zones: ZoneData[];
  combatants: CombatantData[];
  activeCombatantId?: string;
}) {
  const { minX, minY, cols, rows } = useMemo(() => {
    const xs = zones.map((z) => z.x);
    const ys = zones.map((z) => z.y);
    const minX = xs.length > 0 ? Math.min(...xs) : 0;
    const minY = ys.length > 0 ? Math.min(...ys) : 0;
    const cols = xs.length > 0 ? Math.max(...xs) - minX + 1 : 1;
    const rows = ys.length > 0 ? Math.max(...ys) - minY + 1 : 1;
    return { minX, minY, cols, rows };
  }, [zones]);

  const occupantsByZone = useMemo(() => {
    const byZone = new Map<string, CombatantData[]>();
    for (const combatant of combatants) {
      const key = `${combatant.x},${combatant.y}`;
      const existing = byZone.get(key);
      if (existing) {
        existing.push(combatant);
      } else {
        byZone.set(key, [combatant]);
      }
    }
    return byZone;
  }, [combatants]);

  return (
    <div
      data-testid="zone-grid"
      className="overflow-auto rounded-lg p-1"
      style={{
        background: "rgba(6,6,14,0.85)",
        border: "1px solid rgba(179,139,45,0.2)",
        maxHeight: "260px",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, minmax(80px, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(96px, 1fr))`,
          gap: "2px",
        }}
      >
        {zones.map((zone) => {
          const col = zone.x - minX + 1;
          const row = zone.y - minY + 1;
          const occupants = occupantsByZone.get(`${zone.x},${zone.y}`) ?? [];

          return (
            <div
              key={zone.id}
              style={{
                gridColumn: col,
                gridRow: row,
                background: "rgba(12,10,22,0.92)",
                border: "1px solid rgba(179,139,45,0.18)",
                borderRadius: "4px",
                padding: "6px 4px 4px",
                position: "relative",
                minHeight: "96px",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 3,
                  left: 5,
                  fontFamily: "var(--font-cinzel)",
                  fontSize: "0.45rem",
                  fontWeight: 600,
                  color: "rgba(179,139,45,0.55)",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  pointerEvents: "none",
                }}
              >
                {zone.name}
              </span>

              <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                {occupants.map((c) => (
                  <CombatantToken
                    key={c.id}
                    combatant={c}
                    isActive={c.id === activeCombatantId}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Abstract Arena
// ---------------------------------------------------------------------------

export const AbstractArena = memo(function AbstractArena({
  combatants,
  activeCombatantId,
}: {
  combatants: CombatantData[];
  activeCombatantId?: string;
}) {
  const { players, enemies } = useMemo(() => {
    const players = combatants.filter((c) => c.isPlayer);
    const enemies = combatants.filter((c) => !c.isPlayer);
    return { players, enemies };
  }, [combatants]);

  return (
    <div
      className="relative overflow-hidden rounded-lg"
      style={{
        background:
          "radial-gradient(ellipse 90% 60% at 50% 50%, rgba(12,8,20,0.98) 0%, rgba(6,6,14,0.99) 100%)",
        border: "1px solid rgba(179,139,45,0.18)",
        minHeight: "160px",
        padding: "16px 12px",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          fontFamily: "var(--font-cinzel)",
          fontSize: "1.5rem",
          color: "rgba(179,139,45,0.06)",
          userSelect: "none",
          pointerEvents: "none",
        }}
      >
        ⚔
      </div>

      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "50%",
          top: "16px",
          bottom: "16px",
          width: "1px",
          background:
            "linear-gradient(to bottom, transparent, rgba(179,139,45,0.15) 30%, rgba(179,139,45,0.15) 70%, transparent)",
        }}
      />

      <div className="flex items-start justify-around gap-4">
        <div className="flex flex-col items-center gap-1">
          <span
            style={{
              fontFamily: "var(--font-cinzel)",
              fontSize: "0.45rem",
              fontWeight: 700,
              color: "rgba(245,158,11,0.45)",
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              marginBottom: "4px",
            }}
          >
            Party
          </span>
          <div className="flex flex-wrap justify-center gap-3">
            {players.map((c) => (
              <CombatantToken
                key={c.id}
                combatant={c}
                isActive={c.id === activeCombatantId}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col items-center gap-1">
          <span
            style={{
              fontFamily: "var(--font-cinzel)",
              fontSize: "0.45rem",
              fontWeight: 700,
              color: "rgba(239,68,68,0.45)",
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              marginBottom: "4px",
            }}
          >
            Enemies
          </span>
          <div className="flex flex-wrap justify-center gap-3">
            {enemies.map((c) => (
              <CombatantToken
                key={c.id}
                combatant={c}
                isActive={c.id === activeCombatantId}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});
