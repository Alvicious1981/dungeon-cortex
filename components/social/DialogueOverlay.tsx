"use client";

import { useEffect, useRef, useState } from "react";
import { ScrollText, UserRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { StatusMessage } from "@/components/ui/StatusMessage";
import { useModalFocus } from "@/lib/hooks/useModalFocus";
import { attitudeFor } from "@/lib/rules/social-logic";
import type { NpcAttitude } from "@/lib/rules/social";

/**
 * DialogueOverlay.tsx — Milestone N: Slice 3
 * 
 * Immersive NPC interaction UI following the "Code is Law" architecture.
 * Features:
 *  - Real-time animated disposition meter.
 *  - Discoverable personality tags (Motivation, Trait).
 *  - Social Intent buttons (Persuade, Intimidate, Deceive).
 *  - "Ask for Rumors" locked/unlocked via disposition threshold.
 *  - Strict accessibility with focus traps and ARIA compliance.
 */

interface DialogueOverlayProps {
  npc: {
    id: string;
    name: string;
    race: string | null;
    profession: string | null;
    disposition: number | null;
    personalityTags: {
      motivation: string;
      secret: string; // RECEIVED: for NPC context
      distinctiveTrait: string;
    } | null;
    hasMetPlayer: boolean;
  };
  narrationText: string;
  characterId: string;
  result: {
    approach: "persuade" | "intimidate" | "deceive";
    skill: string;
    roll: number;
    total: number;
    dc: number;
    success: boolean;
    attitudeBefore: string;
    attitudeAfter: string;
    dispositionBefore: number;
    dispositionAfter: number;
  } | null;
  error: string | null;
  /**
   * What the NPC said when asked what they had heard. A refusal is a normal
   * answer, not an error: `rumors` is empty and `refusalReason` explains why,
   * which is a fact the player should read rather than an empty panel.
   */
  rumors: {
    attitude: string;
    rumors: Array<{ nodeId: string; nodeName: string; rumor: string; source: string }>;
    refusalReason?: string;
  } | null;
  onSpeak: (words: string, approach: "persuade" | "intimidate" | "deceive") => void;
  onSocialIntent: (approach: "persuade" | "intimidate" | "deceive") => void;
  onAskRumors: () => void;
  onApproach: () => void; // Unmet -> derive initial attitude
  onClose: () => void;
  isLoading: boolean;
}

const DISPOSITION_COLORS: Record<NpcAttitude, string> = {
  Hostile: "#ef4444",     // Red
  Indifferent: "#a1a1aa", // Zinc
  Friendly: "#22c55e"     // Green
};

const ATTITUDE_LABELS: Record<NpcAttitude, string> = {
  Hostile: "Hostil",
  Indifferent: "Indiferente",
  Friendly: "Amistoso",
};

const APPROACH_LABELS = {
  persuade: "Persuadir",
  intimidate: "Intimidar",
  deceive: "Engañar",
} as const;

const SKILL_LABELS: Record<string, string> = {
  Persuasion: "Persuasión",
  Intimidation: "Intimidación",
  Deception: "Engaño",
};

const RUMOR_REFUSALS: Record<string, string> = {
  "This NPC is hostile and will not speak.": "Este personaje es hostil y se niega a hablar.",
  "This NPC is indifferent and unwilling to share information freely.":
    "Este personaje se muestra indiferente y no quiere compartir información libremente.",
};

function attitudeLabel(attitude: string): string {
  return ATTITUDE_LABELS[attitude as NpcAttitude] ?? attitude;
}

export default function DialogueOverlay({
  npc,
  narrationText,
  result,
  error,
  rumors,
  onSpeak,
  onSocialIntent,
  onAskRumors,
  onApproach,
  onClose,
  isLoading
}: DialogueOverlayProps) {
  const [showPersonality, setShowPersonality] = useState(false);
  const [customWords, setCustomWords] = useState("");
  const [approach, setApproach] = useState<"persuade" | "intimidate" | "deceive">("persuade");
  const overlayRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const band = attitudeFor(npc.disposition);
  // Rendering-only fallback: an NPC with no disposition yet (never met, or
  // simply unknown) is drawn at the meter's midpoint. `attitudeFor(null)`
  // already treats this as Indifferent by design; this local value exists
  // only for the numeric meter math below and is never sent back out.
  const dispositionValue = npc.disposition ?? 0;
  /**
   * NEVER RENDER: secret is for engine use only. 
   * The player only sees Motivation and Distinctive Trait.
   */

  useModalFocus({
    open: true,
    onClose,
    dialogRef: overlayRef,
    initialFocusRef: headingRef,
  });

  // Auto-scroll narration
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [narrationText]);

  const dispositionPercent = ((dispositionValue + 10) / 20) * 100;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm transition-opacity duration-300 sm:p-5">
      <style jsx global>{`
        @keyframes dg-dialogue-in {
          from { opacity: 0; transform: scale(0.97) translateY(10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        .dialogue-card {
          animation: dg-dialogue-in var(--dc-duration-base) cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        @media (max-height: 40rem) {
          .dialogue-card { overflow-y: auto; }
          .dialogue-main { flex: none; min-height: 12rem; }
          .dialogue-log { overflow: visible; }
        }
      `}</style>

      <div 
        ref={overlayRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="npc-dialogue-title"
        aria-busy={isLoading}
        className="dialogue-card relative flex max-h-[calc(100svh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[var(--dc-border-strong)] bg-[var(--dc-canvas-soft)] shadow-2xl sm:max-h-[90vh]"
      >
        {/* Header: NPC Identity & Disposition Icon */}
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--dc-border)] bg-[var(--dc-surface-raised)] px-4 py-4 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
            <div 
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--dc-border-strong)] bg-[var(--dc-canvas-soft)] text-[var(--dc-action-hover)]"
              aria-hidden="true"
            >
              <UserRound size={22} />
            </div>
            <div className="min-w-0">
              <h2
                ref={headingRef}
                tabIndex={-1}
                id="npc-dialogue-title"
                className="dc-heading truncate text-xl font-bold text-amber-100"
              >
                {npc.name}
              </h2>
              {(npc.race || npc.profession) && (
                <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--dc-text-muted)]">
                  {[npc.race, npc.profession].filter(Boolean).join(" • ")}
                </p>
              )}
            </div>
          </div>
          
          <div className="ml-auto text-right">
            <span 
              className="mb-1 block text-xs font-bold uppercase tracking-widest"
              style={{ color: DISPOSITION_COLORS[band] }}
            >
              {ATTITUDE_LABELS[band]}
            </span>
            <div className="text-xs text-[var(--dc-text-muted)]">
              {npc.disposition === null
                ? "Disposición desconocida"
                : `Disposición ${npc.disposition > 0 ? "+" : ""}${npc.disposition}`}
            </div>
          </div>
        </header>

        {/* Disposition Meter */}
        <div className="shrink-0 border-b border-[var(--dc-border)] bg-[var(--dc-surface)] px-4 py-3 sm:px-8">
          <div className="mb-1.5 flex justify-between text-[0.6875rem] font-bold uppercase tracking-wide text-[var(--dc-text-muted)]">
            <span>Hostil</span>
            <span>Indiferente</span>
            <span>Amistoso</span>
          </div>
          <div 
            className="h-2.5 w-full bg-[#08080c] rounded-full border border-neutral-900 overflow-hidden relative"
            role="meter"
            aria-valuenow={dispositionValue}
            aria-valuemin={-10}
            aria-valuemax={10}
            aria-valuetext={`${ATTITUDE_LABELS[band]}, ${dispositionValue > 0 ? "+" : ""}${dispositionValue}`}
            aria-label="Disposición del personaje"
          >
            {/* Gradient Background */}
            <div className="absolute inset-0 bg-gradient-to-r from-red-950 via-neutral-900 to-green-950 opacity-40" />
            
            {/* Active Progress Bar */}
            <div 
              className="relative h-full transition-[width] duration-200 ease-out motion-reduce:transition-none"
              style={{ 
                width: `${dispositionPercent}%`,
                background: `linear-gradient(90deg, #7f1d1d 0%, #44403c ${100 - dispositionPercent}%, ${DISPOSITION_COLORS[band]} 100%)`,
                boxShadow: `0 0 10px ${DISPOSITION_COLORS[band]}44`
              }}
            >
              <div className="absolute right-0 top-0 bottom-0 w-1 bg-white/40 shadow-[0_0_8px_rgba(255,255,255,0.6)]" />
            </div>
          </div>
        </div>

        {/* Main Content Area: Narration & Sidebar */}
        <div className="dialogue-main flex min-h-0 flex-1 flex-col sm:flex-row">
          {/* Narration Log */}
          <section className="dialogue-log min-h-0 flex-1 overflow-y-auto bg-[#0a0a0f] p-4 sm:p-6" ref={scrollRef} aria-label="Conversación">
            <div
              className="whitespace-pre-wrap text-[1.0625rem] leading-7 text-amber-100/90"
              style={{ fontFamily: "var(--font-crimson)" }}
            >
              {narrationText}
              {isLoading && (
                <span aria-hidden="true" className="ml-1 inline-block h-4 w-2 animate-pulse bg-amber-500 align-middle motion-reduce:animate-none" />
              )}
            </div>

            {/* What the NPC had to say when asked. A refusal renders as their
                answer, not as an empty list or an error. */}
            {rumors && (
              <div
                className="mt-4 border border-amber-900/30 rounded-lg p-4 bg-amber-950/10 text-sm"
                data-testid="rumor-payload"
              >
                {rumors.refusalReason ? (
                  <p className="italic text-[var(--dc-text-muted)]">
                    {RUMOR_REFUSALS[rumors.refusalReason] ?? "Este personaje no quiere compartir información ahora."}
                  </p>
                ) : (
                  <ul className="space-y-2" aria-label="Rumores compartidos">
                    {rumors.rumors.map((r) => (
                      <li key={r.nodeId} className="text-amber-200/90">
                        {r.rumor}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Error feedback — a failed attempt says something, rather than looking like a no-op. */}
            {error && (
              <StatusMessage
                tone="error"
                title="No se pudo completar la interacción"
                className="mt-4"
                data-testid="social-check-error"
              >
                <p>{error}</p>
              </StatusMessage>
            )}

            {/* Resolved check facts — rendered as returned by the route, never narrated. */}
            {result && (
              <Panel
                as="section"
                tone="mechanical"
                aria-label="Resultado de la interacción"
                className="mt-4 p-4 text-sm"
                data-testid="social-check-result"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-amber-100">
                  <span className="text-xs font-bold uppercase tracking-widest">
                    {SKILL_LABELS[result.skill] ?? result.skill} ({APPROACH_LABELS[result.approach]})
                  </span>
                  <span className={result.success ? "font-semibold text-[var(--dc-success)]" : "font-semibold text-[var(--dc-error)]"}>
                    {result.success ? "Éxito" : "Fallo"}
                  </span>
                </div>
                <div className="dc-mechanical-value mt-2">
                  Tirada {result.roll} + modificadores = {result.total} contra CD {result.dc}
                </div>
                <div className="mt-1 text-xs text-[var(--dc-text-muted)]">
                  {attitudeLabel(result.attitudeBefore)} &rarr; {attitudeLabel(result.attitudeAfter)}
                </div>
              </Panel>
            )}

            {isLoading && (
              <p className="sr-only" role="status" aria-live="polite">
                Resolviendo la interacción…
              </p>
            )}
          </section>

          {/* Personality Sidebar (Discoverable) */}
          {npc.personalityTags && (
            <aside className={`border-l border-[#3b2d1a]/20 transition-all duration-300 ${showPersonality ? 'w-64 bg-[#0e0e16]' : 'w-10 bg-[#161622]'} flex flex-col`}>
              <button 
                onClick={() => setShowPersonality(!showPersonality)}
                className="w-full flex items-center justify-center p-3 hover:bg-amber-900/10 text-amber-700 transition-colors"
                aria-expanded={showPersonality}
                aria-label={showPersonality ? "Collapse personality info" : "Expand personality info"}
              >
                {showPersonality ? "◀" : "👤"}
              </button>
              
              {showPersonality && (
                <div className="p-4 space-y-6 overflow-y-auto">
                  <div>
                    <h3 className="text-[10px] font-bold text-amber-700 uppercase tracking-[0.2em] mb-2">Motivation</h3>
                    <p className="text-sm italic text-amber-200/70 border-l-2 border-amber-900/30 pl-3">
                      &quot;{npc.personalityTags.motivation}&quot;
                    </p>
                  </div>
                  <div>
                    <h3 className="text-[10px] font-bold text-amber-700 uppercase tracking-[0.2em] mb-2">Distinctive Trait</h3>
                    <p className="text-sm text-amber-100/60 leading-snug">
                      {npc.personalityTags.distinctiveTrait}
                    </p>
                  </div>
                  <div className="pt-4 border-t border-amber-900/20 text-[9px] text-amber-800 text-center uppercase tracking-widest italic">
                    Personality Discovery
                  </div>
                </div>
              )}
            </aside>
          )}
        </div>

        {/* Footer: User Interaction */}
        <footer className="shrink-0 space-y-4 border-t border-[var(--dc-border)] bg-[var(--dc-surface-raised)] p-4 sm:p-6">
          
          {npc.hasMetPlayer ? (
            <>
              {/* Intent Quick Actions */}
              <div className="grid grid-cols-3 gap-2" role="group" aria-label="Acciones rápidas">
                <Button
                  variant="secondary"
                  size="compact"
                  disabled={isLoading}
                  onClick={() => onSocialIntent("persuade")}
                  className="text-xs uppercase tracking-widest"
                >
                  Persuadir
                </Button>
                <Button
                  variant="danger"
                  size="compact"
                  disabled={isLoading}
                  onClick={() => onSocialIntent("intimidate")}
                  className="text-xs uppercase tracking-widest"
                >
                  Intimidar
                </Button>
                <Button
                  variant="secondary"
                  size="compact"
                  disabled={isLoading}
                  onClick={() => onSocialIntent("deceive")}
                  className="text-xs uppercase tracking-widest"
                >
                  Engañar
                </Button>
              </div>

              {/* Custom Input */}
              <div className="flex flex-col gap-2">
                <span id="social-approach-label" className="dc-label mb-0">Enfoque de la intervención</span>
                <div className="grid grid-cols-3 gap-2" role="group" aria-labelledby="social-approach-label">
                  {(["persuade", "intimidate", "deceive"] as const).map((mode) => (
                    <Button
                      key={mode}
                      variant="ghost"
                      size="compact"
                      onClick={() => setApproach(mode)}
                      aria-pressed={approach === mode}
                      className={`px-2 text-[0.6875rem] uppercase tracking-wider ${
                        approach === mode
                          ? "border-[var(--dc-action)] bg-[var(--dc-canvas-soft)] text-amber-100"
                          : "text-[var(--dc-text-muted)]"
                      }`}
                    >
                      {APPROACH_LABELS[mode]}
                    </Button>
                  ))}
                </div>
                <label htmlFor="social-dialogue-words" className="dc-label mb-0 mt-1">
                  Tus palabras
                </label>
                <div className="flex items-stretch gap-2">
                  <textarea 
                    id="social-dialogue-words"
                    value={customWords}
                    onChange={(e) => setCustomWords(e.target.value)}
                    placeholder="Escribe lo que quieres decir…"
                    className="dc-field h-24 min-w-0 flex-1 resize-none p-3 text-base"
                    disabled={isLoading}
                  />
                  <Button
                    onClick={() => {
                      if (!customWords.trim()) return;
                      onSpeak(customWords, approach);
                      setCustomWords("");
                    }}
                    disabled={isLoading || !customWords.trim()}
                    className="shrink-0 px-4 text-xs uppercase tracking-widest sm:px-6"
                  >
                    Enviar
                  </Button>
                </div>
              </div>

              {/* Utility Row */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <Button
                  variant="ghost"
                  size="compact"
                  onClick={onAskRumors}
                  disabled={isLoading}
                  title="Preguntar qué ha oído este personaje"
                  className="justify-start text-xs uppercase tracking-widest"
                >
                  <ScrollText size={17} aria-hidden="true" />
                  Preguntar por rumores
                </Button>
                <Button
                  variant="ghost"
                  size="compact"
                  onClick={onClose}
                  className="text-xs uppercase tracking-widest"
                >
                  Terminar conversación
                </Button>
              </div>
            </>
          ) : (
            /* Unmet State: Approach Button */
            <div className="flex flex-col items-center gap-4 py-8">
              <p className="max-w-sm text-center text-sm italic text-[var(--dc-text-muted)]">
                Este personaje todavía no ha reparado en tu presencia.
              </p>
              <Button
                onClick={onApproach}
                disabled={isLoading}
                className="w-full max-w-xs uppercase tracking-[0.16em]"
              >
                Acercarse y presentarse
              </Button>
              <Button
                variant="ghost"
                size="compact"
                onClick={onClose}
                className="text-xs uppercase tracking-widest"
              >
                Permanecer en la sombra
              </Button>
            </div>
          )}
        </footer>

        {/* Loading Overlay (Thin strip) */}
        {isLoading && (
          <div aria-hidden="true" className="absolute left-0 right-0 top-0 h-0.5 overflow-hidden">
            <div className="h-full animate-[loading-bar_1.5s_infinite_linear] bg-amber-500 motion-reduce:animate-none" style={{ width: "40%" }} />
          </div>
        )}
      </div>
      
      <style jsx>{`
        @keyframes loading-bar {
          0% { transform: translateX(-100%); width: 30%; }
          50% { width: 60%; }
          100% { transform: translateX(300%); width: 30%; }
        }
      `}</style>
    </div>
  );
}
