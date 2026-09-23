/**
 * lib/rules/social-target.ts
 *
 * Pure candidate matching and cardinality resolution for typed social actions.
 *
 * Pure rule layer:
 * - Operates purely on candidate lists { id, campaignId, name, seed }
 * - Knows nothing about databases, Prisma, or I/O.
 * - Handles:
 *     - Explicit target name (exact, seed, unambiguous partial)
 *     - Omitted target, pronouns, and collectives
 *     - Cardinality decisions (0 -> fail, 1 -> match, 2+ -> clarification)
 *     - Terminal and punctuation normalization
 */

export interface SocialTargetCandidate {
  id: string;
  name: string;
  seed?: string | null;
  campaignId: string;
}

export type SocialTargetResolution =
  | { ok: true; target: SocialTargetCandidate }
  | {
      ok: false;
      error: string;
      code: "NPC_NOT_PRESENT" | "MECHANICAL_CLARIFICATION_REQUIRED" | "NO_TARGET_AVAILABLE";
      status: 400;
    };

export const PRONOUNS_AND_COLLECTIVES = new Set([
  "him",
  "her",
  "them",
  "they",
  "it",
  "someone",
  "anyone",
  "everyone",
  "everybody",
  "all",
  "el",
  "él",
  "ella",
  "ellos",
  "ellas",
  "le",
  "les",
  "alguien",
  "nadie",
  "todos",
  "todas",
]);

/**
 * Normalizes punctuation from a target name candidate without destroying internal hyphens/apostrophes.
 */
export function normalizeTargetName(raw?: string): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .trim()
    .replace(/^[¿¡\s]+/, "")
    .replace(/[.!?\s]+$/, "")
    .trim()
    .toLowerCase();
  return cleaned || undefined;
}

/**
 * Pure candidate matching algorithm.
 */
export function resolveSocialTargetCandidate(
  candidates: readonly SocialTargetCandidate[],
  targetName?: string
): SocialTargetResolution {
  const trimmedTarget = normalizeTargetName(targetName);
  const isExplicitTarget =
    Boolean(trimmedTarget) && !PRONOUNS_AND_COLLECTIVES.has(trimmedTarget!);

  if (!isExplicitTarget) {
    if (candidates.length === 0) {
      return {
        ok: false,
        error: "No target available in the current scene.",
        code: "NO_TARGET_AVAILABLE",
        status: 400,
      };
    }
    if (candidates.length === 1) {
      return { ok: true, target: candidates[0]! };
    }
    return {
      ok: false,
      error: "Multiple characters are present. State who you are talking to.",
      code: "MECHANICAL_CLARIFICATION_REQUIRED",
      status: 400,
    };
  }

  const needle = trimmedTarget!;

  // 1. Normalized exact name or seed match
  const exactMatches = candidates.filter((c) => {
    const normName = normalizeTargetName(c.name);
    const normSeed = normalizeTargetName(c.seed ?? undefined);
    return normName === needle || normSeed === needle;
  });

  if (exactMatches.length === 1) {
    return { ok: true, target: exactMatches[0]! };
  }
  if (exactMatches.length > 1) {
    return {
      ok: false,
      error: "Multiple matching targets found. Specify which one.",
      code: "MECHANICAL_CLARIFICATION_REQUIRED",
      status: 400,
    };
  }

  // 2. Unique unambiguous partial match
  const partialMatches = candidates.filter((c) => {
    const normName = normalizeTargetName(c.name) ?? "";
    const normSeed = normalizeTargetName(c.seed ?? undefined) ?? "";
    return normName.includes(needle) || (normSeed && normSeed.includes(needle));
  });

  if (partialMatches.length === 1) {
    return { ok: true, target: partialMatches[0]! };
  }
  if (partialMatches.length > 1) {
    return {
      ok: false,
      error: "Multiple matching targets found. Specify which one.",
      code: "MECHANICAL_CLARIFICATION_REQUIRED",
      status: 400,
    };
  }

  // 3. Otherwise fail closed
  return {
    ok: false,
    error: "NPC is not present in the current scene.",
    code: "NPC_NOT_PRESENT",
    status: 400,
  };
}
