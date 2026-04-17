/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WildernessMapVTT } from "../../components/exploration/map/WildernessMapVTT";
import React from "react";

// Mock hex-grid functions to avoid heavy math in tests
vi.mock("../../lib/rules/hex-grid", () => ({
  cubeToPixel: vi.fn((q: number, r: number, size: number) => ({
    x: q * size * 1.732,
    y: r * size * 1.5,
  })),
  HEX_DIRECTIONS: [
    { dq: 1, dr: -1 }, { dq: 1, dr: 0 }, { dq: 0, dr: 1 },
    { dq: -1, dr: 1 }, { dq: -1, dr: 0 }, { dq: 0, dr: -1 }
  ]
}));

describe("WildernessMapVTT Component", () => {
  const mockHexes = [
    { q: 0, r: 0, terrain: "plains", discovered: true, scouted: true, feature: "dungeon_entrance" },
    { q: 1, r: -1, terrain: "forest", discovered: false, scouted: true, feature: "village" },
  ];

  it("renders the SVG container and global transform group", () => {
    render(<WildernessMapVTT hexes={mockHexes} currentQ={0} currentR={0} />);
    
    const svg = document.querySelector("svg");
    expect(svg).toBeDefined();
    
    const viewportGroup = document.querySelector(".vtt-viewport");
    expect(viewportGroup).toBeDefined();
  });

  it("renders exactly as many hex tiles as provided in the hexes prop", () => {
    render(<WildernessMapVTT hexes={mockHexes} currentQ={0} currentR={0} />);
    
    const hexTiles = document.querySelectorAll(".hex-tile");
    expect(hexTiles).toHaveLength(mockHexes.length);
  });

  it("applies 'discovered' class only to hexes with discovered=true", () => {
    render(<WildernessMapVTT hexes={mockHexes} currentQ={0} currentR={0} />);
    
    const discoveredHex = document.querySelector(".hex-tile[data-q='0'][data-r='0']");
    const scoutedHex = document.querySelector(".hex-tile[data-q='1'][data-r='-1']");
    
    expect(discoveredHex?.classList.contains("is-discovered")).toBe(true);
    expect(scoutedHex?.classList.contains("is-discovered")).toBe(false);
    expect(scoutedHex?.classList.contains("is-scouted")).toBe(true);
  });

  it("renders feature icons only for discovered hexes", () => {
    render(<WildernessMapVTT hexes={mockHexes} currentQ={0} currentR={0} />);
    
    // Discovered hex has a feature icon
    const discoveredHex = document.querySelector(".hex-tile[data-q='0'][data-r='0']");
    expect(discoveredHex?.querySelector(".hex-feature-icon")).toBeDefined();
    
    // Scouted hex has a feature but it should be HIDDEN per requirements
    const scoutedHex = document.querySelector(".hex-tile[data-q='1'][data-r='-1']");
    expect(scoutedHex?.querySelector(".hex-feature-icon")).toBeNull();
  });

  it("renders a party marker at the current location", () => {
    render(<WildernessMapVTT hexes={mockHexes} currentQ={0} currentR={0} />);
    
    const partyMarker = document.querySelector(".party-marker");
    expect(partyMarker).toBeDefined();
  });
});
