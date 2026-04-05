"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  campaignId: string;
  inCombat: boolean;
}

// ─── Action definitions ───────────────────────────────────────────────────────

const COMBAT_ACTIONS = [
  "Atacar con arma",
  "Lanzar conjuro",
  "Usar poción",
  "Esquivar",
] as const;

const EXPLORATION_ACTIONS = [
  "Buscar trampas",
  "Moverse con sigilo",
  "Investigar la zona",
  "Tomar descanso corto",
] as const;

// ─── Per-action icon + accent ─────────────────────────────────────────────────

interface ActionMeta {
  icon: React.ReactNode;
  accent: string;
}

function SvgIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const ACTION_META: Record<string, ActionMeta> = {
  // ── Combat ──────────────────────────────────────────────────────────────────
  "Atacar con arma": {
    accent: "#FCA5A5",
    icon: (
      <SvgIcon>
        {/* Sword: diagonal blade + crossguard */}
        <line x1="2.5" y1="13.5" x2="10" y2="6" />
        <line x1="9" y1="3" x2="13" y2="7" />
        <line x1="7" y1="5" x2="11" y2="9" />
        <line x1="4" y1="12" x2="6" y2="10" />
      </SvgIcon>
    ),
  },
  "Lanzar conjuro": {
    accent: "#C4B5FD",
    icon: (
      <SvgIcon>
        {/* 4-pointed sparkle */}
        <line x1="8" y1="2" x2="8" y2="5" />
        <line x1="8" y1="11" x2="8" y2="14" />
        <line x1="2" y1="8" x2="5" y2="8" />
        <line x1="11" y1="8" x2="14" y2="8" />
        <line x1="4.1" y1="4.1" x2="6.2" y2="6.2" />
        <line x1="9.8" y1="9.8" x2="11.9" y2="11.9" />
        <line x1="11.9" y1="4.1" x2="9.8" y2="6.2" />
        <line x1="6.2" y1="9.8" x2="4.1" y2="11.9" />
      </SvgIcon>
    ),
  },
  "Usar poción": {
    accent: "#86EFAC",
    icon: (
      <SvgIcon>
        {/* Flask */}
        <path d="M6 2h4" />
        <path d="M7 2v3.5L3.5 11A2 2 0 005.3 14h5.4a2 2 0 001.8-3L9 5.5V2" />
        <line x1="5" y1="10" x2="8" y2="12" />
      </SvgIcon>
    ),
  },
  "Esquivar": {
    accent: "#93C5FD",
    icon: (
      <SvgIcon>
        {/* Shield */}
        <path d="M8 2L3 4.5V9a5 5 0 005 5 5 5 0 005-5V4.5L8 2z" />
        <polyline points="5.5,8 7,9.5 10.5,6" />
      </SvgIcon>
    ),
  },
  // ── Exploration ─────────────────────────────────────────────────────────────
  "Buscar trampas": {
    accent: "#FDE68A",
    icon: (
      <SvgIcon>
        {/* Magnifying glass */}
        <circle cx="6.5" cy="6.5" r="4" />
        <line x1="9.5" y1="9.5" x2="13.5" y2="13.5" />
      </SvgIcon>
    ),
  },
  "Moverse con sigilo": {
    accent: "#A3E635",
    icon: (
      <SvgIcon>
        {/* Footstep / dashed path */}
        <path d="M4 12c0-1 1-1.5 1.5-2.5S6 8 6 7a2 2 0 10-4 0c0 1 .5 1.5 1 2.5S4 11 4 12z" />
        <path d="M11 9c0-.8.8-1.2 1.2-2S13 6 13 5a1.5 1.5 0 10-3 0c0 .8.5 1.2.8 2S11 8.2 11 9z" />
      </SvgIcon>
    ),
  },
  "Investigar la zona": {
    accent: "#67E8F9",
    icon: (
      <SvgIcon>
        {/* Eye */}
        <path d="M2 8s2.5-5 6-5 6 5 6 5-2.5 5-6 5-6-5-6-5z" />
        <circle cx="8" cy="8" r="1.5" />
      </SvgIcon>
    ),
  },
  "Tomar descanso corto": {
    accent: "#F9A8D4",
    icon: (
      <SvgIcon>
        {/* Moon crescent */}
        <path d="M12 9.5A5 5 0 016 4a6.5 6.5 0 100 9 5 5 0 006-3.5z" />
      </SvgIcon>
    ),
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function MacroDeck({ campaignId, inCombat }: Props) {
  const router = useRouter();
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const actions = inCombat ? COMBAT_ACTIONS : EXPLORATION_ACTIONS;
  const isAnyLoading = loadingAction !== null;

  async function handleAction(actionText: string) {
    if (isAnyLoading) return;
    setError(null);
    setLoadingAction(actionText);
    try {
      const res = await fetch(`/api/campaign/${campaignId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: actionText }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(data.error ?? `Error ${res.status}`);
        return;
      }

      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoadingAction(null);
    }
  }

  const sectionLabel = inCombat ? "Combat actions" : "Exploration actions";
  const modeLabel = inCombat ? "Combat" : "Exploration";
  const modeBorderColor = inCombat
    ? "rgba(239,68,68,0.25)"
    : "rgba(228,168,50,0.18)";
  const modeLabelColor = inCombat ? "#FCA5A5" : "#8A6B1A";

  return (
    <section aria-label={sectionLabel}>
      {/* Mode label */}
      <div className="mb-2 flex items-center gap-2">
        <span
          className="text-[10px] uppercase tracking-[0.3em] font-semibold"
          style={{ color: modeLabelColor, fontFamily: "var(--font-cinzel, serif)" }}
        >
          {modeLabel} Quick Actions
        </span>
        {inCombat && (
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: "#EF4444", boxShadow: "0 0 6px #EF444480" }}
            aria-hidden="true"
          />
        )}
      </div>

      {/* Button grid: 2 cols on mobile, 4 cols on sm+ */}
      <div
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        role="group"
        aria-label={sectionLabel}
      >
        {actions.map((actionText) => {
          const meta = ACTION_META[actionText];
          const isThisLoading = loadingAction === actionText;
          const isDisabled = isAnyLoading;

          return (
            <button
              key={actionText}
              type="button"
              disabled={isDisabled}
              onClick={() => void handleAction(actionText)}
              aria-label={actionText}
              aria-busy={isThisLoading}
              className="group relative flex min-h-[44px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg px-2 py-3 text-center transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                background: isThisLoading
                  ? "rgba(20,16,30,0.95)"
                  : "rgba(12,12,22,0.88)",
                border: `1px solid ${isThisLoading ? (meta?.accent ?? "#888") + "55" : modeBorderColor}`,
                color: meta?.accent ?? "#E2D9C5",
              }}
              onMouseEnter={(e) => {
                if (!isDisabled) {
                  const btn = e.currentTarget;
                  btn.style.borderColor = (meta?.accent ?? "#F59E0B") + "55";
                  btn.style.background = "rgba(20,16,30,0.95)";
                  btn.style.boxShadow = `0 0 12px ${meta?.accent ?? "#F59E0B"}18`;
                }
              }}
              onMouseLeave={(e) => {
                const btn = e.currentTarget;
                btn.style.borderColor = isThisLoading
                  ? (meta?.accent ?? "#888") + "55"
                  : modeBorderColor;
                btn.style.background = isThisLoading
                  ? "rgba(20,16,30,0.95)"
                  : "rgba(12,12,22,0.88)";
                btn.style.boxShadow = "none";
              }}
            >
              {/* Icon or spinner */}
              {isThisLoading ? (
                <svg
                  className="h-4 w-4 shrink-0 animate-spin"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    cx="8" cy="8" r="6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeDasharray="28"
                    strokeDashoffset="10"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                meta?.icon
              )}

              {/* Label */}
              <span
                className="block text-[10px] leading-tight"
                style={{
                  fontFamily: "var(--font-cinzel, serif)",
                  letterSpacing: "0.03em",
                  color: isThisLoading ? (meta?.accent ?? "#E2D9C5") + "99" : "inherit",
                }}
              >
                {isThisLoading ? "…" : actionText}
              </span>
            </button>
          );
        })}
      </div>

      {/* Error feedback */}
      {error !== null && (
        <p
          role="alert"
          className="mt-2 rounded px-3 py-2 text-xs"
          style={{ background: "rgba(127,29,29,0.4)", color: "#FCA5A5", border: "1px solid rgba(239,68,68,0.2)" }}
        >
          {error}
        </p>
      )}
    </section>
  );
}
