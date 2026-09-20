/**
 * lib/rules/social-target.ts
 *
 * Deterministic scene-presence target resolution for typed social actions.
 *
 * Rules:
 * - When scenePresenceVersion >= 1 (canonical mode):
 *     Candidates come exclusively from CampaignSceneParticipant for the campaign.
 *     Never falls back to currentNode.npcSeed.
 * - When scenePresenceVersion === 0 (legacy mode):
 *     Resolves from currentNode.npcSeed for the campaign.
 * - Explicit target:
 *     - Exactly 1 match -> proceed with target.
 *     - 0 matches -> refuse with NPC_NOT_PRESENT.
 *     - 2+ matches -> refuse with MECHANICAL_CLARIFICATION_REQUIRED.
 * - No usable explicit target (pronouns / collectives / omitted):
 *     - Exactly 1 present NPC -> resolve to that unique participant.
 *     - 0 present NPCs -> refuse with NO_TARGET_AVAILABLE.
 *     - 2+ present NPCs -> refuse with MECHANICAL_CLARIFICATION_REQUIRED.
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

export interface SocialTargetDb {
  campaignSceneParticipant?: {
    findMany(args: {
      where: { campaignId: string };
      orderBy?: { npcId: "asc" | "desc" };
      include?: {
        npc?: boolean | { select?: Record<string, boolean> };
        nPC?: boolean | { select?: Record<string, boolean> };
      };
    }): Promise<
      Array<{
        campaignId: string;
        npcId: string;
        npc?: SocialTargetCandidate | null;
        nPC?: SocialTargetCandidate | null;
      }>
    >;
  };
  nPC: {
    findUnique(args: {
      where: {
        campaignId_seed: { campaignId: string; seed: string };
      };
      select?: Record<string, boolean>;
    }): Promise<SocialTargetCandidate | null | undefined>;
  };
}

const PRONOUNS_AND_COLLECTIVES = new Set([
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

export async function resolveSocialSceneTarget(input: {
  campaignId: string;
  targetName?: string;
  scenePresenceVersion: number;
  currentNodeNpcSeed?: string | null;
  db: SocialTargetDb;
}): Promise<SocialTargetResolution> {
  const { campaignId, targetName, scenePresenceVersion, currentNodeNpcSeed, db } = input;

  let candidates: SocialTargetCandidate[] = [];

  if (scenePresenceVersion >= 1) {
    if (db.campaignSceneParticipant?.findMany) {
      const participants = await db.campaignSceneParticipant.findMany({
        where: { campaignId },
        orderBy: { npcId: "asc" },
        include: {
          npc: {
            select: {
              id: true,
              name: true,
              seed: true,
              campaignId: true,
            },
          },
        },
      });

      candidates = participants
        .map((p) => p.npc ?? p.nPC)
        .filter(
          (npc): npc is SocialTargetCandidate =>
            Boolean(npc && npc.campaignId === campaignId && npc.id)
        );
    }
  } else {
    // Legacy mode (scenePresenceVersion === 0)
    if (currentNodeNpcSeed) {
      const legacyNpc = await db.nPC.findUnique({
        where: {
          campaignId_seed: {
            campaignId,
            seed: currentNodeNpcSeed,
          },
        },
        select: {
          id: true,
          name: true,
          seed: true,
          campaignId: true,
        },
      });

      if (legacyNpc && legacyNpc.campaignId === campaignId) {
        candidates = [legacyNpc];
      }
    }
  }

  const trimmedTarget = targetName?.trim().toLowerCase();
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
      return { ok: true, target: candidates[0] };
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
    const normName = c.name?.trim().toLowerCase();
    const normSeed = c.seed?.trim().toLowerCase();
    return normName === needle || normSeed === needle;
  });

  if (exactMatches.length === 1) {
    return { ok: true, target: exactMatches[0] };
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
    const normName = c.name?.trim().toLowerCase() ?? "";
    const normSeed = c.seed?.trim().toLowerCase() ?? "";
    return normName.includes(needle) || (normSeed && normSeed.includes(needle));
  });

  if (partialMatches.length === 1) {
    return { ok: true, target: partialMatches[0] };
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
