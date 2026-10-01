/** @vitest-environment jsdom */
import { afterEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import BattleGrid from "@/components/combat/BattleGrid";
import {
  DUNGEON_ACTION_REQUEST,
  dispatchDungeonActionEnd,
  dispatchDungeonActionError,
  type DungeonActionRequestDetail,
} from "@/lib/events/action-transport";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

describe("BattleGrid", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
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
    const { container } = render(
      <BattleGrid
        combatants={combatants}
        activeCombatantId="pc-1"
      />
    );

    expect(screen.getByText("Cuadrícula táctica 10x10")).toBeInTheDocument();
    const gridLines = container.querySelector('[aria-hidden="true"]');
    expect(gridLines).toHaveStyle({
      gridTemplateColumns: "repeat(10, minmax(0, 1fr))",
      gridTemplateRows: "repeat(10, minmax(0, 1fr))",
    });
    expect(gridLines?.children).toHaveLength(100);
    expect(screen.getByLabelText("Ficha de Aldric en 1,2")).toBeInTheDocument();
    expect(screen.getByLabelText("Ficha de Ogre en 2,3")).toBeInTheDocument();
  });

  it("renders Large tokens as 2x2", () => {
    render(
      <BattleGrid
        combatants={combatants}
      />
    );

    const ogreToken = screen.getByLabelText("Ficha de Ogre en 2,3");
    expect(ogreToken).toHaveStyle({
      gridColumn: "3 / span 2",
      gridRow: "4 / span 2",
    });
  });
  it("previews keyboard movement and requests the canonical Move action on Enter", async () => {
    const requestListener = vi.fn();
    window.addEventListener(DUNGEON_ACTION_REQUEST, requestListener);
    render(<BattleGrid combatants={combatants} activeCombatantId="pc-1" />);

    fireEvent.keyDown(screen.getByLabelText("Ficha de Aldric en 1,2"), { key: "ArrowRight" });
    const preview = screen.getByLabelText("Ficha de Aldric en 2,2");
    expect(screen.getByRole("status")).toHaveTextContent("Confirma con Enter");
    expect(requestListener).not.toHaveBeenCalled();
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

    fireEvent.keyDown(screen.getByLabelText("Ficha de Aldric en 1,2"), { key: "ArrowRight" });
    expect(screen.getByRole("status")).toHaveTextContent("Confirma con Enter");

    fireEvent.keyDown(screen.getByLabelText("Ficha de Aldric en 2,2"), { key: "ArrowLeft" });
    expect(screen.getByLabelText("Ficha de Aldric en 1,2")).toBeInTheDocument();
    expect(screen.queryByText(/Destino previsto/)).not.toBeInTheDocument();
  });

  function observeRequests() {
    const requests: DungeonActionRequestDetail[] = [];
    const handler = (event: Event) => requests.push((event as CustomEvent<DungeonActionRequestDetail>).detail);
    window.addEventListener(DUNGEON_ACTION_REQUEST, handler);
    return { requests, stop: () => window.removeEventListener(DUNGEON_ACTION_REQUEST, handler) };
  }

  function boardBounds() {
    const board = screen.getByRole("grid");
    vi.spyOn(board, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 500, height: 500, bottom: 500, right: 500, toJSON: () => ({}) });
    return board;
  }

  it("selects an owned origin and pointer destination without requesting movement until confirmation", () => {
    const { requests, stop } = observeRequests();
    render(<BattleGrid combatants={combatants} />);
    const board = boardBounds();
    const token = screen.getByRole("gridcell", { name: /Aldric/ });
    fireEvent.pointerDown(token, { pointerType: "touch", pointerId: 1 });
    fireEvent.pointerUp(token, { pointerType: "touch", pointerId: 1 });
    fireEvent.click(token);
    fireEvent.click(board, { clientX: 475, clientY: 475 });
    expect(requests).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar movimiento" }));
    expect(requests).toHaveLength(1);
    // No client distance/collision rule blocks a requested coordinate.
    expect(requests[0].request).toEqual({ action: "Move", targetX: 9, targetY: 9 });
    expect(screen.getByRole("status")).toHaveTextContent(/comprobando/i);
    expect(screen.getByRole("gridcell", { name: /Aldric/ })).toBeDisabled();
    stop();
  });

  it("cancels a pointer preview without sending and restores the owned token focus", () => {
    const { requests, stop } = observeRequests();
    render(<BattleGrid combatants={combatants} />);
    const board = boardBounds();
    fireEvent.click(screen.getByRole("gridcell", { name: /Aldric/ }));
    fireEvent.click(board, { clientX: 175, clientY: 125 });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar movimiento" }));
    expect(screen.getByRole("gridcell", { name: /Aldric.*1,2/ })).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Confirmar movimiento" })).not.toBeInTheDocument();
    expect(requests).toHaveLength(0);
    stop();
  });

  it("previews a mouse drag but pointercancel never confirms it", () => {
    const { requests, stop } = observeRequests();
    render(<BattleGrid combatants={combatants} />);
    boardBounds();
    const token = screen.getByRole("gridcell", { name: /Aldric/ });
    fireEvent.pointerDown(token, { pointerType: "mouse", pointerId: 3, button: 0 });
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 175, clientY: 125 });
    fireEvent.pointerCancel(window, { pointerId: 3 });
    expect(screen.getByRole("gridcell", { name: /Aldric.*1,2/ })).toBeInTheDocument();
    expect(requests).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Confirmar movimiento" })).not.toBeInTheDocument();
    stop();
  });

  it("keeps a released drag as a preview and cancels it with Escape", () => {
    const { requests, stop } = observeRequests();
    render(<BattleGrid combatants={combatants} />);
    boardBounds();
    const token = screen.getByRole("gridcell", { name: /Aldric/ });
    fireEvent.pointerDown(token, { pointerType: "mouse", pointerId: 3, button: 0 });
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 175, clientY: 125 });
    fireEvent.pointerUp(window, { pointerId: 3, clientX: 175, clientY: 125 });
    expect(requests).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Confirmar movimiento" })).toBeEnabled();
    fireEvent.keyDown(screen.getByRole("gridcell", { name: /Aldric/ }), { key: "Escape" });
    expect(screen.getByRole("gridcell", { name: /Aldric.*1,2/ })).toBeInTheDocument();
    expect(requests).toHaveLength(0);
    stop();
  });

  it("restores the server position and permits a fresh intent after correlated refusal", () => {
    const { requests, stop } = observeRequests();
    render(<BattleGrid combatants={combatants} />);
    fireEvent.keyDown(screen.getByRole("gridcell", { name: /Aldric/ }), { key: "ArrowRight" });
    fireEvent.keyDown(screen.getByRole("gridcell", { name: /Aldric/ }), { key: "Enter" });
    act(() => {
      dispatchDungeonActionError({ ...requests[0], error: "Out of range" });
      dispatchDungeonActionEnd(requests[0]);
    });
    expect(screen.getByRole("gridcell", { name: /Aldric.*1,2/ })).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/no se pudo completar/i);
    expect(screen.getByRole("alert")).not.toHaveTextContent("Out of range");
    fireEvent.keyDown(screen.getByRole("gridcell", { name: /Aldric/ }), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("gridcell", { name: /Aldric/ }), { key: "Enter" });
    expect(requests).toHaveLength(2);
    stop();
  });
});
