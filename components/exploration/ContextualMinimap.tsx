"use client";

import { useMemo } from "react";
import { Maximize2 } from "lucide-react";
import { useDungeon } from "@/lib/hooks/useDungeon";

const TILE_SIZE = 16;
const DEFAULT_RADIUS_TILES = 8;

export interface ContextualMinimapProps {
  seed: string;
  playerX: number;
  playerY: number;
  currentNodeIndex: number;
  visitedNodeIndices: readonly number[];
  onExpand?: () => void;
  size?: number;
  className?: string;
}

export function ContextualMinimap({
  seed,
  playerX,
  playerY,
  currentNodeIndex,
  visitedNodeIndices,
  onExpand,
  size = 180,
  className = "",
}: ContextualMinimapProps) {
  const { dungeon, fov, isReady } = useDungeon(seed, playerX, playerY);

  const visitedSet = useMemo(() => new Set(visitedNodeIndices), [visitedNodeIndices]);

  if (!isReady || !dungeon) {
    return (
      <div
        role="status"
        aria-label="Cargando minimapa"
        style={{ width: size, height: size }}
        className={`relative flex items-center justify-center rounded-lg border border-[var(--dc-border)] bg-[var(--dc-surface)] ${className}`}
      >
        <span className="text-xs text-[var(--dc-text-muted)] animate-pulse motion-reduce:animate-none">
          Cargando minimapa…
        </span>
      </div>
    );
  }

  // Calculate centered viewport bounds in tiles
  const minX = Math.max(0, playerX - DEFAULT_RADIUS_TILES);
  const maxX = Math.min(dungeon.width - 1, playerX + DEFAULT_RADIUS_TILES);
  const minY = Math.max(0, playerY - DEFAULT_RADIUS_TILES);
  const maxY = Math.min(dungeon.height - 1, playerY + DEFAULT_RADIUS_TILES);

  const centerX = playerX * TILE_SIZE + TILE_SIZE / 2;
  const centerY = playerY * TILE_SIZE + TILE_SIZE / 2;
  const viewBoxSize = (DEFAULT_RADIUS_TILES * 2 + 1) * TILE_SIZE;
  const viewBoxX = centerX - viewBoxSize / 2;
  const viewBoxY = centerY - viewBoxSize / 2;

  // Render only visible/known tiles within the viewport
  const visibleTiles: Array<{
    key: string;
    x: number;
    y: number;
    type: "floor" | "wall" | "door";
    inFov: boolean;
  }> = [];

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const key = `${x},${y}`;
      const inFov = fov.has(key);
      const tileType = dungeon.tiles[y]?.[x];

      if (!tileType) continue;

      // Unknown walls outside FOV are never rendered (zero leak)
      if (!inFov && tileType === "wall") {
        continue;
      }

      visibleTiles.push({
        key,
        x,
        y,
        type: tileType,
        inFov,
      });
    }
  }

  // Filter rooms: strictly legitimate knowledge only (in FOV or visited)
  const visibleRooms = dungeon.rooms.filter((room) => {
    const inFov = fov.has(`${room.centerX},${room.centerY}`);
    const isVisited = visitedSet.has(room.nodeIndex);
    return inFov || isVisited;
  });

  return (
    <div
      role="region"
      aria-label={`Minimapa contextual. Personaje en la posición ${playerX}, ${playerY}.`}
      style={{ width: size, height: size }}
      className={`relative overflow-hidden rounded-lg border border-[var(--dc-border)] bg-[var(--dc-canvas)] shadow-sm ${className}`}
    >
      <p className="sr-only">
        Minimapa de la mazmorra centrado en el personaje. Muestra el entorno inmediato visible y salas descubiertas.
      </p>

      {/* Compass indicator */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-2 top-1.5 z-10 font-mono text-[10px] font-bold text-[var(--dc-text-muted)]"
      >
        N
      </span>

      <svg
        aria-hidden="true"
        viewBox={`${viewBoxX} ${viewBoxY} ${viewBoxSize} ${viewBoxSize}`}
        className="block h-full w-full"
      >
        {/* Render visible tiles */}
        {visibleTiles.map(({ key, x, y, type, inFov }) => {
          let fill = "var(--dc-surface-raised)";
          let stroke = "var(--dc-border)";
          let opacity = inFov ? 1 : 0.45;

          if (type === "wall") {
            fill = "var(--dc-surface)";
            stroke = "var(--dc-border-strong)";
            opacity = 1;
          } else if (type === "door") {
            fill = "var(--dc-action)";
            stroke = "var(--dc-border)";
            opacity = inFov ? 1 : 0.65;
          }

          return (
            <rect
              key={`tile-${key}`}
              x={x * TILE_SIZE}
              y={y * TILE_SIZE}
              width={TILE_SIZE}
              height={TILE_SIZE}
              fill={fill}
              stroke={stroke}
              strokeWidth={0.5}
              opacity={opacity}
            />
          );
        })}

        {/* Render only discovered or visible rooms */}
        {visibleRooms.map((room) => {
          const isActive = room.nodeIndex === currentNodeIndex;
          const isVisited = visitedSet.has(room.nodeIndex);
          const cx = room.centerX * TILE_SIZE + TILE_SIZE / 2;
          const cy = room.centerY * TILE_SIZE + TILE_SIZE / 2;

          let fill = "var(--dc-surface)";
          let stroke = "var(--dc-border)";

          if (isActive) {
            fill = "var(--dc-action)";
            stroke = "var(--dc-text)";
          } else if (isVisited) {
            fill = "var(--dc-surface-raised)";
            stroke = "var(--dc-action)";
          }

          return (
            <g key={`room-${room.id}`} data-testid={`minimap-room-${room.nodeIndex}`}>
              {isActive && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={7}
                  fill="none"
                  stroke="var(--dc-action)"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                  opacity={0.8}
                />
              )}
              <circle
                cx={cx}
                cy={cy}
                r={4}
                fill={fill}
                stroke={stroke}
                strokeWidth={isActive ? 1.5 : 1}
              />
            </g>
          );
        })}

        {/* Player Token */}
        <circle
          data-testid="minimap-player-token"
          cx={centerX}
          cy={centerY}
          r={4.5}
          fill="var(--dc-mechanical)"
          stroke="var(--dc-focus)"
          strokeWidth={1.5}
        />
      </svg>

      {/* Expand button to full map if requested */}
      {onExpand && (
        <button
          type="button"
          onClick={onExpand}
          aria-label="Abrir plano completo de la mazmorra"
          className="absolute bottom-1.5 right-1.5 z-10 flex min-h-11 min-w-11 items-center justify-center rounded border border-[var(--dc-border)] bg-[var(--dc-surface)] text-[var(--dc-text-muted)] hover:border-[var(--dc-border-strong)] hover:text-[var(--dc-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dc-focus)]"
        >
          <Maximize2 size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export default ContextualMinimap;
