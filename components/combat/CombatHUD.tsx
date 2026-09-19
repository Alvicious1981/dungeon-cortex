"use client";

import { useEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowDown,
  EyeOff,
  Flag,
  FlaskConical,
  Ghost,
  Hand,
  Link2,
  MoonStar,
  Sword,
  ZapOff,
} from "lucide-react";

export interface CombatHUDProps {
  combatants: Array<{
    id: string;
    name: string;
    hp: number;
    maxHp: number;
    initiativeTotal: number;
    conditions: string[];
  }>;
  activeTurnIndex: number;
  isPending: boolean;
  onActionTrigger: (action: string) => void;
  /** The player is at 0 HP: only the death-save action applies (death-saves spec §7.4). */
  playerDown?: boolean;
}

interface ActionConfig {
  keybind: string;
  action: string;
  icon: LucideIcon;
}

const ACTIONS: ActionConfig[] = [
  { keybind: "F1", action: "Attack", icon: Sword },
  { keybind: "F2", action: "End Turn", icon: Flag },
];

const PANEL_CLASS =
  "backdrop-blur-md border border-white/20 bg-slate-900/40 rounded-xl";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function hpPercent(hp: number, maxHp: number) {
  if (maxHp <= 0) return 0;
  return clamp((hp / maxHp) * 100, 0, 100);
}

// ─── Status Registry (Section 6.2) ──────────────────────────────────────────

interface ConditionUI {
  icon: LucideIcon;
  color: string;
  label: string;
}

const CONDITION_UI_REGISTRY: Record<string, ConditionUI> = {
  blinded:     { icon: EyeOff,       color: "#94A3B8", label: "Blinded" },
  poisoned:    { icon: FlaskConical, color: "#84CC16", label: "Poisoned" },
  prone:       { icon: ArrowDown,    color: "#F97316", label: "Prone" },
  restrained:  { icon: Link2,        color: "#06B6D4", label: "Restrained" },
  stunned:     { icon: ZapOff,       color: "#EAB308", label: "Stunned" },
  paralyzed:   { icon: Hand,         color: "#A78BFA", label: "Paralyzed" },
  unconscious: { icon: MoonStar,     color: "#64748B", label: "Unconscious" },
  invisible:   { icon: Ghost,        color: "#67E8F9", label: "Invisible" },
  frightened:  { icon: AlertTriangle, color: "#EF4444", label: "Frightened" },
};

function ConditionBadge({ id }: { id: string }) {
  const config = CONDITION_UI_REGISTRY[id.toLowerCase()] || {
    icon: AlertTriangle,
    color: "#EF4444",
    label: id,
  };
  const Icon = config.icon;

  return (
    <div
      title={config.label}
      aria-label={config.label}
      className="animate-condition-enter flex h-6 w-6 items-center justify-center rounded-md border border-white/10 shadow-sm backdrop-blur-sm transition-all hover:scale-110"
      style={{
        backgroundColor: `${config.color}22`,
        borderColor: `${config.color}44`,
        color: config.color,
      }}
    >
      <Icon className="h-3.5 w-3.5" />
    </div>
  );
}

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

function hpColor(percent: number) {
  const t = clamp(percent / 100, 0, 1);
  const r = Math.round(239 + (34 - 239) * t);
  const g = Math.round(68 + (197 - 68) * t);
  const b = Math.round(68 + (94 - 68) * t);
  return `rgb(${r} ${g} ${b})`;
}

export default function CombatHUD({
  combatants,
  activeTurnIndex,
  isPending,
  onActionTrigger,
  playerDown = false,
}: CombatHUDProps) {
  // Single source of truth for when the action buttons can be used; the
  // keyboard shortcuts below read the same values.
  const actionsOffered = !playerDown;
  const actionsDisabled = isPending;
  const canTriggerAction = actionsOffered && !actionsDisabled;

  const latest = useRef({ canTriggerAction, onActionTrigger });
  latest.current = { canTriggerAction, onActionTrigger };

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.repeat) return;
      if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
      const config = ACTIONS.find(({ keybind }) => keybind === event.key);
      if (!config) return;
      if (isTextEntryTarget(event.target)) return;
      if (isModalOrDialogTarget(event.target)) return;
      if (hasActiveBlockingModal()) return;
      const { canTriggerAction, onActionTrigger } = latest.current;
      if (!canTriggerAction) return;
      event.preventDefault();
      onActionTrigger(config.action);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <section className="relative h-full w-full text-slate-100">
      <aside
        aria-label="Initiative tracker"
        className={`absolute left-4 top-4 w-72 p-3 ${PANEL_CLASS}`}
      >
        <ol className="space-y-2">
          {combatants.map((combatant, index) => {
            const percent = hpPercent(combatant.hp, combatant.maxHp);
            const isActive = index === activeTurnIndex;

            return (
              <li
                key={combatant.id}
                className={[
                  "rounded-lg border border-white/10 bg-slate-950/40 p-2",
                  isActive
                    ? "ring-2 ring-amber-400 drop-shadow-[0_0_10px_rgba(251,191,36,0.5)]"
                    : "",
                ].join(" ")}
                aria-current={isActive ? "true" : undefined}
              >
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="truncate font-medium">{combatant.name}</span>
                  <span className="ml-2 shrink-0 text-slate-300">
                    Init {combatant.initiativeTotal}
                  </span>
                </div>

                <div className="mb-2 h-2 overflow-hidden rounded bg-slate-800">
                  <div
                    className="h-full transition-all duration-300"
                    style={{
                      width: `${percent}%`,
                      backgroundColor: hpColor(percent),
                    }}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-300">
                    {combatant.hp} / {combatant.maxHp} HP
                  </span>
                  <div className="flex flex-wrap gap-1.5 justify-end max-w-[120px]">
                    {combatant.conditions.map((cond) => (
                      <ConditionBadge key={`${combatant.id}-${cond}`} id={cond} />
                    ))}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </aside>

      <div className="absolute bottom-4 left-1/2 w-[min(52rem,92vw)] -translate-x-1/2">
        <div className={`p-3 ${PANEL_CLASS}`}>
          {!actionsOffered ? (
            <p role="status" className="px-2 py-3 text-center text-sm text-red-200">
              Estás inconsciente: usa «Tirada de muerte» o «Esperar» en las acciones de combate.
            </p>
          ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {ACTIONS.map(({ keybind, action, icon: Icon }) => (
              <button
                key={keybind}
                type="button"
                disabled={actionsDisabled}
                onClick={() => onActionTrigger(action)}
                className="group relative flex h-16 flex-col items-center justify-center rounded-lg border border-white/15 bg-slate-950/50 px-2 text-xs transition hover:border-amber-300/60 hover:bg-slate-900/60 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={`${action} (${keybind})`}
              >
                <span className="absolute right-1.5 top-1 text-[10px] text-slate-400">
                  {keybind}
                </span>
                <Icon className="mb-1 h-4 w-4 text-amber-300" aria-hidden="true" />
                <span className="text-center leading-tight">{action}</span>
              </button>
            ))}
          </div>
          )}
        </div>
      </div>
    </section>
  );
}
