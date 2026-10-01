/** @vitest-environment jsdom */
import React, { createRef } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
    render(<StatusMessage tone="error" title="No se pudo guardar">Inténtalo de nuevo.</StatusMessage>);
    expect(screen.getByRole("alert")).toHaveTextContent("Inténtalo de nuevo.");
  });

  it("permite nombrar un panel mecánico", () => {
    render(<Panel tone="mechanical" aria-label="Estado confirmado">8 puntos de golpe</Panel>);
    expect(screen.getByRole("region", { name: "Estado confirmado" })).toHaveTextContent("8 puntos de golpe");
  });
});

describe("shared button interactions", () => {
  it("supports focus refs, avoids implicit submit and honors explicit submit", () => {
    const ref = createRef<HTMLButtonElement>();
    const submit = vi.fn(event => event.preventDefault());
    render(<form onSubmit={submit}><Button ref={ref}>Consultar</Button><Button type="submit">Guardar</Button></form>);
    ref.current!.focus();
    expect(screen.getByRole("button", { name: "Consultar" })).toHaveFocus();
    fireEvent.click(ref.current!);
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(submit).toHaveBeenCalledOnce();
  });

  it("blocks clicks while loading and retains the accessible label", () => {
    const click = vi.fn();
    const { rerender } = render(<Button loading onClick={click}>Resolver</Button>);
    const button = screen.getByRole("button", { name: "Resolver" });
    expect(button).toHaveAttribute("aria-busy", "true");
    fireEvent.click(button);
    expect(click).not.toHaveBeenCalled();
    rerender(<Button onClick={click}>Resolver</Button>);
    fireEvent.click(button);
    expect(click).toHaveBeenCalledOnce();
  });
});
