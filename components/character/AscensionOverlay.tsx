"use client";

/**
 * components/character/AscensionOverlay.tsx
 *
 * Milestone L Slice 3 — The Forge Overlay
 *
 * Cinematic level-up celebration overlay rendered over the VTT when the
 * `triggerLevelUp` AI tool fires. Driven by the `dungeon-level-up`
 * CustomEvent dispatched from ActionInput.
 *
 * Design: forged-iron dark panel, ember-particle field, staggered
 * stat-line reveals, golden rune border, amber confirmation button.
 *
 * Accessibility:
 *   - focus-traps to the overlay when open
 *   - Escape key dismisses (equivalent to accepting)
 *   - Stat changes announced via aria-live
 *   - Confirmation button has descriptive aria-label
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { LevelUpPayload } from "@/lib/rules/progression";
import type { LevelUpResolvedPayload } from "@/lib/events/game-events";

// ─── Props ────────────────────────────────────────────────────────────────────

interface AscensionOverlayProps {
  /** The level-up payload returned by the triggerLevelUp tool. */
  payload: LevelUpPayload;
  /** Callback when the player acknowledges the level-up. */
  onAccept: () => void;
  /** Whether the overlay is visible. */
  isOpen: boolean;
}

// ─── Ember particle positions (deterministic — no randomness at render time) ──

const EMBERS = Array.from({ length: 24 }, (_, i) => ({
  left: `${(i * 37 + 11) % 100}%`,
  animDelay: `${(i * 0.19) % 2}s`,
  animDuration: `${1.8 + (i * 0.13) % 1.4}s`,
  size: i % 3 === 0 ? 4 : i % 3 === 1 ? 3 : 2,
  opacity: 0.5 + (i % 4) * 0.12,
}));

// ─── Self-contained overlay (exported for direct use) ────────────────────────

