/**
 * lib/events/game-events.ts
 *
 * Deterministic game event types emitted by the action route before
 * the AI narration stream begins.  These are derived purely from
 * dice outcomes and state mutations — the AI never owns them.
 *
 * Transport: each event is sent as an SSE `data:` frame with a JSON
 * body of type ActionStreamFrame.  The client dispatches a
 * "dungeon-game-event" CustomEvent so GameEventHandler can react
 * (audio, visual) without being coupled to the fetch call.
 */

// ─── Event catalogue ────────────────────────────────────────────────────────

export type GameEventType =
  | "CRITICAL_HIT"      // Natural 20 on an attack roll
  | "CRITICAL_MISS"     // Natural 1 on an attack roll
  | "DAMAGE_DEALT"      // Normal hit — target HP reduced
  | "ENEMY_DEFEATED"    // Target HP reaches 0
  | "SPELL_CAST"        // Spell slot successfully consumed
  | "HEALING_RECEIVED"  // Consumable heals the player
  | "PLAYER_DOWNED";    // Player HP reaches 0

export interface GameEvent {
  type: GameEventType;
  /** Contextual data for UI/audio — shape varies per event type. */
  payload: Record<string, unknown>;
}

// ─── SSE wire protocol ───────────────────────────────────────────────────────

/**
 * Discriminated union for frames sent over the action SSE stream.
 *
 *   t:"evt"  — a deterministic game event (fires before any LLM tokens)
 *   t:"txt"  — a text delta from the AI narrator
 *   t:"done" — stream complete; client should call router.refresh()
 */
export type ActionStreamFrame =
  | { t: "evt"; e: GameEvent }
  | { t: "txt"; d: string }
  | { t: "done" };
