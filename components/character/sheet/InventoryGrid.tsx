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

export interface InventoryGridProps {
  items: readonly InventoryGridItem[];
  onSelect?: (item: InventoryGridItem) => void;
  selectedId?: string;
  label?: string;
}

export const INVENTORY_CATEGORY_LABELS: Record<ItemType, string> = {
  weapon: "Armas", armor: "Armaduras", consumable: "Consumibles", spell: "Conjuros", misc: "Otros",
};

export function InventoryItemDetails({ item }: { item: InventoryGridItem }) {
  return (
    <div className="space-y-3 text-sm leading-6 text-[var(--dc-text-muted)]">
      {item.summary && <p className="whitespace-pre-wrap break-words">{item.summary}</p>}
      {item.tooltipLines?.length ? (
        <ul className="space-y-1">
          {item.tooltipLines.map((line, index) => <li key={`${item.id}-${index}`} className="break-words">{line}</li>)}
        </ul>
      ) : !item.summary ? <p className="text-[var(--dc-text-muted)]">No hay más detalles disponibles para este objeto.</p> : null}
    </div>
  );
}

export default function InventoryGrid({ items, onSelect, selectedId, label = "Objetos del inventario" }: InventoryGridProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--dc-border)] p-6 text-center text-[var(--dc-text-muted)]">
        <Backpack className="mx-auto mb-2" size={20} aria-hidden="true" />
        <p className="text-sm">La mochila está vacía.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-2" aria-label={label}>
      {items.map((item) => {
        const heading = (
          <span className="flex w-full items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block break-words font-medium text-[var(--dc-text)]">{item.name}</span>
              <span className="block text-xs text-[var(--dc-text-muted)]">{INVENTORY_CATEGORY_LABELS[item.category] ?? "Otros"}</span>
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
                className={`min-h-14 w-full rounded-lg border px-3 py-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dc-focus)] ${selectedId === item.id ? "border-[var(--dc-action)] bg-[var(--dc-action)]/10" : "border-[var(--dc-border)] bg-[var(--dc-surface)] hover:border-[var(--dc-border-strong)]"}`}
              >{heading}</button>
            ) : (
              <details className="rounded-lg border border-[var(--dc-border)] bg-[var(--dc-surface)]">
                <summary className="min-h-14 cursor-pointer px-3 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dc-focus)]">{heading}<span className="mt-1 block text-xs text-[var(--dc-action-hover)]">Ver detalles</span></summary>
                <div className="border-t border-[var(--dc-border)] p-3"><InventoryItemDetails item={item} /></div>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}
