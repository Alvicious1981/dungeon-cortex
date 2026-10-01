"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  DUNGEON_ACTION_END,
  DUNGEON_ACTION_ERROR,
  createDungeonActionRequestId,
  requestDungeonAction,
  type DungeonActionErrorDetail,
  type DungeonActionRequestDetail,
} from "@/lib/events/action-transport";
import { COMBAT_GRID_SIZE } from "@/lib/rules/geometry";

type Position = { x: number; y: number };
type MoveDraft = { id: string; origin: Position; destination: Position };

export interface BattleGridCombatant {
  id: string; name: string; isPlayer: boolean; hp: number; maxHp: number; ac: number; x: number; y: number; size: string;
}

interface BattleGridProps { combatants: BattleGridCombatant[]; activeCombatantId?: string; }

function sizeToSquares(size: string): number {
  switch (size) { case "Large": return 2; case "Huge": return 3; case "Gargantuan": return 4; default: return 1; }
}
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length === 1 ? parts[0]!.slice(0, 2).toUpperCase() : `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

export default function BattleGrid({ combatants, activeCombatantId }: BattleGridProps) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const tokenRefs = useRef(new Map<string, HTMLButtonElement>());
  const [draft, setDraft] = useState<MoveDraft | null>(null);
  const draftRef = useRef<MoveDraft | null>(null);
  const dragRef = useRef<{ pointerId: number; size: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [movePending, setMovePending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingMove = useRef<(MoveDraft & { requestId: string; failed: boolean }) | null>(null);

  function preview(move: MoveDraft | null) {
    draftRef.current = move;
    setDraft(move);
  }

  const cancelPreview = useCallback(() => {
    const id = draftRef.current?.id;
    dragRef.current = null;
    setDragging(false);
    draftRef.current = null;
    setDraft(null);
    if (id) tokenRefs.current.get(id)?.focus();
  }, []);

  useEffect(() => {
    // A refresh supersedes a preview if the authoritative origin has changed.
    const current = draftRef.current;
    if (!current) return;
    const owner = combatants.find((combatant) => combatant.id === current.id && combatant.isPlayer);
    if (!owner || owner.x !== current.origin.x || owner.y !== current.origin.y) cancelPreview();
  }, [combatants, cancelPreview]);

  function getCurrentPos(combatant: BattleGridCombatant): Position {
    const requested = pendingMove.current;
    const source = draft?.id === combatant.id ? draft.destination :
      requested?.id === combatant.id && !requested.failed ? requested.destination : combatant;
    const maxStart = COMBAT_GRID_SIZE - sizeToSquares(combatant.size);
    return { x: clamp(source.x, 0, maxStart), y: clamp(source.y, 0, maxStart) };
  }

  function pointerToCell(clientX: number, clientY: number, size: number): Position | null {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0 ||
      clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) return null;
    const maxStart = COMBAT_GRID_SIZE - size;
    return {
      x: clamp(Math.floor((clientX - rect.left) / (rect.width / COMBAT_GRID_SIZE)), 0, maxStart),
      y: clamp(Math.floor((clientY - rect.top) / (rect.height / COMBAT_GRID_SIZE)), 0, maxStart),
    };
  }

  function commitMove() {
    const move = draftRef.current;
    if (!move || pendingMove.current || (move.origin.x === move.destination.x && move.origin.y === move.destination.y)) return;
    const requestId = createDungeonActionRequestId();
    pendingMove.current = { ...move, requestId, failed: false };
    setError(null);
    preview(null);
    setMovePending(true);
    requestDungeonAction({ action: "Move", targetX: move.destination.x, targetY: move.destination.y }, requestId);
  }

  useEffect(() => {
    function handleActionError(event: Event) {
      const detail = (event as CustomEvent<DungeonActionErrorDetail>).detail;
      const pending = pendingMove.current;
      if (!pending || detail.requestId !== pending.requestId) return;
      pending.failed = true;
      setError("No se pudo completar el movimiento. Revisa la posición actual y elige de nuevo.");
    }

    function handleActionEnd(event: Event) {
      const detail = (event as CustomEvent<DungeonActionRequestDetail>).detail;
      if (detail.requestId !== pendingMove.current?.requestId) return;
      pendingMove.current = null;
      setMovePending(false);
    }

    window.addEventListener(DUNGEON_ACTION_ERROR, handleActionError);
    window.addEventListener(DUNGEON_ACTION_END, handleActionEnd);
    return () => {
      window.removeEventListener(DUNGEON_ACTION_ERROR, handleActionError);
      window.removeEventListener(DUNGEON_ACTION_END, handleActionEnd);
    };
  }, []);

  useEffect(() => {
    function onMove(event: PointerEvent) {
      const drag = dragRef.current;
      const move = draftRef.current;
      if (!drag || !move || event.pointerId !== drag.pointerId) return;
      const destination = pointerToCell(event.clientX, event.clientY, drag.size);
      if (!destination) return;
      drag.moved = drag.moved || destination.x !== move.origin.x || destination.y !== move.origin.y;
      preview({ ...move, destination });
    }
    function onUp(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      suppressClickRef.current = drag.moved;
      dragRef.current = null;
      setDragging(false);
      // Releasing prepares a destination only. It never submits the action.
      if (!pointerToCell(event.clientX, event.clientY, drag.size)) cancelPreview();
    }
    function onCancel(event: PointerEvent) {
      if (!dragRef.current || event.pointerId !== dragRef.current.pointerId) return;
      suppressClickRef.current = true;
      cancelPreview();
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [cancelPreview]);

  function selectToken(combatant: BattleGridCombatant) {
    if (!combatant.isPlayer || pendingMove.current) return;
    const origin = { x: combatant.x, y: combatant.y };
    preview({ id: combatant.id, origin, destination: origin });
    setError(null);
  }

  function startDrag(event: ReactPointerEvent, combatant: BattleGridCombatant) {
    suppressClickRef.current = false;
    // Touch taps use the selection path; vertical gestures remain page scrolling.
    if (event.pointerType === "touch" || !combatant.isPlayer || pendingMove.current || event.button !== 0) return;
    event.preventDefault();
    tokenRefs.current.get(combatant.id)?.focus();
    selectToken(combatant);
    dragRef.current = { pointerId: event.pointerId, size: sizeToSquares(combatant.size), moved: false };
    setDragging(true);
  }

  function selectDestination(event: ReactMouseEvent<HTMLDivElement>) {
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    const move = draftRef.current;
    if (!move || pendingMove.current) return;
    const combatant = combatants.find((entry) => entry.id === move.id);
    if (!combatant) return;
    const destination = pointerToCell(event.clientX, event.clientY, sizeToSquares(combatant.size));
    if (destination) preview({ ...move, destination });
  }

  function handleTokenKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, combatant: BattleGridCombatant) {
    if (!combatant.isPlayer || pendingMove.current) return;
    const deltas: Record<string, Position> = {
      ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
    };
    const delta = deltas[event.key];
    if (delta) {
      event.preventDefault();
      const move = draftRef.current?.id === combatant.id ? draftRef.current : null;
      const origin = move?.origin ?? { x: combatant.x, y: combatant.y };
      const current = move?.destination ?? origin;
      const maxStart = COMBAT_GRID_SIZE - sizeToSquares(combatant.size);
      const destination = { x: clamp(current.x + delta.x, 0, maxStart), y: clamp(current.y + delta.y, 0, maxStart) };
      preview(destination.x === origin.x && destination.y === origin.y ? null : { id: combatant.id, origin, destination });
      setError(null);
    } else if (event.key === "Enter" && draftRef.current?.id === combatant.id) {
      event.preventDefault();
      commitMove();
    }
  }

  const changed = draft && (draft.origin.x !== draft.destination.x || draft.origin.y !== draft.destination.y);

  return (
    <section aria-label="Cuadrícula táctica" onKeyDown={(event) => {
      if (event.key === "Escape" && draftRef.current && !pendingMove.current) { event.preventDefault(); cancelPreview(); }
    }} className="rounded-sm border border-zinc-700/80 bg-zinc-950/90 p-3 shadow-[0_8px_28px_rgba(0,0,0,0.55)]">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-300" style={{ fontFamily: "var(--font-cinzel)" }}>Cuadrícula táctica {COMBAT_GRID_SIZE}x{COMBAT_GRID_SIZE}</p>
        {movePending && <span role="status" className="text-sm text-amber-200">Comprobando movimiento…</span>}
      </div>
      <p id="battle-grid-help" className="mb-2 text-sm text-zinc-300">Selecciona tu ficha y toca el destino, o arrástrala. Con teclado, usa las flechas y Enter para confirmar. Escape cancela.</p>

      <div ref={boardRef} role="grid" aria-describedby="battle-grid-help" onClick={selectDestination} className="relative aspect-square w-full overflow-hidden rounded-sm border border-zinc-700/80 bg-zinc-900" style={{ touchAction: "pan-y", backgroundImage: "radial-gradient(circle at 15% 10%, rgba(255,255,255,0.04), transparent 45%), linear-gradient(to bottom, rgba(24,24,27,0.98), rgba(9,9,11,0.98))" }}>
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${COMBAT_GRID_SIZE}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${COMBAT_GRID_SIZE}, minmax(0, 1fr))` }}>{Array.from({ length: COMBAT_GRID_SIZE * COMBAT_GRID_SIZE }).map((_, index) => <div key={index} className="border border-zinc-700/50" />)}</div>
        <div className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${COMBAT_GRID_SIZE}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${COMBAT_GRID_SIZE}, minmax(0, 1fr))` }}>
          {combatants.map((combatant) => {
            const pos = getCurrentPos(combatant);
            const side = sizeToSquares(combatant.size);
            const isActive = combatant.id === activeCombatantId;
            const isSelected = draft?.id === combatant.id;
            const canMove = combatant.isPlayer && !movePending;
            return (
              <button key={combatant.id} ref={(element) => { if (element) tokenRefs.current.set(combatant.id, element); else tokenRefs.current.delete(combatant.id); }}
                type="button" role="gridcell" onPointerDown={(event) => startDrag(event, combatant)}
                onClick={(event) => { event.stopPropagation(); if (suppressClickRef.current) { suppressClickRef.current = false; return; } selectToken(combatant); }}
                onKeyDown={(event) => handleTokenKeyDown(event, combatant)} disabled={!canMove} aria-selected={isSelected} aria-label={`Ficha de ${combatant.name} en ${pos.x},${pos.y}`}
                className="relative z-10 m-0.5 flex h-[calc(100%-0.25rem)] w-[calc(100%-0.25rem)] items-center justify-center rounded-full border text-center shadow-lg transition-transform disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                style={{
                  pointerEvents: canMove ? "auto" : "none", touchAction: "pan-y",
                  gridColumn: `${pos.x + 1} / span ${side}`, gridRow: `${pos.y + 1} / span ${side}`, cursor: canMove ? dragging && isSelected ? "grabbing" : "grab" : "default",
                  background: combatant.isPlayer ? "radial-gradient(circle at 32% 28%, #facc15 0%, #92400e 100%)" : "radial-gradient(circle at 32% 28%, #f87171 0%, #7f1d1d 100%)",
                  borderColor: isSelected ? "#fff" : isActive ? "#fde68a" : "rgba(39,39,42,0.95)", borderStyle: isSelected ? "dashed" : "solid",
                  boxShadow: isSelected || isActive ? "0 0 0 2px rgba(253,230,138,0.45), 0 6px 20px rgba(0,0,0,0.6)" : "0 4px 14px rgba(0,0,0,0.65)", transform: dragging && isSelected ? "scale(1.04)" : "scale(1)",
                }}><span className="pointer-events-none text-[10px] font-bold tracking-wide text-amber-50">{initials(combatant.name)}</span></button>
            );
          })}
        </div>
      </div>

      <div className="mt-2 space-y-2 text-sm text-zinc-300">
        {error ? <p role="alert" className="text-red-300">{error}</p> : draft ? (
          <p role="status" className="text-amber-200">{changed ? `Destino previsto: ${draft.destination.x},${draft.destination.y}. Confirma con Enter o el botón.` : "Ficha seleccionada. Toca una casilla de destino."}</p>
        ) : !movePending ? <p>1 casilla = 5 pies. El movimiento se comprueba al confirmar.</p> : null}
        {draft && <div className="flex flex-wrap gap-2">
          <button type="button" onClick={commitMove} disabled={!changed} className="min-h-11 rounded border border-amber-400/60 bg-amber-800 px-3 text-sm text-amber-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">Confirmar movimiento</button>
          <button type="button" onClick={cancelPreview} className="min-h-11 rounded border border-zinc-500 px-3 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">Cancelar movimiento</button>
        </div>}
      </div>
    </section>
  );
}
