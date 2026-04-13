/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ZoneGrid } from "@/components/combat/ZoneGrid";
import React from 'react';

describe("ZoneGrid Smoke Test", () => {
  const mockZones = [
    { id: "z1", name: "Frontline", x: 0, y: 0 },
    { id: "z2", name: "Backline", x: 1, y: 0 },
  ];

  const mockCombatants = [
    {
      id: "c1",
      name: "Aldric",
      isPlayer: true,
      hp: 20,
      maxHp: 20,
      ac: 16,
      initiativeTotal: 15,
      zoneId: "z1",
    },
    {
      id: "c2",
      name: "Goblin",
      isPlayer: false,
      hp: 7,
      maxHp: 7,
      ac: 13,
      initiativeTotal: 12,
      zoneId: "z1",
    },
  ];

  it("renders correctly with mock data", () => {
    render(
      <ZoneGrid
        zones={mockZones}
        combatants={mockCombatants}
        activeCombatantId="c1"
      />
    );

    // Check for zone names
    expect(screen.getByText("Frontline")).toBeInTheDocument();
    expect(screen.getByText("Backline")).toBeInTheDocument();
    
    // Check for combatant names
    expect(screen.getByText("Aldric")).toBeInTheDocument();
    expect(screen.getByText("Goblin")).toBeInTheDocument();
    
    // Check for AC badges (they are small spans)
    expect(screen.getByText("16")).toBeInTheDocument();
    expect(screen.getByText("13")).toBeInTheDocument();

    // Check for HP displays
    expect(screen.getByText("20/20")).toBeInTheDocument();
    expect(screen.getByText("7/7")).toBeInTheDocument();
  });

  it("handles empty zones and combatants gracefully", () => {
    render(<ZoneGrid zones={[]} combatants={[]} />);
    expect(screen.getByTestId("zone-grid")).toBeInTheDocument();
  });
});
