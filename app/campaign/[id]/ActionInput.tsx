"use client";

/** The sole action transport. Received story content belongs to CampaignStoryProvider. */

import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { StatusMessage } from "@/components/ui/StatusMessage";
import type { ActionStreamFrame } from "@/lib/events/game-events";
import { DUNGEON_PREPARE_ACTION, type PrepareActionDetail } from "@/lib/events/campaign-ui";
import { useCampaignStory } from "./CampaignStoryProvider";
import {
  ATTACK_SINGLE_TARGET_REQUIRED,
  DUNGEON_ACTION_REQUEST,
  DUNGEON_TARGET_SELECTION_SYNC_REQUEST,
  createDungeonActionRequestId,
  dispatchDungeonActionEnd,
  dispatchDungeonActionError,
  dispatchDungeonActionStart,
  dispatchDungeonTargetSelection,
  type DungeonActionRequestBody,
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
  /** Why free-text actions are unavailable, e.g. an unconscious player (death-saves spec §7.4). */
  disabledReason?: string;
  controls?: ReactNode;
}

export default function ActionInput({ campaignId, selectableTargets = [], disabledReason, controls }: Props) {
  const router = useRouter();
  const story = useCampaignStory()?.actions;
  const inputRef = useRef<HTMLInputElement>(null);
  const [preparedAction, setPreparedAction] = useState<string | null>(null);
  const [action, setAction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);
  /**
   * The submission whose outcome is still uncertain, kept verbatim so an
   * explicit retry resends the *same* `requestId` (DC-AUD-003). Without this
   * the server's idempotency key is inert: re-typing the action mints a new id
   * and the backend has no way to recognise the repeat.
   *
   * Cleared only on a terminal outcome — never on entry to `executeAction`.
   * Clearing on entry would discard it the moment a retry came back
   * ACTION_IN_FLIGHT, leaving the player nothing to retry with but a fresh id.
   */
  const [retryable, setRetryable] = useState<{
    detail: DungeonActionRequestDetail;
    /** "retry" after a transport failure; "recheck" while the server says in-flight. */
    mode: "retry" | "recheck";
  } | null>(null);
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

  // This list is the single source of truth for the selection; broadcast every
  // change (including pruning) so MacroDeck's one-target Attack guard sees it,
  // and answer sync requests from listeners that mount later.
  const selectedTargetIdsRef = useRef(selectedTargetIds);
  useEffect(() => {
    selectedTargetIdsRef.current = selectedTargetIds;
    dispatchDungeonTargetSelection(selectedTargetIds);
  }, [selectedTargetIds]);

  useEffect(() => {
    function handleSyncRequest() {
      dispatchDungeonTargetSelection(selectedTargetIdsRef.current);
    }
    window.addEventListener(DUNGEON_TARGET_SELECTION_SYNC_REQUEST, handleSyncRequest);
    return () =>
      window.removeEventListener(DUNGEON_TARGET_SELECTION_SYNC_REQUEST, handleSyncRequest);
  }, []);

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

    // The correlation id the local start/end/error events carry is the same id
    // the server receives. Written after the spread so it is `detail.requestId`
    // and not something a caller smuggled onto the request, and never minted
    // here: a second id would look identical in the UI while leaving the
    // backend unable to recognise a repeat of this submission.
    const body: DungeonActionRequestBody = { ...request, requestId: detail.requestId };

    submittingRef.current = true;
    setError(null);
    setSubmitting(true);
    story?.begin(detail.requestId, pendingAction);
    setStreamError(null);
    dispatchDungeonActionStart({ ...detail, request });

    try {
      const res = await fetch(`/api/campaign/${campaignId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as Record<string, unknown>);
        const errorMessage =
          (data as { error?: string }).error ?? `Error ${res.status}`;
        const code = (data as { code?: string }).code;

        if (code === "ACTION_IN_FLIGHT") {
          // The server owns this submission and cannot yet say how it ended.
          // Keep the exact detail so "Comprobar de nuevo" asks about the SAME
          // id — repeatedly, if need be. Surfaced through `streamError` so it
          // reuses the recovery panel, which already offers a state refresh.
          setRetryable({ detail, mode: "recheck" });
          setStreamError(errorMessage);
          story?.finish(detail.requestId, "uncertain");
          dispatchDungeonActionError({ ...detail, request, error: errorMessage });
          return;
        }

        // Everything else is terminal for this id: a mechanical refusal is a
        // decision, not an unknown, and REQUEST_ID_REUSED means the id can
        // never be sent again. Neither may enter the transport-retry path.
        // Guarded by id so a later submission cannot clear a different one.
        setRetryable((current) =>
          current && current.detail.requestId === detail.requestId ? null : current
        );
        setError(errorMessage);
        story?.finish(detail.requestId, "refused");
        dispatchDungeonActionError({ ...detail, request, error: errorMessage });
        return;
      }

      if (!res.body) {
        story?.finish(detail.requestId, "received");
        router.refresh();
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;
      let receivedText = "";
      let eventIndex = 0;

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
            story?.event(detail.requestId, parsed.e, eventIndex++);
            window.dispatchEvent(
              new CustomEvent("dungeon-game-event", { detail: { event: parsed.e } })
            );
          } else if (parsed.t === "txt") {
            receivedText += parsed.d;
            story?.text(detail.requestId, receivedText);
            window.dispatchEvent(
              new CustomEvent("dungeon-token", { detail: { chunk: parsed.d } })
            );
          } else if (parsed.t === "level_up_available") {
            // A level-up the backend detected but has NOT applied. Kept on its
            // own event so nothing downstream can mistake a pending payload for
            // an applied one — it carries no roll, no gain and no new maximum.
            window.dispatchEvent(
              new CustomEvent("dungeon-level-up-available", { detail: parsed.payload })
            );
          } else if (parsed.t === "level_up") {
            // An applied level-up. Unchanged: the celebration overlay still
            // listens here and still receives a resolved LevelUpPayload.
            window.dispatchEvent(
              new CustomEvent("dungeon-level-up", { detail: parsed.payload })
            );
          } else if (parsed.t === "merchant") {
            window.dispatchEvent(
              new CustomEvent("dungeon-merchant", { detail: parsed.payload })
            );
          } else if (parsed.t === "done") {
            done = true;
            break;
          }
        }
      }

      // The stream ran to `done`. That covers both an ordinary turn and a
      // duplicate — either way this submission is settled, so nothing is left
      // to retry and the refresh below reconciles canonical state.
      setRetryable((current) =>
        current && current.detail.requestId === detail.requestId ? null : current
      );
      story?.finish(detail.requestId, "received");
      router.refresh();
    } catch {
      const errorMessage =
        "Se perdió la conexión con el Director de Mazmorras. Actualiza o vuelve a intentar la acción.";
      // Transport failure: the outcome is unknown, so keep the exact detail —
      // same id, same action, same targets — for an explicit retry. Never
      // automatic; the player decides.
      setRetryable({ detail, mode: "retry" });
      setStreamError(errorMessage);
      story?.finish(detail.requestId, "uncertain");
      dispatchDungeonActionError({ ...detail, request, error: errorMessage });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
      dispatchDungeonActionEnd({ ...detail, request });
    }
  }, [campaignId, router, story]);

  useEffect(() => {
    function handleRequestedAction(event: Event) {
      const { detail } = event as CustomEvent<DungeonActionRequestDetail>;
      if (!detail?.request.action.trim()) return;

      if (submittingRef.current) {
        const errorMessage = "Ya se está resolviendo otra acción.";
        dispatchDungeonActionError({ ...detail, error: errorMessage });
        dispatchDungeonActionEnd(detail);
        return;
      }

      // An Attack without targets (e.g. the HUD's F1 button) takes the Objetivos
      // selection, which must be exactly one target — the same rule MacroDeck
      // applies before it builds its own request.
      if (
        detail.request.action.trim() === "Attack" &&
        detail.request.targetIds === undefined
      ) {
        if (selectedTargetIds.length !== 1) {
          setError(ATTACK_SINGLE_TARGET_REQUIRED);
          dispatchDungeonActionError({ ...detail, error: ATTACK_SINGLE_TARGET_REQUIRED });
          dispatchDungeonActionEnd(detail);
          return;
        }
        void executeAction({
          ...detail,
          request: { ...detail.request, targetIds: [...selectedTargetIds] },
        });
        return;
      }

      void executeAction(detail);
    }

    window.addEventListener(DUNGEON_ACTION_REQUEST, handleRequestedAction);
    return () =>
      window.removeEventListener(DUNGEON_ACTION_REQUEST, handleRequestedAction);
  }, [executeAction, selectedTargetIds]);

  function focusAction() {
    // The equipment sheet can close in this same event. Focus after it unmounts.
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.scrollIntoView?.({ block: "nearest", behavior: "auto" });
    });
  }

  useEffect(() => {
    function handlePrepare(event: Event) {
      const proposed = (event as CustomEvent<PrepareActionDetail>).detail?.action?.trim();
      if (!proposed) return;
      if (submittingRef.current || action.trim() || disabledReason) {
        setPreparedAction(proposed);
        return;
      }
      setAction(proposed);
      focusAction();
    }
    window.addEventListener(DUNGEON_PREPARE_ACTION, handlePrepare);
    return () => window.removeEventListener(DUNGEON_PREPARE_ACTION, handlePrepare);
  }, [action, disabledReason]);

  return (
    <div className="min-w-0 space-y-3">
      <form onSubmit={handleSubmit} className="min-w-0 space-y-3">
        {aliveHostileTargets.length > 0 && (
          <fieldset className="rounded-md border border-neutral-700/80 bg-neutral-900/60 px-3 py-2">
            <legend className="px-1 text-sm font-semibold text-neutral-200">Objetivos</legend>
            <p className="mb-2 text-xs text-neutral-400">Selecciona un objetivo para atacar.</p>
            <div className="flex flex-wrap gap-2">
              {aliveHostileTargets.map((target) => {
                const selected = selectedTargetIds.includes(target.id);
                return (
                  <label
                    key={target.id}
                    className={`flex min-h-11 cursor-pointer items-center gap-2 rounded border px-3 py-2 text-sm transition-colors ${
                      selected
                        ? "border-amber-500/70 bg-amber-950/30 text-amber-100"
                        : "border-neutral-700 bg-neutral-950/30 text-neutral-300 hover:border-neutral-500"
                    }`}
                  >
                    <input type="checkbox" checked={selected} disabled={submitting}
                      onChange={() => toggleTarget(target.id)} className="h-4 w-4 accent-amber-500" />
                    <span className="font-medium">{target.name}</span>
                    <span className="text-neutral-400">{target.hp}/{target.maxHp}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}
        {controls}
        <label htmlFor="action-input" className="block text-sm font-semibold text-amber-200">Tu acción</label>
        <div className="flex min-w-0 gap-2">
          <input
            ref={inputRef} id="action-input" type="text" value={action}
            onChange={(e) => setAction(e.target.value)} disabled={submitting || Boolean(disabledReason)}
            maxLength={500} placeholder={disabledReason ?? "¿Qué intentas hacer?"}
            className="dc-field min-h-12 min-w-0 flex-1 rounded-sm px-3 py-2 text-base placeholder:text-neutral-400 disabled:opacity-50"
          />
          <Button type="submit" loading={submitting} disabled={!action.trim() || Boolean(disabledReason)}
            className="shrink-0 text-sm">
            {submitting ? "Resolviendo…" : "Actuar"}
          </Button>
        </div>
        {disabledReason && <p className="text-sm text-neutral-300">{disabledReason}</p>}
        {preparedAction && (
          <div role="status" className="rounded border border-amber-900/50 p-3 text-sm text-amber-100">
            <p>Acción preparada: {preparedAction}</p>
            {submitting && <p className="mt-1 text-neutral-300">Podrás usarla cuando termine la acción actual.</p>}
            {action.trim() && <p className="mt-1 text-neutral-300">Tu borrador sigue en el campo.</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="secondary" size="compact" disabled={submitting || Boolean(disabledReason)}
                onClick={() => { setAction(preparedAction); setPreparedAction(null); focusAction(); }}>
                {action.trim() ? "Sustituir borrador" : "Usar acción preparada"}
              </Button>
              <Button variant="ghost" size="compact" onClick={() => setPreparedAction(null)}>Descartar preparación</Button>
            </div>
          </div>
        )}
        {error && <StatusMessage tone="error" title="No se pudo realizar la acción">{error}</StatusMessage>}
      </form>
      {streamError && (
        <StatusMessage tone="error" title="No se pudo completar la respuesta">
          <p className="mb-2 text-sm">{streamError}</p>
          <div className="flex flex-wrap gap-2">
            {retryable && (
              <Button onClick={() => { void executeAction(retryable.detail); }} variant="secondary" size="compact" disabled={submitting}>
                {retryable.mode === "recheck" ? "Comprobar de nuevo" : "Reintentar"}
              </Button>
            )}
            <Button onClick={() => { setStreamError(null); router.refresh(); }} variant="ghost" size="compact">Descartar y sincronizar</Button>
          </div>
        </StatusMessage>
      )}
    </div>
  );
}
