"use client";

/**
 * components/exploration/ExplorationMap.tsx
 *
 * SVG-based interactive node graph for the VTT Exploration View.
 *
 * Renders the procedurally generated location graph with fog-of-war,
 * passage type styling, feature icons, and keyboard-accessible adjacent nodes.
 *
 * Node states:
 *   current  — golden pulsing border, "★ HERE" marker
 *   visited  — warm parchment, fully revealed
 *   adjacent — blue-grey, clickable (move target)
 *   fog      — near-invisible silhouette, "???"
 *
 * The SVG uses a responsive viewBox so it scales inside any container.
 * Adjacent nodes are rendered as `<g role="button">` elements inside the SVG
 * so coordinate alignment is exact at any scale.
 */

import { useState } from "react";
import type { ContextExplorationNode, ContextExplorationEdge } from "@/lib/memory/context";

// ─── Layout constants ────────────────────────────────────────────────────────

const CELL = 90;    // Grid cell size in px (viewBox units)
const NW   = 80;    // Node rectangle width
const NH   = 50;    // Node rectangle height
const PAD  = 60;    // Canvas padding
const SVG_W = 650;  // Total SVG viewBox width
const SVG_H = 620;  // Total SVG viewBox height

function nodeCx(x: number) { return PAD + x * CELL + NW / 2; }
function nodeCy(y: number) { return PAD + y * CELL + NH / 2; }

// ─── Node state ──────────────────────────────────────────────────────────────

type NodeState = "current" | "visited" | "adjacent" | "fog";

function getNodeState(
  index: number,
  currentIndex: number,
  visitedSet: Set<number>,
  adjacentSet: Set<number>,
): NodeState {
  if (index === currentIndex)  return "current";
  if (visitedSet.has(index))   return "visited";
  if (adjacentSet.has(index))  return "adjacent";
  return "fog";
}

const NODE_BG: Record<NodeState, string> = {
  current:  "hsl(40 40% 25%)",
  visited:  "hsl(40 15% 15%)",
  adjacent: "hsl(220 10% 20%)",
  fog:      "hsl(0 0% 12%)",
};
const NODE_STROKE: Record<NodeState, string> = {
  current:  "hsl(40 100% 55%)",
  visited:  "hsl(40 30% 55%)",
  adjacent: "hsl(220 20% 40%)",
  fog:      "hsl(0 0% 20%)",
};
const NODE_STROKE_W: Record<NodeState, number> = {
  current: 2, visited: 1.5, adjacent: 1.5, fog: 1,
};
const NODE_OPACITY: Record<NodeState, number> = {
  current: 1, visited: 1, adjacent: 1, fog: 0.35,
};
const NODE_TEXT: Record<NodeState, string> = {
  current:  "hsl(40 80% 90%)",
  visited:  "hsl(40 15% 80%)",
  adjacent: "hsl(220 15% 75%)",
  fog:      "hsl(0 0% 30%)",
};

// ─── Edge styles ─────────────────────────────────────────────────────────────

const EDGE_STROKE: Record<string, string> = {
  open:      "hsl(40 15% 40%)",
  door:      "hsl(40 15% 40%)",
  locked:    "hsl(0 40% 45%)",
  hidden:    "hsl(270 20% 30%)",
  collapsed: "hsl(0 0% 30%)",
};
const EDGE_DASH: Record<string, string | undefined> = {
  locked: "6 4",
  hidden: "2 5",
};
const EDGE_W: Record<string, number> = {
  open: 2, door: 2, locked: 2, hidden: 1, collapsed: 1.5,
};
const EDGE_OPACITY: Record<string, number> = {
  hidden: 0.45,
};

// ─── Feature icons ────────────────────────────────────────────────────────────

const FEATURE_ICONS: Record<string, string> = {
  npc:        "◆",
  hazard:     "⚠",
  treasure:   "🗃",
  quest_hook: "📜",
  rest:       "🔥",
  shop:       "💰",
  exit:       "🚪",
  empty:      "",
};

// ─── Edge helpers ─────────────────────────────────────────────────────────────

function midpoint(x1: number, y1: number, x2: number, y2: number) {
  return { mx: (x1 + x2) / 2, my: (y1 + y2) / 2 };
}

