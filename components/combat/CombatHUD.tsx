"use client";

import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowDown,
  EyeOff,
  Flag,
  Flame,
  FlaskConical,
  Ghost,
  Hand,
  HandHelping,
  Link2,
  MoonStar,
  Package,
  Search,
  Shield,
  Sparkles,
  Sword,
  Timer,
  Zap,
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
  onActionTrigger: (action: string) => void;
}

interface ActionConfig {
  keybind: string;
  action: string;
  icon: LucideIcon;
}

const ACTIONS: ActionConfig[] = [
  { keybind: "F1", action: "Attack", icon: Sword },
  { keybind: "F2", action: "Dash", icon: Zap },
  { keybind: "F3", action: "Disengage", icon: Shield },
  { keybind: "F4", action: "Dodge", icon: Shield },
  { keybind: "F5", action: "Help", icon: HandHelping },
  { keybind: "F6", action: "Hide", icon: EyeOff },
  { keybind: "F7", action: "Ready", icon: Timer },
  { keybind: "F8", action: "Search", icon: Search },
  { keybind: "F9", action: "Use Object", icon: Package },
  { keybind: "F10", action: "Cast Spell", icon: Flame },
  { keybind: "F11", action: "Class Feature", icon: Sparkles },
  { keybind: "F12", action: "End Turn", icon: Flag },
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
  onActionTrigger,
}: CombatHUDProps) {
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
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {ACTIONS.map(({ keybind, action, icon: Icon }) => (
              <button
                key={keybind}
                type="button"
                onClick={() => onActionTrigger(action)}
                className="group relative flex h-16 flex-col items-center justify-center rounded-lg border border-white/15 bg-slate-950/50 px-2 text-xs transition hover:border-amber-300/60 hover:bg-slate-900/60"
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
        </div>
      </div>
    </section>
  );
}
