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
