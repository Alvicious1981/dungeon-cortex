/** @vitest-environment jsdom */
import React, { useRef, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useModalFocus } from "@/lib/hooks/useModalFocus";

function Dialog({ name, close, children }: { name: string; close(): void; children?: React.ReactNode }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  useModalFocus({ open: true, onClose: close, dialogRef, initialFocusRef });
  return <div ref={dialogRef} role="dialog" aria-label={name} tabIndex={-1}>
    <button ref={initialFocusRef} onClick={close}>Cerrar {name}</button>{children}
  </div>;
}

function NestedDialogs() {
  const [parent, setParent] = useState(false);
  const [child, setChild] = useState(false);
  return <>
    <header data-testid="outer-background"><button>Campaña</button></header>
    <main><button onClick={() => setParent(true)}>Abrir hoja</button>
      {parent && <Dialog name="hoja" close={() => setParent(false)}>
        <button onClick={() => setChild(true)}>Abrir detalle</button>
        {child && <Dialog name="detalle" close={() => setChild(false)} />}
      </Dialog>}
    </main>
  </>;
}

afterEach(cleanup);

describe("useModalFocus", () => {
  it("lets Tab reach inventory summaries and excludes controls inside closed details", () => {
    render(<Dialog name="inventario" close={() => {}}>
      <button>Última pestaña</button>
      <details><summary>Espada</summary><p>Detalle del arma</p></details>
    </Dialog>);
    screen.getByRole("button", { name: "Última pestaña" }).focus();
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    window.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    screen.getByText("Espada").focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Cerrar inventario" })).toHaveFocus();
  });
  it("returns to the disclosure summary rather than controls hidden inside it", () => {
    render(<Dialog name="mochila" close={() => {}}>
      <details><summary>Cuerda</summary><button>Detalle oculto</button></details>
    </Dialog>);
    screen.getByRole("button", { name: "Cerrar mochila" }).focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(screen.getByText("Cuerda")).toHaveFocus();
  });
  it("isolates ancestor siblings, contains focus and restores the trigger", () => {
    render(<NestedDialogs />);
    const trigger = screen.getByRole("button", { name: "Abrir hoja" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "Cerrar hoja" })).toHaveFocus();
    expect(screen.getByTestId("outer-background")).toHaveAttribute("inert");
    expect(trigger).toHaveAttribute("inert");
    trigger.focus();
    expect(screen.getByRole("button", { name: "Cerrar hoja" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Abrir detalle" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Cerrar hoja" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(screen.getByTestId("outer-background")).not.toHaveAttribute("inert");
  });

  it("closes only the top nested dialog and keeps parent isolation and scroll lock", () => {
    document.body.style.overflow = "auto";
    render(<NestedDialogs />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir hoja" }));
    const childTrigger = screen.getByRole("button", { name: "Abrir detalle" });
    childTrigger.focus();
    fireEvent.click(childTrigger);
    expect(screen.getByRole("button", { name: "Cerrar detalle" })).toHaveFocus();
    expect(childTrigger).toHaveAttribute("inert");
    expect(screen.getByRole("dialog", { name: "detalle" }).closest("[inert]")).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "detalle" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "hoja" })).toBeInTheDocument();
    expect(childTrigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByTestId("outer-background")).toHaveAttribute("inert");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.body.style.overflow).toBe("auto");
  });
});
