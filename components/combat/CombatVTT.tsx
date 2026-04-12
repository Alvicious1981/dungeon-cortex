"use client";

/**
 * components/combat/CombatVTT.tsx
 *
 * Iron Grimoire Virtual Table Top — renders the active encounter as a
 * diegetic battle map torn from a dungeon scribe's journal.
 *
 * Design language:
 *   • Zone cells — inked battle-map panels on dark vellum
 *   • Tokens     — embossed wax-seal medallions (PC=amber, Enemy=crimson)
 *   • HP bar     — thin scribe's rule, CSS-transitioned on depletion
 *   • Consequence log — blood-ink marginalia scrolling from newest to oldest
 *   • Combat Beat — atmospheric banner driven by consequence events
 *
 * Data contract:
 *   • Static encounter state is server-fetched, passed as props.
 *   • Live consequence data arrives via `dungeon-game-event` (COMBAT_CONSEQUENCE).
 *   • Never performs state mutations — display only.
 */

import { useEffect, useState } from "react";
import type { CombatConsequencePayload } from "@/lib/events/game-events";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CombatantData {
  id: string;
  name: string;
  isPlayer: boolean;
  hp: number;
  maxHp: number;
  ac: number;
  initiativeTotal: number;
  zoneId: string | null;
}

interface ZoneData {
  id: string;
  name: string;
  x: number;
  y: number;
}

interface EncounterData {
  id: string;
  round: number;
  currentTurnIndex: number;
  combatants: CombatantData[];
  zones: ZoneData[];
}

interface Props {
  encounter: EncounterData;
}

// ---------------------------------------------------------------------------
// Beat catalogue
// ---------------------------------------------------------------------------

type BeatKey = "opening" | "first_blood" | "turning_point" | "climax" | "aftermath";

