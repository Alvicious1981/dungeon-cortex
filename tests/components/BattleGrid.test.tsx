/** @vitest-environment jsdom */
import { afterEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import BattleGrid from "@/components/combat/BattleGrid";
import {
  DUNGEON_ACTION_REQUEST,
  type DungeonActionRequestDetail,
} from "@/lib/events/action-transport";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

describe("BattleGrid", () => {
  afterEach(() => vi.restoreAllMocks());
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
        combatants={combatants}
      />
    );

    const ogreToken = screen.getByLabelText("Ogre token at 2,3");
    expect(ogreToken).toHaveStyle({
      gridColumn: "3 / span 2",
      gridRow: "4 / span 2",
    });
  });
  it("previews keyboard movement and requests the canonical Move action on Enter", async () => {
    const requestListener = vi.fn();
    window.addEventListener(DUNGEON_ACTION_REQUEST, requestListener);
    render(<BattleGrid combatants={combatants} activeCombatantId="pc-1" />);

    fireEvent.keyDown(screen.getByLabelText("Aldric token at 1,2"), { key: "ArrowRight" });
    const preview = screen.getByLabelText("Aldric token at 2,2");
    expect(screen.getByRole("status")).toHaveTextContent("Enter to confirm");
    fireEvent.keyDown(preview, { key: "Enter" });

    await waitFor(() => expect(requestListener).toHaveBeenCalledTimes(1));
    const event = requestListener.mock.calls[0]?.[0] as CustomEvent<DungeonActionRequestDetail>;
    expect(event.detail.request).toEqual({
      action: "Move",
      targetX: 2,
      targetY: 2,
    });
    window.removeEventListener(DUNGEON_ACTION_REQUEST, requestListener);
  });

  it("clears the keyboard preview when the token returns to its origin", () => {
    render(<BattleGrid combatants={combatants} activeCombatantId="pc-1" />);

    fireEvent.keyDown(screen.getByLabelText("Aldric token at 1,2"), { key: "ArrowRight" });
    expect(screen.getByRole("status")).toHaveTextContent("Enter to confirm");

    fireEvent.keyDown(screen.getByLabelText("Aldric token at 2,2"), { key: "ArrowLeft" });
    expect(screen.getByLabelText("Aldric token at 1,2")).toBeInTheDocument();
    expect(screen.queryByText(/Preview/)).not.toBeInTheDocument();
  });
});
