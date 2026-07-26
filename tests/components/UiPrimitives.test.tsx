/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { StatusMessage } from "@/components/ui/StatusMessage";

describe("primitivas de interfaz", () => {
  it("expone el estado de carga y bloquea una acción pendiente", () => {
    render(<Button loading>Guardar</Button>);
    const button = screen.getByRole("button", { name: "Guardar" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("usa una alerta semántica para errores", () => {
    render(
      <StatusMessage tone="error" title="No se pudo guardar">
        Inténtalo de nuevo.
      </StatusMessage>
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Inténtalo de nuevo.");
  });

  it("permite nombrar un panel mecánico", () => {
    render(
      <Panel tone="mechanical" aria-label="Estado confirmado">
        8 puntos de golpe
      </Panel>
    );
    expect(
      screen.getByRole("region", { name: "Estado confirmado" })
    ).toHaveTextContent("8 puntos de golpe");
  });
});
