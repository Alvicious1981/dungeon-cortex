/** @vitest-environment jsdom */
/**
 * tests/components/ExplorationMap.test.tsx
 *
 * Smoke tests for the ExplorationMap SVG component.
 *
 * Verifies:
 *   - Location name header renders
 *   - Current node shows "★ HERE" marker
 *   - Adjacent node is exposed as a button (move target)
 *   - Fog-of-war node shows "???" placeholder
 *   - Feature icons appear on non-fog nodes
 *   - onMoveToNode callback fires when an adjacent node is clicked
 *   - isMoving disables the move button
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import ExplorationMap, { type ExplorationMapProps } from "@/components/exploration/ExplorationMap";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const LOCATION = {
  id: "loc-001",
  name: "The Weeping Cistern",
  type: "dungeon",
  description: "A flooded subterranean vault that smells of rot.",
};

// 3 nodes: 0=current (entry), 1=adjacent (guard post), 2=fog (locked vault)
const NODES: ExplorationMapProps["nodes"] = [
  { index: 0, name: "Entry Hall",  description: "The entry.", feature: "empty",    npcSeed: null, x: 2, y: 0 },
  { index: 1, name: "Guard Post",  description: "An old post.", feature: "npc",    npcSeed: "guard-42", x: 2, y: 1 },
  { index: 2, name: "Locked Vault", description: "Sealed tight.", feature: "treasure", npcSeed: null, x: 3, y: 1 },
];

// Edges: 0-1 (open), 1-2 (locked — no edge from 0 to 2, so node 2 is fog from node 0)
const EDGES: ExplorationMapProps["edges"] = [
  { fromIndex: 0, toIndex: 1, passageType: "open" },
  { fromIndex: 1, toIndex: 2, passageType: "locked" },
];

function makeProps(overrides?: Partial<ExplorationMapProps>): ExplorationMapProps {
  return {
    location: LOCATION,
    nodes: NODES,
    edges: EDGES,
    currentNodeIndex: 0,
    visitedNodeIndices: [0],
    onMoveToNode: vi.fn(),
    isMoving: false,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ExplorationMap — location header", () => {
  it("renders the location name", () => {
    render(<ExplorationMap {...makeProps()} />);
    expect(screen.getByText(/Weeping Cistern/)).toBeTruthy();
  });

  it("renders the location type", () => {
    render(<ExplorationMap {...makeProps()} />);
    expect(screen.getByText(/dungeon/i)).toBeTruthy();
  });
});

describe("ExplorationMap — current node", () => {
  it("shows the '★ HERE' marker for the current node", () => {
    render(<ExplorationMap {...makeProps()} />);
    expect(screen.getByText(/★ HERE/)).toBeTruthy();
  });

  it("renders the current node name (not '???')", () => {
    render(<ExplorationMap {...makeProps()} />);
    // "Entry Hall" should appear; it may be truncated if >10 chars
    // "Entry Hall" is 10 chars — exactly at the limit, no truncation
    expect(screen.getAllByText(/Entry Hall/).length).toBeGreaterThan(0);
  });
});

describe("ExplorationMap — adjacent node", () => {
  it("exposes the adjacent node as a button", () => {
    render(<ExplorationMap {...makeProps()} />);
    const btn = screen.getByRole("button", { name: /Guard Post/i });
    expect(btn).toBeTruthy();
  });

  it("button aria-label includes passage type", () => {
    render(<ExplorationMap {...makeProps()} />);
    const btn = screen.getByRole("button", { name: /open passage/i });
    expect(btn).toBeTruthy();
  });

  it("calls onMoveToNode with correct index when button is clicked", () => {
    const onMove = vi.fn();
    render(<ExplorationMap {...makeProps({ onMoveToNode: onMove })} />);
    const btn = screen.getByRole("button", { name: /Guard Post/i });
    fireEvent.click(btn);
    expect(onMove).toHaveBeenCalledWith(1);
  });

  it("does NOT call onMoveToNode when isMoving is true", () => {
    const onMove = vi.fn();
    render(<ExplorationMap {...makeProps({ onMoveToNode: onMove, isMoving: true })} />);
    // When isMoving, the button's onClick is removed — no button should be found
    // (tabIndex is also removed so it won't be a role=button anymore)
    const buttons = screen.queryAllByRole("button");
    // Even if found, clicking should not fire the handler
    if (buttons.length > 0) {
      fireEvent.click(buttons[0]);
    }
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe("ExplorationMap — fog of war", () => {
  it("shows '???' for the fog node (node 2 is not adjacent to node 0)", () => {
    render(<ExplorationMap {...makeProps()} />);
    expect(screen.getByText("???")).toBeTruthy();
  });

  it("does NOT expose the fog node as a button", () => {
    render(<ExplorationMap {...makeProps()} />);
    // Only node 1 (Guard Post) should be a button; node 2 (fog) must not be
    const buttons = screen.getAllByRole("button");
    const labels  = buttons.map((b) => b.getAttribute("aria-label") ?? "");
    expect(labels.every((l) => !l.includes("Locked Vault"))).toBe(true);
  });
});

describe("ExplorationMap — feature icons", () => {
  it("renders the NPC icon (◆) on the adjacent node", () => {
    render(<ExplorationMap {...makeProps()} />);
    // Node 1 has feature="npc" — icon is ◆ and it's not a fog node
    expect(screen.getByText("◆")).toBeTruthy();
  });

  it("does NOT render the treasure icon on a fog node", () => {
    render(<ExplorationMap {...makeProps()} />);
    // Node 2 has feature="treasure" but is fog — icon should NOT appear
    const treasureIcons = screen.queryAllByText("🗃");
    expect(treasureIcons.length).toBe(0);
  });
});

describe("ExplorationMap — aria-live region", () => {
  it("announces the current room name via aria-live", () => {
    render(<ExplorationMap {...makeProps()} />);
    // The aria-live div contains the current room name
    expect(screen.getByText(/Currently in: Entry Hall/)).toBeTruthy();
  });

  it("announces 'Moving…' while isMoving is true", () => {
    render(<ExplorationMap {...makeProps({ isMoving: true })} />);
    expect(screen.getByText("Moving…")).toBeTruthy();
  });
});
