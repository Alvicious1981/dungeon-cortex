/** @vitest-environment jsdom */
import React, { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CampaignAdventure from "@/components/campaign/CampaignAdventure";
import CampaignJournal from "@/components/campaign/CampaignJournal";
import CampaignLayout from "@/components/campaign/CampaignLayout";
import { prepareDungeonAction } from "@/lib/events/campaign-ui";

function Draft() {
  const [value, setValue] = useState("");
  return <input aria-label="Nota local" value={value} onChange={event => setValue(event.target.value)} />;
}

afterEach(() => vi.restoreAllMocks());

describe("campaign workspace tabs", () => {
  it("supports arrows, Home and End with connected panels, retaining hidden input state", () => {
    render(<CampaignJournal quests={<Draft />} characters={<p>Elia</p>} memories={<p>Recuerdos</p>} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Pendiente" } });
    const quests = screen.getByRole("tab", { name: "Misiones" });
    expect(screen.getByRole("tabpanel")).toHaveAttribute("id", quests.getAttribute("aria-controls"));
    fireEvent.keyDown(quests, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Personajes" })).toHaveFocus();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(input).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Recuerdos");
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(screen.getByRole("textbox")).toBe(input);
    expect(input).toHaveValue("Pendiente");
  });

  it("connects mobile scene navigation and prepared actions with the visible adventure panel", () => {
    const previous = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = vi.fn();
    try {
      render(<><a href="#chronicle">Saltar a la bitácora</a><CampaignLayout character={<div>Estado</div>} journal={<aside id="journal">Diario</aside>}>
        <CampaignAdventure scene={<section id="scene" tabIndex={-1}>Mapa actual</section>} story={<section id="chronicle" tabIndex={-1}>Historia actual</section>}>
          <input id="action-input" aria-label="Comando" />
        </CampaignAdventure>
      </CampaignLayout></>);
      expect(screen.getByRole("tabpanel")).toHaveTextContent("Historia actual");
      fireEvent.click(screen.getByRole("link", { name: "Escena" }));
      expect(screen.getByRole("tabpanel")).toHaveTextContent("Mapa actual");
      expect(screen.getByText("Mapa actual")).toHaveFocus();
      fireEvent.click(screen.getByRole("link", { name: "Saltar a la bitácora" }));
      expect(screen.getByRole("tabpanel")).toHaveTextContent("Historia actual");
      expect(screen.getByText("Historia actual")).toHaveFocus();
      fireEvent.click(screen.getByRole("link", { name: "Escena" }));
      act(() => prepareDungeonAction("equipar Daga"));
      expect(screen.getByRole("tabpanel")).toHaveTextContent("Historia actual");
      expect(screen.getByRole("textbox", { name: "Comando" })).toHaveFocus();
    } finally { HTMLElement.prototype.scrollIntoView = previous; }
  });
});
