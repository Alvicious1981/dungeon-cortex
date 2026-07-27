"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  DUNGEON_ACTION_END,
  DUNGEON_ACTION_ERROR,
  createDungeonActionRequestId,
  requestDungeonAction,
  type DungeonActionErrorDetail,
  type DungeonActionRequestDetail,
} from "@/lib/events/action-transport";
import {
  normalizeSizeCategory,
  sizeToSquares,
  type TacticalMap,
} from "@/lib/rules/geometry";

type Position = { x: number; y: number };
type KeyboardMove = { id: string; origin: Position; destination: Position };

export interface BattleGridCombatant {
  id: string; name: string; isPlayer: boolean; hp: number; maxHp: number; ac: number; x: number; y: number; size: string;
}

interface BattleGridProps { combatants: BattleGridCombatant[]; map: TacticalMap; activeCombatantId?: string; }

function footprintSide(size: string): number {
  return sizeToSquares(normalizeSizeCategory(size));
}
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length === 1 ? parts[0]!.slice(0, 2).toUpperCase() : `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

export default function BattleGrid({ combatants, map, activeCombatantId }: BattleGridProps) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOrigin, setDragOrigin] = useState<Position | null>(null);
  const [dragCell, setDragCell] = useState<Position | null>(null);
  const [keyboardMove, setKeyboardMove] = useState<KeyboardMove | null>(null);
  const [movePending, setMovePending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingMove = useRef<{
    requestId: string;
    combatantId: string;
    origin: Position;
  } | null>(null);

  const combatantById = useMemo(() => new Map(combatants.map((combatant) => [combatant.id, combatant])), [combatants]);

  useEffect(() => {
    if (dragId || movePending || keyboardMove) return;
    setPositions(Object.fromEntries(combatants.map((combatant) => [combatant.id, { x: combatant.x, y: combatant.y }])));
  }, [combatants, dragId, keyboardMove, movePending]);

  function getCurrentPos(combatant: BattleGridCombatant): Position {
    const side = footprintSide(combatant.size);
    const source = dragId === combatant.id && dragCell ? dragCell : positions[combatant.id] ?? { x: combatant.x, y: combatant.y };
    return { x: clamp(source.x, 0, map.width - side), y: clamp(source.y, 0, map.height - side) };
  }

  const pointerToCell = useCallback((clientX: number, clientY: number, size: number): Position | null => {
    const board = boardRef.current;
    if (!board) return null;
    const rect = board.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: clamp(Math.floor((clientX - rect.left) / (rect.width / map.width)), 0, map.width - size),
      y: clamp(Math.floor((clientY - rect.top) / (rect.height / map.height)), 0, map.height - size),
    };
  }, [map.height, map.width]);

  const commitMove = useCallback((id: string, origin: Position, destination: Position) => {
    if (origin.x === destination.x && origin.y === destination.y) return;
    const requestId = createDungeonActionRequestId();
    pendingMove.current = { requestId, combatantId: id, origin };
    setError(null);
    setKeyboardMove(null);
    setPositions((previous) => ({ ...previous, [id]: destination }));
    setMovePending(true);
    requestDungeonAction(
      { action: "Move", targetX: destination.x, targetY: destination.y },
      requestId
    );
  }, []);

  useEffect(() => {
    function handleActionError(event: Event) {
      const detail = (event as CustomEvent<DungeonActionErrorDetail>).detail;
      const pending = pendingMove.current;
      if (!pending || detail.requestId !== pending.requestId) return;
      setPositions((previous) => ({
        ...previous,
        [pending.combatantId]: pending.origin,
      }));
      setError(detail.error);
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
    if (!dragId) return;
    const mover = combatantById.get(dragId);
    if (!mover) return;
    const moverSize = footprintSide(mover.size);

    const onMove = (event: PointerEvent) => {
      const cell = pointerToCell(event.clientX, event.clientY, moverSize);
      if (cell) setDragCell((previous) => previous?.x === cell.x && previous.y === cell.y ? previous : cell);
    };
    const onUp = () => {
      const id = dragId;
      const origin = dragOrigin;
      const destination = dragCell ?? origin;
      setDragId(null); setDragOrigin(null); setDragCell(null);
      if (origin && destination) void commitMove(id, origin, destination);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [combatantById, commitMove, dragCell, dragId, dragOrigin, pointerToCell]);

  function startDrag(event: ReactPointerEvent, combatant: BattleGridCombatant) {
    if (!combatant.isPlayer || movePending) return;
    event.preventDefault();
    const origin = positions[combatant.id] ?? { x: combatant.x, y: combatant.y };
    setError(null); setKeyboardMove(null); setDragId(combatant.id); setDragOrigin(origin); setDragCell(origin);
  }

  function handleTokenKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, combatant: BattleGridCombatant) {
    if (!combatant.isPlayer || movePending) return;
    const deltas: Record<string, Position> = {
      ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
    };
    const delta = deltas[event.key];
    if (delta) {
      event.preventDefault();
      const current = positions[combatant.id] ?? { x: combatant.x, y: combatant.y };
      const origin = keyboardMove?.id === combatant.id ? keyboardMove.origin : current;
      const side = footprintSide(combatant.size);
      const destination = {
        x: clamp(current.x + delta.x, 0, map.width - side),
        y: clamp(current.y + delta.y, 0, map.height - side),
      };
      setPositions((previous) => ({ ...previous, [combatant.id]: destination }));
      if (destination.x === origin.x && destination.y === origin.y) {
        setKeyboardMove(null);
      } else {
        setKeyboardMove({ id: combatant.id, origin, destination });
      }
      setError(null);
    } else if (event.key === "Enter" && keyboardMove?.id === combatant.id) {
      event.preventDefault();
      void commitMove(combatant.id, keyboardMove.origin, keyboardMove.destination);
    } else if (event.key === "Escape" && keyboardMove?.id === combatant.id) {
      event.preventDefault();
      setPositions((previous) => ({ ...previous, [combatant.id]: keyboardMove.origin }));
      setKeyboardMove(null);
    }
  }

  const gridStyle = {
    gridTemplateColumns: `repeat(${map.width}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${map.height}, minmax(0, 1fr))`,
  };

  return (
    <section aria-label="Tactical battle grid" className="rounded-sm border border-zinc-700/80 bg-zinc-950/90 p-3 shadow-[0_8px_28px_rgba(0,0,0,0.55)]">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-300" style={{ fontFamily: "var(--font-cinzel)" }}>Tactical Grid {map.width}x{map.height}</p>
        {movePending && <span role="status" className="text-[11px] text-amber-300/90">Backend validating…</span>}
      </div>
      <p id="battle-grid-help" className="sr-only">Player token: drag with a pointer, or use arrow keys to preview a move, Enter to submit it, and Escape to cancel. The backend validates the destination.</p>

      <div className="overflow-auto pb-1" aria-label="Scrollable tactical map">
      <div ref={boardRef} role="grid" aria-rowcount={map.height} aria-colcount={map.width} aria-describedby="battle-grid-help" className="relative w-full overflow-hidden rounded-sm border border-zinc-700/80 bg-zinc-900" style={{ minWidth: `${map.width * 44}px`, aspectRatio: `${map.width} / ${map.height}`, backgroundImage: "radial-gradient(circle at 15% 10%, rgba(255,255,255,0.04), transparent 45%), linear-gradient(to bottom, rgba(24,24,27,0.98), rgba(9,9,11,0.98))" }}>
        <div aria-hidden="true" className="absolute inset-0 grid" style={gridStyle}>{Array.from({ length: map.width * map.height }).map((_, index) => <div key={index} className="border border-zinc-700/50" />)}</div>
        <div className="absolute inset-0 grid" style={gridStyle}>
          {combatants.map((combatant) => {
            const pos = getCurrentPos(combatant);
            const side = footprintSide(combatant.size);
            const isActive = combatant.id === activeCombatantId;
            const isDragged = dragId === combatant.id;
            const canMove = combatant.isPlayer && !movePending;
            return (
              <button key={combatant.id} type="button" role="gridcell" onPointerDown={(event) => startDrag(event, combatant)} onKeyDown={(event) => handleTokenKeyDown(event, combatant)} disabled={!canMove} aria-label={`${combatant.name} token at ${pos.x},${pos.y}`} className="relative z-10 m-0.5 flex h-[calc(100%-0.25rem)] w-[calc(100%-0.25rem)] items-center justify-center rounded-full border text-center shadow-lg transition-transform disabled:cursor-default" style={{
                gridColumn: `${pos.x + 1} / span ${side}`, gridRow: `${pos.y + 1} / span ${side}`, cursor: canMove ? isDragged ? "grabbing" : "grab" : "default",
                background: combatant.isPlayer ? "radial-gradient(circle at 32% 28%, #facc15 0%, #92400e 100%)" : "radial-gradient(circle at 32% 28%, #f87171 0%, #7f1d1d 100%)",
                borderColor: isActive ? "#fde68a" : "rgba(39,39,42,0.95)", boxShadow: isActive ? "0 0 0 2px rgba(253,230,138,0.45), 0 6px 20px rgba(0,0,0,0.6)" : "0 4px 14px rgba(0,0,0,0.65)", transform: isDragged ? "scale(1.04)" : "scale(1)",
              }}><span className="pointer-events-none text-[10px] font-bold tracking-wide text-amber-50">{initials(combatant.name)}</span></button>
            );
          })}
        </div>
      </div>

      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400" style={{ fontFamily: "var(--font-crimson)" }}>
        <span>Drag, or arrows + Enter, to request movement.</span>
        {error ? <span role="alert" className="text-red-300">{error}</span> : keyboardMove ? <span role="status" className="text-amber-200">Preview {keyboardMove.destination.x},{keyboardMove.destination.y} — Enter to confirm</span> : <span>1 cell = {map.cellSize} ft</span>}
      </div>
    </section>
  );
}
