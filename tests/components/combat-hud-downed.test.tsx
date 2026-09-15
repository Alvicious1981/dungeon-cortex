/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import CombatHUD from "@/components/combat/CombatHUD";

afterEach(() => cleanup());

const COMBATANTS = [
  { id: "g1", name: "Goblin", hp: 7, maxHp: 7, initiativeTotal: 12, conditions: [] },
  { id: "p1", name: "Aldric", hp: 0, maxHp: 12, initiativeTotal: 8, conditions: [] },
];

describe("CombatHUD for a downed player (death-saves spec §7.4)", () => {
  it("replaces Attack and End Turn with a pointer to the death-save action", () => {
    render(
      <CombatHUD
        combatants={COMBATANTS}
        activeTurnIndex={1}
        isPending={false}
        onActionTrigger={vi.fn()}
        playerDown
      />
    );

    expect(screen.queryByRole("button", { name: /Attack/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /End Turn/ })).toBeNull();
    expect(screen.getByText(/Estás inconsciente/)).toBeTruthy();
  });

  it("keeps the ordinary actions for a conscious player", () => {
    render(
      <CombatHUD
        combatants={COMBATANTS}
        activeTurnIndex={1}
        isPending={false}
        onActionTrigger={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Attack (F1)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "End Turn (F2)" })).toBeTruthy();
  });
});
