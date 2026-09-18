/**
 * lib/memory/context.ts
 *
 * Context assembly for Milestone D — Memory and continuity.
 *
 * Gathers the three pillars of campaign context needed to build an AI prompt
 * or power any context-aware operation:
 *   1. Character — current stats, hp, spell slots, and inventory
 *   2. Active encounter — initiative order and combatant state (null if none)
 *   3. Recent logs — last 5 GameLog entries, oldest-first (for chronology)
 *
 * This module is pure fetch logic: it never mutates state.
 * Callers are responsible for error handling at the API boundary.
 */

import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@prisma/client";
import { COMBATANT_INITIATIVE_ORDER } from "@/lib/rules/turn-authority";
import { searchMemories } from "@/lib/memory/search";
import type { NPCPersonality } from "@/lib/rules/social";
import type { NPCTraits } from "@/lib/rules/npc";

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

export interface ContextCharacter {
  id: string;
  name: string;
  race: string;
  class: string;
  level: number;
  hp: number;
  maxHp: number;
  /** Total accumulated XP. */
  xp: number;
  /** Raw JSON — { STR, DEX, CON, INT, WIS, CHA } */
  stats: Prisma.JsonValue;
  /** Raw JSON spell slot map, or null if the character has no spellcasting. */
  spellSlots: Prisma.JsonValue | null;
  /** Raw JSON array of SRD skill names the character is proficient in, or null. */
  skillProficiencies: Prisma.JsonValue | null;
  /** ID of the currently concentrated-on spell, or null. */
  concentrationSpellId: string | null;
  /** Total hit dice the character possesses (= level). */
  hitDiceTotal: number;
  /** Remaining hit dice available for short rest healing. */
  hitDiceRemaining: number;
  /** D&D 5e exhaustion level (0-6). */
  exhaustionLevel: number;
  inventory: ContextInventoryItem[];
}

export interface ContextInventoryItem {
  id: string;
  name: string;
  type: string;
  quantity: number;
  properties: Prisma.JsonValue;
  /** Equipped slot name, e.g. 'MAIN_HAND' | 'OFF_HAND' | 'ARMOR' | 'ACCESSORY'. */
  equippedSlot: string | null;
}

export interface ContextEncounter {
  id: string;
  round: number;
  currentTurnIndex: number;
  /** Integer feet spent in this round/index turn; null is fail-closed legacy state. */
  currentTurnMovementSpentFt: number | null;
  /** Null is fail-closed legacy state; this is mechanical state, never narration. */
  currentTurnObjectInteractionUsed: boolean | null;
  /** Ordered by the persisted initiativeOrder — index 0 acts first. */
  combatants: ContextCombatant[];
  /** Total damage dealt to enemies. */
  totalDamageDealt: number;
  // No `status`, `tensionScore` or `reason` here. All three were declared as
  // "populated on resolution" and none ever was: the query below filters on
  // `status: "active"` and selects none of them, and neither `tensionScore`
  // nor `reason` is a column on `Encounter` at all. They only ever fed a
  // victory branch in the formatter that a resolved encounter could not reach,
  // because it arrives here as `null`.
}

export interface ContextCombatant {
  id: string;
  name: string;
  isPlayer: boolean;
  hp: number;
  maxHp: number;
  /** Armor Class — used for attack roll resolution. */
  ac: number;
  initiativeTotal: number;
  /** Stable zero-based identity indexed by currentTurnIndex. */
  initiativeOrder: number;
  /** Raw JSON string[] of active condition names. */
  conditions: Prisma.JsonValue;
  /** Raw JSON — { STR, DEX, CON, INT, WIS, CHA } */
  stats: Prisma.JsonValue;
  /** SRD damage modifiers, snapshotted at spawn. Empty for the player. */
  damageImmunities: string[];
  damageResistances: string[];
  damageVulnerabilities: string[];
  /** SRD condition immunities, snapshotted at spawn. Empty for the player. */
  conditionImmunities: string[];
  /** ID of the currently concentrated-on spell, or null. */
  concentrationSpellId: string | null;
  /** Grid column (0-based). Used by tactical movement validation. */
  x: number;
  /** Grid row (0-based). Used by tactical movement validation. */
  y: number;
  /** D&D 5e size category — determines footprint for collision detection. */
  size: string;
  /** Death saves while at 0 HP (death-saves spec §4). */
  deathSaveSuccesses: number;
  deathSaveFailures: number;
  /** Round a stable player wakes; null when not stable. */
  stableWakeRound: number | null;
}

export interface ContextLog {
  id: string;
  /** "user" | "assistant" | "system" */
  role: string;
  content: string;
  createdAt: Date;
}

export interface ContextQuest {
  id: string;
  title: string;
  description: string;
  /** "active" | "completed" | "failed" */
  status: string;
  createdAt: Date;
}

