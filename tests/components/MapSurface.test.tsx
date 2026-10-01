/** @vitest-environment jsdom */
import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import MapSurface from "@/components/campaign/MapSurface";

function DraftMap() {
  const [draft, setDraft] = useState("");
  return <input aria-label="Destino preparado" value={draft} onChange={event => setDraft(event.target.value)} />;
}

describe("expanded map", () => {
  it("keeps the same map and draft across expansion, isolates the background and restores focus", () => {
    render(<><button>Fuera del mapa</button><MapSurface title="Mapa de combate"><DraftMap /></MapSurface></>);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "3,4" } });
    const trigger = screen.getByRole("button", { name: "Ampliar mapa de combate" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Mapa de combate" })).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Fuera del mapa")).toHaveAttribute("inert");
    expect(screen.getByRole("textbox")).toBe(input);
    expect(input).toHaveValue("3,4");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(input).toHaveValue("3,4");
    expect(trigger).toHaveFocus();
    expect(screen.getByText("Fuera del mapa")).not.toHaveAttribute("inert");
  });
});
