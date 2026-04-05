/**
 * lib/rules/magic.ts
 *
 * Pure rules functions for spell slot management (Milestone C — Magic and state depth).
 *
 * SpellSlots is the canonical in-memory representation of the `spellSlots Json?`
 * field on the Character model. Keys are spell level as a string ("1"–"9");
 * values track current available slots and the per-long-rest maximum.
 *
 * These functions are pure: they never touch the database. Callers are
 * responsible for persisting the returned state via prisma.character.update.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-level slot entry stored inside the SpellSlots record. */
export interface SlotEntry {
  /** Slots currently available (0 ≤ current ≤ max). */
  current: number;
  /** Maximum slots granted at this spell level. */
  max: number;
}

/**
 * Canonical shape of Character.spellSlots.
 * Keys are spell level as a string, e.g. "1", "2", … "9".
 * Cantrips (level 0) are unlimited and must not appear here.
 *
 * Example: { "1": { current: 2, max: 2 }, "2": { current: 1, max: 1 } }
 */
export type SpellSlots = Record<string, SlotEntry>;

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** Narrows an unknown value (e.g. Prisma JsonValue) to SpellSlots. */
export function isSpellSlots(value: unknown): value is SpellSlots {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).every(([key, entry]) => {
    if (!/^\d+$/.test(key)) return false;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const e = entry as Record<string, unknown>;
    return typeof e.current === "number" && typeof e.max === "number";
  });
}

// ---------------------------------------------------------------------------
// Pure rule functions
// ---------------------------------------------------------------------------

/**
 * Returns true if the character has at least one available slot at `level`.
 * Safe to call with null/undefined (characters without spellcasting ability).
 */
export function hasAvailableSlot(
  slots: SpellSlots | null | undefined,
  level: number
): boolean {
  if (!slots) return false;
  const key = String(level);
  const entry = slots[key];
  return entry !== undefined && entry.current > 0;
}

/**
 * Decrements the `current` count for the given spell level and returns the
 * updated SpellSlots object. The original object is not mutated.
 *
 * Throws if:
 * - the level has no entry in slots, or
 * - `current` is already 0 (no slots remaining).
 */
export function consumeSlot(slots: SpellSlots, level: number): SpellSlots {
  const key = String(level);
  const entry = slots[key];

  if (entry === undefined) {
    throw new Error(
      `No spell slot entry found for level ${level}. ` +
      `Available levels: ${Object.keys(slots).join(", ") || "none"}.`
    );
  }
  if (entry.current <= 0) {
    throw new Error(
      `No available spell slots remaining at level ${level} ` +
      `(max: ${entry.max}).`
    );
  }

  return {
    ...slots,
    [key]: { ...entry, current: entry.current - 1 },
  };
}

/**
 * Restores all spell slots to their maximum values (long rest).
 * Returns a new SpellSlots object; the original is not mutated.
 */
export function restoreAllSlots(slots: SpellSlots): SpellSlots {
  return Object.fromEntries(
    Object.entries(slots).map(([key, entry]) => [key, { ...entry, current: entry.max }])
  );
}