export interface ContextExplorationNode {
  index: number;
  name: string;
  description: string;
  feature: string;
  npcSeed: string | null;
  x: number;
  y: number;
}

export interface ContextExplorationEdge {
  fromIndex: number;
  toIndex: number;
  passageType: string;
}

export interface ContextExploration {
  location: { id: string; name: string; type: string; description: string } | null;
  currentNode: ContextExplorationNode | null;
  adjacentNodes: Array<{ node: ContextExplorationNode; passageType: string }>;
  /** Indices of nodes the party has visited (starts with current node index). */
  visitedNodeIndices: number[];
  allNodes: ContextExplorationNode[];
  allEdges: ContextExplorationEdge[];
}

/**
 * The NPC the party is currently facing, resolved from persisted state.
 *
 * Lives here rather than in the formatter because the formatter already
 * imports from this module; defining it there and importing it back would
 * invert the dependency.
 */
export interface ContextActiveNPC {
  name: string;
  /**
   * Who this person is, derived from the seed at creation. Nullable because
   * rows created before the NPC route persisted identity have none, and an
   * absent field must read as absent rather than blank.
   */
  race: string | null;
  profession: string | null;
  alignment: string | null;
  traits: NPCTraits | null;
  disposition: number | null;
  personalityTags: NPCPersonality | null;
  hasMetPlayer: boolean;
}

export interface CampaignContext {
  character: ContextCharacter;
  /** The current active encounter, or null if no combat is in progress. */
  activeEncounter: ContextEncounter | null;
  /** Up to 5 most recent log entries, oldest-first. */
  recentLogs: ContextLog[];
  /**
   * Top-2 semantically relevant MemoryEntry summaries for the current player
   * action. Empty array when no playerInput was provided or no memories exist.
   * Advisory context only — canonical state tables always take precedence.
   */
  relevantMemories: string[];
  /** All quests for this campaign, newest-first. Canonical state — never advisory. */
  quests: ContextQuest[];
  /** Active exploration location and navigation state, or null if not exploring. */
  currentExploration: ContextExploration | null;
  /**
   * The party's gold. Was an optional field on `FormatterContext` that nothing
   * ever supplied, so the narrator was told "Party Gold: 0 GP" at every
   * balance.
   */
  gold: number;
  /**
   * Authoritative list of NPCs currently present in the scene.
   * - In legacy mode (`scenePresenceVersion === 0`): holds 0 or 1 NPC resolved from `currentNode.npcSeed`.
   * - In canonical mode (`scenePresenceVersion >= 1`): holds all NPCs resolved from `CampaignSceneParticipant`.
   */
  activeNPCs: ContextActiveNPC[];
  /**
   * Single-NPC compatibility accessor.
   * Derived strictly from `activeNPCs[0] ?? null` to prevent dual sources of truth.
   */
  activeNPC: ContextActiveNPC | null;
}

interface CanonicalParticipantRecord {
  campaignId: string;
  npcId: string;
  npc?: {
    name: string;
    race: string | null;
    profession: string | null;
    alignment: string | null;
    traits: unknown;
    disposition: number | null;
    personalityTags: unknown;
    hasMetPlayer: boolean;
  } | null;
}

interface ScenePresenceReaderDb {
  campaignSceneParticipant?: {
    findMany(args: {
      where: { campaignId: string };
      orderBy?: { npcId: "asc" | "desc" };
      include?: {
        npc?:
          | boolean
          | {
              select?: Record<string, boolean>;
            };
        nPC?:
          | boolean
          | {
              select?: Record<string, boolean>;
            };
      };
    }): Promise<CanonicalParticipantRecord[]>;
  };
}

/**
 * Resolves authoritative scene participants from `CampaignSceneParticipant`.
 *
 * Used in canonical mode (`scenePresenceVersion >= 1`).
 * - Strictly queries `CampaignSceneParticipant` scoped by `campaignId`.
 * - Never consults legacy `currentNode.npcSeed`.
 * - Preserves all present NPCs in stable technical order (sorted by `npcId: "asc"`).
 * - Soft-failure on error: returns empty array rather than falling back to legacy data.
 */
async function fetchCanonicalActiveNPCs(
  campaignId: string
): Promise<ContextActiveNPC[]> {
  try {
    const db = prisma as unknown as ScenePresenceReaderDb;
    if (!db.campaignSceneParticipant?.findMany) {
      return [];
    }

    const participants = await db.campaignSceneParticipant.findMany({
      where: { campaignId },
      orderBy: { npcId: "asc" },
      include: {
        npc: {
          select: {
            name: true,
            race: true,
            profession: true,
            alignment: true,
            traits: true,
            disposition: true,
            personalityTags: true,
            hasMetPlayer: true,
          },
        },
      },
    });

    const result: ContextActiveNPC[] = [];
    for (const participant of participants) {
      const npc =
        participant.npc ??
        (participant as unknown as { nPC?: typeof participant.npc }).nPC;
      if (!npc) continue;
      result.push({
        name: npc.name,
        race: npc.race,
        profession: npc.profession,
        alignment: npc.alignment,
        traits: (npc.traits as NPCTraits | null) ?? null,
        disposition: npc.disposition,
        personalityTags: (npc.personalityTags as NPCPersonality | null) ?? null,
        hasMetPlayer: npc.hasMetPlayer,
      });
    }

    return result;
  } catch {
    return [];
  }
}