export function AscensionOverlay({ payload, onAccept, isOpen }: AscensionOverlayProps) {
  const acceptBtnRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Focus the accept button when opened
  useEffect(() => {
    if (isOpen) {
      const timeout = setTimeout(() => acceptBtnRef.current?.focus(), 80);
      return () => clearTimeout(timeout);
    }
  }, [isOpen]);

  // Escape key dismissal
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onAccept();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onAccept]);

  // Focus trap — keep Tab inside the overlay
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const focusable = overlayRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, []);

  if (!isOpen) return null;

  const conSign = payload.conModifier >= 0 ? "+" : "";

  return (
    <>
      {/* ── Keyframe definitions ─────────────────────────────────────────── */}
      <style>{`
        @keyframes forge-backdrop {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes forge-panel {
          from { opacity: 0; transform: translateY(28px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0)    scale(1);    }
        }
        @keyframes forge-pulse {
          0%   { transform: scale(0.85); opacity: 0; }
          40%  { transform: scale(1.08); opacity: 1; }
          70%  { transform: scale(0.97); opacity: 1; }
          100% { transform: scale(1);    opacity: 1; }
        }
        @keyframes ember-rise {
          0%   { transform: translateY(0)    scale(1);    opacity: var(--em-op); }
          60%  { transform: translateY(-60px) scale(0.8); opacity: calc(var(--em-op) * 0.6); }
          100% { transform: translateY(-110px) scale(0.4); opacity: 0; }
        }
        @keyframes level-reveal {
          from { opacity: 0; transform: translateX(-12px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes stat-reveal {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes glow-pulse {
          0%, 100% { box-shadow: 0 0 20px rgba(228,168,50,0.25), 0 0 60px rgba(228,168,50,0.08); }
          50%       { box-shadow: 0 0 35px rgba(228,168,50,0.45), 0 0 80px rgba(228,168,50,0.18); }
        }
        @keyframes btn-shimmer {
          0%   { background-position: 200% center; }
          100% { background-position: -200% center; }
        }
      `}</style>

      {/* ── Backdrop ─────────────────────────────────────────────────────── */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Level Up — The Forge accepts you"
        ref={overlayRef}
        onKeyDown={handleKeyDown}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.88)",
          zIndex: 1000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1rem",
          animation: "forge-backdrop 0.35s ease forwards",
        }}
      >
        {/* ── Forge Panel ─────────────────────────────────────────────────── */}
        <div
          style={{
            position: "relative",
            width: "100%",
            maxWidth: 500,
            background: "linear-gradient(160deg, #0e0e1c 0%, #0a0a15 60%, #110d08 100%)",
            border: "1px solid rgba(228,168,50,0.55)",
            borderRadius: 4,
            padding: "2.5rem 2rem 2rem",
            overflow: "hidden",
            animation: "forge-panel 0.45s cubic-bezier(0.22,1,0.36,1) forwards, glow-pulse 3s ease-in-out 0.5s infinite",
          }}
        >
          {/* Corner runes */}
          {["top-0 left-0", "top-0 right-0", "bottom-0 left-0", "bottom-0 right-0"].map((pos, i) => (
            <span
              key={i}
              aria-hidden="true"
              style={{
                position: "absolute",
                [pos.includes("top") ? "top" : "bottom"]: -1,
                [pos.includes("left") ? "left" : "right"]: -1,
                width: 18,
                height: 18,
                borderTop: pos.includes("top") ? "2px solid rgba(228,168,50,0.8)" : "none",
                borderBottom: pos.includes("bottom") ? "2px solid rgba(228,168,50,0.8)" : "none",
                borderLeft: pos.includes("left") ? "2px solid rgba(228,168,50,0.8)" : "none",
                borderRight: pos.includes("right") ? "2px solid rgba(228,168,50,0.8)" : "none",
              }}
            />
          ))}

          {/* Ember particle field */}
          <div
            aria-hidden="true"
            style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}
          >
            {EMBERS.map((em, i) => (
              <span
                key={i}
                style={{
                  position: "absolute",
                  bottom: "15%",
                  left: em.left,
                  width: em.size,
                  height: em.size,
                  borderRadius: "50%",
                  background: i % 5 === 0
                    ? "rgba(255,140,20,0.9)"
                    : i % 3 === 0
                    ? "rgba(255,200,60,0.85)"
                    : "rgba(228,140,30,0.7)",
                  "--em-op": em.opacity,
                  animation: `ember-rise ${em.animDuration} ${em.animDelay} ease-out infinite`,
                } as React.CSSProperties}
              />
            ))}
          </div>

          {/* ── Header ──────────────────────────────────────────────────────── */}
          <header style={{ textAlign: "center", marginBottom: "1.75rem", position: "relative" }}>
            <p
              style={{
                fontFamily: "var(--font-cinzel, 'Cinzel', serif)",
                fontSize: "0.6rem",
                letterSpacing: "0.4em",
                color: "rgba(228,168,50,0.6)",
                textTransform: "uppercase",
                marginBottom: "0.6rem",
              }}
            >
              ✦ The Forge Accepts You ✦
            </p>

            {/* Level transition — the hero element */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "1rem",
                animation: "forge-pulse 0.6s cubic-bezier(0.34,1.56,0.64,1) 0.15s both",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-cinzel, 'Cinzel', serif)",
                  fontSize: "3.5rem",
                  fontWeight: 900,
                  color: "rgba(180,140,60,0.55)",
                  lineHeight: 1,
                  letterSpacing: "-0.02em",
                }}
              >
                {payload.previousLevel}
              </span>
              <span
                aria-hidden="true"
                style={{
                  fontSize: "1.25rem",
                  color: "rgba(228,168,50,0.5)",
                  marginTop: 4,
                }}
              >
                ──►
              </span>
              <span
                style={{
                  fontFamily: "var(--font-cinzel, 'Cinzel', serif)",
                  fontSize: "3.5rem",
                  fontWeight: 900,
                  color: "#E8C84A",
                  lineHeight: 1,
                  letterSpacing: "-0.02em",
                  textShadow: "0 0 30px rgba(228,168,50,0.6), 0 0 60px rgba(228,168,50,0.25)",
                }}
              >
                {payload.newLevel}
              </span>
            </div>

            <p
              style={{
                fontFamily: "var(--font-crimson, 'Crimson Pro', serif)",
                fontSize: "0.95rem",
                color: "rgba(200,184,152,0.75)",
                fontStyle: "italic",
                marginTop: "0.5rem",
                animation: "level-reveal 0.4s ease 0.5s both",
              }}
            >
              {payload.className.charAt(0).toUpperCase() + payload.className.slice(1)}
              {" · "}
              Level {payload.newLevel}
            </p>
          </header>

          {/* ── Stat panel ───────────────────────────────────────────────────── */}
          <div
            aria-live="polite"
            style={{
              background: "rgba(6,6,12,0.7)",
              border: "1px solid rgba(228,168,50,0.18)",
              borderRadius: 3,
              padding: "1.25rem 1.5rem",
              marginBottom: "1.75rem",
              display: "grid",
              gap: "0.55rem",
            }}
          >
            {[
              {
                label: "Hit Die",
                value: `${payload.hitDie}  →  rolled ${payload.hpRoll}`,
                color: "#E2D9C5",
                delay: "0.55s",
              },
              {
                label: "CON modifier",
                value: `${conSign}${payload.conModifier}`,
                color: "rgba(200,184,152,0.7)",
                delay: "0.7s",
              },
              {
                label: "HP Gained",
                value: `+${payload.hpGained}`,
                color: "#4ADE80",
                delay: "0.85s",
              },
              {
                label: "Max HP",
                value: `${payload.previousMaxHp}  →  ${payload.newMaxHp}`,
                color: "#4ADE80",
                delay: "1s",
              },
              {
                label: "Hit Dice",
                value: `${payload.newHitDiceTotal}${payload.hitDie}`,
                color: "rgba(200,184,152,0.7)",
                delay: "1.1s",
              },
            ].map(({ label, value, color, delay }) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  animation: `stat-reveal 0.35s ease ${delay} both`,
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-cinzel, 'Cinzel', serif)",
                    fontSize: "0.65rem",
                    letterSpacing: "0.15em",
                    color: "rgba(180,145,50,0.65)",
                    textTransform: "uppercase",
                  }}
                >
                  {label}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-crimson, 'Crimson Pro', serif)",
                    fontSize: "1rem",
                    fontWeight: 600,
                    color,
                    letterSpacing: "0.03em",
                  }}
                >
                  {value}
                </span>
              </div>
            ))}
          </div>

          {/* ── Confirmation button ──────────────────────────────────────────── */}
          <div style={{ display: "flex", justifyContent: "center" }}>
            <button
              ref={acceptBtnRef}
              onClick={onAccept}
              aria-label={`Accept level up to level ${payload.newLevel} — gain ${payload.hpGained} hit points`}
              style={{
                fontFamily: "var(--font-cinzel, 'Cinzel', serif)",
                fontSize: "0.7rem",
                fontWeight: 700,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: "#0A0A14",
                background: "linear-gradient(90deg, #B8860B, #E8C84A, #F5A623, #E8C84A, #B8860B)",
                backgroundSize: "300% auto",
                border: "none",
                borderRadius: 2,
                padding: "0.85rem 2.5rem",
                cursor: "pointer",
                animation: "btn-shimmer 4s linear 1.2s infinite",
                transition: "transform 0.15s ease, box-shadow 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "scale(1.03)";
                e.currentTarget.style.boxShadow = "0 0 24px rgba(228,168,50,0.55)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "scale(1)";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              Accept the Forge&rsquo;s Gift
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Self-wiring wrapper (event-driven) ───────────────────────────────────────

/**
 * Drop this anywhere in the component tree — it listens for the
 * `dungeon-level-up` CustomEvent dispatched by ActionInput and shows
 * the overlay automatically. No props required from the parent.
 */
export default function AscensionOverlayController() {
  const [payload, setPayload] = useState<LevelUpPayload | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    function handleLevelUp(e: Event) {
      const raw = (e as CustomEvent<LevelUpResolvedPayload>).detail;
      // Coerce — the payload shape is identical to LevelUpPayload.
      setPayload(raw as LevelUpPayload);
      setIsOpen(true);
    }
    window.addEventListener("dungeon-level-up", handleLevelUp);
    return () => window.removeEventListener("dungeon-level-up", handleLevelUp);
  }, []);

  const handleAccept = useCallback(() => {
    setIsOpen(false);
  }, []);

  if (!payload) return null;

  return (
    <AscensionOverlay
      payload={payload}
      isOpen={isOpen}
      onAccept={handleAccept}
    />
  );
}
