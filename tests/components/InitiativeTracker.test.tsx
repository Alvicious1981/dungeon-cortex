/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import InitiativeTracker from "@/components/combat/InitiativeTracker";
import {
  DUNGEON_ACTION_REQUEST,
  type DungeonActionRequestDetail,
} from "@/lib/events/action-transport";

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
      roll: {
        dice: [{ result: 13, sides: 20 }],
        total: 13,
        type: "1d20",
      } as any,
    },
    {
      id: "c2",
      name: "Goblin",
      dexModifier: 1,
      naturalRoll: 11,
      initiative: 12,
      roll: {
        dice: [{ result: 11, sides: 20 }],
        total: 11,
        type: "1d20",
      } as any,
    },
  ];

  it("renders correctly with entries", () => {
    render(<InitiativeTracker entries={mockEntries} activeId="c1" />);

    expect(screen.getByText("Orden de iniciativa")).toBeInTheDocument();
    expect(screen.getByText("Aldric")).toBeInTheDocument();
    expect(screen.getByText("Goblin")).toBeInTheDocument();
    expect(screen.getByText("15")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Siguiente turno" })
    ).toBeInTheDocument();
  });

  it("requests canonical End Turn through the shared action transport", () => {
    const requestListener = vi.fn();
    window.addEventListener(DUNGEON_ACTION_REQUEST, requestListener);
    render(<InitiativeTracker entries={mockEntries} activeId="c1" />);

    fireEvent.click(
      screen.getByRole("button", { name: "Siguiente turno" })
    );

    expect(requestListener).toHaveBeenCalledTimes(1);
    const event = requestListener.mock
      .calls[0]?.[0] as CustomEvent<DungeonActionRequestDetail>;
    expect(event.detail.request).toEqual({ action: "End Turn" });
    window.removeEventListener(DUNGEON_ACTION_REQUEST, requestListener);
  });

  it("renders empty state correctly", () => {
    render(<InitiativeTracker entries={[]} />);

    expect(
      screen.getByText("No hay combatientes en este encuentro.")
    ).toBeInTheDocument();
  });
});
