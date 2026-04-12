"use client";

/**
 * components/combat/GameEventHandler.tsx
 *
 * Invisible client component that listens for deterministic game events
 * dispatched by ActionInput and InitiativeTracker, and responds with
 * procedural Web Audio sounds and brief CSS visual effects.
 *
 * Milestone E Slice 3 additions:
 *   • inCombat prop     — drives exploration vs combat ambient drone
 *   • Master GainNode   — enables the mute toggle without stopping AudioContext
 *   • Ambient drone     — procedural low-frequency pad, fades between modes
 *   • New event sounds  — ENCOUNTER_START, TURN_ADVANCE, ROUND_ADVANCE
 *   • Mute button       — fixed-position; preference persisted to localStorage
 *
 * Reduced-motion note:
 *   prefers-reduced-motion gates screen-shake ONLY (visual motion).
 *   Audio is a separate sensory channel; the mute toggle is the correct UX control.
 *
 * AudioContext gesture constraint:
 *   AudioContext requires a user gesture to start. ActionInput dispatches
 *   "dungeon-action-start" synchronously inside the form submit handler.
 *   The context (and drone) are created there, satisfying the browser policy.
 */

import { useEffect, useRef, useState } from "react";
import type { GameEvent } from "@/lib/events/game-events";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  /** Whether a combat encounter is currently active. Drives ambient drone mode. */
  inCombat: boolean;
}

// ─── Audio synthesis helpers ──────────────────────────────────────────────────
// All helpers accept `dest: AudioNode` (the master GainNode) so mute works for
// every sound without stopping or recreating the AudioContext.

function playTone(
  ctx: AudioContext,
  dest: AudioNode,
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
  gain.connect(dest);

  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + durationMs / 1000);
}

function playSweep(
  ctx: AudioContext,
  dest: AudioNode,
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
  gain.connect(dest);

  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + durationMs / 1000);
}

function playChord(
  ctx: AudioContext,
  dest: AudioNode,
  freqs: number[],
  durationMs: number,
  gainPeak = 0.2,
) {
  for (const freq of freqs) {
    playTone(ctx, dest, freq, "sine", durationMs, gainPeak);
  }
}

function playEventSound(ctx: AudioContext, dest: AudioNode, event: GameEvent) {
  switch (event.type) {
    case "CRITICAL_HIT":
      // Sharp ascending double-tap: martial impact
      playTone(ctx, dest, 220, "sawtooth", 80, 0.4);
      setTimeout(() => playTone(ctx, dest, 440, "square", 200, 0.35), 80);
      break;

    case "CRITICAL_MISS":
      // Descending wobble: fumble
      playSweep(ctx, dest, 300, 80, "sine", 300, 0.3);
      break;

    case "DAMAGE_DEALT":
      // Short thud: solid hit
      playTone(ctx, dest, 120, "sawtooth", 100, 0.35);
      break;

    case "ENEMY_DEFEATED":
      // Triumphant rising chord
      playChord(ctx, dest, [523, 659, 784], 500, 0.25);
      setTimeout(() => playTone(ctx, dest, 1046, "sine", 400, 0.2), 100);
      break;

    case "SPELL_CAST":
      // Magical rising sweep
      playSweep(ctx, dest, 440, 1760, "sine", 350, 0.25);
      setTimeout(() => playTone(ctx, dest, 880, "sine", 200, 0.15), 180);
      break;

    case "HEALING_RECEIVED":
      // Warm restorative tone
      playChord(ctx, dest, [523, 659], 400, 0.2);
      break;

    case "PLAYER_DOWNED":
      // Slow descending toll
      playSweep(ctx, dest, 220, 55, "sine", 800, 0.4);
      break;

    case "ENCOUNTER_START":
      // Rising metallic tension burst: tritone cluster
      playTone(ctx, dest, 220, "square", 80, 0.3);
      setTimeout(() => playTone(ctx, dest, 311, "square", 120, 0.25), 50);
      setTimeout(() => playSweep(ctx, dest, 277, 440, "sine", 300, 0.2), 80);
      break;

    case "TURN_ADVANCE":
      // Crisp tick — signals whose turn it is
      playTone(ctx, dest, 1200, "square", 35, 0.07);
      break;

    case "ROUND_ADVANCE":
      // Two-tone chime — clearly signals a round boundary
      playTone(ctx, dest, 523, "sine", 280, 0.12);
      setTimeout(() => playTone(ctx, dest, 659, "sine", 280, 0.12), 60);
      setTimeout(() => playTone(ctx, dest, 880, "sine", 200, 0.1), 140);
      break;
  }
}

// ─── Ambient drone ────────────────────────────────────────────────────────────

interface DroneNodes {
  oscillators: OscillatorNode[];
  lfo: OscillatorNode;
  lfoGain: GainNode;
  droneGain: GainNode; // faded in/out during mode transitions
}

/**
 * Build and immediately start an ambient drone routed through `dest`.
 * The drone gain ramps from 0 to the target over 1 second.
 */
