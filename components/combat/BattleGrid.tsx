"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PointerEvent as ReactPointerEvent } from "react";

const GRID_SIZE = 10;

type Position = { x: number; y: number };

export interface BattleGridCombatant {
  id: string;
  name: string;
  isPlayer: boolean;
  hp: number;
  maxHp: number;
  ac: number;
  x: number;
  y: number;
  size: string;
}

interface BattleGridProps {
  campaignId: string;
  combatants: BattleGridCombatant[];
  activeCombatantId?: string;
}

function sizeToSquares(size: string): number {
  switch (size) {
    case "Large":
      return 2;
    case "Huge":
      return 3;
    case "Gargantuan":
      return 4;
    default:
      return 1;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

export default function BattleGrid({ campaignId, combatants, activeCombatantId }: BattleGridProps) {
  const router = useRouter();
  const boardRef = useRef<HTMLDivElement | null>(null);

  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOrigin, setDragOrigin] = useState<Position | null>(null);
  const [dragCell, setDragCell] = useState<Position | null>(null);
  const [movePending, setMovePending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const combatantById = useMemo(() => {
    const map = new Map<string, BattleGridCombatant>();
    for (const c of combatants) map.set(c.id, c);
    return map;
  }, [combatants]);

  useEffect(() => {
    if (dragId || movePending) return;
    const next: Record<string, Position> = {};
    for (const c of combatants) {
      next[c.id] = { x: c.x, y: c.y };
    }
    setPositions(next);
  }, [combatants, dragId, movePending]);

  function getCurrentPos(c: BattleGridCombatant): Position {
    const size = sizeToSquares(c.size);
    const maxStart = GRID_SIZE - size;
    const source = dragId === c.id && dragCell ? dragCell : positions[c.id] ?? { x: c.x, y: c.y };
    return {
      x: clamp(source.x, 0, maxStart),
      y: clamp(source.y, 0, maxStart),
    };
  }

  function pointerToCell(clientX: number, clientY: number, size: number): Position | null {
    const board = boardRef.current;
    if (!board) return null;

    const rect = board.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const cellW = rect.width / GRID_SIZE;
    const cellH = rect.height / GRID_SIZE;

    const rawX = Math.floor((clientX - rect.left) / cellW);
    const rawY = Math.floor((clientY - rect.top) / cellH);

    const maxStart = GRID_SIZE - size;
    return {
      x: clamp(rawX, 0, maxStart),
      y: clamp(rawY, 0, maxStart),
    };
  }

  useEffect(() => {
    if (!dragId) return;

    const mover = combatantById.get(dragId);
    if (!mover) return;
    const moverSize = sizeToSquares(mover.size);

    const onMove = (event: PointerEvent) => {
      const cell = pointerToCell(event.clientX, event.clientY, moverSize);
      if (!cell) return;
      setDragCell((prev) => (prev && prev.x === cell.x && prev.y === cell.y ? prev : cell));
    };

    const onUp = async () => {
      const origin = dragOrigin;
      const destination = dragCell ?? origin;

      setDragId(null);
      setDragOrigin(null);
      setDragCell(null);

      if (!origin || !destination || (origin.x === destination.x && origin.y === destination.y)) {
        return;
      }

      setError(null);
      setPositions((prev) => ({ ...prev, [dragId]: destination }));
      setMovePending(true);

      try {
        const response = await fetch(`/api/campaign/${campaignId}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "Move", targetX: destination.x, targetY: destination.y }),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          setPositions((prev) => ({ ...prev, [dragId]: origin }));
          setError(payload.error ?? "Movement failed.");
          return;
        }

        router.refresh();
      } catch {
        setPositions((prev) => ({ ...prev, [dragId]: origin }));
        setError("Network error while moving.");
      } finally {
        setMovePending(false);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [campaignId, combatantById, dragCell, dragId, dragOrigin, router]);

  function startDrag(event: ReactPointerEvent, combatant: BattleGridCombatant) {
    if (!combatant.isPlayer || movePending) return;
    event.preventDefault();

    const origin = positions[combatant.id] ?? { x: combatant.x, y: combatant.y };
    setError(null);
    setDragId(combatant.id);
    setDragOrigin(origin);
    setDragCell(origin);
  }

  return (
    <section
      aria-label="Tactical battle grid"
      className="rounded-xl border border-zinc-700/80 bg-zinc-950/90 p-3 shadow-[0_8px_28px_rgba(0,0,0,0.55)]"
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-300" style={{ fontFamily: "var(--font-cinzel)" }}>
          Tactical Grid 10x10
        </p>
        {movePending ? (
          <span className="text-[11px] text-amber-300/90" style={{ fontFamily: "var(--font-cinzel)" }}>
            Moving...
          </span>
        ) : null}
      </div>

      <div
        ref={boardRef}
        className="relative aspect-square w-full overflow-hidden rounded-lg border border-zinc-700/80 bg-zinc-900"
        style={{
          backgroundImage:
            "radial-gradient(circle at 15% 10%, rgba(255,255,255,0.04), transparent 45%), linear-gradient(to bottom, rgba(24,24,27,0.98), rgba(9,9,11,0.98))",
        }}
      >
        <div className="absolute inset-0 grid grid-cols-10 grid-rows-10">
          {Array.from({ length: GRID_SIZE * GRID_SIZE }).map((_, idx) => (
            <div key={idx} className="border border-zinc-700/50" />
          ))}
        </div>

        <div className="absolute inset-0 grid grid-cols-10 grid-rows-10">
          {combatants.map((combatant) => {
            const pos = getCurrentPos(combatant);
            const side = sizeToSquares(combatant.size);
            const isActive = combatant.id === activeCombatantId;
            const isDragged = dragId === combatant.id;
            const canDrag = combatant.isPlayer && !movePending;

            return (
              <button
                key={combatant.id}
                type="button"
                onPointerDown={(event) => startDrag(event, combatant)}
                disabled={!canDrag}
                aria-label={`${combatant.name} token at ${pos.x},${pos.y}`}
                className="relative z-10 m-0.5 flex h-[calc(100%-0.25rem)] w-[calc(100%-0.25rem)] items-center justify-center rounded-full border text-center shadow-lg transition-transform disabled:cursor-default"
                style={{
                  gridColumn: `${pos.x + 1} / span ${side}`,
                  gridRow: `${pos.y + 1} / span ${side}`,
                  cursor: canDrag ? (isDragged ? "grabbing" : "grab") : "default",
                  background: combatant.isPlayer
                    ? "radial-gradient(circle at 32% 28%, #facc15 0%, #92400e 100%)"
                    : "radial-gradient(circle at 32% 28%, #f87171 0%, #7f1d1d 100%)",
                  borderColor: isActive ? "#fde68a" : "rgba(39,39,42,0.95)",
                  boxShadow: isActive
                    ? "0 0 0 2px rgba(253,230,138,0.45), 0 6px 20px rgba(0,0,0,0.6)"
                    : "0 4px 14px rgba(0,0,0,0.65)",
                  transform: isDragged ? "scale(1.04)" : "scale(1)",
                }}
              >
                <span className="pointer-events-none text-[10px] font-bold tracking-wide text-amber-50" style={{ fontFamily: "var(--font-cinzel)" }}>
                  {initials(combatant.name)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-400" style={{ fontFamily: "var(--font-crimson)" }}>
        <span>Drag only the player token to move.</span>
        {error ? <span className="text-red-300">{error}</span> : <span>1 square = 5 ft</span>}
      </div>
    </section>
  );
}
