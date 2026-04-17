/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WildernessMapController } from "../../components/exploration/map/WildernessMapController";
import React from "react";

// Mock child components
vi.mock("../../components/exploration/map/WildernessMapVTT", () => ({
  WildernessMapVTT: () => React.createElement("div", { "data-testid": "wilderness-map-vtt" }, "Mocked VTT")
}));

describe("WildernessMapController", () => {
  const mockHexes = [{ q: 0, r: 0, terrain: "plains", discovered: true, scouted: true }];

  it("renders the toggle button initially, but not the map", () => {
    render(<WildernessMapController hexes={mockHexes} currentQ={0} currentR={0} />);
    
    expect(screen.getByText(/Consult The Cartographer's Map/i)).toBeDefined();
    expect(screen.queryByTestId("wilderness-map-vtt")).toBeNull();
  });

  it("opens the full-screen overlay when the button is clicked", async () => {
    render(<WildernessMapController hexes={mockHexes} currentQ={0} currentR={0} />);
    
    const button = screen.getByText(/Consult The Cartographer's Map/i);
    fireEvent.click(button);
    
    const map = await screen.findByTestId("wilderness-map-vtt");
    expect(map).toBeDefined();
    expect(screen.getByText(/World Map/i)).toBeDefined();
  });

  it("closes the overlay when the Close button is clicked", async () => {
    render(<WildernessMapController hexes={mockHexes} currentQ={0} currentR={0} />);
    
    // Open
    fireEvent.click(screen.getByText(/Consult The Cartographer's Map/i));
    const map = await screen.findByTestId("wilderness-map-vtt");
    expect(map).toBeDefined();
    
    // Close
    const closeButton = screen.getByText(/Close Map/i);
    fireEvent.click(closeButton);
    
    expect(screen.queryByTestId("wilderness-map-vtt")).toBeNull();
  });
});
