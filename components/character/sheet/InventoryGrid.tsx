import { Backpack, Sparkles } from "lucide-react";
import { type ItemType } from "@/lib/rules/inventory";

export interface InventoryGridItem {
  id: string;
  name: string;
  quantity: number;
  category: ItemType;
  equipped?: boolean;
  summary?: string;
  tooltipTitle?: string;
  tooltipLines?: readonly string[];
}

export interface InventoryGridProps {
  items: readonly InventoryGridItem[];
}

const CATEGORY_STYLES: Record<
  InventoryGridItem["category"],
  { label: string; tone: string; border: string; bg: string }
> = {
  weapon: { label: "WPN", tone: "text-rose-200", border: "border-rose-300/30", bg: "bg-rose-400/10" },
  armor: { label: "ARM", tone: "text-sky-200", border: "border-sky-300/30", bg: "bg-sky-400/10" },
  consumable: { label: "CON", tone: "text-emerald-200", border: "border-emerald-300/30", bg: "bg-emerald-400/10" },
  spell: { label: "SPL", tone: "text-violet-200", border: "border-violet-300/30", bg: "bg-violet-400/10" },
  misc: { label: "MSC", tone: "text-amber-200", border: "border-amber-300/30", bg: "bg-amber-400/10" },
};

export default function InventoryGrid({ items }: InventoryGridProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-amber-300/25 bg-slate-950/45 p-6 text-center">
        <Backpack className="mx-auto mb-2 text-amber-200/55" size={18} aria-hidden="true" />
        <p className="text-sm text-amber-100/70">Pack is currently empty.</p>
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="list" aria-label="Inventory items">
      {items.map((item) => {
        const style = CATEGORY_STYLES[item.category];
        const tooltipId = `inventory-tooltip-${item.id}`;
        const hasTooltip = Boolean(item.tooltipLines?.length);

        return (
          <li key={item.id} className="relative">
            <article
              className="group relative rounded-xl border border-amber-400/20 bg-slate-950/55 p-3 backdrop-blur-xl transition-colors duration-200 hover:border-amber-300/35 focus-within:border-amber-300/35"
              tabIndex={0}
              aria-describedby={hasTooltip ? tooltipId : undefined}
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-br from-amber-300/10 via-transparent to-indigo-300/10 opacity-75"
              />

              <div className="relative flex items-start justify-between gap-2">
                <span
                  className={`inline-flex rounded-md border px-1.5 py-0.5 text-[9px] font-bold tracking-wider ${style.tone} ${style.border} ${style.bg}`}
                >
                  {style.label}
                </span>

                <div className="flex items-center gap-1">
                  {item.equipped && (
                    <span className="rounded-full border border-amber-300/35 bg-amber-400/12 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-100">
                      Equipped
                    </span>
                  )}
                  {item.quantity > 1 && (
                    <span className="text-xs tabular-nums text-amber-50/70">x{item.quantity}</span>
                  )}
                </div>
              </div>

              <p
                className="relative mt-2 truncate text-sm font-semibold text-amber-50"
                style={{ fontFamily: "var(--font-crimson)" }}
              >
                {item.name}
              </p>

              {item.summary && (
                <p
                  className="relative mt-0.5 truncate text-xs text-amber-100/60"
                  style={{ fontFamily: "var(--font-crimson)" }}
                >
                  {item.summary}
                </p>
              )}

              {hasTooltip && (
                <div
                  id={tooltipId}
                  role="tooltip"
                  className="pointer-events-none absolute left-2 right-2 top-full z-30 mt-1 rounded-lg border border-amber-300/30 bg-slate-950/95 p-2 opacity-0 shadow-lg shadow-black/60 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100"
                >
                  <p
                    className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-200/80"
                    style={{ fontFamily: "var(--font-cinzel)" }}
                  >
                    {item.tooltipTitle ?? "Properties"}
                  </p>
                  <ul className="space-y-0.5">
                    {item.tooltipLines?.map((line, index) => (
                      <li key={`${item.id}-${index}`} className="flex items-start gap-1 text-xs text-amber-50/90">
                        <Sparkles size={10} className="mt-0.5 shrink-0 text-amber-300/70" aria-hidden="true" />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
          </li>
        );
      })}
    </ul>
  );
}
