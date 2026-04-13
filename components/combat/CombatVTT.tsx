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

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CombatConsequencePayload, LootGeneratedPayload } from "@/lib/events/game-events";
import type { LootPayload } from "@/lib/rules/loot";

// Extracted Components & Logic
import {
  ZoneGrid,
  AbstractArena,
  CombatantData,
  ZoneData
} from "./ZoneGrid";
import {
  ConsequenceEntry,
  deriveBeat,
  BEAT_META
} from "./ConsequenceLog";
import SpoilsOfWar from "./SpoilsOfWar";


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

interface LoggedConsequence {
  key: number;
  payload: CombatConsequencePayload;
}


// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function CombatVTT({ encounter }: Props) {
  const [consequences, setConsequences] = useState<LoggedConsequence[]>([]);
  const [lootPayload, setLootPayload] = useState<LootPayload | null>(null);
  const nextConsequenceKey = useRef(1);

  // Sorted by initiative descending (server already sorts this way)
  const activeCombatant = encounter.combatants[encounter.currentTurnIndex];
  const consequencePayloads = useMemo(
    () => consequences.map((entry) => entry.payload),
    [consequences]
  );
  const beat = deriveBeat(consequencePayloads, encounter.round);
  const beatMeta = BEAT_META[beat];

  const handleClaim = useCallback(() => setLootPayload(null), []);

  useEffect(() => {
    function onGameEvent(e: Event) {
      const ev = (e as CustomEvent<{ event: { type: string; payload: unknown } }>).detail.event;
      if (ev.type === "COMBAT_CONSEQUENCE") {
        setConsequences((prev) =>
          [
            { key: nextConsequenceKey.current++, payload: ev.payload as CombatConsequencePayload },
            ...prev,
          ].slice(0, 8)
        );
      }
      if (ev.type === "LOOT_GENERATED") {
        // Cast LootGeneratedPayload → LootPayload (shapes are identical)
        setLootPayload(ev.payload as unknown as LootPayload);
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
        position: "relative",
      }}
    >
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
                <ConsequenceEntry key={entry.key} entry={entry.payload} index={i} />
              ))}
            </ul>
          )}
        </div>

      </div>

      {/* Spoils of War overlay — mounts when generateLoot tool fires LOOT_GENERATED */}
      {lootPayload && (
        <SpoilsOfWar payload={lootPayload} onClaim={handleClaim} />
      )}
    </section>
  );
}
