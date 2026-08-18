"use client";

import { useEffect, useRef, useState } from "react";
import {
  DUNGEON_ACTION_END,
  DUNGEON_ACTION_ERROR,
  DUNGEON_TARGET_SELECTION_CHANGE,
  createDungeonActionRequestId,
  requestDungeonAttack,
  requestDungeonAction,
  type DungeonActionErrorDetail,
  type DungeonActionRequestDetail,
  type DungeonTargetSelectionDetail,
} from "@/lib/events/action-transport";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  inCombat: boolean;
}

// ─── Action definitions ───────────────────────────────────────────────────────

const COMBAT_ACTIONS = [
  "Atacar con arma",
  "Finalizar turno",
] as const;

/**
 * Button label → the canonical command sent to /api/campaign/[id]/action.
 *
 * The label is presentation and may be reworded freely; the command is a
 * contract with the backend's deterministic classifier. Every button must
 * appear here. Sending the Spanish label verbatim — which the exploration
 * buttons used to do — makes the classification depend on the copy: "Buscar
 * trampas" happened to reach a classification no gate consumed, and "Moverse
 * con sigilo" matched no pattern at all and returned 400.
 */
const CANONICAL_ACTION_REQUESTS: Record<string, string> = {
  // Combat — resolved by the authoritative macro path.
  "Atacar con arma": "Attack",
  "Finalizar turno": "End Turn",
  // Exploration — resolved as SRD ability checks or a rest.
  "Buscar trampas": "search for traps",
  "Investigar la zona": "investigate the area",
  "Moverse con sigilo": "sneak",
  "Tomar descanso corto": "short rest",
};

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
  "Finalizar turno": {
    accent: "#93C5FD",
    icon: (
      <SvgIcon>
        {/* Flag */}
        <line x1="4" y1="2" x2="4" y2="14" />
        <path d="M4 3h7l-1.5 2L11 7H4" />
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

export default function MacroDeck({ inCombat }: Props) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>([]);
  const pendingRequestId = useRef<string | null>(null);

  const actions = inCombat ? COMBAT_ACTIONS : EXPLORATION_ACTIONS;
  const isAnyLoading = loadingAction !== null;

  useEffect(() => {
    function handleActionError(event: Event) {
      const detail = (event as CustomEvent<DungeonActionErrorDetail>).detail;
      if (detail.requestId === pendingRequestId.current) {
        setError(detail.error);
      }
    }

    function handleActionEnd(event: Event) {
      const detail = (event as CustomEvent<DungeonActionRequestDetail>).detail;
      if (detail.requestId === pendingRequestId.current) {
        pendingRequestId.current = null;
        setLoadingAction(null);
      }
    }

    function handleTargetSelection(event: Event) {
      const detail = (event as CustomEvent<DungeonTargetSelectionDetail>).detail;
      setSelectedTargetIds(detail.targetIds);
    }

    window.addEventListener(DUNGEON_ACTION_ERROR, handleActionError);
    window.addEventListener(DUNGEON_ACTION_END, handleActionEnd);
    window.addEventListener(
      DUNGEON_TARGET_SELECTION_CHANGE,
      handleTargetSelection
    );
    return () => {
      window.removeEventListener(DUNGEON_ACTION_ERROR, handleActionError);
      window.removeEventListener(DUNGEON_ACTION_END, handleActionEnd);
      window.removeEventListener(
        DUNGEON_TARGET_SELECTION_CHANGE,
        handleTargetSelection
      );
    };
  }, []);

  function handleAction(actionText: string) {
    if (isAnyLoading) return;
    const canonicalAction = CANONICAL_ACTION_REQUESTS[actionText] ?? actionText;
    if (canonicalAction === "Attack" && selectedTargetIds.length !== 1) {
      setError("Selecciona exactamente un objetivo para atacar.");
      return;
    }

    const requestId = createDungeonActionRequestId();
    pendingRequestId.current = requestId;
    setError(null);
    setLoadingAction(actionText);
    if (canonicalAction === "Attack") {
      requestDungeonAttack(selectedTargetIds[0]!, requestId);
    } else {
      requestDungeonAction({ action: canonicalAction }, requestId);
    }
  }

  const sectionLabel = inCombat ? "Acciones de combate" : "Acciones de exploración";
  const modeLabel = inCombat ? "Combate" : "Exploración";
  const modeBorderColor = inCombat
    ? "rgba(239,68,68,0.25)"
    : "rgba(228,168,50,0.18)";
  const modeLabelColor = inCombat ? "#FCA5A5" : "#C49A2A";

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
              className="group relative flex min-h-[44px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-sm px-2 py-3 text-center motion-safe:transition-all motion-safe:duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 disabled:cursor-not-allowed disabled:opacity-40"
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
                  className="h-4 w-4 shrink-0 motion-safe:animate-spin"
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
