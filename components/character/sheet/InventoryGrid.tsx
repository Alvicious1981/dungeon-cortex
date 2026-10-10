"use client";

import { useEffect, useState } from "react";
import { Backpack } from "lucide-react";
import { type ItemType } from "@/lib/rules/inventory";

export interface InventoryGridItem {
  id: string;
  name: string;
  quantity: number;
  category: ItemType;
  equipped?: boolean;
  equippedSlot?: string | null;
  summary?: string;
  tooltipLines?: readonly string[];
}

export interface ItemPlacement {
  col: number;
  row: number;
  colSpan?: number;
  rowSpan?: number;
}

export interface SpatialLayoutConfig {
  columns: number;
  rows: number;
}

export interface DestinationValidationResult {
  valid: boolean;
  reason?: string;
}

export interface InventoryGridProps {
  items: readonly InventoryGridItem[];
  onSelect?: (item: InventoryGridItem) => void;
  selectedId?: string;
  label?: string;
  /** Configuration for spatial layout (columns and rows) */
  spatialLayout?: SpatialLayoutConfig;
  /** Placements mapped by item ID */
  itemPlacements?: Record<string, ItemPlacement>;
  /** Callback invoked when an item is moved to a target cell */
  onMoveItem?: (itemId: string, destination: { col: number; row: number }) => void;
  /** Validation callback to verify if destination is valid for the given item */
  validateDestination?: (itemId: string, destination: { col: number; row: number }) => DestinationValidationResult;
  /** Active view mode when spatial layout is available. Defaults to "spatial" if spatialLayout is provided */
  viewMode?: "list" | "spatial";
  /** Callback when view mode changes */
  onViewModeChange?: (mode: "list" | "spatial") => void;
}

export const INVENTORY_CATEGORY_LABELS: Record<ItemType, string> = {
  weapon: "Armas",
  armor: "Armaduras",
  consumable: "Consumibles",
  spell: "Conjuros",
  misc: "Otros",
};

export function InventoryItemDetails({ item }: { item: InventoryGridItem }) {
  return (
    <div className="space-y-3 text-sm leading-6 text-[var(--dc-text-muted)]">
      {item.summary && <p className="whitespace-pre-wrap break-words">{item.summary}</p>}
      {item.tooltipLines?.length ? (
        <ul className="space-y-1">
          {item.tooltipLines.map((line, index) => (
            <li key={`${item.id}-${index}`} className="break-words">
              {line}
            </li>
          ))}
        </ul>
      ) : !item.summary ? (
        <p className="text-[var(--dc-text-muted)]">No hay más detalles disponibles para este objeto.</p>
      ) : null}
    </div>
  );
}

