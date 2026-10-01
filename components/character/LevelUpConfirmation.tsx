"use client";

/**
 * components/character/LevelUpConfirmation.tsx
 *
 * The decision step between "the backend says a level-up is pending" and "the
 * backend applied it".
 *
 * This component is deliberately separate from AscensionOverlay. It renders a
 * `LevelUpAvailablePayload`, which describes a level-up that has NOT happened:
 * there is no hit-point roll, no gain and no new maximum to show, because those
 * values do not exist until the player picks a method and the server rolls.
 * AscensionOverlay keeps its own job — celebrating a resolved LevelUpPayload —
 * and the two payload types are never mixed.
 *
 * The only thing this component decides is the player's intent
 * (`useAverage: true | false`). Everything mechanical is the backend's:
 * `applyLevelUp` behind POST /api/campaign/[id]/level-up remains the single
 * authority that may resolve a level. Nothing here computes, merges, increments
 * or decrements a payload.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CircleAlert, Dices, Divide, LoaderCircle, Sparkles, X } from "lucide-react";
import type { LevelUpAvailablePayload } from "@/lib/actions/backend-presentation-resolution";
import type { LevelUpPayload } from "@/lib/rules/progression";
import { useModalFocus } from "@/lib/hooks/useModalFocus";

export const DUNGEON_LEVEL_UP_AVAILABLE = "dungeon-level-up-available";
export const DUNGEON_LEVEL_UP = "dungeon-level-up";

interface Props {
  /** Passed explicitly by the page. Never read from the URL or the DOM. */
  campaignId: string;
}

/**
 * Statuses whose payload is no longer usable: the pending level-up this panel
 * was built from is gone, already applied, unreachable or unverifiable. Retrying
 * with the same payload cannot succeed, so the panel closes and the client
 * resynchronises instead of offering a button that would repeat a dead request.
 */
const STALE_PAYLOAD_STATUSES = new Set([401, 404, 409, 422]);

/** Stable, code-keyed copy. The route's own messages are English; this is the UI. */
function staleNoticeFor(status: number): string {
  switch (status) {
    case 401:
      return "Tu sesión ya no es válida para esta acción. Se ha resincronizado el estado de la campaña.";
    case 404:
      return "Esta campaña ya no está disponible. Se ha resincronizado el estado.";
    case 409:
      return "El estado cambió: la subida ya no está pendiente o ya se aplicó. Se ha resincronizado el estado.";
    default:
      return "El estado de progresión almacenado es inconsistente. Se ha resincronizado el estado.";
  }
}