/** Builds a zigzag polyline for collapsed passages. */
function zigzagPoints(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return `${x1},${y1} ${x2},${y2}`;
  const px = (-dy / len) * 7;
  const py = (dx / len) * 7;
  const pts: string[] = [`${x1.toFixed(1)},${y1.toFixed(1)}`];
  for (let i = 1; i <= 4; i++) {
    const t = i / 5;
    const sign = i % 2 === 0 ? 1 : -1;
    pts.push(`${(x1 + t * dx + sign * px).toFixed(1)},${(y1 + t * dy + sign * py).toFixed(1)}`);
  }
  pts.push(`${x2.toFixed(1)},${y2.toFixed(1)}`);
  return pts.join(" ");
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ExplorationMapProps {
  location: { id: string; name: string; type: string; description: string };
  nodes: ContextExplorationNode[];
  edges: ContextExplorationEdge[];
  currentNodeIndex: number;
  visitedNodeIndices: number[];
  /** Called when the player clicks or keyboards-into an adjacent node. */
  onMoveToNode: (index: number) => void;
  /** Disables all move buttons while a transition is in flight. */
  isMoving: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ExplorationMap({
  location,
  nodes,
  edges,
  currentNodeIndex,
  visitedNodeIndices,
  onMoveToNode,
  isMoving,
}: ExplorationMapProps) {
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  const nodeByIndex = new Map(nodes.map((n) => [n.index, n]));
  const visitedSet  = new Set(visitedNodeIndices);

  // Adjacent: every node connected to the current node by any edge
  const adjacentSet = new Set<number>();
  for (const e of edges) {
    if (e.fromIndex === currentNodeIndex) adjacentSet.add(e.toIndex);
    if (e.toIndex   === currentNodeIndex) adjacentSet.add(e.fromIndex);
  }

  const currentNodeName = nodeByIndex.get(currentNodeIndex)?.name ?? "unknown";

  return (
    <div
      role="region"
      aria-label={`Exploration map: ${location.name}`}
      style={{ background: "rgba(10,10,14,0.95)", borderRadius: 8, border: "1px solid rgba(228,168,50,0.18)", overflow: "hidden" }}
    >
      {/* ── Header ── */}
      <div
        style={{
          padding: "10px 16px 8px",
          borderBottom: "1px solid rgba(100,70,14,0.3)",
          display: "flex",
          alignItems: "baseline",
          gap: 8,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-cinzel, serif)",
            fontSize: 13,
            fontWeight: 700,
            color: "#E8C84A",
            letterSpacing: "0.06em",
          }}
        >
          🗺 {location.name}
        </span>
        <span
          style={{
            fontFamily: "var(--font-cinzel, serif)",
            fontSize: 10,
            color: "#7A6A50",
            textTransform: "uppercase",
            letterSpacing: "0.2em",
          }}
        >
          ({location.type})
        </span>
      </div>

      {/* ── SVG Map ── */}
      <svg
        width="100%"
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: "block" }}
        aria-label={`Node graph for ${location.name}. Current location: ${currentNodeName}`}
      >
        {/* Pulse animation + focus ring */}
        <style>{`
          @media (prefers-reduced-motion: no-preference) {
            @keyframes pulse-gold {
              0%, 100% { stroke-opacity: 1; stroke-width: 2; }
              50%       { stroke-opacity: 0.35; stroke-width: 3.5; }
            }
            .node-border-current { animation: pulse-gold 2s ease-in-out infinite; }
          }
        `}</style>

        {/* ── Edges (rendered below nodes) ── */}
        <g>
          {edges.map((edge, i) => {
            const from = nodeByIndex.get(edge.fromIndex);
            const to   = nodeByIndex.get(edge.toIndex);
            if (!from || !to) return null;

            const x1 = nodeCx(from.x);
            const y1 = nodeCy(from.y);
            const x2 = nodeCx(to.x);
            const y2 = nodeCy(to.y);
            const pt  = edge.passageType;
            const stroke  = EDGE_STROKE[pt] ?? EDGE_STROKE.open;
            const sw      = EDGE_W[pt] ?? 1.5;
            const dash    = EDGE_DASH[pt];
            const opacity = EDGE_OPACITY[pt] ?? 1;
            const { mx, my } = midpoint(x1, y1, x2, y2);

            return (
              <g key={`edge-${i}`} opacity={opacity}>
                {pt === "collapsed" ? (
                  <polyline
                    points={zigzagPoints(x1, y1, x2, y2)}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={sw}
                  />
                ) : (
                  <line
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={stroke}
                    strokeWidth={sw}
                    strokeDasharray={dash}
                  />
                )}
                {/* Door icon — small rectangle at midpoint */}
                {pt === "door" && (
                  <rect x={mx - 5} y={my - 4} width={10} height={8} rx={1}
                    fill={stroke} opacity={0.75}
                  />
                )}
                {/* Locked icon */}
                {pt === "locked" && (
                  <text x={mx} y={my + 5} textAnchor="middle" fontSize={13}
                    fill={stroke} style={{ userSelect: "none" }}>
                    🔒
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {/* ── Nodes ── */}
        {nodes.map((node) => {
          const state    = getNodeState(node.index, currentNodeIndex, visitedSet, adjacentSet);
          const cx       = nodeCx(node.x);
          const cy       = nodeCy(node.y);
          const isCurrent  = state === "current";
          const isAdjacent = state === "adjacent";
          const isFog      = state === "fog";
          const icon     = FEATURE_ICONS[node.feature] ?? "";
          const label    = isFog ? "???" : (node.name.length > 10 ? node.name.slice(0, 9) + "…" : node.name);
          const isFocused = focusedIndex === node.index;

          // Passage type to this node (from current node) for aria-label
          const connectingEdge = isAdjacent
            ? edges.find(
                (e) =>
                  (e.fromIndex === currentNodeIndex && e.toIndex === node.index) ||
                  (e.toIndex === currentNodeIndex && e.fromIndex === node.index),
              )
            : undefined;

          const ariaLabel = isAdjacent
            ? `Move to ${node.name}, ${node.feature !== "empty" ? node.feature + ", " : ""}${connectingEdge?.passageType ?? "open"} passage`
            : undefined;

          const GroupEl = isAdjacent ? "g" : "g";

          return (
            <GroupEl
              key={`node-${node.index}`}
              role={isAdjacent ? "button" : undefined}
              tabIndex={isAdjacent && !isMoving ? 0 : undefined}
              aria-label={ariaLabel}
              aria-current={isCurrent ? ("location" as React.AriaAttributes["aria-current"]) : undefined}
              aria-disabled={isAdjacent && isMoving ? true : undefined}
              onClick={isAdjacent && !isMoving ? () => onMoveToNode(node.index) : undefined}
              onKeyDown={
                isAdjacent && !isMoving
                  ? (e: React.KeyboardEvent) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onMoveToNode(node.index);
                      }
                    }
                  : undefined
              }
              onFocus={isAdjacent ? () => setFocusedIndex(node.index) : undefined}
              onBlur={isAdjacent ? () => setFocusedIndex(null) : undefined}
              style={{
                cursor: isAdjacent ? (isMoving ? "wait" : "pointer") : "default",
                outline: "none",
              }}
              transform={`translate(${cx - NW / 2}, ${cy - NH / 2})`}
              opacity={NODE_OPACITY[state]}
            >
              {/* Background rect */}
              <rect
                width={NW} height={NH} rx={4}
                fill={NODE_BG[state]}
                stroke={NODE_STROKE[state]}
                strokeWidth={NODE_STROKE_W[state]}
                className={isCurrent ? "node-border-current" : undefined}
              />
              {/* Focus ring — only visible when the group is focused */}
              {isAdjacent && (
                <rect
                  width={NW} height={NH} rx={4}
                  fill="transparent"
                  stroke={isFocused ? "#E8C84A" : "transparent"}
                  strokeWidth={2.5}
                  style={{ pointerEvents: "none" }}
                />
              )}
              {/* Node name */}
              <text
                x={NW / 2}
                y={icon && !isFog ? NH / 2 - 6 : NH / 2 + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={9}
                fontFamily="var(--font-cinzel, serif)"
                fill={NODE_TEXT[state]}
                fontWeight={isCurrent ? "700" : "400"}
                style={{ userSelect: "none", pointerEvents: "none" }}
              >
                {label}
              </text>
              {/* Feature icon */}
              {icon && !isFog && (
                <text
                  x={NW / 2}
                  y={NH / 2 + 12}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={14}
                  style={{ userSelect: "none", pointerEvents: "none" }}
                >
                  {icon}
                </text>
              )}
              {/* "★ HERE" marker for current node */}
              {isCurrent && (
                <text
                  x={NW / 2}
                  y={NH - 6}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={7}
                  fontFamily="var(--font-cinzel, serif)"
                  fill="hsl(40 100% 70%)"
                  style={{ userSelect: "none", pointerEvents: "none" }}
                >
                  ★ HERE
                </text>
              )}
            </GroupEl>
          );
        })}
      </svg>

      {/* Screen-reader live region — announces room transitions */}
      <div
        aria-live="polite"
        aria-atomic="true"
        style={{ position: "absolute", left: -9999, top: 0, width: 1, height: 1, overflow: "hidden" }}
      >
        {isMoving ? "Moving…" : `Currently in: ${currentNodeName}`}
      </div>
    </div>
  );
}
