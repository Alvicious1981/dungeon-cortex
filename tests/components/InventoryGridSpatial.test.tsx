/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import InventoryGrid, {
  type InventoryGridItem,
  type ItemPlacement,
} from "@/components/character/sheet/InventoryGrid";

afterEach(() => {
  cleanup();
});

const sampleItems: InventoryGridItem[] = [
  {
    id: "item-sword",
    name: "Espada larga",
    quantity: 1,
    category: "weapon",
    equipped: true,
    equippedSlot: "MAIN_HAND",
    summary: "Arma versátil (1d8/1d10 daño cortante).",
    tooltipLines: ["Daño: 1d8 cortante", "Propiedad: Versátil"],
  },
  {
    id: "item-potion",
    name: "Poción de curación",
    quantity: 3,
    category: "consumable",
    summary: "Restaura 2d4+2 PG.",
  },
  {
    id: "item-scroll",
    name: "Pergamino arcano",
    quantity: 1,
    category: "spell",
    summary: "Contiene el conjuro Escudo.",
  },
];

const samplePlacements: Record<string, ItemPlacement> = {
  "item-sword": { col: 1, row: 1, colSpan: 2, rowSpan: 1 },
  "item-potion": { col: 3, row: 1 },
};

describe("InventoryGrid — spatial presentation and fallback", () => {
  it("renders the accessible list view as fallback when spatialLayout is omitted", () => {
    const onSelect = vi.fn();
    render(<InventoryGrid items={sampleItems} onSelect={onSelect} />);

    expect(screen.getByRole("list", { name: "Objetos del inventario" })).toBeInTheDocument();
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cuadrícula" })).not.toBeInTheDocument();

    const swordButton = screen.getByRole("button", { name: /Espada larga/ });
    expect(swordButton).toBeInTheDocument();
    fireEvent.click(swordButton);
    expect(onSelect).toHaveBeenCalledWith(sampleItems[0]);
  });

  it("renders empty backpack state when items array is empty", () => {
    render(<InventoryGrid items={[]} spatialLayout={{ columns: 4, rows: 3 }} />);
    expect(screen.getByText("La mochila está vacía.")).toBeInTheDocument();
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("renders spatial grid with placed items, dimensions, spans and empty cell slots", () => {
    render(
      <InventoryGrid
        items={sampleItems}
        spatialLayout={{ columns: 4, rows: 3 }}
        itemPlacements={samplePlacements}
      />
    );

    const grid = screen.getByRole("grid", {
      name: "Objetos del inventario (cuadrícula 4x3)",
    });
    expect(grid).toBeInTheDocument();

    // Placed item 1: sword with colSpan: 2, rowSpan: 1 at col 1, row 1
    const sword = within(grid).getByRole("button", {
      name: /Espada larga, Armas, equipado, posición columna 1, fila 1/,
    });
    expect(sword).toBeInTheDocument();
    expect(sword).toHaveStyle({
      gridColumn: "1 / span 2",
      gridRow: "1 / span 1",
    });

    // Placed item 2: potion with quantity 3 at col 3, row 1
    const potion = within(grid).getByRole("button", {
      name: /Poción de curación, Consumibles, cantidad 3, posición columna 3, fila 1/,
    });
    expect(potion).toBeInTheDocument();
    expect(potion).toHaveStyle({
      gridColumn: "3 / span 1",
      gridRow: "1 / span 1",
    });
    expect(within(potion).getByText("x3")).toBeInTheDocument();

    // Unplaced item (item-scroll) should be in the unplaced section
    const unplacedSection = screen.getByRole("list", { name: "Objetos sin ubicar" });
    expect(within(unplacedSection).getByRole("button", { name: /Pergamino arcano/ })).toBeInTheDocument();

    // Verify empty cells exist in grid (total 4x3 = 12 cells, occupied: (1,1), (2,1), (3,1) -> 9 empty)
    const emptyCellAt41 = within(grid).getByRole("button", {
      name: "Casilla vacía columna 4, fila 1",
    });
    expect(emptyCellAt41).toBeInTheDocument();
    expect(emptyCellAt41).toHaveStyle({ gridColumn: "4", gridRow: "1" });
  });

  it("supports toggling between spatial grid and list view", () => {
    const onViewModeChange = vi.fn();
    render(
      <InventoryGrid
        items={sampleItems}
        spatialLayout={{ columns: 4, rows: 3 }}
        itemPlacements={samplePlacements}
        onViewModeChange={onViewModeChange}
      />
    );

    expect(screen.getByRole("grid")).toBeInTheDocument();

    // Click "Lista"
    const listToggle = screen.getByRole("button", { name: "Lista" });
    fireEvent.click(listToggle);

    expect(onViewModeChange).toHaveBeenCalledWith("list");
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Objetos del inventario" })).toBeInTheDocument();

    // Click "Cuadrícula"
    const gridToggle = screen.getByRole("button", { name: "Cuadrícula" });
    fireEvent.click(gridToggle);
    expect(onViewModeChange).toHaveBeenCalledWith("spatial");
    expect(screen.getByRole("grid")).toBeInTheDocument();
  });

  it("handles non-drag accessible move flow when destination is valid", () => {
    const onMoveItem = vi.fn();
    render(
      <InventoryGrid
        items={sampleItems}
        spatialLayout={{ columns: 4, rows: 3 }}
        itemPlacements={samplePlacements}
        onMoveItem={onMoveItem}
      />
    );

    const sword = screen.getByRole("button", { name: /Espada larga/ });
    fireEvent.click(sword);

    // Banner indicates moving item
    expect(screen.getByText(/Mover objeto:/)).toBeInTheDocument();

    // Click empty cell at col 4, row 2
    const targetCell = screen.getByRole("button", {
      name: /Casilla columna 4, fila 2: destino disponible/,
    });
    fireEvent.click(targetCell);

    expect(onMoveItem).toHaveBeenCalledWith("item-sword", { col: 4, row: 2 });
    expect(screen.getByRole("status")).toHaveTextContent("Objeto reubicado en casilla 4, 2.");
    expect(screen.queryByText(/Mover objeto:/)).not.toBeInTheDocument();
  });

  it("handles destination rejection with textual reason when validateDestination fails", () => {
    const onMoveItem = vi.fn();
    const validateDestination = vi.fn().mockImplementation((_itemId, dest) => {
      if (dest.col === 4 && dest.row === 1) {
        return { valid: false, reason: "Espacio insuficiente para arma a dos manos" };
      }
      return { valid: true };
    });

    render(
      <InventoryGrid
        items={sampleItems}
        spatialLayout={{ columns: 4, rows: 3 }}
        itemPlacements={samplePlacements}
        onMoveItem={onMoveItem}
        validateDestination={validateDestination}
      />
    );

    const sword = screen.getByRole("button", { name: /Espada larga/ });
    fireEvent.click(sword);

    // Slot accessible label should report the invalid state and reason
    const invalidCell = screen.getByRole("button", {
      name: /Casilla columna 4, fila 1: destino no válido \(Espacio insuficiente para arma a dos manos\)/,
    });
    expect(invalidCell).toBeInTheDocument();

    fireEvent.click(invalidCell);

    // onMoveItem should NOT be called
    expect(onMoveItem).not.toHaveBeenCalled();

    // Alert message should explain refusal reason directly
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Espacio insuficiente para arma a dos manos");
  });

  it("allows cancelling the move operation", () => {
    const onMoveItem = vi.fn();
    render(
      <InventoryGrid
        items={sampleItems}
        spatialLayout={{ columns: 4, rows: 3 }}
        itemPlacements={samplePlacements}
        onMoveItem={onMoveItem}
      />
    );

    const sword = screen.getByRole("button", { name: /Espada larga/ });
    fireEvent.click(sword);
    expect(screen.getByText(/Mover objeto:/)).toBeInTheDocument();

    const cancelButton = screen.getByRole("button", { name: "Cancelar" });
    fireEvent.click(cancelButton);

    expect(screen.queryByText(/Mover objeto:/)).not.toBeInTheDocument();
  });

  it("supports native drag and drop to move items", () => {
    const onMoveItem = vi.fn();
    render(
      <InventoryGrid
        items={sampleItems}
        spatialLayout={{ columns: 4, rows: 3 }}
        itemPlacements={samplePlacements}
        onMoveItem={onMoveItem}
      />
    );

    const potion = screen.getByRole("button", { name: /Poción de curación/ });
    const setData = vi.fn();
    fireEvent.dragStart(potion, {
      dataTransfer: { setData },
    });

    expect(setData).toHaveBeenCalledWith("text/plain", "item-potion");

    const targetCell = screen.getByRole("button", {
      name: /Casilla columna 1, fila 2/,
    });

    fireEvent.dragOver(targetCell);
    fireEvent.drop(targetCell, {
      dataTransfer: { getData: () => "item-potion" },
    });

    expect(onMoveItem).toHaveBeenCalledWith("item-potion", { col: 1, row: 2 });
  });

  it("reveals item details when an item is clicked in spatial mode without onSelect", () => {
    render(
      <InventoryGrid
        items={sampleItems}
        spatialLayout={{ columns: 4, rows: 3 }}
        itemPlacements={samplePlacements}
      />
    );

    const sword = screen.getByRole("button", { name: /Espada larga/ });
    fireEvent.click(sword);

    expect(screen.getByText("Arma versátil (1d8/1d10 daño cortante).")).toBeVisible();
    expect(screen.getByText("Daño: 1d8 cortante")).toBeVisible();
  });
});