/**
 * Resolves the NPC the party is facing from the node they are standing in.
 *
 * `npcSeed` is the backend's own marker for "there is someone here" — the
 * formatter already prints it — so it is the signal that decides scope. No
 * client input and no model output reaches this.
 */
async function fetchActiveNPC(
  campaignId: string,
  exploration: ContextExploration | null
): Promise<ContextActiveNPC | null> {
  const seed = exploration?.currentNode?.npcSeed;
  if (!seed) return null;

  const npc = await prisma.nPC.findUnique({
    where: { campaignId_seed: { campaignId, seed } },
    select: {
      name: true,
      race: true,
      profession: true,
      alignment: true,
      traits: true,
      disposition: true,
      personalityTags: true,
      hasMetPlayer: true,
    },
  });
  if (!npc) return null;

  return {
    name: npc.name,
    race: npc.race,
    profession: npc.profession,
    alignment: npc.alignment,
    traits: (npc.traits as NPCTraits | null) ?? null,
    disposition: npc.disposition,
    personalityTags: (npc.personalityTags as NPCPersonality | null) ?? null,
    hasMetPlayer: npc.hasMetPlayer,
  };
}

// ---------------------------------------------------------------------------
// Assembly function
// ---------------------------------------------------------------------------

/**
 * Fetches the current exploration state for a campaign.
 * Returns null if the campaign has no active location.
 */
async function fetchExplorationContext(
  campaignId: string
): Promise<ContextExploration | null> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { currentLocationId: true, currentNodeId: true },
  });

  if (!campaign?.currentLocationId) return null;

  const location = await prisma.location.findUnique({
    where: { id: campaign.currentLocationId },
    include: {
      nodes: { orderBy: { index: "asc" } },
      edges: true,
    },
  });

  if (!location) return null;

  const nodeById = new Map(location.nodes.map((n) => [n.id, n]));

  const allEdges: ContextExplorationEdge[] = location.edges.map((e) => ({
    fromIndex: nodeById.get(e.fromNodeId)?.index ?? 0,
    toIndex: nodeById.get(e.toNodeId)?.index ?? 0,
    passageType: e.passageType,
  }));

  const allNodes: ContextExplorationNode[] = location.nodes.map((n) => ({
    index: n.index,
    name: n.name,
    description: n.description,
    feature: n.feature,
    npcSeed: n.npcSeed,
    x: n.x,
    y: n.y,
  }));

  const currentDbNode = campaign.currentNodeId
    ? nodeById.get(campaign.currentNodeId)
    : null;

  const currentNode: ContextExplorationNode | null = currentDbNode
    ? {
        index: currentDbNode.index,
        name: currentDbNode.name,
        description: currentDbNode.description,
        feature: currentDbNode.feature,
        npcSeed: currentDbNode.npcSeed,
        x: currentDbNode.x,
        y: currentDbNode.y,
      }
    : null;

  const adjacentNodes: Array<{ node: ContextExplorationNode; passageType: string }> =
    currentNode
      ? allEdges
          .filter(
            (e) =>
              e.fromIndex === currentNode.index ||
              e.toIndex === currentNode.index
          )
          .map((e) => {
            const adjIndex =
              e.fromIndex === currentNode.index ? e.toIndex : e.fromIndex;
            const adjNode = allNodes.find((n) => n.index === adjIndex);
            return adjNode
              ? { node: adjNode, passageType: e.passageType }
              : null;
          })
          .filter((entry): entry is { node: ContextExplorationNode; passageType: string } =>
            entry !== null
          )
      : [];

  return {
    location: {
      id: location.id,
      name: location.name,
      type: location.type,
      description: location.description,
    },
    currentNode,
    adjacentNodes,
    visitedNodeIndices: currentNode ? [currentNode.index] : [],
    allNodes,
    allEdges,
  };
}

/**
 * Assembles the full context snapshot for a campaign in parallel.
 *
 * @param campaignId  - The campaign to build context for.
 * @param playerInput - Optional: the current player action text. When provided,
 *                      the top-2 semantically relevant MemoryEntry summaries are
 *                      fetched and included in `relevantMemories`. When omitted
 *                      (e.g. non-action callers), `relevantMemories` is [].
 * @throws {Error} if the campaign does not exist.
 */
