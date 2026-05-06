"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useDungeon } from "../../lib/hooks/useDungeon";
import type { TileType } from "../../lib/rules/dungeon";

const TILE_SIZE = 16;

export interface DungeonMapVTTProps {
  seed: string;
  playerX: number;
  playerY: number;
  currentNodeIndex: number;
  visitedNodeIndices: number[];
  onNodeClick?: (nodeIndex: number) => void;
}

export const DungeonMapVTT: React.FC<DungeonMapVTTProps> = ({
  seed,
  playerX,
  playerY,
  currentNodeIndex,
  visitedNodeIndices,
  onNodeClick,
}) => {
  const { dungeon, fov, isReady } = useDungeon(seed, playerX, playerY);

  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const centeredRef = useRef(false);

  // Center on player when dungeon first becomes ready
  useEffect(() => {
    if (isReady && !centeredRef.current && svgRef.current) {
      centeredRef.current = true;
      const rect = svgRef.current.getBoundingClientRect();
      const tileS = TILE_SIZE * zoom;
      setOffset({
        x: rect.width / 2 - playerX * tileS - tileS / 2,
        y: rect.height / 2 - playerY * tileS - tileS / 2,
      });
    }
  }, [isReady, playerX, playerY, zoom]);

  // Pointer capture drag pattern
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      isDragging.current = true;
      dragStart.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
      (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
    },
    [offset]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!isDragging.current) return;
      setOffset({
        x: e.clientX - dragStart.current.x,
        y: e.clientY - dragStart.current.y,
      });
    },
    []
  );

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom((prev) => Math.min(Math.max(prev * delta, 0.2), 4));
    },
    []
  );

  const centerOnPlayer = useCallback(() => {
    if (svgRef.current) {
      const rect = svgRef.current.getBoundingClientRect();
      const tileS = TILE_SIZE * zoom;
      setOffset({
        x: rect.width / 2 - playerX * tileS - tileS / 2,
        y: rect.height / 2 - playerY * tileS - tileS / 2,
      });
    }
  }, [playerX, playerY, zoom]);

  const resetZoom = useCallback(() => {
    setZoom(1);
  }, []);

  // Tile color/stroke helpers
  const tileColors: Record<TileType, { fill: string; stroke: string }> = {
    floor: { fill: "#2a1f1a", stroke: "#3d2f28" },
    wall: { fill: "#0d0d0d", stroke: "#1a1a1a" },
    door: { fill: "#7c5c2e", stroke: "#a07840" },
  };

  const visitedSet = new Set(visitedNodeIndices);

  const tileS = TILE_SIZE * zoom;

  if (!isReady || !dungeon) {
    return (
      <div className="relative w-full h-full bg-[#060606] rounded-lg border border-amber-900/30 flex items-center justify-center">
        <span className="text-amber-500/70 text-sm font-medium tracking-widest animate-pulse">
          Conjuring dungeon…
        </span>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-[#060606] rounded-lg border border-amber-900/30 overflow-hidden">
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        className="block cursor-grab active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
        style={{ touchAction: "none" }}
      >
        <g transform={`translate(${offset.x}, ${offset.y}) scale(${zoom})`}>
          {/* Tile grid */}
          {dungeon.tiles.map((row, y) =>
            row.map((tileType, x) => {
              const key = `${x},${y}`;
              const inFov = fov.has(key);
              // Skip invisible wall tiles
              if (!inFov && tileType === "wall") return null;

              const colors = tileColors[tileType];
              const opacity = inFov ? 1 : 0.45;

              return (
                <rect
                  key={key}
                  x={x * TILE_SIZE}
                  y={y * TILE_SIZE}
                  width={TILE_SIZE}
                  height={TILE_SIZE}
                  fill={colors.fill}
                  stroke={colors.stroke}
                  strokeWidth={0.5}
                  opacity={opacity}
                />
              );
            })
          )}

          {/* Room markers */}
          {dungeon.rooms.map((room) => {
            const key = `${room.centerX},${room.centerY}`;
            const inFov = fov.has(key);
            const isVisited = visitedSet.has(room.nodeIndex);
            const isActive = room.nodeIndex === currentNodeIndex;

            // Skip rooms not in FOV and not visited
            if (!inFov && !isVisited) return null;

            const cx = room.centerX * TILE_SIZE + TILE_SIZE / 2;
            const cy = room.centerY * TILE_SIZE + TILE_SIZE / 2;

            let fill: string;
            let stroke: string;
            let strokeWidth = 1.5;

            if (isActive) {
              fill = "#d97706";
              stroke = "#fbbf24";
              strokeWidth = 2;
            } else if (isVisited) {
              fill = "#78350f";
              stroke = "#7c3f00";
            } else {
              // In FOV but not visited
              fill = "#3b1f0a";
              stroke = "#7c3f00";
            }

            return (
              <g
                key={`room-${room.id}`}
                onClick={() => onNodeClick?.(room.nodeIndex)}
                style={{ cursor: onNodeClick ? "pointer" : "default" }}
              >
                {/* Dashed orbit ring for active room */}
                {isActive && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={8}
                    fill="none"
                    stroke="#fbbf24"
                    strokeWidth={1}
                    strokeDasharray="3 2"
                    opacity={0.7}
                  />
                )}
                <circle
                  cx={cx}
                  cy={cy}
                  r={5}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                />
              </g>
            );
          })}

          {/* Player token */}
          <circle
            cx={playerX * TILE_SIZE + TILE_SIZE / 2}
            cy={playerY * TILE_SIZE + TILE_SIZE / 2}
            r={5}
            fill="#1e40af"
            stroke="#93c5fd"
            strokeWidth={1.5}
          />
        </g>
      </svg>

      {/* Control buttons — bottom right */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-2 z-10">
        <button
          onClick={resetZoom}
          className="px-2 py-1 bg-black/60 backdrop-blur-md rounded border border-amber-900/40 text-amber-400/80 text-xs font-mono hover:bg-amber-900/20 transition-colors"
          title="Reset zoom to 1:1"
        >
          1:1
        </button>
        <button
          onClick={centerOnPlayer}
          className="px-2 py-1 bg-black/60 backdrop-blur-md rounded border border-amber-900/40 text-amber-400/80 text-xs font-mono hover:bg-amber-900/20 transition-colors"
          title="Center on player"
        >
          Center
        </button>
      </div>
    </div>
  );
};
