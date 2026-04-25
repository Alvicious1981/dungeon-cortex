/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import BattleGrid from "@/components/combat/BattleGrid";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

describe("BattleGrid", () => {
  const combatants = [
    {
      id: "pc-1",
      name: "Aldric",
      isPlayer: true,
      hp: 20,
      maxHp: 20,
      ac: 16,
      x: 1,
      y: 2,
      size: "Medium",
    },
    {
      id: "ogre-1",
      name: "Ogre",
      isPlayer: false,
      hp: 59,
      maxHp: 59,
      ac: 11,
      x: 2,
      y: 3,
      size: "Large",
    },
  ];

  it("renders a 10x10 tactical grid", () => {
    render(
      <BattleGrid
        campaignId="camp-123"
        combatants={combatants}
        activeCombatantId="pc-1"
      />
    );

    expect(screen.getByText("Tactical Grid 10x10")).toBeInTheDocument();
    expect(screen.getByLabelText("Aldric token at 1,2")).toBeInTheDocument();
    expect(screen.getByLabelText("Ogre token at 2,3")).toBeInTheDocument();
  });

  it("renders Large tokens as 2x2", () => {
    render(
      <BattleGrid
        campaignId="camp-123"
        combatants={combatants}
      />
    );

    const ogreToken = screen.getByLabelText("Ogre token at 2,3");
    expect(ogreToken).toHaveStyle({
      gridColumn: "3 / span 2",
      gridRow: "4 / span 2",
    });
  });
});
