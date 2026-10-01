"use client";

import { useId, useRef, type ReactNode } from "react";

export interface TabItem { id: string; label: string; content: ReactNode; }

/** All panels stay mounted so switching views preserves local interaction state. */
export function Tabs({ label, items, value, onChange, compact = false }: {
  label: string; items: TabItem[]; value: string; onChange: (id: string) => void; compact?: boolean;
}) {
  const prefix = useId();
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  return <div className="min-w-0 space-y-3">
    <div role="tablist" aria-label={label} className="flex gap-1 rounded-lg border border-[var(--dc-border)] bg-[var(--dc-canvas-soft)] p-1">
      {items.map((item, index) => <button key={item.id} ref={node => { if (node) buttons.current.set(item.id, node); else buttons.current.delete(item.id); }}
        role="tab" id={`${prefix}-tab-${item.id}`} aria-selected={value === item.id} aria-controls={`${prefix}-panel-${item.id}`}
        tabIndex={value === item.id ? 0 : -1} type="button" onClick={() => onChange(item.id)}
        onKeyDown={event => {
          const next = event.key === "ArrowRight" ? (index + 1) % items.length
            : event.key === "ArrowLeft" ? (index - 1 + items.length) % items.length
            : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : -1;
          if (next < 0) return;
          event.preventDefault();
          const target = items[next]!;
          onChange(target.id); buttons.current.get(target.id)?.focus();
        }}
        className={`min-h-11 min-w-0 flex-1 whitespace-nowrap rounded-md py-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${compact ? "px-1 text-xs" : "px-2 text-sm"} ${value === item.id ? "bg-[var(--dc-surface-soft)] text-amber-100 shadow-sm" : "text-[var(--dc-text-muted)] hover:bg-[var(--dc-surface)]"}`}>
        {item.label}
      </button>)}
    </div>
    {items.map(item => <div key={item.id} role="tabpanel" id={`${prefix}-panel-${item.id}`}
      aria-labelledby={`${prefix}-tab-${item.id}`} hidden={value !== item.id} tabIndex={0}
      className="min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
      {item.content}
    </div>)}
  </div>;
}