function recoverableErrorFor(status: number): string {
  if (status === 400) {
    return "La petición no era válida. Vuelve a intentarlo.";
  }
  return "No se pudo aplicar la subida de nivel. Vuelve a intentarlo.";
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

interface DecisionPanelProps extends Props {
  payload: LevelUpAvailablePayload;
  onApplied(applied: LevelUpPayload): void;
  onStale(status: number): void;
  onBusyChange(busy: boolean): void;
  onPostpone(): void;
  returnFocusRef: RefObject<HTMLElement | null>;
}

export function LevelUpDecisionPanel({
  campaignId,
  payload,
  onApplied,
  onStale,
  onBusyChange,
  onPostpone,
  returnFocusRef,
}: DecisionPanelProps) {
  const [pending, setPending] = useState<"average" | "roll" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pendingRef = useRef(false);

  const busy = pending !== null;
  const postpone = useCallback(() => {
    if (!pendingRef.current) onPostpone();
  }, [onPostpone]);
  useModalFocus({ open: true, onClose: postpone, dialogRef, initialFocusRef: headingRef, returnFocusRef });

  async function confirm(useAverage: boolean) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(useAverage ? "average" : "roll");
    onBusyChange(true);
    setError(null);

    try {
      const response = await fetch(`/api/campaign/${campaignId}/level-up`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `toLevel` binds retries to the concrete transition the backend
        // presented. The server still derives and validates the level.
        body: JSON.stringify({ useAverage, targetLevel: payload.toLevel }),
      });

      const body = (await response.json().catch(() => ({}))) as {
        payload?: LevelUpPayload;
        error?: string;
        code?: string;
      };

      if (!response.ok) {
        if (STALE_PAYLOAD_STATUSES.has(response.status)) {
          // The payload this panel holds is dead. Hand control back so the
          // controller can discard it and resynchronise; never offer a retry.
          onStale(response.status);
          return;
        }
        setError(recoverableErrorFor(response.status));
        return;
      }

      if (!body.payload) {
        setError("La respuesta del servidor no incluyó el resultado aplicado.");
        return;
      }

      onApplied(body.payload);
    } catch {
      setError("Se perdió la conexión al confirmar la subida. Vuelve a intentarlo.");
    } finally {
      pendingRef.current = false;
      setPending(null);
      onBusyChange(false);
    }
  }

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="level-up-confirmation-title"
      aria-busy={busy}
      tabIndex={-1}
      className="fixed inset-0 z-[2100] flex items-center justify-center overflow-y-auto bg-black/80 p-4"
    >
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-lg border border-amber-500/40 bg-neutral-950 p-6 shadow-2xl">
        <h2
          ref={headingRef}
          tabIndex={-1}
          id="level-up-confirmation-title"
          className="flex items-center gap-2 text-lg font-semibold text-amber-100"
        >
          <Sparkles size={20} aria-hidden="true" />
          Subida de nivel disponible
        </h2>

        <p className="mt-2 text-sm text-neutral-400">
          Tu personaje puede subir al nivel {payload.toLevel}. La
          subida <strong className="text-neutral-200">todavía no se ha aplicado</strong>: elige
          cómo determinar los puntos de golpe.
        </p>

        {/* Only what is known before applying. No roll, no gain, no new maximum. */}
        <dl className="mt-4 grid grid-cols-2 gap-3 border-y border-neutral-800 py-4 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wider text-neutral-500">Nivel</dt>
            <dd className="text-neutral-100">
              {payload.fromLevel} → {payload.toLevel}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-neutral-500">Clase</dt>
            <dd className="capitalize text-neutral-100">{payload.className}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-neutral-500">Dado de golpe</dt>
            <dd className="text-neutral-100">{payload.hitDie}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-neutral-500">Mod. CON</dt>
            <dd className="text-neutral-100">{signed(payload.conModifier)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-neutral-500">PG máx. actuales</dt>
            <dd className="text-neutral-100">{payload.currentMaxHp}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-neutral-500">Dados de golpe</dt>
            <dd className="text-neutral-100">{payload.currentHitDiceTotal}</dd>
          </div>
        </dl>

        {/* Backend-authorized counters, displayed verbatim. This panel resolves
            one level per confirmation; the rest stay pending until the backend
            emits them again. */}
        {payload.pendingLevels > 1 && (
          <p className="mt-3 text-xs text-neutral-500">
            Subidas pendientes: {payload.pendingLevels} (nivel objetivo{" "}
            {payload.targetLevel}). Esta confirmación aplica solo una.
          </p>
        )}

        {error && (
          <p
            role="alert"
            className="mt-4 rounded border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-200"
          >
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => void confirm(true)}
            disabled={busy}
            className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-neutral-700 px-4 text-sm font-medium text-neutral-100 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            {pending === "average" ? (
              <LoaderCircle className="animate-spin" size={17} aria-hidden="true" />
            ) : (
              <Divide size={17} aria-hidden="true" />
            )}
            Usar el promedio
          </button>
          <button
            type="button"
            onClick={() => void confirm(false)}
            disabled={busy}
            className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md bg-amber-700 px-4 text-sm font-semibold text-amber-50 hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            {pending === "roll" ? (
              <LoaderCircle className="animate-spin" size={17} aria-hidden="true" />
            ) : (
              <Dices size={17} aria-hidden="true" />
            )}
            Tirar el dado
          </button>
        </div>
        {busy && <p role="status" className="mt-3 text-sm text-amber-200">Confirmando la subida de nivel… Espera a que termine.</p>}
        <button type="button" onClick={postpone} disabled={busy}
          className="mt-3 min-h-11 w-full rounded-md px-4 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300">
          Decidir más tarde
        </button>
      </div>
    </div>,
    document.body
  );
}

/**
 * Non-modal replacement shown once a payload has gone stale. It deliberately
 * holds no payload, so there is no control here capable of repeating the
 * request — the player is informed but never trapped.
 */
