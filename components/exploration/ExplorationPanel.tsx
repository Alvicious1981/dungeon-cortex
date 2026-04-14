"use client";

/**
 * components/exploration/ExplorationPanel.tsx
 *
 * Client-side wrapper that manages optimistic exploration state.
 *
 * Responsibilities:
 *   1. Holds currentNodeIndex and visitedNodeIndices in React state.
 *   2. On move: optimistically updates state, fires a POST to the action
 *      endpoint (which triggers the narrator's moveToNode tool), drains
 *      the SSE stream, then calls router.refresh() to sync server state.
 *   3. If the server state diverges from the optimistic state (e.g. a
 *      locked door was impassable), the props update on refresh and state
 *      snaps back to the server truth.
 *   4. Computes adjacentNodes from the edge graph before passing down.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ExplorationMap from "./ExplorationMap";
import NodeDetail from "./NodeDetail";
import type { ContextExplorationNode, ContextExplorationEdge } from "@/lib/memory/context";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ExplorationPanelProps {
  campaignId: string;
  location: { id: string; name: string; type: string; description: string };
  nodes: ContextExplorationNode[];
  edges: ContextExplorationEdge[];
  initialCurrentNodeIndex: number;
  initialVisitedNodeIndices: number[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ExplorationPanel({
  campaignId,
  location,
  nodes,
  edges,
  initialCurrentNodeIndex,
  initialVisitedNodeIndices,
}: ExplorationPanelProps) {
  const router = useRouter();

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
    let passageType = edge.passageType;

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

  async function handleMoveToNode(targetIndex: number) {
    if (movingRef.current) return;
    const targetNode = nodeByIndex.get(targetIndex);
    if (!targetNode) return;

    movingRef.current = true;
    setIsMoving(true);

    // Optimistic update — player sees the move immediately
    const prevIndex = currentNodeIndex;
    setCurrentNodeIndex(targetIndex);
    setVisitedNodeIndices((prev) =>
      prev.includes(targetIndex) ? prev : [...prev, targetIndex],
    );

    try {
      const res = await fetch(`/api/campaign/${campaignId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: `move to ${targetNode.name}` }),
      });

      if (!res.ok || !res.body) {
        // Network error — revert optimistic state
        setCurrentNodeIndex(prevIndex);
        return;
      }

      // Drain the SSE stream (the narrative appears in the chronicle via
      // router.refresh(), not here — we just wait for the stream to end)
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // Stop early once we see the "done" sentinel frame
        if (buf.includes('"t":"done"')) break;
      }
    } catch {
      // On any error, revert so state is consistent with the server
      setCurrentNodeIndex(prevIndex);
    } finally {
      movingRef.current = false;
      setIsMoving(false);
      // Refresh the Server Component tree so the chronicle and
      // character panel pick up any state mutations from the narrator
      router.refresh();
    }
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