const BEAT_META: Record<BeatKey, { label: string; bg: string; border: string; color: string; glyph: string }> = {
  opening:       { label: "OPENING",       glyph: "◈", bg: "rgba(20,20,42,0.95)",  border: "rgba(99,102,241,0.45)",  color: "#818CF8" },
  first_blood:   { label: "FIRST BLOOD",   glyph: "✦", bg: "rgba(58,8,8,0.95)",    border: "rgba(239,68,68,0.5)",    color: "#F87171" },
  turning_point: { label: "TURNING POINT", glyph: "⚔", bg: "rgba(58,38,0,0.95)",   border: "rgba(245,158,11,0.5)",   color: "#FCD34D" },
  climax:        { label: "CLIMAX",        glyph: "☆", bg: "rgba(38,8,58,0.95)",   border: "rgba(167,139,250,0.55)", color: "#C4B5FD" },
  aftermath:     { label: "AFTERMATH",     glyph: "☽", bg: "rgba(6,14,10,0.95)",   border: "rgba(74,222,128,0.35)",  color: "#6EE7B7" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hpColor(hp: number, maxHp: number): string {
  const pct = maxHp > 0 ? hp / maxHp : 1;
  if (pct <= 0.25) return "#EF4444";
  if (pct <= 0.5)  return "#F59E0B";
  return "#4ADE80";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Derive current beat heuristically from consequence history. */
function deriveBeat(
  entries: CombatConsequencePayload[],
  round: number
): BeatKey {
  if (entries.length === 0) return "opening";
  const hasKill  = entries.some((e) => e.isKill);
  const hasCrit  = entries.some((e) => e.isCrit);
  const last     = entries[0];
  if (last?.isKill) return "aftermath";
  if (hasCrit && round >= 3) return "climax";
  if (hasCrit || round >= 2) return "turning_point";
  if (hasKill) return "aftermath";
  if (entries.length > 0) return "first_blood";
  return "opening";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CombatantToken({
  combatant,
  isActive,
}: {
  combatant: CombatantData;
  isActive: boolean;
}) {
  const pct  = combatant.maxHp > 0 ? Math.max(0, combatant.hp / combatant.maxHp) : 0;
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
          className="h-full rounded-full motion-safe:transition-all motion-safe:duration-700"
          style={{
            width: `${Math.round(pct * 100)}%`,
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
}

// ---------------------------------------------------------------------------
// Zone Grid (rendered when zones exist)
// ---------------------------------------------------------------------------

function ZoneGrid({
  zones,
  combatants,
  activeCombatantId,
}: {
  zones: ZoneData[];
  combatants: CombatantData[];
  activeCombatantId?: string;
}) {
  const xs = zones.map((z) => z.x);
  const ys = zones.map((z) => z.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const cols = Math.max(...xs) - minX + 1;
  const rows = Math.max(...ys) - minY + 1;

  return (
    <div
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
          const occupants = combatants.filter((c) => c.zoneId === zone.id);

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
              {/* Zone name — top-left corner, superscript style */}
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

              {/* Occupant tokens */}
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
}

// ---------------------------------------------------------------------------
// Abstract Arena (rendered when no zones exist)
// ---------------------------------------------------------------------------

function AbstractArena({
  combatants,
  activeCombatantId,
}: {
  combatants: CombatantData[];
  activeCombatantId?: string;
}) {
  const players = combatants.filter((c) => c.isPlayer);
  const enemies = combatants.filter((c) => !c.isPlayer);

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
      {/* Decorative crossed-axes glyph — centred divider */}
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

      {/* Thin divider line */}
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
        {/* Players side */}
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

        {/* Enemies side */}
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
}

// ---------------------------------------------------------------------------
// Consequence Log Entry
// ---------------------------------------------------------------------------

function ConsequenceEntry({ entry, index }: { entry: CombatConsequencePayload; index: number }) {
  const isNew = index === 0;
  const barPct = entry.targetMaxHp > 0
    ? Math.max(0, entry.hpAfter / entry.targetMaxHp)
    : 0;
  const barColor = hpColor(entry.hpAfter, entry.targetMaxHp);

  return (
    <li
      style={{
        background: entry.isKill
          ? "rgba(30,8,8,0.85)"
          : entry.isCrit
          ? "rgba(22,14,38,0.85)"
          : "rgba(10,10,20,0.75)",
        border: entry.isKill
          ? "1px solid rgba(239,68,68,0.3)"
          : entry.isCrit
          ? "1px solid rgba(167,139,250,0.3)"
          : "1px solid rgba(60,46,20,0.35)",
        borderRadius: "4px",
        padding: "7px 9px",
        opacity: isNew ? 1 : Math.max(0.4, 1 - index * 0.15),
        transition: "opacity 0.4s",
        animation: isNew ? "consequence-appear 0.35s ease-out" : "none",
      }}
    >
      {/* Header row: glyph · attacker → target · damage */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span
          style={{
            fontFamily: "var(--font-cinzel)",
            fontSize: "0.7rem",
            color: entry.isCrit ? "#C4B5FD" : entry.isKill ? "#F87171" : "#B38B2D",
          }}
          aria-hidden="true"
        >
          {entry.isKill ? "☠" : entry.isCrit ? "✦" : "⚔"}
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
        <span style={{ fontSize: "0.55rem", color: "rgba(179,139,45,0.4)" }}>→</span>
        <span
          style={{
            fontFamily: "var(--font-cinzel)",
            fontSize: "0.6rem",
            fontWeight: 600,
            color: entry.isKill ? "#F87171" : "#D1918A",
            letterSpacing: "0.04em",
          }}
        >
          {entry.targetName}
        </span>
        {/* Damage pill */}
        <span
          className="ml-auto shrink-0 rounded px-1.5 py-0.5"
          style={{
            fontFamily: "var(--font-cinzel)",
            fontSize: "0.65rem",
            fontWeight: 700,
            background: entry.isCrit
              ? "rgba(124,58,237,0.25)"
              : "rgba(60,30,6,0.6)",
            border: entry.isCrit
              ? "1px solid rgba(167,139,250,0.35)"
              : "1px solid rgba(179,139,45,0.3)",
            color: entry.isCrit ? "#C4B5FD" : "#E8C84A",
          }}
        >
          {entry.damage}
          {entry.isCrit && (
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

      {/* Hit location + HP bar */}
      <div className="mt-1.5 flex items-center gap-2">
        <span
          style={{
            fontFamily: "var(--font-crimson)",
            fontSize: "0.7rem",
            fontStyle: "italic",
            color: "rgba(200,184,152,0.6)",
            letterSpacing: "0.02em",
          }}
        >
          {entry.hitLocation}
        </span>
        {/* Remaining HP rail */}
        <div
          className="flex-1 h-1 rounded-full overflow-hidden"
          style={{ background: "rgba(20,14,6,0.7)" }}
          aria-hidden="true"
        >
          <div
            className="h-full rounded-full motion-safe:transition-all motion-safe:duration-500"
            style={{
              width: `${Math.round(barPct * 100)}%`,
              background: `linear-gradient(90deg, ${barColor}77, ${barColor})`,
            }}
          />
        </div>
        <span
          style={{
            fontFamily: "var(--font-crimson)",
            fontSize: "0.625rem",
            color: "rgba(179,139,45,0.5)",
            tabularNums: true,
            letterSpacing: "0.02em",
          } as React.CSSProperties}
        >
          {entry.hpAfter}/{entry.targetMaxHp}
        </span>
      </div>

      {/* Narrative tag pills */}
      {entry.narrativeTags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1" aria-label="Narrative tags">
          {entry.narrativeTags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              style={{
                fontFamily: "var(--font-crimson)",
                fontSize: "0.575rem",
                fontStyle: "italic",
                color: "rgba(165,150,110,0.65)",
                background: "rgba(30,22,8,0.6)",
                border: "1px solid rgba(80,60,20,0.35)",
                borderRadius: "3px",
                padding: "1px 5px",
                letterSpacing: "0.03em",
              }}
            >
              {tag.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function CombatVTT({ encounter }: Props) {
  const [consequences, setConsequences] = useState<CombatConsequencePayload[]>([]);

  // Sorted by initiative descending (server already sorts this way)
  const activeCombatant = encounter.combatants[encounter.currentTurnIndex];
  const beat = deriveBeat(consequences, encounter.round);
  const beatMeta = BEAT_META[beat];

  useEffect(() => {
    function onGameEvent(e: Event) {
      const ev = (e as CustomEvent<{ event: { type: string; payload: unknown } }>).detail.event;
      if (ev.type === "COMBAT_CONSEQUENCE") {
        setConsequences((prev) =>
          [ev.payload as CombatConsequencePayload, ...prev].slice(0, 8)
        );
      }
    }

    window.addEventListener("dungeon-game-event", onGameEvent);
    return () => window.removeEventListener("dungeon-game-event", onGameEvent);
  }, []);

  return (
    <section
      aria-label="Field of battle"
      style={{
        background: "rgba(8,8,18,0.96)",
        border: "1px solid rgba(179,139,45,0.22)",
        borderRadius: "8px",
        overflow: "hidden",
        boxShadow:
          "0 4px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,220,80,0.04)",
      }}
    >
      {/* ── Keyframe injection ── */}
      <style>{`
        @keyframes consequence-appear {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* ── Header ── */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
        style={{
          background: "rgba(6,6,12,0.92)",
          borderBottom: "1px solid rgba(179,139,45,0.14)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            style={{
              fontFamily: "var(--font-cinzel)",
              fontSize: "0.65rem",
              color: "rgba(179,139,45,0.4)",
            }}
          >
            ⚔
          </span>
          <h2
            style={{
              fontFamily: "var(--font-cinzel)",
              fontSize: "0.625rem",
              fontWeight: 700,
              color: "#C49A2A",
              letterSpacing: "0.25em",
              textTransform: "uppercase",
            }}
          >
            Field of Battle
          </h2>
          <span
            style={{
              fontFamily: "var(--font-cinzel)",
              fontSize: "0.55rem",
              color: "rgba(179,139,45,0.45)",
              letterSpacing: "0.1em",
            }}
          >
            Round {encounter.round}
          </span>
        </div>

        {/* Combat Beat badge */}
        <span
          aria-label={`Combat phase: ${beatMeta.label}`}
          className="inline-flex items-center gap-1 rounded px-2 py-0.5"
          style={{
            background: beatMeta.bg,
            border: `1px solid ${beatMeta.border}`,
            boxShadow: `0 0 8px ${beatMeta.border}`,
            transition: "background 0.6s, border-color 0.6s, box-shadow 0.6s",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              fontFamily: "var(--font-cinzel)",
              fontSize: "0.6rem",
              color: beatMeta.color,
            }}
          >
            {beatMeta.glyph}
          </span>
          <span
            style={{
              fontFamily: "var(--font-cinzel)",
              fontSize: "0.5rem",
              fontWeight: 700,
              color: beatMeta.color,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
            }}
          >
            {beatMeta.label}
          </span>
        </span>
      </div>

      {/* ── Body ── */}
      <div className="p-3 space-y-3">

        {/* Zone grid or abstract arena */}
        {encounter.zones.length > 0 ? (
          <ZoneGrid
            zones={encounter.zones}
            combatants={encounter.combatants}
            activeCombatantId={activeCombatant?.id}
          />
        ) : (
          <AbstractArena
            combatants={encounter.combatants}
            activeCombatantId={activeCombatant?.id}
          />
        )}

        {/* Active turn ribbon */}
        {activeCombatant && (
          <div
            className="flex items-center gap-2 rounded px-3 py-1.5"
            style={{
              background: "rgba(60,38,6,0.55)",
              border: "1px solid rgba(245,158,11,0.22)",
            }}
          >
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full motion-safe:animate-pulse"
              style={{ background: "#F59E0B", boxShadow: "0 0 6px #F59E0B" }}
            />
            <span
              style={{
                fontFamily: "var(--font-cinzel)",
                fontSize: "0.55rem",
                fontWeight: 700,
                color: "rgba(245,158,11,0.55)",
                letterSpacing: "0.15em",
                textTransform: "uppercase",
              }}
            >
              Current Turn
            </span>
            <span
              style={{
                fontFamily: "var(--font-cinzel)",
                fontSize: "0.65rem",
                fontWeight: 700,
                color: "#F59E0B",
                letterSpacing: "0.05em",
              }}
            >
              {activeCombatant.name}
            </span>
            <span
              style={{
                marginLeft: "auto",
                fontFamily: "var(--font-crimson)",
                fontSize: "0.65rem",
                fontStyle: "italic",
                color: "rgba(179,139,45,0.5)",
              }}
            >
              Initiative {activeCombatant.initiativeTotal}
            </span>
          </div>
        )}

        {/* ── Combat Consequence Log ── */}
        <div>
          <div
            className="flex items-center gap-2 mb-2"
            style={{ borderBottom: "1px solid rgba(60,40,14,0.4)", paddingBottom: "5px" }}
          >
            <span
              aria-hidden="true"
              style={{
                fontFamily: "var(--font-cinzel)",
                fontSize: "0.6rem",
                color: "rgba(179,139,45,0.35)",
              }}
            >
              ◆
            </span>
            <span
              style={{
                fontFamily: "var(--font-cinzel)",
                fontSize: "0.5rem",
                fontWeight: 700,
                color: "rgba(179,139,45,0.45)",
                letterSpacing: "0.2em",
                textTransform: "uppercase",
              }}
            >
              Combat Log
            </span>
          </div>

          {consequences.length === 0 ? (
            <p
              style={{
                fontFamily: "var(--font-crimson)",
                fontSize: "0.75rem",
                fontStyle: "italic",
                color: "rgba(120,100,70,0.5)",
                textAlign: "center",
                padding: "12px 0",
                letterSpacing: "0.02em",
              }}
            >
              Awaiting the first strike…
            </p>
          ) : (
            <ul
              className="space-y-1.5"
              role="log"
              aria-live="polite"
              aria-label="Combat action history"
              style={{ maxHeight: "220px", overflowY: "auto" }}
            >
              {consequences.map((entry, i) => (
                <ConsequenceEntry key={i} entry={entry} index={i} />
              ))}
            </ul>
          )}
        </div>

      </div>
    </section>
  );
}
