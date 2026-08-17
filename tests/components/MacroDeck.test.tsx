/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import MacroDeck from "@/components/combat/MacroDeck";
import {
  DUNGEON_ACTION_REQUEST,
  dispatchDungeonTargetSelection,
  type DungeonActionRequestDetail,
} from "@/lib/events/action-transport";

afterEach(() => cleanup());

describe("MacroDeck combat transport", () => {
  it("offers only combat actions with authoritative backend gates", () => {
    render(<MacroDeck inCombat />);

    expect(screen.getByRole("button", { name: "Atacar con arma" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finalizar turno" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Esquivar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lanzar conjuro" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Usar poción" })).not.toBeInTheDocument();
  });

  it("maps Finalizar turno to the canonical End Turn request", () => {
    const requestListener = vi.fn();
    window.addEventListener(DUNGEON_ACTION_REQUEST, requestListener);
    render(<MacroDeck inCombat />);

    fireEvent.click(screen.getByRole("button", { name: "Finalizar turno" }));

    expect(requestListener).toHaveBeenCalledTimes(1);
    const event = requestListener.mock.calls[0]?.[0] as CustomEvent<DungeonActionRequestDetail>;
    expect(event.detail.request).toEqual({ action: "End Turn" });
    window.removeEventListener(DUNGEON_ACTION_REQUEST, requestListener);
  });

  it("sends the selected target with Atacar con arma", () => {
    const requestListener = vi.fn();
    window.addEventListener(DUNGEON_ACTION_REQUEST, requestListener);
    render(<MacroDeck inCombat />);

    act(() => dispatchDungeonTargetSelection(["enemy-1"]));
    fireEvent.click(screen.getByRole("button", { name: "Atacar con arma" }));

    expect(requestListener).toHaveBeenCalledTimes(1);
    const event = requestListener.mock.calls[0]?.[0] as CustomEvent<DungeonActionRequestDetail>;
    expect(event.detail.request).toEqual({
      action: "Attack",
      targetIds: ["enemy-1"],
    });
    window.removeEventListener(DUNGEON_ACTION_REQUEST, requestListener);
  });

  it("rejects Atacar con arma without exactly one selected target", () => {
    const requestListener = vi.fn();
    window.addEventListener(DUNGEON_ACTION_REQUEST, requestListener);
    render(<MacroDeck inCombat />);

    act(() => dispatchDungeonTargetSelection(["enemy-1", "enemy-2"]));
    fireEvent.click(screen.getByRole("button", { name: "Atacar con arma" }));

    expect(requestListener).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Selecciona exactamente un objetivo para atacar."
    );
    window.removeEventListener(DUNGEON_ACTION_REQUEST, requestListener);
  });
});
