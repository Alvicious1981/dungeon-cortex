"use client";

import { useEffect, useRef, type ReactNode } from "react";
import InitiativeTracker from "./InitiativeTracker";

export interface CombatHUDProps {
  combatants: Array<{
    id: string;
    name: string;
    hp: number;
    maxHp: number;
    initiativeTotal: number;
    conditions: string[];
    isPlayer?: boolean;
  }>;
  activeTurnIndex: number;
  isPending: boolean;
  onActionTrigger: (action: string) => void;
  playerDown?: boolean;
  children?: ReactNode;
}

const ACTIONS = [
  { keybind: "F1", action: "Attack" },
  { keybind: "F2", action: "End Turn" },
];

/** Keystrokes aimed at a text field (e.g. the action textbox) are the user typing, not shortcuts. */
function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const editableHost = target.closest("[contenteditable]");
  if (editableHost && editableHost.getAttribute("contenteditable") !== "false") return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Keystrokes originating inside an active modal or dialog overlay must not trigger combat actions behind it. */
function isModalOrDialogTarget(target: EventTarget | null) {
  if (!(target instanceof Node)) return false;
  const element = target instanceof Element ? target : target.parentElement;
  if (!element) return false;
  return Boolean(
    element.closest('dialog, [role~="dialog"], [role~="alertdialog"], [aria-modal="true"]')
  );
}

/** Checks whether a modal candidate is actively displayed and not closed or hidden. */
function isModalElementActive(element: Element): boolean {
  if (element.tagName === "DIALOG" && !(element as HTMLDialogElement).open) {
    return false;
  }
  let current: Element | null = element;
  while (current) {
    if (current.hasAttribute("hidden")) return false;
    if (current.getAttribute("aria-hidden") === "true") return false;
    if (current instanceof HTMLElement) {
      if (current.style.display === "none" || current.style.visibility === "hidden") {
        return false;
      }
    }
    current = current.parentElement;
  }
  return true;
}

/** Checks whether any blocking modal overlay is currently active in the document. */
function hasActiveBlockingModal(): boolean {
  if (typeof document === "undefined") return false;
  const candidates = document.querySelectorAll('dialog[open], [aria-modal="true"]');
  for (const candidate of candidates) {
    if (isModalElementActive(candidate)) {
      return true;
    }
  }
  return false;
}

export default function CombatHUD({
  combatants, activeTurnIndex, isPending, onActionTrigger,
  playerDown = false, children,
}: CombatHUDProps) {
  const latest = useRef({ canTriggerAction: !playerDown && !isPending, onActionTrigger });
  latest.current = { canTriggerAction: !playerDown && !isPending, onActionTrigger };

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
      const config = ACTIONS.find(({ keybind }) => keybind === event.key);
      if (!config || isTextEntryTarget(event.target) || isModalOrDialogTarget(event.target) || hasActiveBlockingModal()) return;
      const { canTriggerAction, onActionTrigger } = latest.current;
      if (!canTriggerAction) return;
      event.preventDefault();
      onActionTrigger(config.action);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const active = combatants[activeTurnIndex];
  return (
    <section aria-label="Panel de combate" aria-busy={isPending} className="min-w-0 space-y-4 text-slate-100">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="dc-heading text-lg">Combate</h2>
        <p className="text-sm text-amber-200">{active ? `Turno de ${active.name}` : "Esperando turno"}</p>
      </header>
      <details className="rounded border border-[var(--dc-border)] bg-[var(--dc-surface)] p-3" open>
        <summary className="min-h-11 cursor-pointer py-3 text-sm text-[var(--dc-text-muted)]">Iniciativa y estado</summary>
        <InitiativeTracker
          entries={combatants.map((combatant) => ({
            ...combatant,
            unconscious: Boolean(combatant.isPlayer && combatant.hp <= 0),
          }))}
          activeId={active?.id}
          playerDown={playerDown}
          showTurnControl={false}
        />
      </details>
      {playerDown ? (
        <p className="text-sm text-red-200">Estás inconsciente: usa «Tirada de muerte» o «Esperar».</p>
      ) : (
        <p className="text-xs text-[var(--dc-text-muted)]">Atajos: F1 atacar · F2 finalizar turno</p>
      )}
      {children}
    </section>
  );
}
