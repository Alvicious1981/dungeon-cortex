"use client";

import { useEffect, useRef, useState } from "react";
import { getDispositionBand } from "@/lib/rules/social-logic";
import type { DispositionBand } from "@/lib/rules/social";

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
    disposition: number;
    personalityTags: {
      motivation: string;
      secret: string; // RECEIVED: for NPC context
      distinctiveTrait: string;
    } | null;
    hasMetPlayer: boolean;
  };
  narrationText: string;
  characterId: string;
  onSpeak: (words: string, approach: "persuade" | "intimidate" | "deceive") => void;
  onSocialIntent: (approach: "persuade" | "intimidate" | "deceive") => void;
  onAskRumors: () => void;
  onApproach: () => void; // Unmet -> rollReaction
  onClose: () => void;
  isLoading: boolean;
}

const DISPOSITION_ICONS: Record<DispositionBand, string> = {
  Hostile: "💀",
  Unfriendly: "⚔️",
  Indifferent: "👁️",
  Friendly: "🤝",
  Helpful: "⭐"
};

const DISPOSITION_COLORS: Record<DispositionBand, string> = {
  Hostile: "#ef4444",     // Red
  Unfriendly: "#f97316",  // Orange
  Indifferent: "#a1a1aa", // Zinc
  Friendly: "#eab308",    // Yellow
  Helpful: "#22c55e"      // Green
};

