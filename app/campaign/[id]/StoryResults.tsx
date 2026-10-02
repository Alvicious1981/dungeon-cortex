"use client";

import type { GameEvent, GameEventType } from "@/lib/events/game-events";
import { ConsequenceEntry } from "@/components/combat/ConsequenceLog";
import { conditionLabel } from "@/lib/character-sheet/condition-labels";

const EVENT_LABELS: Record<GameEventType, string> = {
  CRITICAL_HIT: "Golpe crítico", CRITICAL_MISS: "Pifia", DAMAGE_DEALT: "Daño causado",
  ENEMY_DEFEATED: "Enemigo derrotado", SPELL_CAST: "Conjuro lanzado", HEALING_RECEIVED: "Curación recibida",
  PLAYER_DOWNED: "Has caído inconsciente", ENCOUNTER_START: "Comienza el combate", TURN_ADVANCE: "Cambio de turno",
  ROUND_ADVANCE: "Nueva ronda", COMBAT_CONSEQUENCE: "Resultado del combate", LOOT_GENERATED: "Botín recibido",
  LEVEL_UP_RESOLVED: "Nivel aumentado", CONCENTRATION_STARTED: "Concentración iniciada",
  CONCENTRATION_BROKEN: "Concentración terminada", MOVE_COMBATANT: "Movimiento realizado",
  EQUIP_ITEM: "Equipo cambiado", REST_COMPLETED: "Descanso completado", EXPLORATION_WARNING: "Aviso de exploración",
  PLAYER_MOVE: "Cambio de ubicación", ABILITY_CHECK_RESOLVED: "Prueba resuelta", DEATH_SAVE_ROLLED: "Tirada de muerte",
  PLAYER_STABILIZED: "Te has estabilizado", PLAYER_REVIVED: "Has recuperado la consciencia",
  PLAYER_WOKE: "Has despertado", PLAYER_DIED: "Tu personaje ha muerto",
};

