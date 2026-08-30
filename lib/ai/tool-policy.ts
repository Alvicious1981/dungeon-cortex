/**
 * lib/ai/tool-policy.ts
 *
 * Least-privilege containment for the narrator's tool surface (SEC-AI-001).
 *
 * The narrator receives only the read-only subset below. The remaining tools
 * stay implemented for their backend-owned callers, but are absent from the
 * object passed to the model call.
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
 * Every entry is a read-only SRD lookup. Generators and campaign-aware tools
 * remain outside the narrator's model-visible surface.
 */
export const ACTIVE_NARRATOR_TOOL_NAMES = Object.freeze([
  "getSpellInfo",
  "getItemInfo",
  "getEquipmentInfo",
  "getMonsterInfo",
] as const);

export type ActiveNarratorToolName = (typeof ACTIVE_NARRATOR_TOOL_NAMES)[number];

type NarratorToolCatalogue = Record<ActiveNarratorToolName, unknown>;

/**
 * Physically projects a complete tool catalogue onto the fixed narrator policy.
 *
 * The generic constraint is deliberate: adding a name to the policy without
 * adding it to the catalogue passed by `buildNarratorTools` is a TypeScript
 * error. The model-facing object is therefore always derived from this single
 * policy list rather than maintained as a second handwritten list.
 */
export function selectActiveNarratorTools<
  const TTools extends NarratorToolCatalogue,
>(catalogue: TTools): Pick<TTools, ActiveNarratorToolName> {
  const activeTools = {} as Pick<TTools, ActiveNarratorToolName>;

  for (const toolName of ACTIVE_NARRATOR_TOOL_NAMES) {
    activeTools[toolName] = catalogue[toolName];
  }

  return activeTools;
}

/**
 * Returns the immutable list of tools included in the narrator tool object.
 *
 * Takes no arguments by design: the active set is fixed by policy, never
 * derived from runtime data.
 */
export function getActiveNarratorToolNames(): readonly ActiveNarratorToolName[] {
  return ACTIVE_NARRATOR_TOOL_NAMES;
}
