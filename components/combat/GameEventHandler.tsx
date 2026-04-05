"use client";

/**
 * components/combat/GameEventHandler.tsx
 *
 * Invisible client component that listens for deterministic game events
 * dispatched by ActionInput and responds with procedural Web Audio sounds
 * and brief CSS visual effects.
 *
 * Web Audio API gesture constraint
 * ─────────────────────────────────
 * AudioContext requires a user gesture to start.  ActionInput dispatches
 * "dungeon-action-start" synchronously inside the form's submit handler
 * (which IS a user gesture).  This component creates / resumes the
 * AudioContext in that handler — before any SSE frames arrive — satisfying
 * the browser's autoplay policy.
 *
 * Reduced-motion
 * ──────────────
 * Screen-shake is gated behind `prefers-reduced-motion: no-preference`.
 * Audio is not motion; it plays regardless.
 *
 * Sounds are synthesised with the Web Audio API (no audio files needed).
 */

import { useEffect, useRef } from "react";
import type { GameEvent } from "@/lib/events/game-events";

// ─── Audio synthesis helpers ─────────────────────────────────────────────────

/** Play a single oscillator tone with a quick fade-out. */
function playTone(
  ctx: AudioContext,
  freq: number,
  type: OscillatorType,
  durationMs: number,
  gainPeak = 0.35,
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  gain.gain.setValueAtTime(gainPeak, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + durationMs / 1000);
}

/** Play a sweep from startFreq to endFreq over durationMs. */
function playSweep(
  ctx: AudioContext,
  startFreq: number,
  endFreq: number,
  type: OscillatorType,
  durationMs: number,
  gainPeak = 0.3,
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(startFreq, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(endFreq, ctx.currentTime + durationMs / 1000);
  gain.gain.setValueAtTime(gainPeak, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + durationMs / 1000);
}

/** Play a triumphant two-note hit (used for critical hit and enemy defeated). */
function playChord(
  ctx: AudioContext,
  freqs: number[],
  durationMs: number,
  gainPeak = 0.2,
) {
  for (const freq of freqs) {
    playTone(ctx, freq, "sine", durationMs, gainPeak);
  }
}

function playEventSound(ctx: AudioContext, event: GameEvent) {
  switch (event.type) {
    case "CRITICAL_HIT":
      // Sharp ascending double-tap: martial impact
      playTone(ctx, 220, "sawtooth", 80, 0.4);
      setTimeout(() => playTone(ctx, 440, "square", 200, 0.35), 80);
      break;

    case "CRITICAL_MISS":
      // Descending wobble: fumble
      playSweep(ctx, 300, 80, "sine", 300, 0.3);
      break;

    case "DAMAGE_DEALT":
      // Short thud: solid hit
      playTone(ctx, 120, "sawtooth", 100, 0.35);
      break;

    case "ENEMY_DEFEATED":
      // Triumphant rising chord
      playChord(ctx, [523, 659, 784], 500, 0.25);
      setTimeout(() => playTone(ctx, 1046, "sine", 400, 0.2), 100);
      break;

    case "SPELL_CAST":
      // Magical rising sweep
      playSweep(ctx, 440, 1760, "sine", 350, 0.25);
      setTimeout(() => playTone(ctx, 880, "sine", 200, 0.15), 180);
      break;

    case "HEALING_RECEIVED":
      // Warm restorative tone
      playChord(ctx, [523, 659], 400, 0.2);
      break;

    case "PLAYER_DOWNED":
      // Slow descending toll
      playSweep(ctx, 220, 55, "sine", 800, 0.4);
      break;
  }
}

// ─── Visual effects ───────────────────────────────────────────────────────────

/** CSS class injected on <body> for screen shake.  Auto-removed after animation. */
const SHAKE_CLASS = "dungeon-screen-shake";

let shakeStyleInjected = false;

function ensureShakeStyle() {
  if (shakeStyleInjected) return;
  shakeStyleInjected = true;

  const style = document.createElement("style");
  style.textContent = `
    @media (prefers-reduced-motion: no-preference) {
      @keyframes dungeon-shake {
        0%   { transform: translate(0, 0) rotate(0deg); }
        20%  { transform: translate(-3px, 2px) rotate(-0.4deg); }
        40%  { transform: translate(3px, -2px) rotate(0.4deg); }
        60%  { transform: translate(-2px, 1px) rotate(-0.2deg); }
        80%  { transform: translate(2px, -1px) rotate(0.2deg); }
        100% { transform: translate(0, 0) rotate(0deg); }
      }
      body.${SHAKE_CLASS} {
        animation: dungeon-shake 0.25s ease-in-out;
      }
    }
  `;
  document.head.appendChild(style);
}

function triggerScreenShake() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  ensureShakeStyle();
  document.body.classList.remove(SHAKE_CLASS);
  // Force reflow so re-adding the class triggers the animation again
  void document.body.offsetWidth;
  document.body.classList.add(SHAKE_CLASS);

  const onEnd = () => {
    document.body.classList.remove(SHAKE_CLASS);
    document.body.removeEventListener("animationend", onEnd);
  };
  document.body.addEventListener("animationend", onEnd, { once: true });
}

function applyVisualEffect(event: GameEvent) {
  switch (event.type) {
    case "CRITICAL_HIT":
    case "ENEMY_DEFEATED":
      triggerScreenShake();
      break;
    default:
      break;
  }
}

// ─── Custom event types ───────────────────────────────────────────────────────

interface DungeonActionStartEvent extends Event {
  type: "dungeon-action-start";
}

interface DungeonGameEvent extends CustomEvent {
  type: "dungeon-game-event";
  detail: { event: GameEvent };
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Renders nothing.  Mounts once in the campaign layout and wires up
 * the global event bus used by ActionInput.
 */
export default function GameEventHandler() {
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    /**
     * "dungeon-action-start" fires synchronously from the form submit handler
     * — a genuine user gesture.  Creating / resuming AudioContext here satisfies
     * the browser autoplay policy before any SSE frames arrive.
     */
    function onActionStart(_e: DungeonActionStartEvent) {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      } else if (audioCtxRef.current.state === "suspended") {
        void audioCtxRef.current.resume();
      }
    }

    function onGameEvent(e: DungeonGameEvent) {
      const { event } = e.detail;
      if (audioCtxRef.current && audioCtxRef.current.state === "running") {
        playEventSound(audioCtxRef.current, event);
      }
      applyVisualEffect(event);
    }

    const actionStartHandler = onActionStart as EventListener;
    const gameEventHandler = onGameEvent as EventListener;

    window.addEventListener("dungeon-action-start", actionStartHandler);
    window.addEventListener("dungeon-game-event", gameEventHandler);

    return () => {
      window.removeEventListener("dungeon-action-start", actionStartHandler);
      window.removeEventListener("dungeon-game-event", gameEventHandler);
    };
  }, []);

  return null;
}
