"use client";

import { useEffect, useRef, useState } from "react";
import { Backpack, CircleDot, Search, Shield, Shirt, Sword } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { EquipmentSlot } from "@/lib/rules/equipment-slot";
import InventoryGrid, { INVENTORY_CATEGORY_LABELS, InventoryItemDetails, type InventoryGridItem } from "./InventoryGrid";

const SLOTS: Array<{ id: EquipmentSlot; label: string; icon: typeof Sword; position: string }> = [
  { id: "MAIN_HAND", label: "Mano principal", icon: Sword, position: "md:col-start-1 md:row-start-1" },
  { id: "OFF_HAND", label: "Mano secundaria", icon: Shield, position: "md:col-start-3 md:row-start-1" },
  { id: "ARMOR", label: "Armadura", icon: Shirt, position: "md:col-start-2 md:row-start-1 md:self-center" },
  { id: "ACCESSORY", label: "Accesorio", icon: CircleDot, position: "md:col-start-2 md:row-start-2" },
];

type Selection = { itemId: string } | { slot: EquipmentSlot };

export default function EquipmentTab({ items, onPrepare }: {
  items: readonly InventoryGridItem[];
  onPrepare: (action: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [selection, setSelection] = useState<Selection | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  const selectedSlot = selection && "slot" in selection ? SLOTS.find((slot) => slot.id === selection.slot) : undefined;
  const selectedItem = selection && "itemId" in selection
    ? items.find((item) => item.id === selection.itemId)
    : selectedSlot ? items.find((item) => item.equippedSlot === selectedSlot.id) : undefined;
  const backpack = items.filter((item) => !SLOTS.some((slot) => slot.id === item.equippedSlot));
  const filtered = backpack.filter((item) =>
    item.name.toLocaleLowerCase("es").includes(search.trim().toLocaleLowerCase("es")) &&
    (category === "all" || item.category === category)
  );

  function inspect(next: Selection) {
    setSelection(next);
  }

  useEffect(() => {
    if (selection) detailRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [selection]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-labelledby="equipment-current-heading">
        <h3 id="equipment-current-heading" className="mb-3 text-base font-semibold text-[var(--dc-text)]">Equipo actual</h3>
        <p className="mb-4 text-sm text-[var(--dc-text-muted)]">Selecciona una posición para ver su objeto.</p>
        <div className="relative grid gap-2 md:min-h-80 md:grid-cols-3 md:grid-rows-[minmax(14rem,1fr)_auto]">
          <svg viewBox="0 0 80 220" className="pointer-events-none absolute left-1/3 top-0 hidden h-56 w-1/3 text-[var(--dc-border-strong)] md:block" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="40" cy="24" r="17" /><path d="M23 50 10 64 5 119 18 124 25 82 24 132 16 200 31 203 40 144 49 203 64 200 56 132 55 82 62 124 75 119 70 64 57 50Z" /><path d="M25 82 55 82M24 132 56 132" />
          </svg>
          {SLOTS.map(({ id, label, icon: Icon, position }) => {
            const item = items.find((entry) => entry.equippedSlot === id);
            const selected = selectedSlot?.id === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => inspect({ slot: id })}
                aria-label={`${label}: ${item?.name ?? "Vacío"}`}
                aria-pressed={selected}
                aria-controls="equipment-item-details"
                className={`relative flex min-h-16 items-center gap-3 rounded-lg border p-3 text-left md:flex-col md:justify-center md:self-center md:text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dc-focus)] ${position} ${selected ? "border-[var(--dc-action)] bg-[var(--dc-surface-raised)]" : item ? "border-[var(--dc-border-strong)] bg-[var(--dc-surface)]" : "border-dashed border-[var(--dc-border)] bg-[var(--dc-surface)]/80"}`}
              >
                <Icon size={22} className={item ? "shrink-0 text-[var(--dc-action-hover)]" : "shrink-0 text-[var(--dc-text-subtle)]"} aria-hidden="true" />
                <span className="min-w-0"><span className="block text-xs text-[var(--dc-text-muted)]">{label}</span><span className="mt-1 block break-words text-sm font-medium text-[var(--dc-text)]">{item?.name ?? "Vacío"}</span></span>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="equipment-backpack-heading">
        <h3 id="equipment-backpack-heading" className="mb-3 flex items-center gap-2 text-base font-semibold text-[var(--dc-text)]"><Backpack size={18} aria-hidden="true" />Mochila <span className="text-sm font-normal text-[var(--dc-text-muted)]">({backpack.length})</span></h3>
        <div className="mb-3 flex flex-wrap gap-2">
          <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md border border-[var(--dc-border-strong)] bg-[var(--dc-surface)] px-3 focus-within:ring-2 focus-within:ring-[var(--dc-focus)]">
            <Search size={17} className="shrink-0 text-[var(--dc-text-muted)]" aria-hidden="true" />
            <span className="sr-only">Buscar en la mochila</span>
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar objeto" className="min-w-0 w-full bg-transparent py-2 text-sm text-[var(--dc-text)] outline-none" />
          </label>
          <label className="min-w-0">
            <span className="sr-only">Categoría</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)} className="min-h-11 max-w-full rounded-md border border-[var(--dc-border-strong)] bg-[var(--dc-surface)] px-3 text-sm text-[var(--dc-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dc-focus)]">
              <option value="all">Todas las categorías</option>
              {Object.entries(INVENTORY_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        {backpack.length > 0 && filtered.length === 0 ? <p role="status" className="py-6 text-sm text-[var(--dc-text-muted)]">No hay objetos que coincidan con los filtros.</p> : (
          <InventoryGrid items={filtered} selectedId={selectedItem?.id} onSelect={(item) => inspect({ itemId: item.id })} label="Objetos de la mochila" />
        )}
      </section>

      <section ref={detailRef} id="equipment-item-details" aria-label="Detalle del objeto" className="rounded-lg border border-[var(--dc-border)] bg-[var(--dc-surface)]/60 p-4 lg:col-span-2">
        <h3 className="mb-3 text-base font-semibold text-[var(--dc-text)]" aria-live="polite">{selectedItem?.name ?? selectedSlot?.label ?? "Detalle del objeto"}</h3>
        {selectedItem ? (
          <>
            <p className="mb-3 text-xs text-[var(--dc-text-muted)]">{INVENTORY_CATEGORY_LABELS[selectedItem.category] ?? "Otros"} · Cantidad: {selectedItem.quantity}{selectedItem.equipped ? " · Equipado" : " · En la mochila"}</p>
            <InventoryItemDetails item={selectedItem} />
            {!selectedItem.equipped && (
              <div className="mt-4 flex flex-col items-start gap-2">
                <Button variant="secondary" size="compact" onClick={() => onPrepare(`equipar ${selectedItem.name}`)} aria-label={`Preparar equipar ${selectedItem.name}`}>Preparar equipar</Button>
                <p className="text-xs leading-5 text-[var(--dc-text-muted)]">La acción quedará escrita para que la revises y envíes. El equipo cambiará cuando se confirme la acción.</p>
              </div>
            )}
          </>
        ) : <p className="text-sm text-[var(--dc-text-muted)]">{selectedSlot ? "No hay ningún objeto equipado en esta posición." : "Selecciona un objeto de la mochila o una posición de equipo para consultar sus detalles."}</p>}
      </section>
    </div>
  );
}
