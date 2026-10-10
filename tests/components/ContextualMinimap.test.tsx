/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ContextualMinimap from "@/components/exploration/ContextualMinimap";

afterEach(() => {
  cleanup();
});

// Mock useDungeon to provide controlled tiles, rooms, and FOV
vi.mock("@/lib/hooks/useDungeon", () => ({
  useDungeon: (seed: string | null, playerX: number, playerY: number) => {
    if (seed === "loading-seed") {
      return { dungeon: null, fov: new Set<string>(), isReady: false };
    }

    return {
      dungeon: {
        width: 30,
        height: 20,
        tiles: [
          // Row 0: wall in FOV, wall out of FOV
          ["wall", "wall", "floor"],
          // Row 1: floor in FOV, door in FOV
          ["floor", "door", "floor"],
        ],
        rooms: [
          // Room 0: active room at (1, 1), nodeIndex 0
          { id: 0, nodeIndex: 0, centerX: 1, centerY: 1, x: 0, y: 0, width: 3, height: 3 },
          // Room 1: visited room at (5, 5), nodeIndex 1 (out of FOV but visited)
          { id: 1, nodeIndex: 1, centerX: 5, centerY: 5, x: 4, y: 4, width: 3, height: 3 },
          // Room 2: in-FOV room at (0, 1), nodeIndex 2 (unvisited but visible in FOV)
          { id: 2, nodeIndex: 2, centerX: 0, centerY: 1, x: 0, y: 1, width: 2, height: 2 },
          // Room 3: SECRET/UNDISCOVERED room at (20, 15), nodeIndex 3 (out of FOV, never visited)
          { id: 3, nodeIndex: 3, centerX: 20, centerY: 15, x: 19, y: 14, width: 3, height: 3 },
        ],
        corridors: [],
      },
      // FOV contains (0,0), (0,1), (1,1), (2,1)
      fov: new Set<string>(["0,0", "0,1", "1,1", "2,1"]),
      isReady: true,
    };
  },
}));

describe("ContextualMinimap — presentation and fog-of-war authority", () => {
  it("renders a loading state when the dungeon generator is not ready", () => {
    render(
      <ContextualMinimap
        seed="loading-seed"
        playerX={1}
        playerY={1}
        currentNodeIndex={0}
        visitedNodeIndices={[]}
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent("Cargando minimapa…");
  });

  it("renders the player token centered at the player coordinates", () => {
    render(
      <ContextualMinimap
        seed="ready-seed"
        playerX={1}
        playerY={1}
        currentNodeIndex={0}
        visitedNodeIndices={[0]}
      />
    );

    const region = screen.getByRole("region", {
      name: "Minimapa contextual. Personaje en la posición 1, 1.",
    });
    expect(region).toBeInTheDocument();

    const playerToken = screen.getByTestId("minimap-player-token");
    expect(playerToken).toBeInTheDocument();

    // Player at (1, 1) -> center should be 1 * 16 + 8 = 24
    expect(playerToken).toHaveAttribute("cx", "24");
    expect(playerToken).toHaveAttribute("cy", "24");
  });

  it("renders legitimate rooms (active, visited, or in FOV)", () => {
    render(
      <ContextualMinimap
        seed="ready-seed"
        playerX={1}
        playerY={1}
        currentNodeIndex={0}
        visitedNodeIndices={[0, 1]}
      />
    );

    // Room 0: active room
    expect(screen.getByTestId("minimap-room-0")).toBeInTheDocument();

    // Room 1: visited room (even though out of FOV)
    expect(screen.getByTestId("minimap-room-1")).toBeInTheDocument();

    // Room 2: in FOV (even though not visited)
    expect(screen.getByTestId("minimap-room-2")).toBeInTheDocument();
  });

  it("STRICT NO-LEAK: completely omits undiscovered rooms from the DOM", () => {
    render(
      <ContextualMinimap
        seed="ready-seed"
        playerX={1}
        playerY={1}
        currentNodeIndex={0}
        visitedNodeIndices={[0]}
      />
    );

    // Room 3 is neither in FOV nor visited: it MUST NOT exist anywhere in DOM
    expect(screen.queryByTestId("minimap-room-3")).toBeNull();
    expect(screen.queryByText(/room-3/i)).toBeNull();
  });

  it("omits wall tiles that are outside the field of view", () => {
    const { container } = render(
      <ContextualMinimap
        seed="ready-seed"
        playerX={1}
        playerY={1}
        currentNodeIndex={0}
        visitedNodeIndices={[0]}
      />
    );

    // Wall at (0,0) is in FOV -> rendered
    expect(container.querySelector('[key="tile-0,0"], rect[x="0"][y="0"]')).toBeInTheDocument();

    // Wall at (1,0) is NOT in FOV -> MUST NOT be rendered
    expect(container.querySelector('[key="tile-1,0"], rect[x="16"][y="0"]')).toBeNull();
  });

  it("renders orientation indicator and screen reader text alternative", () => {
    render(
      <ContextualMinimap
        seed="ready-seed"
        playerX={1}
        playerY={1}
        currentNodeIndex={0}
        visitedNodeIndices={[0]}
      />
    );

    expect(screen.getByText("N")).toBeInTheDocument();
    expect(
      screen.getByText(/Minimapa de la mazmorra centrado en el personaje/i)
    ).toBeInTheDocument();
  });

  it("renders expand button when onExpand is provided and triggers callback", () => {
    const onExpand = vi.fn();
    render(
      <ContextualMinimap
        seed="ready-seed"
        playerX={1}
        playerY={1}
        currentNodeIndex={0}
        visitedNodeIndices={[0]}
        onExpand={onExpand}
      />
    );

    const expandBtn = screen.getByRole("button", {
      name: "Abrir plano completo de la mazmorra",
    });
    expect(expandBtn).toBeInTheDocument();

    fireEvent.click(expandBtn);
    expect(onExpand).toHaveBeenCalledTimes(1);
  });
});
