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
import type { Prisma } from "@/app/generated/prisma/client";
import { searchMemories } from "@/lib/memory/search";

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
  /** ID of the currently concentrated-on spell, or null. */
  concentrationSpellId: string | null;
  inventory: ContextInventoryItem[];
}

export interface ContextInventoryItem {
  id: string;
  name: string;
  type: string;
  quantity: number;
  properties: Prisma.JsonValue;
}

export interface ContextEncounter {
  id: string;
  round: number;
  currentTurnIndex: number;
  /** Ordered by initiativeTotal DESC — index 0 acts first. */
  combatants: ContextCombatant[];
  /** Encounter lifecycle status. "active" | "resolved" | "fled". */
  status?: string;
  /**
   * Final Tension Score [0..1] at encounter end.
   * Populated when the encounter transitions to "resolved".
   * Used by the formatter to inject the Victory trigger section.
   */
  tensionScore?: number | null;
  /** Resolution reason — "all_enemies_dead" | "fled" | etc. Populated on resolution. */
  reason?: string;
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
  /** Raw JSON string[] of active condition names. */
  conditions: Prisma.JsonValue;
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
    prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
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
            concentrationSpellId: true,
            inventory: {
              select: {
                id: true,
                name: true,
                type: true,
                quantity: true,
                properties: true,
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
        combatants: {
          select: {
            id: true,
            name: true,
            isPlayer: true,
            hp: true,
            maxHp: true,
            ac: true,
            initiativeTotal: true,
            conditions: true,
          },
          orderBy: { initiativeTotal: "desc" },
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

  return {
    character: campaign.character,
    activeEncounter: activeEncounter ?? null,
    // Reverse so logs are oldest-first (natural reading order for AI context)
    recentLogs: recentLogsDesc.reverse(),
    quests,
    relevantMemories,
    currentExploration: currentExploration ?? null,
  };
}
