/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
    { id: "c1", name: "Aldric", initiativeTotal: 15 },
    { id: "c2", name: "Goblin", initiativeTotal: 12 },
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

  it("labels persisted totals without displaying a reconstructed die or modifier", () => {
    render(
      <InitiativeTracker
        entries={[
          { id: "pc", name: "Mira", initiativeTotal: 23, unconscious: true },
          { id: "enemy", name: "Goblin", initiativeTotal: -2 },
        ]}
        activeId="pc"
      />
    );

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("aria-current", "true");
    expect(rows[1]).not.toHaveAttribute("aria-current");
    expect(rows[0]).toHaveTextContent("Mira");
    expect(rows[1]).toHaveTextContent("Goblin");
    expect(within(rows[0]).getByText("Inconsciente")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Iniciativa:")).toBeInTheDocument();
    expect(within(rows[0]).getAllByText("23")).toHaveLength(1);
    expect(within(rows[1]).getAllByText("-2")).toHaveLength(1);
    expect(rows[0]).not.toHaveTextContent(/\+0|undefined|NaN/);
    expect(rows[1]).not.toHaveTextContent(/\+0|undefined|NaN/);
  });

  it("marks the active turn with text, not only with colour", () => {
    render(<InitiativeTracker entries={mockEntries} activeId="c2" />);

    const rows = screen.getAllByRole("listitem");
    expect(within(rows[1]).getByText("Turno actual")).toBeInTheDocument();
    expect(within(rows[0]).queryByText("Turno actual")).toBeNull();
    expect(screen.getAllByText("Turno actual")).toHaveLength(1);
  });

  it("marks no row when nobody holds the turn", () => {
    render(<InitiativeTracker entries={mockEntries} />);

    expect(screen.queryByText("Turno actual")).toBeNull();
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

  it("offers no turn advance to a downed player (death-saves spec §7.4)", () => {
    render(<InitiativeTracker entries={mockEntries} activeId="c1" playerDown />);

    expect(screen.queryByRole("button", { name: "Siguiente turno" })).toBeNull();
    expect(screen.getByText(/Estás inconsciente/)).toBeInTheDocument();
  });

  it("renders empty state correctly", () => {
    render(<InitiativeTracker entries={[]} />);

    expect(
      screen.getByText("No hay combatientes en este encuentro.")
    ).toBeInTheDocument();
  });
});
