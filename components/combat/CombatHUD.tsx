"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { conditionLabel } from "@/lib/character-sheet/condition-labels";
import InitiativeTracker from "./InitiativeTracker";
import { hpColor, hpRatio } from "./hit-points";

/**
 * What the HUD may show about the player beyond the combatant row, and only when
 * the backend has it. Every field is optional and an absent one renders nothing:
 * the HUD never fills in a resource the data does not carry.
 *
 * The event stream carries no spell-slot data, so this is the server's snapshot
 * and moves with `router.refresh()`, like the character aside it mirrors.
 */
export interface CombatHUDPlayerResources {
  spellSlots?: readonly { level: number; total: number; used: number }[];
  concentrating?: boolean;
}

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
  playerResources?: CombatHUDPlayerResources;
  children?: ReactNode;
}

/** A visual cue only; the text beside the pips carries the value. Caps a corrupt `total`. */
const MAX_SLOT_PIPS = 12;

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
  playerDown = false, playerResources, children,
}: CombatHUDProps) {
  const slotsLabelId = useId();
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
  // The player's own row, already kept current by the controller from `targets[]`.
  const player = combatants.find((combatant) => combatant.isPlayer);
  // Display only: no slot level is invented, and a level with no slots is not a resource.
  const spellSlots = (playerResources?.spellSlots ?? [])
    .filter((slot) => slot.total > 0)
    .sort((a, b) => a.level - b.level);
  const concentrating = Boolean(playerResources?.concentrating);
  return (
    <section aria-label="Panel de combate" aria-busy={isPending} className="min-w-0 space-y-4 text-[var(--dc-text)]">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="dc-heading text-lg">Combate</h2>
        {/* A status region, so a change of turn is announced as well as shown (UI_SPEC §5). */}
        <p role="status" className="flex flex-wrap items-baseline gap-2 text-sm text-[var(--dc-action-hover)]">
          {active ? `Turno de ${active.name}` : "Esperando turno"}
          {active?.isPlayer && (
            <>
              {" "}
              <strong className="whitespace-nowrap rounded border border-[var(--dc-action)] px-2 py-0.5 text-xs uppercase tracking-wide">Tu turno</strong>
            </>
          )}
        </p>
      </header>
      {player && (
        <section
          aria-label="Estado del jugador"
          className="space-y-3 rounded border border-[var(--dc-border)] bg-[var(--dc-surface)] p-3"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-xs font-semibold uppercase tracking-widest text-[var(--dc-text-muted)]">Puntos de golpe</span>
            <span className="dc-mechanical-value text-base font-semibold">{player.hp} / {player.maxHp}</span>
          </div>
          <div
            role="meter"
            aria-label={`Puntos de golpe: ${player.hp} de ${player.maxHp}`}
            aria-valuenow={player.hp}
            aria-valuemin={0}
            aria-valuemax={player.maxHp}
            className="h-2 overflow-hidden rounded-full border border-[var(--dc-border)] bg-[var(--dc-canvas)]"
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.round(hpRatio(player.hp, player.maxHp) * 100)}%`, background: hpColor(player.hp, player.maxHp) }}
            />
          </div>
          {(player.conditions.length > 0 || concentrating) && (
            <div className="flex flex-wrap items-center gap-2">
              {player.conditions.length > 0 && (
                <ul aria-label="Condiciones" className="flex flex-wrap gap-2">
                  {player.conditions.map((condition) => (
                    <li
                      key={condition}
                      className="rounded border border-[var(--dc-border-strong)] bg-[var(--dc-surface-soft)] px-2 py-1 text-xs text-[var(--dc-text)]"
                    >
                      {conditionLabel(condition)}
                    </li>
                  ))}
                </ul>
              )}
              {concentrating && (
                <span className="rounded border border-[var(--dc-mechanical)] px-2 py-1 text-xs text-[var(--dc-mechanical)]">Concentración</span>
              )}
            </div>
          )}
          {spellSlots.length > 0 && (
            <div className="space-y-1">
              <p id={slotsLabelId} className="text-xs font-semibold uppercase tracking-widest text-[var(--dc-text-muted)]">Espacios de conjuro</p>
              <ul aria-labelledby={slotsLabelId} className="space-y-1">
                {spellSlots.map((slot) => {
                  const available = Math.max(0, slot.total - slot.used);
                  const pips = Math.min(slot.total, MAX_SLOT_PIPS);
                  return (
                    <li key={slot.level} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      <span className="w-10 shrink-0 text-xs uppercase tracking-widest text-[var(--dc-text-muted)]">Nv {slot.level}</span>
                      <span aria-hidden="true" className="flex flex-wrap gap-1">
                        {Array.from({ length: pips }, (_, index) => (
                          <span
                            key={index}
                            className={[
                              "inline-block h-3 w-3 rounded-full border",
                              index < available
                                ? "border-[var(--dc-mechanical)] bg-[var(--dc-mechanical)]"
                                : "border-[var(--dc-border-strong)]",
                            ].join(" ")}
                          />
                        ))}
                      </span>
                      <span className="tabular-nums">{available} de {slot.total} {slot.total === 1 ? "disponible" : "disponibles"}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      )}
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
        <p className="text-sm text-[var(--dc-error)]">Estás inconsciente: usa «Tirada de muerte» o «Esperar».</p>
      ) : (
        <p className="text-xs text-[var(--dc-text-muted)]">Atajos: F1 atacar · F2 finalizar turno</p>
      )}
      {/* The one place the actions live (ActionInput + MacroDeck). The HUD does not know what they
          are, and the UI-03 Action Bar, if it is built, mounts here rather than beside the HUD. */}
      <div data-combat-hud-slot="actions" className="min-w-0 space-y-4">{children}</div>
    </section>
  );
}