function buildDrone(ctx: AudioContext, dest: AudioNode, combat: boolean): DroneNodes {
  const droneGain = ctx.createGain();
  droneGain.gain.setValueAtTime(0, ctx.currentTime); // silent; fade-in below
  droneGain.connect(dest);

  const oscillators: OscillatorNode[] = [];

  if (combat) {
    // Two slightly detuned oscillators create a beating, tense texture
    const osc1 = ctx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(42, ctx.currentTime);
    const osc1Gain = ctx.createGain();
    osc1Gain.gain.setValueAtTime(0.022, ctx.currentTime);
    osc1.connect(osc1Gain);
    osc1Gain.connect(droneGain);
    osc1.start();
    oscillators.push(osc1);

    const osc2 = ctx.createOscillator();
    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(84, ctx.currentTime);
    osc2.detune.setValueAtTime(4, ctx.currentTime);
    const osc2Gain = ctx.createGain();
    osc2Gain.gain.setValueAtTime(0.012, ctx.currentTime);
    osc2.connect(osc2Gain);
    osc2Gain.connect(droneGain);
    osc2.start();
    oscillators.push(osc2);
  } else {
    // Single low sine pad for exploration
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(68, ctx.currentTime);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.018, ctx.currentTime);
    osc.connect(oscGain);
    oscGain.connect(droneGain);
    osc.start();
    oscillators.push(osc);
  }

  // LFO for amplitude modulation: additive connection to droneGain.gain AudioParam
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.setValueAtTime(combat ? 3.6 : 0.04, ctx.currentTime);

  const lfoGain = ctx.createGain();
  lfoGain.gain.setValueAtTime(combat ? 0.01 : 0.004, ctx.currentTime);

  lfo.connect(lfoGain);
  lfoGain.connect(droneGain.gain); // additive: modulates the master drone amplitude
  lfo.start();

  // Fade drone in over 1 second
  const targetGain = combat ? 0.025 : 0.016;
  droneGain.gain.linearRampToValueAtTime(targetGain, ctx.currentTime + 1.0);

  return { oscillators, lfo, lfoGain, droneGain };
}

/**
 * Fade out `drone` over 1.5 s, then stop and disconnect all nodes.
 * `onDone` fires after the teardown settles (used to sequence mode switches).
 */
function teardownDrone(ctx: AudioContext, drone: DroneNodes, onDone: () => void) {
  const now = ctx.currentTime;
  drone.droneGain.gain.cancelScheduledValues(now);
  drone.droneGain.gain.setValueAtTime(0.03, now); // safe upper-bound start for ramp
  drone.droneGain.gain.linearRampToValueAtTime(0.001, now + 1.5);

  setTimeout(() => {
    for (const osc of drone.oscillators) {
      try { osc.stop(); } catch { /* already stopped */ }
    }
    try { drone.lfo.stop(); } catch { /* already stopped */ }
    drone.lfoGain.disconnect();
    drone.droneGain.disconnect();
    onDone();
  }, 1600);
}

// ─── Visual effects ───────────────────────────────────────────────────────────

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
  void document.body.offsetWidth; // force reflow so re-adding triggers animation
  document.body.classList.add(SHAKE_CLASS);
  document.body.addEventListener(
    "animationend",
    () => document.body.classList.remove(SHAKE_CLASS),
    { once: true },
  );
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

export default function GameEventHandler({ inCombat }: Props) {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const droneRef = useRef<DroneNodes | null>(null);

  // Refs mirror state/props so event-listener closures always read current values
  // without the listeners needing to re-register on every change.
  const inCombatRef = useRef(inCombat);
  const isMutedRef = useRef(false);

  const [isMuted, setIsMuted] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("dungeon-audio-muted") === "true";
  });

  // Keep refs in sync
  useEffect(() => { inCombatRef.current = inCombat; }, [inCombat]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  // Apply mute change to master gain node
  useEffect(() => {
    const ctx = audioCtxRef.current;
    const masterGain = masterGainRef.current;
    if (!ctx || !masterGain) return;
    masterGain.gain.setValueAtTime(isMuted ? 0 : 1, ctx.currentTime);
  }, [isMuted]);

  // Swap ambient drone when combat mode changes (only once AudioContext exists)
  useEffect(() => {
    const ctx = audioCtxRef.current;
    const masterGain = masterGainRef.current;
    if (!ctx || !masterGain) return; // context not yet created; drone starts in onActionStart

    const newDrone = buildDrone(ctx, masterGain, inCombat);
    const oldDrone = droneRef.current;
    droneRef.current = newDrone;

    if (oldDrone) {
      teardownDrone(ctx, oldDrone, () => { /* new drone already running */ });
    }
  }, [inCombat]);

  // Wire up global event bus — runs once, uses refs for current state
  useEffect(() => {
    function onActionStart(_e: DungeonActionStartEvent) {
      if (!audioCtxRef.current) {
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;

        // Master gain: all sounds route through here; mute = gain 0
        const masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(isMutedRef.current ? 0 : 1, ctx.currentTime);
        masterGain.connect(ctx.destination);
        masterGainRef.current = masterGain;

        // Start ambient drone now that we have a live AudioContext
        droneRef.current = buildDrone(ctx, masterGain, inCombatRef.current);
      } else if (audioCtxRef.current.state === "suspended") {
        void audioCtxRef.current.resume();
      }
    }

    function onGameEvent(e: DungeonGameEvent) {
      const { event } = e.detail;
      const ctx = audioCtxRef.current;
      const masterGain = masterGainRef.current;
      if (ctx?.state === "running" && masterGain) {
        playEventSound(ctx, masterGain, event);
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
  }, []); // intentionally empty — listeners read live state via refs

  function handleMuteToggle() {
    const next = !isMuted;
    setIsMuted(next);
    localStorage.setItem("dungeon-audio-muted", String(next));
  }

  return (
    <button
      type="button"
      aria-label={isMuted ? "Unmute audio" : "Mute audio"}
      onClick={handleMuteToggle}
      className="fixed bottom-3 right-3 z-50 flex h-8 w-8 items-center justify-center rounded-full text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
      style={{
        background: "rgba(12,12,22,0.88)",
        border: `1px solid ${isMuted ? "rgba(107,114,128,0.3)" : "rgba(228,168,50,0.22)"}`,
        color: isMuted ? "#6B7280" : "#C49A2A",
      }}
    >
      {isMuted ? "🔇" : "🔊"}
    </button>
  );
}
