/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import MacroDeck from "@/components/combat/MacroDeck";
import {
  DUNGEON_ACTION_REQUEST,
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

  it.each([
    ["Atacar con arma", "Attack"],
    ["Finalizar turno", "End Turn"],
  ])("maps %s to the canonical %s request", (label, action) => {
    const requestListener = vi.fn();
    window.addEventListener(DUNGEON_ACTION_REQUEST, requestListener);
    render(<MacroDeck inCombat />);

    fireEvent.click(screen.getByRole("button", { name: label }));

    expect(requestListener).toHaveBeenCalledTimes(1);
    const event = requestListener.mock.calls[0]?.[0] as CustomEvent<DungeonActionRequestDetail>;
    expect(event.detail.request).toEqual({ action });
    window.removeEventListener(DUNGEON_ACTION_REQUEST, requestListener);
  });
});
