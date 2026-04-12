"use client";

/**
 * ActionInput.tsx — Milestone I upgrade
 *
 * Consumes the SSE action stream from /api/campaign/[id]/action:
 *   1.  On submit: dispatches "dungeon-action-start" so GameEventHandler can
 *       create / resume AudioContext inside the user gesture.
 *   2.  Reads SSE frames:
 *         t:"evt"  → dispatches "dungeon-game-event" CustomEvent (audio + FX)
 *         t:"txt"  → appends delta to the optimistic narrative bubble
 *         t:"done" → calls router.refresh() to sync server state
 *   3.  Shows a pulsing "DM is narrating…" skeleton while Phase 1 events
 *       arrive and Phase 2 tokens have not yet started flowing.
 *   4.  Reserves min-height on the narrative bubble to prevent layout shift
 *       (ui-ux-pro-max: content-jumping rule).
 *
 * Error handling: JSON error bodies from 4xx responses are surfaced; network
 * failures fall through to a generic message.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionStreamFrame } from "@/lib/events/game-events";

interface Props {
  campaignId: string;
}

export default function ActionInput({ campaignId }: Props) {
  const router = useRouter();
  const [action, setAction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** null  = idle; ""    = events received, waiting for first token;
   *  string = partial or complete optimistic narrative text           */
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!action.trim() || submitting) return;

    setError(null);
    setSubmitting(true);
    setStreamingText("");
    setStreamError(null);

    // ── User-gesture chain: warm up AudioContext in GameEventHandler ──────────
    // This fires synchronously before any await, so it counts as a user gesture.
    window.dispatchEvent(new CustomEvent("dungeon-action-start"));

    const pendingAction = action.trim();
    setAction("");

    try {
      const res = await fetch(`/api/campaign/${campaignId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: pendingAction }),
      });

      // 4xx / 5xx: read JSON error body (same shape as before)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as Record<string, unknown>);
        setError((data as { error?: string }).error ?? `Error ${res.status}`);
        setStreamingText(null);
        return;
      }

      // ── Consume SSE stream ────────────────────────────────────────────────
      if (!res.body) {
        setStreamingText(null);
        router.refresh();
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;

      while (!done) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by double newlines
        const frames = buffer.split("\n\n");
        // Keep the last (possibly incomplete) chunk in the buffer
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          if (!frame.startsWith("data: ")) continue;
          const raw = frame.slice(6).trim();
          if (!raw) continue;

          let parsed: ActionStreamFrame;
          try {
            parsed = JSON.parse(raw) as ActionStreamFrame;
          } catch {
            continue;
          }

          if (parsed.t === "evt") {
            // Phase 1: deterministic game event — forward to GameEventHandler
            window.dispatchEvent(
              new CustomEvent("dungeon-game-event", { detail: { event: parsed.e } })
            );
          } else if (parsed.t === "txt") {
            // Phase 2: narrative token — append to optimistic bubble
            setStreamingText((prev) => (prev ?? "") + parsed.d);
          } else if (parsed.t === "done") {
            // Phase 3: stream complete
            done = true;
            break;
          }
        }
      }

      // Clear optimistic bubble and sync server state
      setStreamingText(null);
      router.refresh();
    } catch {
      // Network failure or stream interrupted
      setStreamError("The connection to the Dungeon Master was severed. Please refresh or try your action again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">

      {/* ── Optimistic narrative bubble ──────────────────────────────────────
          Visible while the stream is active.
          - Min-height is reserved immediately to prevent layout shift.
          - Shows a pulsing skeleton before the first token arrives.
          - Matches the DM log entry style from the chronicle.
      ────────────────────────────────────────────────────────────────────── */}
      {streamingText !== null && (
        <div
          className="rounded-lg px-4 py-3"
          style={{
            background: "rgba(12,12,22,0.92)",
            border: "1px solid rgba(100,70,14,0.25)",
            minHeight: "4.5rem",  // reserve space — prevents layout shift
          }}
        >
          <span
            className="mb-1.5 block text-[9px] font-semibold uppercase tracking-[0.2em]"
            style={{ fontFamily: "var(--font-cinzel)", color: "#8A6B1A" }}
          >
            Dungeon Master
          </span>

          {streamingText === "" && !streamError ? (
            /* Skeleton: DM is generating — show pulsing placeholder lines */
            <div className="space-y-2 animate-pulse" aria-label="Dungeon Master is narrating…" role="status">
              <div
                className="h-3 rounded"
                style={{ background: "rgba(228,168,50,0.08)", width: "85%" }}
              />
              <div
                className="h-3 rounded"
                style={{ background: "rgba(228,168,50,0.06)", width: "70%" }}
              />
              <div
                className="h-3 rounded"
                style={{ background: "rgba(228,168,50,0.04)", width: "50%" }}
              />
            </div>
          ) : (
            <>
              {streamingText !== "" && (
                <p
                  className="text-sm leading-relaxed"
                  style={{
                    fontFamily: "var(--font-crimson)",
                    fontSize: "0.9375rem",
                    lineHeight: "1.75",
                    color: "#C8BEA0",
                    marginBottom: streamError ? "0.75rem" : "0"
                  }}
                >
                  {streamingText}
                  {/* Blinking cursor while stream is active */}
                  {!streamError && (
                    <span
                      aria-hidden="true"
                      className="inline-block w-0.5 h-4 ml-0.5 align-middle motion-safe:animate-pulse"
                      style={{ background: "#8A6B1A", verticalAlign: "middle" }}
                    />
                  )}
                </p>
              )}
              {streamError && (
                <div className="mt-3 rounded border border-red-900/50 bg-red-950/20 p-3">
                  <p className="text-sm text-red-400 mb-2">{streamError}</p>
                  <button 
                    onClick={() => {
                      setStreamError(null);
                      setStreamingText(null);
                      router.refresh();
                    }}
                    type="button"
                    className="text-xs bg-red-900/40 hover:bg-red-900/60 transition-colors px-2 py-1.5 rounded text-red-200 cursor-pointer uppercase font-semibold tracking-wider"
                    style={{ fontFamily: "var(--font-cinzel), serif" }}
                  >
                    Clear & Sync
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Input form ────────────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex gap-2">
          <label htmlFor="action-input" className="sr-only">
            Your action
          </label>
          <input
            id="action-input"
            type="text"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            disabled={submitting}
            maxLength={500}
            placeholder="What do you do?"
            className="flex-1 min-h-[44px] rounded-md bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={submitting || !action.trim()}
            className="rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-3 text-sm font-semibold text-white transition-colors cursor-pointer"
          >
            {submitting ? "…" : "Act"}
          </button>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-400 bg-red-950/40 rounded px-3 py-2">
            {error}
          </p>
        )}
      </form>

    </div>
  );
}
