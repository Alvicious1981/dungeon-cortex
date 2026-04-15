/**
 * components/npc/DispositionBadge.tsx
 *
 * Presentational badge that renders an NPC's persisted disposition value as a
 * colour-coded icon + band label + numeric score.
 *
 * Data contract ("State is Truth"):
 *   This component is READ-ONLY. It receives the disposition integer directly
 *   from the database (via the caller) and maps it to a visual representation.
 *   It never mutates state, calls the AI, or invents values.
 *
 * Icon map mirrors the spec (§5.10) and formatter.ts:
 *   🔴 Hostile  🟠 Unfriendly  ⚪ Indifferent  🟢 Friendly  💛 Helpful
 */

import React from "react";
import { getDispositionBand, type DispositionBand } from "@/lib/rules/social";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DISPOSITION_ICONS: Record<DispositionBand, string> = {
  Hostile:     "🔴",
  Unfriendly:  "🟠",
  Indifferent: "⚪",
  Friendly:    "🟢",
  Helpful:     "💛",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface DispositionBadgeProps {
  /** The NPC's current disposition integer in [−10, +10], or null if not yet met. */
  disposition: number | null;
  /** Optional CSS class passed through to the root element. */
  className?: string;
  /** When true, omits the numeric value — useful for compact layouts. */
  compact?: boolean;
}

/**
 * Renders a one-line disposition summary for an NPC.
 *
 * - `null` disposition → "⬜ Unknown" with an accessible label.
 * - Numeric disposition → icon + band name + score (e.g. "🟢 Friendly (5)").
 */
export default function DispositionBadge({
  disposition,
  className,
  compact = false,
}: DispositionBadgeProps) {
  if (disposition === null) {
    return (
      <span
        className={className}
        aria-label="Disposition: unknown — rollReaction not yet called"
        data-band="unknown"
      >
        ⬜ Unknown
      </span>
    );
  }

  const band = getDispositionBand(disposition);
  const icon = DISPOSITION_ICONS[band];

  return (
    <span
      className={className}
      aria-label={`Disposition: ${band} (${disposition})`}
      data-disposition={disposition}
      data-band={band}
    >
      {icon} {band}{compact ? "" : ` (${disposition})`}
    </span>
  );
}