export default function InventoryGrid({
  items,
  onSelect,
  selectedId,
  label = "Objetos del inventario",
  spatialLayout,
  itemPlacements,
  onMoveItem,
  validateDestination,
  viewMode,
  onViewModeChange,
}: InventoryGridProps) {
  const [internalViewMode, setInternalViewMode] = useState<"list" | "spatial">(
    viewMode ?? (spatialLayout ? "spatial" : "list")
  );
  const [selectedMoveItemId, setSelectedMoveItemId] = useState<string | null>(null);
  const [internalSelectedItemId, setInternalSelectedItemId] = useState<string | null>(null);
  const [placementFeedback, setPlacementFeedback] = useState<{
    type: "error" | "info" | "success";
    message: string;
  } | null>(null);

  useEffect(() => {
    if (viewMode) {
      setInternalViewMode(viewMode);
    }
  }, [viewMode]);

  const activeViewMode = spatialLayout ? (viewMode ?? internalViewMode) : "list";

  function handleViewModeChange(mode: "list" | "spatial") {
    setInternalViewMode(mode);
    onViewModeChange?.(mode);
    setSelectedMoveItemId(null);
    setPlacementFeedback(null);
  }

  const selectedMoveItem = selectedMoveItemId
    ? items.find((item) => item.id === selectedMoveItemId)
    : undefined;

  const effectiveSelectedId = selectedId ?? internalSelectedItemId;
  const selectedItemForDetails = effectiveSelectedId
    ? items.find((item) => item.id === effectiveSelectedId)
    : undefined;

  function handleItemClick(item: InventoryGridItem) {
    setInternalSelectedItemId(item.id);
    onSelect?.(item);

    if (onMoveItem) {
      if (selectedMoveItemId === item.id) {
        setSelectedMoveItemId(null);
        setPlacementFeedback(null);
      } else {
        setSelectedMoveItemId(item.id);
        setPlacementFeedback(null);
      }
    }
  }

  function handleMoveTo(itemId: string, destination: { col: number; row: number }) {
    if (!onMoveItem) return;

    if (validateDestination) {
      const validation = validateDestination(itemId, destination);
      if (!validation.valid) {
        setPlacementFeedback({
          type: "error",
          message: validation.reason ?? "Destino no válido para este objeto.",
        });
        return;
      }
    }

    onMoveItem(itemId, destination);
    setPlacementFeedback({
      type: "success",
      message: `Objeto reubicado en casilla ${destination.col}, ${destination.row}.`,
    });
    setSelectedMoveItemId(null);
  }

  function handleEmptySlotClick(col: number, row: number) {
    if (!selectedMoveItemId) {
      setPlacementFeedback({
        type: "info",
        message: "Selecciona primero un objeto para moverlo a esta casilla.",
      });
      return;
    }

    handleMoveTo(selectedMoveItemId, { col, row });
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--dc-border)] p-6 text-center text-[var(--dc-text-muted)]">
        <Backpack className="mx-auto mb-2" size={20} aria-hidden="true" />
        <p className="text-sm">La mochila está vacía.</p>
      </div>
    );
  }

  const viewToggle = spatialLayout ? (
    <div className="mb-3 flex items-center justify-between gap-2">
      <span className="text-xs font-medium text-[var(--dc-text-muted)]">{label}</span>
      <div className="inline-flex rounded-lg border border-[var(--dc-border)] bg-[var(--dc-surface)] p-0.5">
        <button
          type="button"
          onClick={() => handleViewModeChange("spatial")}
          aria-pressed={activeViewMode === "spatial"}
          className={`rounded px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dc-focus)] ${
            activeViewMode === "spatial"
              ? "bg-[var(--dc-action)] font-medium text-[var(--dc-surface)]"
              : "text-[var(--dc-text-muted)] hover:text-[var(--dc-text)]"
          }`}
        >
          Cuadrícula
        </button>
        <button
          type="button"
          onClick={() => handleViewModeChange("list")}
          aria-pressed={activeViewMode === "list"}
          className={`rounded px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dc-focus)] ${
            activeViewMode === "list"
              ? "bg-[var(--dc-action)] font-medium text-[var(--dc-surface)]"
              : "text-[var(--dc-text-muted)] hover:text-[var(--dc-text)]"
          }`}
        >
          Lista
        </button>
      </div>
    </div>
  ) : null;

  if (activeViewMode === "spatial" && spatialLayout) {
    const occupiedCells = new Set<string>();
    const placedItems: Array<{ item: InventoryGridItem; placement: ItemPlacement }> = [];
    const unplacedItems: InventoryGridItem[] = [];

    for (const item of items) {
      const placement = itemPlacements?.[item.id];
      if (placement) {
        placedItems.push({ item, placement });
        const colSpan = placement.colSpan ?? 1;
        const rowSpan = placement.rowSpan ?? 1;
        for (let c = 0; c < colSpan; c++) {
          for (let r = 0; r < rowSpan; r++) {
            occupiedCells.add(`${placement.col + c},${placement.row + r}`);
          }
        }
      } else {
        unplacedItems.push(item);
      }
    }

    const emptySlots: Array<{ col: number; row: number }> = [];
    for (let r = 1; r <= spatialLayout.rows; r++) {
      for (let c = 1; c <= spatialLayout.columns; c++) {
        if (!occupiedCells.has(`${c},${r}`)) {
          emptySlots.push({ col: c, row: r });
        }
      }
    }

    return (
      <div className="space-y-4">
        {viewToggle}

        {selectedMoveItem && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--dc-border)] bg-[var(--dc-surface-raised)] p-2.5 text-xs">
            <span className="text-[var(--dc-text)]">
              Mover objeto:{" "}
              <strong className="font-semibold text-[var(--dc-action)]">{selectedMoveItem.name}</strong>
              <span className="ml-1 text-[var(--dc-text-muted)]">
                (elige una casilla vacía de destino)
              </span>
            </span>
            <button
              type="button"
              onClick={() => {
                setSelectedMoveItemId(null);
                setPlacementFeedback(null);
              }}
              className="rounded border border-[var(--dc-border)] px-2 py-1 text-xs text-[var(--dc-text-muted)] hover:border-[var(--dc-border-strong)] hover:text-[var(--dc-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dc-focus)]"
            >
              Cancelar
            </button>
          </div>
        )}

        {placementFeedback && (
          <div
            role={placementFeedback.type === "error" ? "alert" : "status"}
            className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${
              placementFeedback.type === "error"
                ? "border-[var(--dc-error)] bg-[var(--dc-error)]/10 text-[var(--dc-error)]"
                : placementFeedback.type === "success"
                ? "border-[var(--dc-success)] bg-[var(--dc-success)]/10 text-[var(--dc-success)]"
                : "border-[var(--dc-info)] bg-[var(--dc-info)]/10 text-[var(--dc-info)]"
            }`}
          >
            <span>{placementFeedback.message}</span>
            <button
              type="button"
              onClick={() => setPlacementFeedback(null)}
              className="text-xs underline hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dc-focus)]"
            >
              Cerrar
            </button>
          </div>
        )}

        <div className="max-w-full overflow-x-auto pb-2">
          <div
            role="grid"
            aria-label={`${label} (cuadrícula ${spatialLayout.columns}x${spatialLayout.rows})`}
            className="grid gap-2 rounded-lg border border-[var(--dc-border)] bg-[var(--dc-surface)] p-3"
            style={{
              gridTemplateColumns: `repeat(${spatialLayout.columns}, minmax(44px, 1fr))`,
              gridTemplateRows: `repeat(${spatialLayout.rows}, minmax(44px, 1fr))`,
            }}
          >
            {placedItems.map(({ item, placement }) => {
              const isSelected = selectedId === item.id || selectedMoveItemId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  draggable={Boolean(onMoveItem)}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", item.id);
                    setSelectedMoveItemId(item.id);
                    setPlacementFeedback(null);
                  }}
                  onClick={() => handleItemClick(item)}
                  aria-pressed={isSelected}
                  aria-label={`${item.name}, ${INVENTORY_CATEGORY_LABELS[item.category] ?? "Otros"}${
                    item.equipped ? ", equipado" : ""
                  }${item.quantity > 1 ? `, cantidad ${item.quantity}` : ""}, posición columna ${
                    placement.col
                  }, fila ${placement.row}`}
                  style={{
                    gridColumn: `${placement.col} / span ${placement.colSpan ?? 1}`,
                    gridRow: `${placement.row} / span ${placement.rowSpan ?? 1}`,
                  }}
                  className={`flex min-h-11 flex-col justify-between rounded-lg border p-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dc-focus)] ${
                    isSelected
                      ? "border-[var(--dc-action)] bg-[var(--dc-action)]/15 ring-1 ring-[var(--dc-action)]"
                      : "border-[var(--dc-border)] bg-[var(--dc-surface-raised)] hover:border-[var(--dc-border-strong)]"
                  }`}
                >
                  <div className="flex w-full items-start justify-between gap-1">
                    <span className="line-clamp-2 break-words font-medium text-[var(--dc-text)]">
                      {item.name}
                    </span>
                    {item.quantity > 1 && (
                      <span className="shrink-0 rounded border border-[var(--dc-border)] bg-[var(--dc-surface)] px-1 font-mono text-[10px] text-[var(--dc-text-muted)]">
                        x{item.quantity}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex w-full items-center justify-between gap-1 text-[10px] text-[var(--dc-text-muted)]">
                    <span>{INVENTORY_CATEGORY_LABELS[item.category] ?? "Otros"}</span>
                    {item.equipped && (
                      <span className="font-medium text-[var(--dc-action-hover)]">Equipado</span>
                    )}
                  </div>
                </button>
              );
            })}

            {emptySlots.map(({ col, row }) => {
              const isMoving = Boolean(selectedMoveItemId);
              const validation =
                selectedMoveItemId && validateDestination
                  ? validateDestination(selectedMoveItemId, { col, row })
                  : null;
              const isValid = validation ? validation.valid : isMoving;

              let slotLabel = `Casilla vacía columna ${col}, fila ${row}`;
              if (selectedMoveItem) {
                if (validation) {
                  slotLabel = `Casilla columna ${col}, fila ${row}: ${
                    validation.valid ? "destino válido" : `destino no válido (${validation.reason ?? "rechazado"})`
                  }`;
                } else {
                  slotLabel = `Casilla columna ${col}, fila ${row}: destino disponible`;
                }
              }

              return (
                <button
                  key={`empty-${col}-${row}`}
                  type="button"
                  onClick={() => handleEmptySlotClick(col, row)}
                  onDragOver={(e) => {
                    e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const droppedId = e.dataTransfer.getData("text/plain") || selectedMoveItemId;
                    if (droppedId) {
                      handleMoveTo(droppedId, { col, row });
                    }
                  }}
                  aria-label={slotLabel}
                  style={{ gridColumn: col, gridRow: row }}
                  className={`flex min-h-11 min-w-11 flex-col items-center justify-center rounded-lg border p-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dc-focus)] ${
                    isMoving
                      ? isValid
                        ? "border-[var(--dc-success)] bg-[var(--dc-success)]/10 text-[var(--dc-success)] hover:bg-[var(--dc-success)]/20"
                        : "border-[var(--dc-error)] bg-[var(--dc-error)]/10 text-[var(--dc-error)] hover:bg-[var(--dc-error)]/20"
                      : "border-dashed border-[var(--dc-border)] bg-[var(--dc-surface)]/40 text-[var(--dc-text-muted)] hover:border-[var(--dc-border-strong)]"
                  }`}
                >
                  <span className="sr-only">{slotLabel}</span>
                  <span aria-hidden="true" className="text-[10px] opacity-60">
                    {col},{row}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {unplacedItems.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--dc-text-muted)]">
              Objetos sin ubicar ({unplacedItems.length})
            </h4>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Objetos sin ubicar">
              {unplacedItems.map((item) => {
                const isSelected = selectedId === item.id || selectedMoveItemId === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => handleItemClick(item)}
                      aria-pressed={isSelected}
                      className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dc-focus)] ${
                        isSelected
                          ? "border-[var(--dc-action)] bg-[var(--dc-action)]/15 ring-1 ring-[var(--dc-action)]"
                          : "border-[var(--dc-border)] bg-[var(--dc-surface)] hover:border-[var(--dc-border-strong)]"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-[var(--dc-text)]">
                          {item.name}
                        </span>
                        <span className="block text-[10px] text-[var(--dc-text-muted)]">
                          {INVENTORY_CATEGORY_LABELS[item.category] ?? "Otros"}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-[var(--dc-text-muted)]">
                        {item.equipped && (
                          <span className="text-[var(--dc-action-hover)]">Equipado</span>
                        )}
                        {item.quantity > 1 && <span>x{item.quantity}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {selectedItemForDetails && !onSelect && (
          <div className="rounded-lg border border-[var(--dc-border)] bg-[var(--dc-surface)] p-3">
            <h4 className="mb-2 text-sm font-medium text-[var(--dc-text)]">
              {selectedItemForDetails.name}
            </h4>
            <InventoryItemDetails item={selectedItemForDetails} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {viewToggle}
      <ul className="space-y-2" aria-label={label}>
        {items.map((item) => {
          const heading = (
            <span className="flex w-full items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block break-words font-medium text-[var(--dc-text)]">{item.name}</span>
                <span className="block text-xs text-[var(--dc-text-muted)]">
                  {INVENTORY_CATEGORY_LABELS[item.category] ?? "Otros"}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1 text-xs text-[var(--dc-text-muted)]">
                {item.equipped && <span className="text-[var(--dc-action-hover)]">Equipado</span>}
                {item.quantity > 1 && <span>x{item.quantity}</span>}
              </span>
            </span>
          );
          return (
            <li key={item.id}>
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  aria-pressed={selectedId === item.id}
                  aria-controls="equipment-item-details"
                  className={`min-h-14 w-full rounded-lg border px-3 py-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dc-focus)] ${
                    selectedId === item.id
                      ? "border-[var(--dc-action)] bg-[var(--dc-action)]/10"
                      : "border-[var(--dc-border)] bg-[var(--dc-surface)] hover:border-[var(--dc-border-strong)]"
                  }`}
                >
                  {heading}
                </button>
              ) : (
                <details className="rounded-lg border border-[var(--dc-border)] bg-[var(--dc-surface)]">
                  <summary className="min-h-14 cursor-pointer px-3 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dc-focus)]">
                    {heading}
                    <span className="mt-1 block text-xs text-[var(--dc-action-hover)]">Ver detalles</span>
                  </summary>
                  <div className="border-t border-[var(--dc-border)] p-3">
                    <InventoryItemDetails item={item} />
                  </div>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
