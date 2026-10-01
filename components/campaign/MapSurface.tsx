"use client";

import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { useModalFocus } from "@/lib/hooks/useModalFocus";
import { Button } from "@/components/ui/Button";

/** Expansion changes layout only: the map and its draft state stay mounted. */
export default function MapSurface({ title, children }: { title: string; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const titleId = useId();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setExpanded(false), []);
  useModalFocus({ open: expanded, onClose: close, dialogRef: surfaceRef, initialFocusRef: buttonRef, returnFocusRef: buttonRef });

  return <div ref={surfaceRef} role={expanded ? "dialog" : "region"} aria-modal={expanded || undefined}
    aria-labelledby={titleId}
    className={expanded
      ? "fixed inset-0 z-[2000] flex flex-col bg-[var(--dc-canvas)] p-3 sm:p-6"
      : "min-w-0 overflow-hidden rounded-lg border border-[var(--dc-border)] bg-[var(--dc-canvas-soft)]"}>
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--dc-border)] px-3 py-2">
      <h3 id={titleId} className="text-sm font-semibold text-[var(--dc-text)]">{title}</h3>
      <Button ref={buttonRef} variant="secondary" size="compact" onClick={() => setExpanded(value => !value)}
        aria-label={`${expanded ? "Reducir" : "Ampliar"} ${title.toLocaleLowerCase("es")}`}
        aria-expanded={expanded} aria-haspopup="dialog"
        className="shrink-0">
        {expanded ? <Minimize2 size={18} aria-hidden="true" /> : <Maximize2 size={18} aria-hidden="true" />}
        {expanded ? "Volver a la escena" : "Ampliar"}
      </Button>
    </header>
    <div className={expanded ? "min-h-0 flex-1 overflow-auto overscroll-contain p-2 sm:p-4" : "p-2"}>
      <div className={expanded ? "mx-auto w-full max-w-5xl" : "min-w-0"}>{children}</div>
    </div>
  </div>;
}
