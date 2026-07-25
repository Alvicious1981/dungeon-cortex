/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { DungeonMapVTT } from "@/components/exploration/DungeonMapVTT";

vi.mock("@/lib/hooks/useDungeon", () => ({
  useDungeon: () => ({
    dungeon: {
      tiles: [["floor", "door"]],
      rooms: [],
    },
    fov: new Set(["0,0", "1,0"]),
    isReady: true,
  }),
}));

describe("DungeonMapVTT", () => {
  it("exposes a textual map region and supports keyboard panning", () => {
    render(
      <div style={{ width: 640, height: 360 }}>
        <DungeonMapVTT seed="test-seed" playerX={0} playerY={0} currentNodeIndex={0} visitedNodeIndices={[]} />
      </div>
    );

    const region = screen.getByRole("region", { name: "Dungeon map. Player at grid position 0, 0." });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(screen.getByText(/Use arrow keys to pan/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();

    const viewport = region.querySelector("svg > g");
    const before = viewport?.getAttribute("transform");
    fireEvent.keyDown(region, { key: "ArrowRight" });
    expect(viewport?.getAttribute("transform")).not.toBe(before);
  });
});
