/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
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
  it("centers on the character when the map first has a size, not while its tab is hidden", () => {
    // A hidden tab panel (display:none) measures 0x0. Centering on that would pin the
    // character to the top-left corner and, being one-shot, never be corrected.
    let size = { width: 0, height: 0 };
    const resized: ResizeObserverCallback[] = [];
    class FakeResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      // Only an observed element can report a resize.
      observe() { resized.push(this.callback); }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const measure = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => ({
      x: 0, y: 0, left: 0, top: 0, right: size.width, bottom: size.height, ...size, toJSON: () => ({}),
    }) as DOMRect);
    try {
      render(<DungeonMapVTT seed="test-seed" playerX={3} playerY={2} currentNodeIndex={0} visitedNodeIndices={[]} />);
      const viewport = screen.getByRole("region").querySelector("svg > g")!;
      expect(viewport.getAttribute("transform")).toContain("translate(0, 0)");

      size = { width: 800, height: 400 };
      act(() => resized.forEach((callback) => callback([], {} as ResizeObserver)));
      // 800 / 2 - 3 * 16 - 16 / 2 = 344; 400 / 2 - 2 * 16 - 16 / 2 = 160
      expect(viewport.getAttribute("transform")).toContain("translate(344, 160)");
    } finally {
      measure.mockRestore();
      vi.unstubAllGlobals();
    }
  });
  it("still centers immediately when the map is already visible on mount", () => {
    const measure = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => ({
      x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400, toJSON: () => ({}),
    }) as DOMRect);
    try {
      render(<DungeonMapVTT seed="test-seed" playerX={3} playerY={2} currentNodeIndex={0} visitedNodeIndices={[]} />);
      const viewport = screen.getByRole("region").querySelector("svg > g")!;
      expect(viewport.getAttribute("transform")).toContain("translate(344, 160)");
    } finally {
      measure.mockRestore();
    }
  });
  it("allows all four pan directions by click without moving the character", () => {
    const onNodeClick = vi.fn();
    render(<DungeonMapVTT seed="test-seed" playerX={0} playerY={0} currentNodeIndex={0} visitedNodeIndices={[]} onNodeClick={onNodeClick} />);
    const region = screen.getByRole("region");
    const viewport = region.querySelector("svg > g")!;
    const position = () => viewport.getAttribute("transform")!.match(/translate\(([-\d.]+), ([-\d.]+)\)/)!.slice(1).map(Number);
    for (const [direction, dx, dy] of [["arriba", 0, 64], ["izquierda", 64, 0], ["abajo", 0, -64], ["derecha", -64, 0]] as const) {
      const [x, y] = position();
      fireEvent.click(screen.getByRole("button", { name: `Desplazar vista hacia ${direction}` }));
      expect(position()).toEqual([x! + dx, y! + dy]);
    }
    expect(onNodeClick).not.toHaveBeenCalled();
    expect(region).toHaveAccessibleName("Mapa de la mazmorra. Personaje en la posición 0, 0.");
  });
  it("exposes a textual map region and supports keyboard panning", () => {
    render(
      <div style={{ width: 640, height: 360 }}>
        <DungeonMapVTT seed="test-seed" playerX={0} playerY={0} currentNodeIndex={0} visitedNodeIndices={[]} />
      </div>
    );

    const region = screen.getByRole("region", { name: "Mapa de la mazmorra. Personaje en la posición 0, 0." });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(screen.getByText(/Usa las flechas para desplazar/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alejar mapa" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Acercar mapa" })).toBeInTheDocument();

    const viewport = region.querySelector("svg > g");
    const before = viewport?.getAttribute("transform");
    fireEvent.keyDown(region, { key: "ArrowRight" });
    expect(viewport?.getAttribute("transform")).not.toBe(before);
  });
});
