"use client";

/**
 * components/exploration/ExplorationPanel.tsx
 *
 * Client-side wrapper that manages optimistic exploration state.
 *
 * Responsibilities:
 *   1. Holds currentNodeIndex and visitedNodeIndices in React state.
 *   2. On move: optimistically updates state and requests the shared action
 *      transport consumed by ActionInput.
 *   3. If the server state diverges from the optimistic state (e.g. a
 *      locked door was impassable), the props update on refresh and state
 *      snaps back to the server truth.
 *   4. Computes adjacentNodes from the edge graph before passing down.
 */

import { useEffect, useRef, useState } from "react";
import {
  DUNGEON_ACTION_END,
  DUNGEON_ACTION_ERROR,
  createDungeonActionRequestId,
  requestDungeonAction,
  type DungeonActionErrorDetail,
  type DungeonActionRequestDetail,
} from "@/lib/events/action-transport";
import ExplorationMap from "./ExplorationMap";
import NodeDetail from "./NodeDetail";
import type { ContextExplorationNode, ContextExplorationEdge } from "@/lib/memory/context";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ExplorationPanelProps {
  location: { id: string; name: string; type: string; description: string };
  nodes: ContextExplorationNode[];
  edges: ContextExplorationEdge[];
  initialCurrentNodeIndex: number;
  initialVisitedNodeIndices: number[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ExplorationPanel({
  location,
  nodes,
  edges,
  initialCurrentNodeIndex,
  initialVisitedNodeIndices,
}: ExplorationPanelProps) {
  const [currentNodeIndex, setCurrentNodeIndex] = useState(initialCurrentNodeIndex);
  const [visitedNodeIndices, setVisitedNodeIndices] = useState<number[]>(initialVisitedNodeIndices);
  const [isMoving, setIsMoving] = useState(false);

  // Sync currentNodeIndex from server after router.refresh()
  useEffect(() => {
    setCurrentNodeIndex(initialCurrentNodeIndex);
  }, [initialCurrentNodeIndex]);

  const nodeByIndex = new Map(nodes.map((n) => [n.index, n]));

  // Derive adjacent nodes for the current position
  const adjacentNodes: Array<{ node: ContextExplorationNode; passageType: string }> = [];
  for (const edge of edges) {
    let neighborIndex: number | null = null;
    const passageType = edge.passageType;

    if (edge.fromIndex === currentNodeIndex) {
      neighborIndex = edge.toIndex;
    } else if (edge.toIndex === currentNodeIndex) {
      neighborIndex = edge.fromIndex;
    }

    if (neighborIndex !== null) {
      const neighborNode = nodeByIndex.get(neighborIndex);
      if (neighborNode) {
        adjacentNodes.push({ node: neighborNode, passageType });
      }
    }
  }

  const currentNode = nodeByIndex.get(currentNodeIndex);

  // Prevent concurrent moves with a ref (state updates are async)
  const movingRef = useRef(false);

  const pendingMove = useRef<{
    requestId: string;
    previousNodeIndex: number;
    previousVisitedNodeIndices: number[];
  } | null>(null);

  useEffect(() => {
    function handleActionError(event: Event) {
      const detail = (event as CustomEvent<DungeonActionErrorDetail>).detail;
      const pending = pendingMove.current;
      if (!pending || detail.requestId !== pending.requestId) return;
      setCurrentNodeIndex(pending.previousNodeIndex);
      setVisitedNodeIndices(pending.previousVisitedNodeIndices);
    }

    function handleActionEnd(event: Event) {
      const detail = (event as CustomEvent<DungeonActionRequestDetail>).detail;
      if (detail.requestId !== pendingMove.current?.requestId) return;
      pendingMove.current = null;
      movingRef.current = false;
      setIsMoving(false);
    }

    window.addEventListener(DUNGEON_ACTION_ERROR, handleActionError);
    window.addEventListener(DUNGEON_ACTION_END, handleActionEnd);
    return () => {
      window.removeEventListener(DUNGEON_ACTION_ERROR, handleActionError);
      window.removeEventListener(DUNGEON_ACTION_END, handleActionEnd);
    };
  }, []);

  function handleMoveToNode(targetIndex: number) {
    if (movingRef.current) return;
    const targetNode = nodeByIndex.get(targetIndex);
    if (!targetNode) return;

    const requestId = createDungeonActionRequestId();
    pendingMove.current = {
      requestId,
      previousNodeIndex: currentNodeIndex,
      previousVisitedNodeIndices: visitedNodeIndices,
    };
    movingRef.current = true;
    setIsMoving(true);
    setCurrentNodeIndex(targetIndex);
    setVisitedNodeIndices((previous) =>
      previous.includes(targetIndex) ? previous : [...previous, targetIndex]
    );
    requestDungeonAction(
      { action: `move to ${targetNode.name}` },
      requestId
    );
  }

  if (!currentNode) {
    return (
      <div
        style={{
          padding: 16,
          background: "rgba(12,12,22,0.92)",
          borderRadius: 8,
          border: "1px solid rgba(228,168,50,0.18)",
          fontFamily: "var(--font-crimson, serif)",
          fontStyle: "italic",
          color: "#5A5040",
          fontSize: 13,
        }}
      >
        Exploration data unavailable.
      </div>
    );
  }

  return (
    <section
      aria-label={`Exploring: ${location.name}`}
      style={{ borderRadius: 8, overflow: "hidden", border: "1px solid rgba(228,168,50,0.18)" }}
    >
      <ExplorationMap
        location={location}
        nodes={nodes}
        edges={edges}
        currentNodeIndex={currentNodeIndex}
        visitedNodeIndices={visitedNodeIndices}
        onMoveToNode={handleMoveToNode}
        isMoving={isMoving}
      />
      <NodeDetail
        currentNode={currentNode}
        adjacentNodes={adjacentNodes}
        onMoveToNode={handleMoveToNode}
        isMoving={isMoving}
      />
    </section>
  );
}
