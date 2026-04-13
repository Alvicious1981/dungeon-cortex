/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import InitiativeTracker from "@/components/combat/InitiativeTracker";
import React from 'react';

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

describe("InitiativeTracker Smoke Test", () => {
  const mockEntries = [
    {
      id: "c1",
      name: "Aldric",
      dexModifier: 2,
      naturalRoll: 13,
      initiative: 15,
      roll: { dice: [{ result: 13, sides: 20 }], total: 13, type: "1d20" } as any,
    },
    {
      id: "c2",
      name: "Goblin",
      dexModifier: 1,
      naturalRoll: 11,
      initiative: 12,
      roll: { dice: [{ result: 11, sides: 20 }], total: 11, type: "1d20" } as any,
    },
  ];

  it("renders correctly with entries", () => {
    render(
      <InitiativeTracker
        entries={mockEntries}
        activeId="c1"
        campaignId="camp-123"
      />
    );

    expect(screen.getByText("Initiative Order")).toBeInTheDocument();
    expect(screen.getByText("Aldric")).toBeInTheDocument();
    expect(screen.getByText("Goblin")).toBeInTheDocument();
    
    // Check initiative totals
    expect(screen.getByText("15")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();

    // Check Next Turn button
    expect(screen.getByRole("button", { name: "Next Turn" })).toBeInTheDocument();
  });

  it("renders empty state correctly", () => {
    render(
      <InitiativeTracker
        entries={[]}
        campaignId="camp-123"
      />
    );

    expect(screen.getByText("No combatants in this encounter.")).toBeInTheDocument();
  });
});
