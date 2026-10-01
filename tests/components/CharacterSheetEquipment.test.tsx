/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import CharacterSheetController from "@/components/character/CharacterSheetController";
import EquipmentLink from "@/components/campaign/EquipmentLink";
import { buildSheetViewModel } from "@/lib/character-sheet/view-model";
import { DUNGEON_OPEN_CHARACTER, DUNGEON_PREPARE_ACTION } from "@/lib/events/campaign-ui";

const profile = {
  id: "mira", revision: 1, name: "Mira", appearance: "", backstory: "",
  personalityTraits: "", ideals: "", bonds: "", flaws: "", updatedAt: "2026-10-01T00:00:00Z",
};
const source = {
  character: { id: "mira", name: "Mira", race: "Human", class: "Fighter", level: 1, hp: 10, maxHp: 10, xp: 0, stats: {} },
  inventory: [
    { id: "old", name: "Espada", type: "weapon", quantity: 1, equippedSlot: "MAIN_HAND", properties: { damageDice: "1d8", damageType: "slashing" } },
    { id: "new", name: "Daga", type: "weapon", quantity: 1, equippedSlot: null, properties: { damageDice: "1d4", damageType: "piercing" } },
    { id: "rope", name: "Cuerda", type: "misc", quantity: 1, equippedSlot: null, properties: { description: "Diez metros de cuerda trenzada." } },
  ],
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function openEquipment() {
  fireEvent.click(screen.getByRole("button", { name: /abrir hoja de personaje/i }));
  fireEvent.click(screen.getByRole("button", { name: "Equipo" }));
}

describe("equipment sheet", () => {
  it("opens equipment directly from the inventory and returns focus to that control", () => {
    render(<><EquipmentLink /><CharacterSheetController sheet={buildSheetViewModel(source)} profile={profile} nameLocked={false} /></>);
    const trigger = screen.getByRole("button", { name: "Abrir Equipo" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("region", { name: "Equipo actual" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
  it("opens from the mobile navigation event and shows the four persisted slots", () => {
    render(<CharacterSheetController sheet={buildSheetViewModel(source)} profile={profile} nameLocked={false} />);
    act(() => { window.dispatchEvent(new CustomEvent(DUNGEON_OPEN_CHARACTER)); });
    expect(screen.getByRole("dialog", { name: "Mira" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Equipo" }));
    const equipment = within(screen.getByRole("region", { name: "Equipo actual" }));
    expect(equipment.getAllByRole("button")).toHaveLength(4);
    expect(equipment.getByRole("button", { name: /Mano principal: Espada/ })).toBeInTheDocument();
    expect(equipment.getByRole("button", { name: /Mano secundaria: Vacío/ })).toBeInTheDocument();
    expect(equipment.getByRole("button", { name: /Armadura: Vacío/ })).toBeInTheDocument();
    fireEvent.click(equipment.getByRole("button", { name: /Accesorio: Vacío/ }));
    expect(screen.getByText("No hay ningún objeto equipado en esta posición.")).toBeVisible();
  });

  it("filters the backpack and reveals actual properties on selection", () => {
    render(<CharacterSheetController sheet={buildSheetViewModel(source)} profile={profile} nameLocked={false} />);
    openEquipment();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar en la mochila" }), { target: { value: "cuer" } });
    const pack = within(screen.getByRole("list", { name: "Objetos de la mochila" }));
    expect(pack.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(pack.getByRole("button", { name: /Cuerda/ }));
    expect(screen.getByRole("region", { name: "Detalle del objeto" })).toHaveTextContent("Diez metros de cuerda trenzada.");
    fireEvent.change(screen.getByRole("combobox", { name: "Categoría" }), { target: { value: "weapon" } });
    expect(screen.getByText("No hay objetos que coincidan con los filtros.")).toBeVisible();
  });

  it("prepares an equip command without sending or changing equipment, then reflects refreshed props", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const prepared: string[] = [];
    const listener = (event: Event) => prepared.push((event as CustomEvent<{ action: string }>).detail.action);
    window.addEventListener(DUNGEON_PREPARE_ACTION, listener);
    const sheet = buildSheetViewModel(source);
    const { rerender } = render(<CharacterSheetController sheet={sheet} profile={profile} nameLocked={false} />);
    try {
      openEquipment();
      fireEvent.click(within(screen.getByRole("list", { name: "Objetos de la mochila" })).getByRole("button", { name: /Daga/ }));
      expect(screen.getByRole("region", { name: "Detalle del objeto" })).toHaveTextContent("Daño base: 1d4 piercing");
      fireEvent.click(screen.getByRole("button", { name: "Preparar equipar Daga" }));
      expect(prepared).toEqual(["equipar Daga"]);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      openEquipment();
      expect(screen.getByRole("button", { name: /Mano principal: Espada/ })).toBeInTheDocument();
      const refreshed = buildSheetViewModel({ ...source, inventory: source.inventory.map((item) => ({ ...item, equippedSlot: item.id === "new" ? "MAIN_HAND" : null })) });
      rerender(<CharacterSheetController sheet={refreshed} profile={profile} nameLocked={false} />);
      expect(screen.getByRole("button", { name: /Mano principal: Daga/ })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /desequipar/i })).not.toBeInTheDocument();
    } finally {
      window.removeEventListener(DUNGEON_PREPARE_ACTION, listener);
    }
  });
});
