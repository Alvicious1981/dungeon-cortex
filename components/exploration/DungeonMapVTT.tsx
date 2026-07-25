"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent, WheelEvent } from "react";
import { useDungeon } from "../../lib/hooks/useDungeon";
import type { TileType } from "../../lib/rules/dungeon";

const TILE_SIZE = 16;
const TILE_COLORS: Record<TileType, { fill: string; stroke: string }> = {
  floor: { fill: "#2a1f1a", stroke: "#3d2f28" },
  wall: { fill: "#0d0d0d", stroke: "#1a1a1a" },
  door: { fill: "#7c5c2e", stroke: "#a07840" },
};

export interface DungeonMapVTTProps {
  seed: string;
  playerX: number;
  playerY: number;
  currentNodeIndex: number;
  visitedNodeIndices: number[];
  onNodeClick?: (nodeIndex: number) => void;
}

export function DungeonMapVTT({ seed, playerX, playerY, currentNodeIndex, visitedNodeIndices, onNodeClick }: DungeonMapVTTProps) {
  const { dungeon, fov, isReady } = useDungeon(seed, playerX, playerY);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const centeredRef = useRef(false);

  useEffect(() => {
    if (isReady && !centeredRef.current && svgRef.current) {
      centeredRef.current = true;
      const rect = svgRef.current.getBoundingClientRect();
      const tileSize = TILE_SIZE * zoom;
      setOffset({ x: rect.width / 2 - playerX * tileSize - tileSize / 2, y: rect.height / 2 - playerY * tileSize - tileSize / 2 });
    }
  }, [isReady, playerX, playerY, zoom]);

  const handlePointerDown = useCallback((event: PointerEvent<SVGSVGElement>) => {
    isDragging.current = true;
    dragStart.current = { x: event.clientX - offset.x, y: event.clientY - offset.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [offset]);

  const handlePointerMove = useCallback((event: PointerEvent<SVGSVGElement>) => {
    if (!isDragging.current) return;
    setOffset({ x: event.clientX - dragStart.current.x, y: event.clientY - dragStart.current.y });
  }, []);

  const handlePointerUp = useCallback(() => { isDragging.current = false; }, []);
  const adjustZoom = useCallback((factor: number) => setZoom((previous) => Math.min(Math.max(previous * factor, 0.2), 4)), []);
  const handleWheel = useCallback((event: WheelEvent) => { event.preventDefault(); adjustZoom(event.deltaY > 0 ? 0.9 : 1.1); }, [adjustZoom]);

  const centerOnPlayer = useCallback(() => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const tileSize = TILE_SIZE * zoom;
    setOffset({ x: rect.width / 2 - playerX * tileSize - tileSize / 2, y: rect.height / 2 - playerY * tileSize - tileSize / 2 });
  }, [playerX, playerY, zoom]);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const pan = event.shiftKey ? 80 : 32;
    const movements: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: pan, y: 0 }, ArrowRight: { x: -pan, y: 0 }, ArrowUp: { x: 0, y: pan }, ArrowDown: { x: 0, y: -pan },
    };
    const movement = movements[event.key];
    if (movement) {
      event.preventDefault();
      setOffset((previous) => ({ x: previous.x + movement.x, y: previous.y + movement.y }));
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault(); adjustZoom(1.15);
    } else if (event.key === "-") {
      event.preventDefault(); adjustZoom(0.85);
    } else if (event.key === "Home") {
      event.preventDefault(); centerOnPlayer();
    }
  }, [adjustZoom, centerOnPlayer]);

  const visitedSet = new Set(visitedNodeIndices);

  if (!isReady || !dungeon) {
    return <div role="status" className="relative flex h-full w-full items-center justify-center rounded-sm border border-amber-900/30 bg-[#060606]"><span className="animate-pulse text-sm font-medium tracking-widest text-amber-500/70 motion-reduce:animate-none">Conjuring dungeon…</span></div>;
  }

  return (
    <div role="region" aria-label={`Dungeon map. Player at grid position ${playerX}, ${playerY}.`} tabIndex={0} onKeyDown={handleKeyDown} className="relative h-full w-full overflow-hidden rounded-sm border border-amber-900/30 bg-[#060606]">
      <p className="sr-only">Use arrow keys to pan, plus and minus to zoom, and Home to center the player.</p>
      <svg ref={svgRef} aria-hidden="true" width="100%" height="100%" className="block cursor-grab active:cursor-grabbing" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp} onWheel={handleWheel} style={{ touchAction: "none" }}>
        <g transform={`translate(${offset.x}, ${offset.y}) scale(${zoom})`}>
          {dungeon.tiles.map((row, y) => row.map((tileType, x) => {
            const key = `${x},${y}`;
            const inFov = fov.has(key);
            if (!inFov && tileType === "wall") return null;
            const colors = TILE_COLORS[tileType];
            return <rect key={key} x={x * TILE_SIZE} y={y * TILE_SIZE} width={TILE_SIZE} height={TILE_SIZE} fill={colors.fill} stroke={colors.stroke} strokeWidth={0.5} opacity={inFov ? 1 : 0.45} />;
          }))}

          {dungeon.rooms.map((room) => {
            const inFov = fov.has(`${room.centerX},${room.centerY}`);
            const isVisited = visitedSet.has(room.nodeIndex);
            const isActive = room.nodeIndex === currentNodeIndex;
            if (!inFov && !isVisited) return null;
            const cx = room.centerX * TILE_SIZE + TILE_SIZE / 2;
            const cy = room.centerY * TILE_SIZE + TILE_SIZE / 2;
            const fill = isActive ? "#d97706" : isVisited ? "#78350f" : "#3b1f0a";
            const stroke = isActive ? "#fbbf24" : "#7c3f00";
            return (
              <g key={`room-${room.id}`} onClick={() => onNodeClick?.(room.nodeIndex)} style={{ cursor: onNodeClick ? "pointer" : "default" }}>
                {isActive && <circle cx={cx} cy={cy} r={8} fill="none" stroke="#fbbf24" strokeWidth={1} strokeDasharray="3 2" opacity={0.7} />}
                <circle cx={cx} cy={cy} r={5} fill={fill} stroke={stroke} strokeWidth={isActive ? 2 : 1.5} />
              </g>
            );
          })}

          <circle cx={playerX * TILE_SIZE + TILE_SIZE / 2} cy={playerY * TILE_SIZE + TILE_SIZE / 2} r={5} fill="#4f46e5" stroke="#c4b5fd" strokeWidth={1.5} />
        </g>
      </svg>

      <div className="absolute bottom-4 right-4 z-10 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => adjustZoom(0.85)} className="flex min-h-11 min-w-11 items-center justify-center rounded-sm border border-amber-900/40 bg-black/70 px-3 text-amber-200 hover:bg-amber-900/30" aria-label="Zoom out">−</button>
        <button type="button" onClick={() => adjustZoom(1.15)} className="flex min-h-11 min-w-11 items-center justify-center rounded-sm border border-amber-900/40 bg-black/70 px-3 text-amber-200 hover:bg-amber-900/30" aria-label="Zoom in">+</button>
        <button type="button" onClick={() => setZoom(1)} className="min-h-11 rounded-sm border border-amber-900/40 bg-black/70 px-3 font-mono text-xs text-amber-200 hover:bg-amber-900/30" aria-label="Reset zoom to one to one">1:1</button>
        <button type="button" onClick={centerOnPlayer} className="min-h-11 rounded-sm border border-amber-900/40 bg-black/70 px-3 font-mono text-xs text-amber-200 hover:bg-amber-900/30">Center</button>
      </div>
    </div>
  );
}
