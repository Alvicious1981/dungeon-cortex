/**
 * lib/ai/tool-policy.ts
 *
 * Least-privilege containment for the narrator's tool surface (SEC-AI-001).
 *
 * The narrator is still built with the full tool catalogue, but only the
 * read-only subset below is activated on the model call. The remaining tools
 * stay defined and normalised while being unreachable, so a prompt-injected
 * memory, log entry, NPC name or tool result cannot reach a state-mutating
 * tool.
 *
 * TEMPORARY, REVERSIBLE REDUCTION — the state-changing tools are inactive
 * until SEC-AI-001 PR 3 restores them behind backend-authorised activation.
 *
 * The list is a frozen module constant: it is computed once, at module load,
 * and there is no input — no campaign state, scene, player text, memory,
 * dialogue or tool output — that can widen it.
 *
 * This module is pure: no I/O, no state, no dependencies.
 */

/**
 * The only tools activated on the narrator model call.
 *
 * Every entry is a read-only lookup or a deterministic generator: it resolves
 * reference data and never mutates campaign state.
 */
export const ACTIVE_NARRATOR_TOOL_NAMES = Object.freeze([
  "getNPCDetails",
  "getTavernName",
  "getMundaneLoot",
  "getSpellInfo",
  "getItemInfo",
  "getEquipmentInfo",
  "getMonsterInfo",
] as const);

export type ActiveNarratorToolName = (typeof ACTIVE_NARRATOR_TOOL_NAMES)[number];

/**
 * Returns the immutable list of tools the narrator may call.
 *
 * Takes no arguments by design: the active set is fixed by policy, never
 * derived from runtime data.
 */
export function getActiveNarratorToolNames(): readonly ActiveNarratorToolName[] {
  return ACTIVE_NARRATOR_TOOL_NAMES;
}
