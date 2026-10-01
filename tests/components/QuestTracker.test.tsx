/** @vitest-environment jsdom */
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import QuestTracker from "@/components/QuestTracker";

const quests = [
  { id: "one", title: "La torre", objective: "Busca la llave", description: "Un camino oscuro", hook: "Una luz distante", status: "active", createdAt: "2026-10-01" },
  { id: "two", title: "El puente", objective: "Habla con Elia", description: "Sobre el río", status: "active", createdAt: "2026-10-01" },
  { id: "old", title: "El bosque", objective: "Encuentra la salida", description: "Entre los árboles", status: "completed", createdAt: "2026-10-01" },
];

describe("quest reading selection", () => {
  it("shows one objective, switches selection, and preserves both hook and description", () => {
    render(<QuestTracker quests={quests} />);
    const detail = screen.getByRole("article", { name: "Misión seleccionada" });
    expect(detail).toHaveTextContent("Busca la llave");
    expect(detail).toHaveTextContent("Una luz distante");
    expect(detail).toHaveTextContent("Un camino oscuro");
    expect(detail.querySelector("details")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: /El puente/ }));
    expect(detail).toHaveTextContent("Habla con Elia");
    expect(detail).not.toHaveTextContent("Busca la llave");
    expect(screen.getByRole("button", { name: /El puente/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Archivo (1)").closest("details")).not.toHaveAttribute("open");
  });

  it("uses refreshed facts and falls back when the selected quest disappears", () => {
    const { rerender } = render(<QuestTracker quests={quests} />);
    fireEvent.click(screen.getByRole("button", { name: /El puente/ }));
    rerender(<QuestTracker quests={quests.map(q => q.id === "two" ? { ...q, objective: "Cruza el puente", status: "completed" } : q)} />);
    expect(screen.getByRole("article")).toHaveTextContent("Cruza el puente");
    rerender(<QuestTracker quests={[quests[0]!]} />);
    expect(screen.getByRole("article")).toHaveTextContent("Busca la llave");
    expect(within(screen.getByRole("article")).queryByText("Cruza el puente")).not.toBeInTheDocument();
  });
});