function field(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

/** Summaries copy stated values. In particular, zero damage is never a miss or immunity. */
function eventSummary(event: Exclude<GameEvent, { type: "COMBAT_CONSEQUENCE" }>): string {
  const p = event.payload;
  switch (event.type) {
    case "ABILITY_CHECK_RESOLVED":
      return [field(p, "skill"), field(p, "total") !== null ? `Total ${field(p, "total")}` : null,
        field(p, "dc") !== null ? `CD ${field(p, "dc")}` : null,
        p.success === true ? "Éxito" : p.success === false ? "Fallo" : null].filter(Boolean).join(" · ");
    case "DAMAGE_DEALT":
      return [field(p, "targetName"), field(p, "damage") !== null ? `${field(p, "damage")} de daño` : null].filter(Boolean).join(" · ");
    case "HEALING_RECEIVED":
      return [field(p, "amount") !== null ? `${field(p, "amount")} PG recuperados` : null,
        field(p, "newHp") !== null ? `${field(p, "newHp")} PG actuales` : null].filter(Boolean).join(" · ");
    case "REST_COMPLETED":
      return [p.type === "LONG_REST" ? "Descanso largo" : p.type === "SHORT_REST" ? "Descanso corto" : null,
        field(p, "hpRecovered") !== null ? `${field(p, "hpRecovered")} PG recuperados` : null].filter(Boolean).join(" · ");
    default:
      return [field(p, "itemName"), field(p, "spellName"), field(p, "targetName"), field(p, "name")].filter(Boolean).join(" · ");
  }
}

// An allowlist of player-facing facts. Technical identifiers and narrative
// tags are deliberately absent; values are copied, never mechanically derived.
const FACT_LABELS: Record<string, string> = {
  targetName: "Objetivo", name: "Nombre", itemName: "Objeto", spellName: "Conjuro",
  replacedSpellName: "Conjuro anterior", spellLevel: "Nivel del conjuro", slotConsumed: "Espacio consumido",
  damage: "Daño", amount: "PG recuperados", newHp: "PG actuales", hp: "PG actuales",
  naturalRoll: "Tirada natural", natural: "Tirada natural", roll: "Tirada", total: "Total", dc: "CD",
  ability: "Característica", skill: "Habilidad", abilityModifier: "Modificador", proficiencyApplied: "Competencia aplicada",
  success: "Éxito", hpRecovered: "PG recuperados", hitDiceRecovered: "Dados de golpe recuperados",
  hitDiceSpent: "Dados de golpe gastados", exhaustionReduced: "Agotamiento reducido", spellSlotsRecovered: "Espacios de conjuro recuperados",
  distanceFt: "Distancia en pies", nextRound: "Ronda", round: "Ronda", successes: "Éxitos", failures: "Fallos",
  previousLevel: "Nivel anterior", newLevel: "Nuevo nivel", hpRoll: "Tirada de PG", hpGained: "PG ganados",
  previousMaxHp: "Máximo anterior de PG", newMaxHp: "Nuevo máximo de PG", gold: "Oro", totalValue: "Valor total",
};

const ENUM_FACTS: Record<string, { label: string; values: Record<string, string> }> = {
  type: { label: "Descanso", values: { LONG_REST: "Largo", SHORT_REST: "Corto" } },
  cause: { label: "Causa", values: { massive_damage: "Daño masivo", death_saves: "Tiradas de muerte" } },
  reason: { label: "Motivo", values: { replaced: "Otro conjuro", duration_expired: "Duración terminada", failed_save: "Salvación fallida", unconscious: "Inconsciencia" } },
  outcome: { label: "Estado", values: { revived: "Consciente", stable: "Estable", dead: "Muerto", dying: "Moribundo" } },
  targetSlot: { label: "Ubicación del equipo", values: { MAIN_HAND: "Mano principal", OFF_HAND: "Mano secundaria", ARMOR: "Armadura", ACCESSORY: "Accesorio" } },
  rollMode: { label: "Modo de tirada", values: { normal: "Normal", advantage: "Ventaja", disadvantage: "Desventaja" } },
};

function FactList({ facts }: { facts: Array<[string, string]> }) {
  return <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
    {facts.map(([label, value], index) => <div key={`${label}-${index}`} className="contents">
      <dt className="text-[var(--dc-text-muted)]">{label}</dt><dd className="break-words text-[var(--dc-text)]">{value}</dd>
    </div>)}
  </dl>;
}

function EventFacts({ event }: { event: GameEvent }) {
  if (event.type === "COMBAT_CONSEQUENCE") {
    return <div className="space-y-3">
      <p className="font-medium text-[var(--dc-text)]">{event.payload.attackerName}</p>
      {event.payload.targets.map((target, index) => (
        <div key={`${target.targetId}-${index}`}>
          <p className="mb-1 font-medium">{target.targetName}</p>
          <FactList facts={[
            ...(target.naturalRoll >= 1 && target.naturalRoll <= 20
              ? [["Tirada natural", String(target.naturalRoll)] as [string, string]] : []),
            ["Daño", String(target.damage)],
            ["PG actuales", String(target.hpAfter)], ["PG máximos", String(target.targetMaxHp)],
            ["Crítico", target.isCrit ? "Sí" : "No"], ["Pifia", target.isFumble ? "Sí" : "No"],
            ["Derrotado", target.isKill ? "Sí" : "No"],
            ["Condiciones aplicadas", target.conditionsApplied.length ? target.conditionsApplied.map(conditionLabel).join(", ") : "Ninguna"],
          ]} />
        </div>
      ))}
    </div>;
  }
  const facts: Array<[string, string]> = [];
  for (const [key, label] of Object.entries(FACT_LABELS)) {
    const value = event.payload[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      facts.push([label, typeof value === "boolean" ? value ? "Sí" : "No" : String(value)]);
    }
  }
  for (const [key, { label, values }] of Object.entries(ENUM_FACTS)) {
    const value = event.payload[key];
    if (typeof value === "string" && values[value]) facts.push([label, values[value]]);
  }
  return facts.length ? <FactList facts={facts} /> : <p className="text-[var(--dc-text-muted)]">Sin detalles adicionales.</p>;
}

export function StoryResults({ events }: { events: GameEvent[] }) {
  if (!events.length) return null;
  return (
    <div className="space-y-2 border-l-2 border-[var(--dc-mechanical)]/60 py-2 pl-3" aria-label="Resultado de la acción">
      <p className="text-sm font-semibold text-[var(--dc-mechanical)]">Resultado</p>
      <ul className="space-y-2">
        {events.map((event, index) => event.type === "COMBAT_CONSEQUENCE" ? (
          <ConsequenceEntry key={index} entry={event.payload} index={0} />
        ) : (
          <li key={index} className="text-sm text-[var(--dc-text)]">
            <span className="font-medium">{EVENT_LABELS[event.type]}</span>
            {eventSummary(event) && <span>: {eventSummary(event)}</span>}
          </li>
        ))}
      </ul>
      <details className="text-sm text-[var(--dc-text-muted)]">
        <summary className="flex min-h-11 cursor-pointer items-center underline decoration-[var(--dc-border-strong)] underline-offset-4">Ver hechos exactos ({events.length})</summary>
        <div className="space-y-4 rounded bg-black/20 p-3">
          {events.map((event, index) => <div key={index} className="space-y-2">
            <p className="font-medium text-[var(--dc-text)]">{EVENT_LABELS[event.type]}</p>
            <EventFacts event={event} />
          </div>)}
        </div>
      </details>
    </div>
  );
}
