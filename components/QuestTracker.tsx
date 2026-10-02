"use client";

import { useId, useState } from "react";
import { Check, Compass, MapPin, Target, X } from "lucide-react";
import { Panel } from "@/components/ui/Panel";

interface Quest {
  id: string;
  title: string;
  description: string;
  status: string;
  createdAt: Date | string;
  location?: string | null;
  hook?: string | null;
  objective?: string | null;
  reward?: string | null;
}

const STATUS = {
  active: { label: "Activa", icon: Compass, color: "text-[var(--dc-action-hover)]" },
  completed: { label: "Completada", icon: Check, color: "text-[var(--dc-success)]" },
  failed: { label: "Fallida", icon: X, color: "text-[var(--dc-error)]" },
};

/** Selection is local reading state; it never changes a quest's progress. */
export default function QuestTracker({ quests }: { quests: Quest[] }) {
  const detailId = useId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const active = quests.filter((quest) => quest.status === "active");
  const archived = quests.filter((quest) => quest.status !== "active");
  const selected = quests.find((quest) => quest.id === selectedId) ?? active[0] ?? quests[0];

  function choices(items: Quest[]) {
    return <ul className="space-y-2">{items.map((quest) => {
      const config = STATUS[quest.status as keyof typeof STATUS];
      const Icon = config?.icon ?? Compass;
      return <li key={quest.id}><button type="button" onClick={() => setSelectedId(quest.id)}
        aria-pressed={selected?.id === quest.id} aria-controls={detailId}
        className={`flex min-h-11 w-full items-start gap-2 rounded-md border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dc-focus)] ${selected?.id === quest.id ? "border-[var(--dc-action)]/60 bg-[var(--dc-action)]/10" : "border-[var(--dc-border)] bg-[var(--dc-surface)]"}`}>
        <Icon className={`mt-0.5 shrink-0 ${config?.color ?? "text-[var(--dc-text-muted)]"}`} size={16} aria-hidden="true" />
        <span className="min-w-0"><span className="block break-words text-sm font-medium text-[var(--dc-text)]">{quest.title}</span>
          <span className={`text-xs ${config?.color ?? "text-[var(--dc-text-muted)]"}`}>{config?.label ?? "Estado sin identificar"}</span></span>
      </button></li>;
    })}</ul>;
  }

  return <Panel aria-label="Registro de misiones" className="space-y-4 p-4">
    <header className="flex items-center justify-between gap-2">
      <h2 className="dc-heading text-lg">Misiones</h2>
      <span className="text-xs text-[var(--dc-text-muted)]">{active.length} {active.length === 1 ? "activa" : "activas"}</span>
    </header>
    {!quests.length ? <p className="text-sm leading-relaxed text-[var(--dc-text-muted)]">Aún no hay misiones confirmadas.</p> : <>
      {active.length > 0 ? choices(active) : <p className="text-sm text-[var(--dc-text-muted)]">No hay misiones activas.</p>}
      {selected && <article id={detailId} aria-label="Misión seleccionada" className="space-y-3 rounded-lg border border-[var(--dc-border-strong)] bg-[var(--dc-surface-raised)] p-3">
        <h3 className="break-words text-base font-semibold text-[var(--dc-text)]">{selected.title}</h3>
        <div className="space-y-1 border-l-2 border-[var(--dc-info)] pl-3">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--dc-info)]"><Target size={14} aria-hidden="true" />Objetivo</p>
          <p className="whitespace-pre-wrap break-words text-base leading-relaxed text-[var(--dc-text)]">{selected.objective || "No hay un objetivo registrado."}</p>
        </div>
        {selected.location && <p className="flex items-start gap-2 text-sm text-[var(--dc-text-muted)]"><MapPin size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span className="break-words">{selected.location}</span></p>}
        {(selected.hook || selected.description || selected.reward) && <details key={selected.id}>
          <summary className="flex min-h-11 cursor-pointer items-center text-sm text-[var(--dc-text)] underline underline-offset-4">Ver detalles de la misión</summary>
          <div className="space-y-3 border-t border-[var(--dc-border)] pt-3 text-sm leading-relaxed text-[var(--dc-text-muted)]">
            {selected.hook && <blockquote className="whitespace-pre-wrap break-words italic">{selected.hook}</blockquote>}
            {selected.description && <p className="whitespace-pre-wrap break-words">{selected.description}</p>}
            {selected.reward && <p className="whitespace-pre-wrap break-words"><span className="font-semibold text-[var(--dc-text)]">Recompensa: </span>{selected.reward}</p>}
          </div>
        </details>}
      </article>}
      {archived.length > 0 && <details><summary className="min-h-11 cursor-pointer py-3 text-sm text-[var(--dc-text-muted)]">Archivo ({archived.length})</summary>{choices(archived)}</details>}
    </>}
  </Panel>;
}
