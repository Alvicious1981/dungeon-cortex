/**
 * components/combat/ZoneTracker.tsx
 *
 * Server component — read-only spatial display.
 *
 * Renders the player's current zone, the zones reachable in one move,
 * and which combatants occupy each zone. No client JS required.
 *
 * "Code is Law": this component only displays data. Movement validation
 * lives in lib/rules/spatial.ts and is enforced server-side.
 */

import type { Zone } from "@/lib/rules/spatial";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CombatantPosition {
  id: string;
  name: string;
  isPlayer: boolean;
  currentZoneId: string | null;
}

interface Props {
  zones: Zone[];
  playerZoneId: string | null;
  combatants: CombatantPosition[];
}

// ── Zone type visual config ───────────────────────────────────────────────────

const ZONE_TYPE_STYLE: Record<Zone["type"], { color: string; bg: string; label: string }> = {
  Engaged: { color: "#FCA5A5", bg: "rgba(239,68,68,0.15)",   label: "ENGAGED" },
  Near:    { color: "#F59E0B", bg: "rgba(245,158,11,0.15)",  label: "NEAR"    },
  Far:     { color: "#818CF8", bg: "rgba(99,102,241,0.12)",  label: "FAR"     },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function ZoneTypeBadge({ type, small = false }: { type: Zone["type"]; small?: boolean }) {
  const s = ZONE_TYPE_STYLE[type];
  return (
    <span
      className={`shrink-0 rounded-sm font-bold uppercase leading-none tracking-wider ${
        small ? "px-1 py-0.5 text-[7px]" : "px-1.5 py-0.5 text-[8px]"
      }`}
      style={{ color: s.color, background: s.bg }}
    >
      {s.label}
    </span>
  );
}

function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3 w-3 shrink-0"
      aria-hidden="true"
      focusable="false"
      style={{ color: "#4A3F28" }}
    >
      <path d="M2 6h8M7 3l3 3-3 3" />
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ZoneTracker({ zones, playerZoneId, combatants }: Props) {
  // Render nothing when spatial tracking is disabled for this encounter.
  if (zones.length === 0) return null;

  const currentZone = zones.find((z) => z.id === playerZoneId) ?? null;

  const connectedZones = currentZone
    ? zones.filter((z) => currentZone.connectedZoneIds.includes(z.id))
    : [];

  // Group combatant display names by zone id.
  const occupantMap: Record<string, string[]> = {};
  for (const c of combatants) {
    if (!c.currentZoneId) continue;
    (occupantMap[c.currentZoneId] ??= []).push(c.isPlayer ? "You" : c.name);
  }

  return (
    <section
      aria-label="Zone position"
      className="rounded-lg p-4 space-y-3"
      style={{
        background: "rgba(12,12,22,0.92)",
        border: "1px solid rgba(245,158,11,0.18)",
        boxShadow: "inset 0 1px 0 rgba(255,220,80,0.03)",
      }}
    >
      {/* ── Section label ── */}
      <p
        className="text-[10px] uppercase tracking-[0.3em]"
        style={{ fontFamily: "var(--font-cinzel)", color: "#8A6B1A" }}
      >
        Zone Position
      </p>

      {/* ── Current zone ── */}
      {currentZone ? (
        <div
          className="flex items-center gap-2 rounded px-3 py-2"
          style={{
            background: "rgba(245,158,11,0.07)",
            border: "1px solid rgba(245,158,11,0.28)",
          }}
        >
          {/* Active pulse dot */}
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: "#F59E0B", boxShadow: "0 0 6px #F59E0B80" }}
            aria-hidden="true"
          />
          <span
            className="flex-1 truncate text-sm font-semibold"
            style={{ fontFamily: "var(--font-cinzel)", color: "#E8C84A" }}
          >
            {currentZone.name}
          </span>
          <ZoneTypeBadge type={currentZone.type} />
        </div>
      ) : (
        <p
          className="text-xs"
          style={{
            color: "#4A3F28",
            fontFamily: "var(--font-crimson)",
            fontStyle: "italic",
          }}
        >
          Not yet placed in a zone.
        </p>
      )}

      {/* ── Reachable zones ── */}
      {connectedZones.length > 0 && (
        <div className="space-y-1.5">
          <p
            className="text-[9px] uppercase tracking-widest"
            style={{ fontFamily: "var(--font-cinzel)", color: "#3A2E18" }}
          >
            Reachable
          </p>
          <ul className="space-y-1" role="list">
            {connectedZones.map((z) => {
              const occ = occupantMap[z.id] ?? [];
              return (
                <li
                  key={z.id}
                  className="flex items-center gap-2 rounded px-2.5 py-1.5"
                  style={{ background: "rgba(255,255,255,0.025)" }}
                >
                  <ArrowIcon />
                  <span
                    className="flex-1 truncate text-xs"
                    style={{ color: "#C8B898", fontFamily: "var(--font-crimson)" }}
                  >
                    {z.name}
                  </span>
                  <ZoneTypeBadge type={z.type} small />
                  {occ.length > 0 && (
                    <span
                      className="shrink-0 text-[9px] tabular-nums"
                      style={{ color: "#4A3F28" }}
                      aria-label={`Occupants: ${occ.join(", ")}`}
                    >
                      {occ.length}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ── Occupants in current zone ── */}
      {currentZone && (occupantMap[currentZone.id] ?? []).length > 0 && (
        <p
          className="text-[9px] leading-relaxed"
          style={{
            color: "#3A3020",
            fontFamily: "var(--font-crimson)",
            fontStyle: "italic",
          }}
        >
          Here: {(occupantMap[currentZone.id] ?? []).join(", ")}
        </p>
      )}
    </section>
  );
}