export async function buildCampaignContext(
  campaignId: string,
  playerInput?: string
): Promise<CampaignContext> {
  const [campaign, activeEncounter, recentLogsDesc, relevantMemories, quests, currentExploration] = await Promise.all([
    // Pillar 1: character with inventory
    (
      prisma.campaign as unknown as {
        findUnique(args: {
          where: { id: string };
          select: {
            gold: boolean;
            scenePresenceVersion: boolean;
            character: {
              select: Record<string, unknown>;
            };
          };
        }): Promise<{
          gold: number;
          scenePresenceVersion?: number | null;
          character: ContextCharacter;
        } | null>;
      }
    ).findUnique({
      where: { id: campaignId },
      select: {
        gold: true,
        scenePresenceVersion: true,
        character: {
          select: {
            id: true,
            name: true,
            race: true,
            class: true,
            level: true,
            hp: true,
            maxHp: true,
            xp: true,
            stats: true,
            spellSlots: true,
            skillProficiencies: true,
            concentrationSpellId: true,
            hitDiceTotal: true,
            hitDiceRemaining: true,
            exhaustionLevel: true,
            inventory: {
              select: {
                id: true,
                name: true,
                type: true,
                quantity: true,
                properties: true,
                equippedSlot: true,
              },
            },
          },
        },
      },
    }),

    // Pillar 2: active encounter with combatants (null if none)
    prisma.encounter.findFirst({
      where: { campaignId, status: "active" },
      select: {
        id: true,
        round: true,
        currentTurnIndex: true,
        currentTurnMovementSpentFt: true,
        currentTurnObjectInteractionUsed: true,
        totalDamageDealt: true,
        combatants: {
          select: {
            id: true,
            name: true,
            isPlayer: true,
            hp: true,
            maxHp: true,
            ac: true,
            initiativeTotal: true,
            initiativeOrder: true,
            conditions: true,
            stats: true,
            damageImmunities: true,
            damageResistances: true,
            damageVulnerabilities: true,
            conditionImmunities: true,
            concentrationSpellId: true,
            x: true,
            y: true,
            size: true,
            deathSaveSuccesses: true,
            deathSaveFailures: true,
            stableWakeRound: true,
          },
          orderBy: COMBATANT_INITIATIVE_ORDER,
        },
      },
    }),

    // Pillar 3: last 5 logs fetched desc, reversed to chronological order below
    prisma.gameLog.findMany({
      where: { campaignId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
      },
    }),

    // Pillar 4: semantic memory recall — top-2 entries relevant to this turn.
    // Only runs when a playerInput is provided. Failures are silently swallowed
    // so a memory retrieval error never blocks the action pipeline.
    playerInput
      ? searchMemories(campaignId, playerInput, 2)
          .then((raw) =>
            raw === "No relevant memories found." ? [] : raw.split("\n---\n")
          )
          .catch(() => [] as string[])
      : Promise.resolve([] as string[]),

    // Pillar 5: all quests for the campaign (canonical state, not advisory)
    prisma.quest.findMany({
      where: { campaignId },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, description: true, status: true, createdAt: true },
    }),

    // Pillar 6: active exploration state — location, current node, adjacent nodes.
    // Failures are silently swallowed so exploration never blocks the action pipeline.
    fetchExplorationContext(campaignId).catch(() => null),
  ]);

  if (!campaign) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }

  // Sequential, not part of the Promise.all above: the NPC(s) in scope are decided
  // by either CampaignSceneParticipant (canonical version >= 1) or currentNode.npcSeed
  // (legacy version 0). Failures are swallowed so a missing NPC never blocks the pipeline.
  const isCanonicalMode = (campaign.scenePresenceVersion ?? 0) >= 1;

  let activeNPCs: ContextActiveNPC[] = [];
  if (isCanonicalMode) {
    // Canonical mode: CampaignSceneParticipant is the ONLY source of truth.
    // Zero participants means empty scene — fail-closed, never falls back to legacy npcSeed.
    activeNPCs = await fetchCanonicalActiveNPCs(campaignId).catch(() => []);
  } else {
    // Legacy mode: resolves NPC from currentNode.npcSeed.
    const legacyNPC = await fetchActiveNPC(campaignId, currentExploration ?? null).catch(
      () => null
    );
    activeNPCs = legacyNPC ? [legacyNPC] : [];
  }

  return {
    character: campaign.character,
    gold: campaign.gold,
    activeNPCs,
    activeNPC: activeNPCs[0] ?? null,
    activeEncounter: activeEncounter ?? null,
    // Reverse so logs are oldest-first (natural reading order for AI context)
    recentLogs: recentLogsDesc.reverse(),
    quests,
    relevantMemories,
    currentExploration: currentExploration ?? null,
  };
}
