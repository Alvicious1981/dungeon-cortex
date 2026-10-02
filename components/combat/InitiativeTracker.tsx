"use client";

import { useEffect, useRef, useState } from "react";
import { conditionLabel } from "@/lib/character-sheet/condition-labels";
import {
  DUNGEON_ACTION_END,
  DUNGEON_ACTION_ERROR,
  createDungeonActionRequestId,
  requestDungeonAction,
  type DungeonActionErrorDetail,
  type DungeonActionRequestDetail,
} from "@/lib/events/action-transport";

export interface InitiativeDisplayEntry {
  id: string;
  name: string;
  initiativeTotal: number;
  unconscious?: boolean;
  hp?: number;
  maxHp?: number;
  conditions?: string[];
}

interface Props {
  entries: InitiativeDisplayEntry[];
  /** id of the combatant whose turn it currently is, if combat is active. */
  activeId?: string;
  /** The player is at 0 HP: turns advance only through the death-save action. */
  playerDown?: boolean;
  showTurnControl?: boolean;
}

export default function InitiativeTracker({ entries, activeId, playerDown = false, showTurnControl = true }: Props) {
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRequestId = useRef<string | null>(null);

  // Fire ENCOUNTER_START exactly once when the component first mounts with combatants.
  // The ref persists across router.refresh() re-renders (component stays mounted).
  const encounterStartFired = useRef(false);

  useEffect(() => {
    if (entries.length > 0 && !encounterStartFired.current) {
      encounterStartFired.current = true;
      window.dispatchEvent(
        new CustomEvent("dungeon-game-event", {
          detail: { event: { type: "ENCOUNTER_START", payload: {} } },
        }),
      );
    }
  }, [entries]);

  useEffect(() => {
    function handleActionError(event: Event) {
      const detail = (event as CustomEvent<DungeonActionErrorDetail>).detail;
      if (detail.requestId === pendingRequestId.current) {
        setError(detail.error);
      }
    }

    function handleActionEnd(event: Event) {
      const detail = (event as CustomEvent<DungeonActionRequestDetail>).detail;
      if (detail.requestId === pendingRequestId.current) {
        pendingRequestId.current = null;
        setAdvancing(false);
      }
    }

    window.addEventListener(DUNGEON_ACTION_ERROR, handleActionError);
    window.addEventListener(DUNGEON_ACTION_END, handleActionEnd);
    return () => {
      window.removeEventListener(DUNGEON_ACTION_ERROR, handleActionError);
      window.removeEventListener(DUNGEON_ACTION_END, handleActionEnd);
    };
  }, []);

  function handleNextTurn() {
    if (advancing) return;
    const requestId = createDungeonActionRequestId();
    pendingRequestId.current = requestId;
    setError(null);
    setAdvancing(true);
    requestDungeonAction({ action: "End Turn" }, requestId);
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--dc-border-strong)] bg-[var(--dc-surface)] px-4 py-6 text-center">
        <p className="text-sm text-[var(--dc-text-muted)]">No hay combatientes en este encuentro.</p>
      </div>
    );
  }

  return (
    <section aria-label="Orden de iniciativa">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[var(--dc-text-muted)]">
        Orden de iniciativa
      </h2>
      <ol className="space-y-1.5">
        {entries.map((entry, index) => {
          const isActive = entry.id === activeId;

          return (
            <li
              key={entry.id}
              aria-current={isActive ? "true" : undefined}
              className={[
                "flex min-h-[44px] flex-wrap items-center gap-2 rounded-md px-3 py-2.5 text-sm motion-safe:transition-colors",
                isActive
                  ? "border border-[var(--dc-action)] bg-[var(--dc-selection)] text-[var(--dc-text)]"
                  : "border border-[var(--dc-border)] bg-[var(--dc-surface)] text-[var(--dc-text)]",
              ].join(" ")}
            >
              {/* Turn position */}
              <span
                className={[
                  "w-5 shrink-0 text-center text-xs font-mono font-bold",
                  isActive ? "text-[var(--dc-action-hover)]" : "text-[var(--dc-text-subtle)]",
                ].join(" ")}
                aria-hidden="true"
              >
                {index + 1}
              </span>

              {/* Active turn indicator */}
              <span
                className={[
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  isActive ? "bg-[var(--dc-action)]" : "bg-[var(--dc-border-strong)]",
                ].join(" ")}
                aria-hidden="true"
              />

              {/* Name */}
              <span className="min-w-0 flex-1 break-words font-medium">
                {entry.name}
                {/* Text as well as colour: the active row must not depend on seeing amber. */}
                {isActive && (
                  <span className="ml-2 inline-block whitespace-nowrap rounded border border-[var(--dc-action)] px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-[var(--dc-action-hover)]">
                    Turno actual
                  </span>
                )}
                {entry.unconscious && (
                  <span className="ml-2 rounded border border-[var(--dc-error)] bg-[var(--dc-surface-raised)] px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-[var(--dc-error)]">
                    Inconsciente
                  </span>
                )}
              </span>

              <span className="text-xs text-[var(--dc-text-muted)]">Iniciativa:</span>
              <span
                className={[
                  "w-8 shrink-0 text-right font-mono text-base font-bold",
                  isActive ? "text-[var(--dc-action-hover)]" : "text-[var(--dc-text)]",
                ].join(" ")}
              >
                {entry.initiativeTotal}
              </span>
              {(entry.hp !== undefined || Boolean(entry.conditions?.length)) && (
                <div className="flex w-full flex-wrap items-center gap-2 pl-7 text-xs text-[var(--dc-text-muted)]">
                  {entry.hp !== undefined && <span>{entry.hp} / {entry.maxHp} PG</span>}
                  {entry.conditions?.map((condition) => (
                    <span key={condition} className="rounded border border-[var(--dc-border-strong)] bg-[var(--dc-surface-soft)] px-2 py-1 text-[var(--dc-text)]">
                      {conditionLabel(condition)}
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {/* Next Turn button */}
      {showTurnControl && <div className="mt-3 space-y-2">
        {playerDown ? (
          <p className="rounded-md border border-[var(--dc-error)] bg-[var(--dc-surface)] px-3 py-2 text-xs text-[var(--dc-error)]">
            Estás inconsciente: el turno avanza con «Tirada de muerte» o «Esperar».
          </p>
        ) : (
        <button
          type="button"
          onClick={handleNextTurn}
          disabled={advancing}
          className="w-full min-h-[44px] rounded-md border border-[var(--dc-action)] bg-[var(--dc-surface-raised)] px-3 py-2 text-xs font-semibold text-[var(--dc-action-hover)] hover:bg-[var(--dc-surface-soft)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {advancing ? "Avanzando…" : "Siguiente turno"}
        </button>
        )}

        {error && (
          <p role="alert" className="text-xs text-[var(--dc-error)] bg-[var(--dc-surface)] rounded px-2 py-1.5">
            {error}
          </p>
        )}
      </div>}
    </section>
  );
}