export default function DialogueOverlay({
  npc,
  narrationText,
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
  const scrollRef = useRef<HTMLDivElement>(null);

  const band = getDispositionBand(npc.disposition);
  /**
   * NEVER RENDER: secret is for engine use only. 
   * The player only sees Motivation and Distinctive Trait.
   */

  // ── Focus Trap & Accessibility ─────────────────────────────────────────────
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;

    const focusableElements = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Tab") {
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }
      if (e.key === "Escape") onClose();
    }

    el.addEventListener("keydown", handleKeyDown);
    first?.focus();
    return () => el.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Auto-scroll narration
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [narrationText]);

  const dispositionPercent = ((npc.disposition + 10) / 20) * 100;

  return (
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm transition-opacity duration-300"
      aria-modal="true"
      role="dialog"
      aria-labelledby="npc-dialogue-title"
    >
      <style jsx global>{`
        @keyframes dg-dialogue-in {
          from { opacity: 0; transform: scale(0.97) translateY(10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes intimidate-shimmer {
          0%, 100% { box-shadow: 0 0 0 rgba(239,68,68,0); }
          50% { box-shadow: 0 0 15px rgba(239,68,68,0.4); }
        }
        .dialogue-card {
          animation: dg-dialogue-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>

      <div 
        ref={overlayRef}
        className="dialogue-card relative w-full max-w-2xl bg-[#0c0c16] border border-[#3b2d1a]/60 shadow-2xl rounded-xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header: NPC Identity & Disposition Icon */}
        <header className="px-6 py-5 border-b border-[#3b2d1a]/40 bg-[#161622] flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div 
              className="w-12 h-12 rounded-full border-2 border-amber-900/50 flex items-center justify-center text-3xl bg-[#0c0c16]"
              aria-hidden="true"
            >
              {DISPOSITION_ICONS[band]}
            </div>
            <div>
              <h2 id="npc-dialogue-title" className="text-xl font-bold text-amber-100 tracking-wide uppercase italic" style={{ fontFamily: "var(--font-cinzel)" }}>
                {npc.name}
              </h2>
              <p className="text-xs text-amber-700/80 font-semibold tracking-[0.15em] uppercase" style={{ fontFamily: "var(--font-inter)" }}>
                {npc.race} {npc.profession ? `• ${npc.profession}` : ""}
              </p>
            </div>
          </div>
          
          <div className="text-right">
            <span 
              className="text-[10px] font-bold uppercase tracking-widest block mb-1"
              style={{ color: DISPOSITION_COLORS[band], opacity: 0.8 }}
            >
              {band}
            </span>
            <div className="text-xs text-amber-500/40">
              {npc.disposition > 0 ? "+" : ""}{npc.disposition} Engagement
            </div>
          </div>
        </header>

        {/* Disposition Meter */}
        <div className="px-8 py-4 bg-[#11111d] border-b border-[#3b2d1a]/20">
          <div className="flex justify-between text-[9px] font-bold text-amber-900 mb-1 uppercase tracking-tighter">
            <span>Hostile</span>
            <span>Indifferent</span>
            <span>Helpful</span>
          </div>
          <div 
            className="h-2.5 w-full bg-[#08080c] rounded-full border border-neutral-900 overflow-hidden relative"
            role="meter"
            aria-valuenow={npc.disposition}
            aria-valuemin={-10}
            aria-valuemax={10}
            aria-label="NPC Disposition"
          >
            {/* Gradient Background */}
            <div className="absolute inset-0 bg-gradient-to-r from-red-950 via-neutral-900 to-green-950 opacity-40" />
            
            {/* Active Progress Bar */}
            <div 
              className="h-full relative transition-[width] duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
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
        <div className="flex-1 flex min-h-0">
          {/* Narration Log */}
          <section className="flex-1 p-6 overflow-y-auto bg-[#0a0a0f]" ref={scrollRef}>
            <div 
              className="text-amber-100/90 text-lg leading-relaxed whitespace-pre-wrap"
              style={{ fontFamily: "var(--font-crimson)" }}
            >
              {narrationText}
              {isLoading && (
                <span className="inline-block w-2 h-4 ml-1 bg-amber-600 animate-pulse align-middle" />
              )}
            </div>
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
                      "{npc.personalityTags.motivation}"
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
        <footer className="p-6 bg-[#161622] border-t border-[#3b2d1a]/40 space-y-4">
          
          {npc.hasMetPlayer ? (
            <>
              {/* Intent Quick Actions */}
              <div className="grid grid-cols-3 gap-3">
                <button 
                  disabled={isLoading}
                  onClick={() => onSocialIntent("persuade")}
                  className="flex items-center justify-center gap-2 py-3 rounded bg-amber-900/10 border border-amber-900/30 text-amber-500 hover:bg-amber-900/20 transition-all text-xs font-bold uppercase tracking-widest disabled:opacity-50"
                  style={{ fontFamily: "var(--font-cinzel)" }}
                >
                  🤝 Persuade
                </button>
                <button 
                  disabled={isLoading}
                  onClick={() => onSocialIntent("intimidate")}
                  className="flex items-center justify-center gap-2 py-3 rounded bg-red-950/20 border border-red-900/30 text-red-500 hover:bg-red-900/40 transition-all text-xs font-bold uppercase tracking-widest disabled:opacity-50"
                  style={{ fontFamily: "var(--font-cinzel)", animation: "intimidate-shimmer 3s infinite" }}
                >
                  💀 Intimidate
                </button>
                <button 
                  disabled={isLoading}
                  onClick={() => onSocialIntent("deceive")}
                  className="flex items-center justify-center gap-2 py-3 rounded bg-purple-950/20 border border-purple-900/30 text-purple-400 hover:bg-purple-900/40 transition-all text-xs font-bold uppercase tracking-widest disabled:opacity-50"
                  style={{ fontFamily: "var(--font-cinzel)" }}
                >
                  🎭 Deceive
                </button>
              </div>

              {/* Custom Input */}
              <div className="flex flex-col gap-2">
                <div className="flex gap-1">
                  {(["persuade", "intimidate", "deceive"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setApproach(mode)}
                      className={`px-3 py-1 text-[9px] uppercase font-bold tracking-widest rounded-t border-t border-x transition-colors ${
                        approach === mode 
                          ? 'bg-[#0c0c16] text-amber-500 border-amber-900/40' 
                          : 'bg-transparent text-neutral-600 border-transparent hover:text-neutral-400'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <textarea 
                    value={customWords}
                    onChange={(e) => setCustomWords(e.target.value)}
                    placeholder="Speak your mind..."
                    className="flex-1 bg-[#0c0c16] border border-[#3b2d1a]/40 rounded-md p-3 text-sm text-amber-50 placeholder-amber-900/40 focus:outline-none focus:border-amber-500 transition-colors resize-none h-20"
                    disabled={isLoading}
                  />
                  <button 
                    onClick={() => {
                      if (!customWords.trim()) return;
                      onSpeak(customWords, approach);
                      setCustomWords("");
                    }}
                    disabled={isLoading || !customWords.trim()}
                    className="px-6 bg-amber-700 hover:bg-amber-600 font-bold uppercase tracking-widest text-xs text-white rounded transition-colors disabled:opacity-50"
                    style={{ fontFamily: "var(--font-cinzel)" }}
                  >
                    Speak
                  </button>
                </div>
              </div>

              {/* Utility Row */}
              <div className="flex items-center justify-between pt-2">
                <button 
                  onClick={onAskRumors}
                  disabled={isLoading || npc.disposition < 3}
                  className={`flex items-center gap-2 text-xs font-bold uppercase tracking-widest transition-colors ${
                    npc.disposition < 3 ? 'text-neutral-700 cursor-not-allowed' : 'text-amber-600 hover:text-amber-400'
                  }`}
                  aria-label={npc.disposition < 3 ? "Disposition too low to ask for rumors" : "Ask for rumors"}
                >
                  {npc.disposition < 3 ? "🔒" : "📜"} Gather Rumors
                </button>
                <button 
                  onClick={onClose}
                  className="text-xs font-bold uppercase tracking-widest text-neutral-500 hover:text-neutral-300 transition-colors"
                >
                  End Conversation
                </button>
              </div>
            </>
          ) : (
            /* Unmet State: Approach Button */
            <div className="flex flex-col items-center gap-4 py-8">
              <p className="text-amber-700 italic text-sm text-center max-w-sm">
                This figure has not yet acknowledged your presence.
              </p>
              <button 
                onClick={onApproach}
                disabled={isLoading}
                className="w-full max-w-xs py-4 bg-amber-700 hover:bg-amber-600 text-white font-bold uppercase tracking-[0.2em] rounded border border-amber-600/50 shadow-[0_0_20px_rgba(180,130,50,0.2)] transition-all disabled:opacity-50"
                style={{ fontFamily: "var(--font-cinzel)" }}
              >
                Approach & Introduce
              </button>
              <button 
                onClick={onClose}
                className="text-xs font-bold uppercase tracking-widest text-neutral-600 hover:text-neutral-400"
              >
                Remain Shadowed
              </button>
            </div>
          )}
        </footer>

        {/* Loading Overlay (Thin strip) */}
        {isLoading && (
          <div className="absolute top-[68px] left-0 right-0 h-0.5 overflow-hidden">
            <div className="h-full bg-amber-500 animate-[loading-bar_1.5s_infinite_linear]" style={{ width: '40%' }} />
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