export function StaleLevelUpNotice({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss(): void;
}) {
  return (
    <div
      role="status"
      className="fixed bottom-24 left-1/2 z-40 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 rounded-md border border-amber-700/50 bg-neutral-950/95 p-3 shadow-xl md:bottom-4"
    >
      <div className="flex items-start gap-2">
        <CircleAlert size={17} className="mt-0.5 shrink-0 text-amber-400" aria-hidden="true" />
        <p className="flex-1 text-sm text-neutral-200">{message}</p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Cerrar aviso"
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/**
 * Listens for `dungeon-level-up-available` and, once the player confirms and the
 * server applies the level-up, hands the resolved payload to the existing
 * celebration overlay through the unchanged `dungeon-level-up` event.
 *
 * Replacement rule for concurrent frames: while a confirmation is in flight
 * (`busy`), the payload the player is confirming is never swapped out. Outside
 * that window the most recent backend-authorized payload wins outright — it is
 * fresher state, and superseding it wholesale is the only safe move. Payloads
 * are replaced, never merged or adjusted.
 */
export default function LevelUpConfirmationController({ campaignId }: Props) {
  const router = useRouter();
  const [payload, setPayload] = useState<LevelUpAvailablePayload | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [postponed, setPostponed] = useState(false);
  const payloadRef = useRef(payload);
  payloadRef.current = payload;
  const busyRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function handleAvailable(event: Event) {
      const detail = (event as CustomEvent<LevelUpAvailablePayload>).detail;
      if (!detail) return;
      // Never swap the payload out from under an in-flight confirmation.
      if (busyRef.current) return;
      if (!document.querySelector('[aria-labelledby="level-up-confirmation-title"]')) {
        returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      // The backend re-detects whatever is still pending on every turn and emits it again. A
      // postponement belongs to that decision: keep it for the same level-up, reopen for another.
      const current = payloadRef.current;
      const sameDecision =
        current !== null && current.characterId === detail.characterId && current.toLevel === detail.toLevel;
      setNotice(null);
      setPayload(detail);
      if (!sameDecision) setPostponed(false);
    }

    window.addEventListener(DUNGEON_LEVEL_UP_AVAILABLE, handleAvailable);
    return () => window.removeEventListener(DUNGEON_LEVEL_UP_AVAILABLE, handleAvailable);
  }, []);

  const handleBusyChange = useCallback((busy: boolean) => {
    busyRef.current = busy;
  }, []);

  const handleApplied = useCallback(
    (applied: LevelUpPayload) => {
      // Close the decision step first, then celebrate. The applied payload is
      // the server's, never one this component assembled.
      setPayload(null);
      window.dispatchEvent(new CustomEvent(DUNGEON_LEVEL_UP, { detail: applied }));
      router.refresh();
    },
    [router]
  );

  const handleStale = useCallback(
    (status: number) => {
      // The pending payload is invalidated here and nowhere else. No applied
      // event is emitted, and the notice that replaces the panel carries no
      // payload, so the dead request cannot be repeated.
      setPayload(null);
      setNotice(staleNoticeFor(status));
      router.refresh();
    },
    [router]
  );

  const dismissNotice = useCallback(() => setNotice(null), []);
  const postpone = useCallback(() => setPostponed(true), []);

  if (payload) {
    return (
      <>
      <button ref={triggerRef} type="button" onClick={() => {
        returnFocusRef.current = triggerRef.current;
        setPostponed(false);
      }} className="fixed bottom-24 left-4 z-40 min-h-11 rounded-md border border-amber-500/40 bg-neutral-950 px-4 text-sm text-amber-100 shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300">
        Retomar subida al nivel {payload.toLevel}
      </button>
      {!postponed && <LevelUpDecisionPanel
        campaignId={campaignId}
        payload={payload}
        onApplied={handleApplied}
        onStale={handleStale}
        onBusyChange={handleBusyChange}
        onPostpone={postpone}
        returnFocusRef={returnFocusRef}
      />}
      </>
    );
  }

  if (notice) {
    return <StaleLevelUpNotice message={notice} onDismiss={dismissNotice} />;
  }

  return null;
}
