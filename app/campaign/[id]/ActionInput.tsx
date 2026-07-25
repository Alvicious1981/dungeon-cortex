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

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import type { ActionStreamFrame } from "@/lib/events/game-events";
import {
  DUNGEON_ACTION_REQUEST,
  createDungeonActionRequestId,
  dispatchDungeonActionEnd,
  dispatchDungeonActionError,
  dispatchDungeonActionStart,
  type DungeonActionRequestDetail,
} from "@/lib/events/action-transport";

interface Props {
  campaignId: string;
  selectableTargets?: Array<{
    id: string;
    name: string;
    hp: number;
    maxHp: number;
    isPlayer: boolean;
  }>;
}

export default function ActionInput({ campaignId, selectableTargets = [] }: Props) {
  const router = useRouter();
  const [action, setAction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>([]);
  /** null  = idle; ""    = events received, waiting for first token;
   *  string = partial or complete optimistic narrative text           */
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const aliveHostileTargets = useMemo(
    () => selectableTargets.filter((target) => !target.isPlayer && target.hp > 0),
    [selectableTargets]
  );

  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const pendingAction = action.trim();
    if (!pendingAction || submittingRef.current) return;
    setAction("");
    await executeAction({
      requestId: createDungeonActionRequestId(),
      request: { action: pendingAction, targetIds: selectedTargetIds },
    });
  }

  useEffect(() => {
    const validTargetIds = new Set(aliveHostileTargets.map((target) => target.id));
    setSelectedTargetIds((current) => {
      const next = current.filter((id) => validTargetIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [aliveHostileTargets]);

  function toggleTarget(targetId: string) {
    setSelectedTargetIds((current) =>
      current.includes(targetId)
        ? current.filter((id) => id !== targetId)
        : [...current, targetId]
    );
  }

  const executeAction = useCallback(async (detail: DungeonActionRequestDetail) => {
    const pendingAction = detail.request.action.trim();
    const request = { ...detail.request, action: pendingAction };

    submittingRef.current = true;
    setError(null);
    setSubmitting(true);
    setStreamingText("");
    setStreamError(null);
    dispatchDungeonActionStart({ ...detail, request });

    try {
      const res = await fetch(`/api/campaign/${campaignId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as Record<string, unknown>);
        const errorMessage =
          (data as { error?: string }).error ?? `Error ${res.status}`;
        setError(errorMessage);
        setStreamingText(null);
        dispatchDungeonActionError({ ...detail, request, error: errorMessage });
        return;
      }

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
        const frames = buffer.split("\n\n");
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
            window.dispatchEvent(
              new CustomEvent("dungeon-game-event", { detail: { event: parsed.e } })
            );
          } else if (parsed.t === "txt") {
            setStreamingText((prev) => (prev ?? "") + parsed.d);
            window.dispatchEvent(
              new CustomEvent("dungeon-token", { detail: { chunk: parsed.d } })
            );
          } else if (parsed.t === "level_up") {
            window.dispatchEvent(
              new CustomEvent("dungeon-level-up", { detail: parsed.payload })
            );
          } else if (parsed.t === "merchant") {
            window.dispatchEvent(
              new CustomEvent("dungeon-merchant", { detail: parsed.payload })
            );
          } else if (parsed.t === "dialogue_open") {
            window.dispatchEvent(
              new CustomEvent("dungeon-dialogue-open", { detail: parsed.payload })
            );
          } else if (parsed.t === "dialogue_update") {
            window.dispatchEvent(
              new CustomEvent("dungeon-dialogue-update", {
                detail: { disposition: parsed.disposition },
              })
            );
          } else if (parsed.t === "done") {
            done = true;
            break;
          }
        }
      }

      setStreamingText(null);
      router.refresh();
    } catch {
      const errorMessage =
        "The connection to the Dungeon Master was severed. Please refresh or try your action again.";
      setStreamError(errorMessage);
      dispatchDungeonActionError({ ...detail, request, error: errorMessage });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
      dispatchDungeonActionEnd({ ...detail, request });
    }
  }, [campaignId, router]);

  useEffect(() => {
    function handleRequestedAction(event: Event) {
      const { detail } = event as CustomEvent<DungeonActionRequestDetail>;
      if (!detail?.request.action.trim()) return;

      if (submittingRef.current) {
        const errorMessage = "Another action is already being resolved.";
        dispatchDungeonActionError({ ...detail, error: errorMessage });
        dispatchDungeonActionEnd(detail);
        return;
      }

      const targetAwareDetail =
        detail.request.action.trim() === "Attack" &&
        detail.request.targetIds === undefined &&
        selectedTargetIds.length > 0
          ? {
              ...detail,
              request: {
                ...detail.request,
                targetIds: selectedTargetIds,
              },
            }
          : detail;

      void executeAction(targetAwareDetail);
    }

    window.addEventListener(DUNGEON_ACTION_REQUEST, handleRequestedAction);
    return () =>
      window.removeEventListener(DUNGEON_ACTION_REQUEST, handleRequestedAction);
  }, [executeAction, selectedTargetIds]);

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
        <p className="dc-kicker">Declare your intent</p>
        {aliveHostileTargets.length > 0 && (
          <fieldset className="rounded-md border border-neutral-700/80 bg-neutral-900/60 px-3 py-2">
            <legend
              className="px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400"
              style={{ fontFamily: "var(--font-cinzel), serif" }}
            >
              Targets
            </legend>
            <div className="flex flex-wrap gap-2">
              {aliveHostileTargets.map((target) => {
                const selected = selectedTargetIds.includes(target.id);
                return (
                  <label
                    key={target.id}
                    className={`flex cursor-pointer items-center gap-2 rounded border px-2.5 py-1.5 text-xs transition-colors ${
                      selected
                        ? "border-amber-500/70 bg-amber-950/30 text-amber-100"
                        : "border-neutral-700 bg-neutral-950/30 text-neutral-300 hover:border-neutral-500"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={submitting}
                      onChange={() => toggleTarget(target.id)}
                      className="h-3.5 w-3.5 accent-amber-500"
                    />
                    <span className="font-medium">{target.name}</span>
                    <span className="text-neutral-500">
                      {target.hp}/{target.maxHp}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

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
            className="dc-field min-h-12 flex-1 rounded-sm px-3 py-2 text-sm placeholder:text-[#675c4a] disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={submitting || !action.trim()}
            className="dc-button-primary min-w-20 rounded-sm px-4 py-3 text-sm uppercase tracking-wider"
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
