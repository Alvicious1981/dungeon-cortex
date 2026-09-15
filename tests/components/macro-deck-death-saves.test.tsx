/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import MacroDeck from "@/components/combat/MacroDeck";

afterEach(() => cleanup());

describe("MacroDeck while the player is down (death-saves spec §7.4)", () => {
  it("offers only the death save while dying, with the counters", () => {
    render(<MacroDeck inCombat lifeState="dying" deathSaves={{ successes: 2, failures: 1 }} />);
    expect(screen.getByRole("button", { name: "Tirada de muerte" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Atacar con arma" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Finalizar turno" })).toBeNull();
    expect(screen.getByLabelText("Éxitos 2 de 3, fallos 1 de 3")).toBeTruthy();
  });

  it("offers only Esperar while stable", () => {
    render(<MacroDeck inCombat lifeState="stable" deathSaves={{ successes: 3, failures: 0 }} />);
    expect(screen.getByRole("button", { name: "Esperar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Tirada de muerte" })).toBeNull();
  });

  it("keeps the ordinary combat actions when conscious", () => {
    render(<MacroDeck inCombat lifeState="conscious" />);
    expect(screen.getByRole("button", { name: "Atacar con arma" })).toBeTruthy();
    expect(screen.queryByLabelText(/Éxitos/)).toBeNull();
  });
});
