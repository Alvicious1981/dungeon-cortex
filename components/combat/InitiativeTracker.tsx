"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { InitiativeEntry } from "@/lib/rules/combat";

interface Props {
  entries: InitiativeEntry[];
  /** id of the combatant whose turn it currently is, if combat is active. */
  activeId?: string;
  campaignId: string;
}

export default function InitiativeTracker({ entries, activeId, campaignId }: Props) {
  const router = useRouter();
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function handleNextTurn() {
    setError(null);
    setAdvancing(true);
    try {
      const res = await fetch(`/api/campaign/${campaignId}/encounter/turn`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "Failed to advance turn.");
        return;
      }

      // Dispatch ROUND_ADVANCE or TURN_ADVANCE based on API response before refreshing.
      const data = await res.json() as { isNewRound: boolean };
      window.dispatchEvent(
        new CustomEvent("dungeon-game-event", {
          detail: {
            event: {
              type: data.isNewRound ? "ROUND_ADVANCE" : "TURN_ADVANCE",
              payload: {},
            },
          },
        }),
      );

      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setAdvancing(false);
    }
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-700 bg-neutral-900/50 px-4 py-6 text-center">
        <p className="text-sm text-neutral-500">No combatants in this encounter.</p>
      </div>
    );
  }

  return (
    <section aria-label="Initiative order">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-neutral-400">
        Initiative Order
      </h2>
      <ol className="space-y-1.5">
        {entries.map((entry, index) => {
          const isActive = entry.id === activeId;
          const modSign = entry.dexModifier >= 0 ? "+" : "";

          return (
            <li
              key={entry.id}
              aria-current={isActive ? "true" : undefined}
              className={[
                "flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2.5 text-sm motion-safe:transition-colors",
                isActive
                  ? "bg-amber-900/40 border border-amber-700/60 text-amber-100"
                  : "bg-neutral-900 border border-neutral-800 text-neutral-300",
              ].join(" ")}
            >
              {/* Turn position */}
              <span
                className={[
                  "w-5 shrink-0 text-center text-xs font-mono font-bold",
                  isActive ? "text-amber-400" : "text-neutral-500",
                ].join(" ")}
                aria-hidden="true"
              >
                {index + 1}
              </span>

              {/* Active turn indicator */}
              <span
                className={[
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  isActive ? "bg-amber-400" : "bg-neutral-700",
                ].join(" ")}
                aria-hidden="true"
              />

              {/* Name */}
              <span className="flex-1 truncate font-medium">{entry.name}</span>

              {/* Roll breakdown: natural + modifier = total */}
              <span className="shrink-0 font-mono text-xs text-neutral-500">
                {entry.naturalRoll}
                <span className="mx-0.5 text-neutral-600">{modSign}{entry.dexModifier}</span>
              </span>

              {/* Initiative total */}
              <span
                className={[
                  "w-8 shrink-0 text-right font-mono text-base font-bold",
                  isActive ? "text-amber-300" : "text-neutral-100",
                ].join(" ")}
              >
                {entry.initiative}
              </span>
            </li>
          );
        })}
      </ol>

      {/* Next Turn button */}
      <div className="mt-3 space-y-2">
        <button
          type="button"
          onClick={handleNextTurn}
          disabled={advancing}
          className="w-full min-h-[44px] rounded-md border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-900/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {advancing ? "Advancing…" : "Next Turn"}
        </button>

        {error && (
          <p role="alert" className="text-xs text-red-400 bg-red-950/40 rounded px-2 py-1.5">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
