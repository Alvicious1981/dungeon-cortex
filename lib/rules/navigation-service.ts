import { prisma } from "@/lib/db/prisma";
import { EXPLORATION_XP } from "@/lib/rules/progression";

export type NavigationServiceErrorCode =
  | "CAMPAIGN_NOT_FOUND"
  | "CHARACTER_OWNERSHIP_MISMATCH"
  | "ACTIVE_LOCATION_NOT_FOUND"
  | "CURRENT_NODE_NOT_FOUND"
  | "DESTINATION_NODE_NOT_FOUND"
  | "DESTINATION_LOCATION_MISMATCH"
  | "NODES_NOT_CONNECTED"
  | "PASSAGE_BLOCKED"
  | "INVALID_DESTINATION";

export class NavigationServiceError extends Error {
  constructor(
    public readonly code: NavigationServiceErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "NavigationServiceError";
  }
}

interface NavigationCampaignRecord {
  id?: string;
  characterId?: string;
  currentLocationId?: string | null;
  currentNodeId?: string | null;
}

interface NavigationCharacterRecord {
  id: string;
  campaignId?: string | null;
}

interface NavigationLocationRecord {
  id: string;
  campaignId?: string;
}

export interface NavigationNodeRecord {
  id: string;
  locationId: string;
  index: number;
  name: string;
  description: string;
  feature: string;
  npcSeed?: string | null;
  featureData?: unknown;
  x?: number;
  y?: number;
}

interface NavigationEdgeRecord {
  id?: string;
  locationId: string;
  fromNodeId: string;
  toNodeId: string;
  passageType: string;
}

interface NavigationDb {
  $transaction?<T>(fn: (tx: NavigationDb) => Promise<T>): Promise<T>;
  campaign: {
    findUnique(args: {
      where: { id: string };
      select?: Record<string, boolean>;
    }): Promise<NavigationCampaignRecord | null | undefined>;
    update(args: {
      where: { id: string };
      data: { currentNodeId: string };
    }): Promise<NavigationCampaignRecord>;
  };
  character?: {
    findUnique(args: {
      where: { id: string };
      select?: Record<string, boolean>;
    }): Promise<NavigationCharacterRecord | null | undefined>;
  };
  location: {
    findUnique(args: {
      where: { id: string };
      select?: Record<string, boolean>;
    }): Promise<NavigationLocationRecord | null | undefined>;
  };
  locationNode: {
    findUnique(args: {
      where:
        | { id: string }
        | { locationId_index: { locationId: string; index: number } };
      select?: Record<string, boolean>;
    }): Promise<NavigationNodeRecord | null | undefined>;
  };
  locationEdge: {
    findMany(args: {
      where: { locationId: string };
      select?: Record<string, boolean>;
    }): Promise<NavigationEdgeRecord[]>;
  };
}

export interface MoveCampaignToNodeInput {
  campaignId: string;
  fromNodeId?: string;
  toNodeId?: string;
  toNodeIndex?: number;
  characterId?: string;
  tx?: NavigationDb;
  db?: NavigationDb;
}

export interface AdjacentNavigationNode {
  index: number;
  name: string;
  feature: string;
  passageType: string;
}

export interface NavigationExplorationXpHint {
  event: string;
  amount: number;
  reason: string;
}

export interface CampaignNodeMovedFacts {
  type: "campaign_node_moved";
  campaignId: string;
  characterId?: string;
  locationId: string;
  fromNodeId: string;
  fromNodeIndex: number;
  toNodeId: string;
  toNodeIndex: number;
  passageType: string;
}

export interface MoveCampaignToNodeResult {
  ok: true;
  campaignId: string;
  characterId?: string;
  fromNodeId: string;
  fromNodeIndex: number;
  toNodeId: string;
  toNodeIndex: number;
  locationId: string;
  passageType: string;
  targetNode: {
    id: string;
    index: number;
    name: string;
    description: string;
    feature: string;
    npcSeed?: string | null;
    featureData?: unknown;
    x?: number;
    y?: number;
  };
  adjacentNodes: AdjacentNavigationNode[];
  explorationXPHints: NavigationExplorationXpHint[];
  facts: CampaignNodeMovedFacts;
}

const navigationNodeSelect = {
  id: true,
  locationId: true,
  index: true,
  name: true,
  description: true,
  feature: true,
  npcSeed: true,
  featureData: true,
  x: true,
  y: true,
};

function resolveDb(input: MoveCampaignToNodeInput): NavigationDb {
  return input.tx ?? input.db ?? (prisma as unknown as NavigationDb);
}

function assertDestinationInput(input: MoveCampaignToNodeInput): void {
  if (!input.toNodeId && input.toNodeIndex === undefined) {
    throw new NavigationServiceError(
      "INVALID_DESTINATION",
      "A destination node id or index is required."
    );
  }

  if (
    input.toNodeIndex !== undefined &&
    (!Number.isInteger(input.toNodeIndex) || input.toNodeIndex < 0)
  ) {
    throw new NavigationServiceError(
      "INVALID_DESTINATION",
      `Invalid destination node index: ${input.toNodeIndex}`
    );
  }
}

async function findDestinationNode(
  db: NavigationDb,
  locationId: string,
  input: MoveCampaignToNodeInput
): Promise<NavigationNodeRecord | null | undefined> {
  if (input.toNodeId) {
    return db.locationNode.findUnique({
      where: { id: input.toNodeId },
      select: navigationNodeSelect,
    });
  }

  return db.locationNode.findUnique({
    where: {
      locationId_index: {
        locationId,
        index: input.toNodeIndex!,
      },
    },
    select: navigationNodeSelect,
  });
}

function findConnectingEdge(
  edges: NavigationEdgeRecord[],
  fromNodeId: string,
  toNodeId: string
): NavigationEdgeRecord | undefined {
  return edges.find(
    (edge) =>
      (edge.fromNodeId === fromNodeId && edge.toNodeId === toNodeId) ||
      (edge.fromNodeId === toNodeId && edge.toNodeId === fromNodeId)
  );
}

function isBlockedPassage(passageType: string): boolean {
  return passageType === "locked" || passageType === "hidden" || passageType === "collapsed";
}

function blockedPassageMessage(passageType: string): string {
  if (passageType === "locked") {
    return "The passage is locked. A key, lockpick check, or force is required.";
  }
  if (passageType === "hidden") {
    return "The passage is hidden. A Search or Perception check is required to find it.";
  }
  return "The passage is blocked and cannot be crossed.";
}

async function assertCharacterOwnership(
  db: NavigationDb,
  campaign: NavigationCampaignRecord,
  input: MoveCampaignToNodeInput
): Promise<string | undefined> {
  const characterId = input.characterId ?? campaign.characterId;
  if (!input.characterId) return characterId;

  if (campaign.characterId && campaign.characterId !== input.characterId) {
    throw new NavigationServiceError(
      "CHARACTER_OWNERSHIP_MISMATCH",
      `Character ${input.characterId} does not belong to campaign ${input.campaignId}.`
    );
  }

  if (db.character) {
    const character = await db.character.findUnique({
      where: { id: input.characterId },
      select: { id: true, campaignId: true },
    });
    if (!character || (character.campaignId && character.campaignId !== input.campaignId)) {
      throw new NavigationServiceError(
        "CHARACTER_OWNERSHIP_MISMATCH",
        `Character ${input.characterId} does not belong to campaign ${input.campaignId}.`
      );
    }
  }

  return characterId;
}

function buildExplorationXpHints(node: NavigationNodeRecord): NavigationExplorationXpHint[] {
  const hints: NavigationExplorationXpHint[] = [
    {
      event: "node_discovery",
      amount: EXPLORATION_XP.node_discovery,
      reason: `First visit to ${node.name}`,
    },
  ];

  if (node.feature === "hazard") {
    hints.push({
      event: "hazard_survived",
      amount: EXPLORATION_XP.hazard_survived,
      reason: `Survived the hazard in ${node.name}`,
    });
  } else if (node.feature === "exit") {
    hints.push({
      event: "exit_reached",
      amount: EXPLORATION_XP.exit_reached,
      reason: `Reached the exit at ${node.name}`,
    });
  } else if (node.feature === "treasure") {
    hints.push({
      event: "treasure_found",
      amount: EXPLORATION_XP.treasure_found,
      reason: `Discovered treasure in ${node.name}`,
    });
  } else if (node.feature === "quest_hook") {
    hints.push({
      event: "quest_hook_found",
      amount: EXPLORATION_XP.quest_hook_found,
      reason: `Found a quest hook in ${node.name}`,
    });
  }

  return hints;
}

async function buildAdjacentNodes(
  db: NavigationDb,
  locationId: string,
  targetNodeId: string
): Promise<AdjacentNavigationNode[]> {
  const edges = await db.locationEdge.findMany({
    where: { locationId },
    select: { locationId: true, fromNodeId: true, toNodeId: true, passageType: true },
  });

  const adjacentNodes: AdjacentNavigationNode[] = [];
  for (const edge of edges) {
    if (edge.fromNodeId !== targetNodeId && edge.toNodeId !== targetNodeId) continue;

    const adjacentId = edge.fromNodeId === targetNodeId ? edge.toNodeId : edge.fromNodeId;
    const adjacentNode = await db.locationNode.findUnique({
      where: { id: adjacentId },
      select: navigationNodeSelect,
    });
    if (!adjacentNode || adjacentNode.locationId !== locationId) continue;

    adjacentNodes.push({
      index: adjacentNode.index,
      name: adjacentNode.name,
      feature: adjacentNode.feature,
      passageType: edge.passageType,
    });
  }

  return adjacentNodes;
}

async function moveCampaignToNodeInTransaction(
  db: NavigationDb,
  input: MoveCampaignToNodeInput
): Promise<MoveCampaignToNodeResult> {
  assertDestinationInput(input);

  const campaign = await db.campaign.findUnique({
    where: { id: input.campaignId },
    select: {
      id: true,
      characterId: true,
      currentLocationId: true,
      currentNodeId: true,
    },
  });
  if (!campaign) {
    throw new NavigationServiceError(
      "CAMPAIGN_NOT_FOUND",
      `Campaign not found: ${input.campaignId}`
    );
  }

  const characterId = await assertCharacterOwnership(db, campaign, input);

  if (!campaign.currentLocationId) {
    throw new NavigationServiceError(
      "ACTIVE_LOCATION_NOT_FOUND",
      "No active location. Call generateLocation first."
    );
  }

  const location = await db.location.findUnique({
    where: { id: campaign.currentLocationId },
    select: { id: true, campaignId: true },
  });
  if (!location) {
    throw new NavigationServiceError(
      "ACTIVE_LOCATION_NOT_FOUND",
      "Active location not found in database."
    );
  }
  if (location.campaignId && location.campaignId !== input.campaignId) {
    throw new NavigationServiceError(
      "ACTIVE_LOCATION_NOT_FOUND",
      "Active location does not belong to campaign."
    );
  }

  const fromNodeId = input.fromNodeId ?? campaign.currentNodeId;
  if (!fromNodeId) {
    throw new NavigationServiceError("CURRENT_NODE_NOT_FOUND", "Current node not found.");
  }

  const currentNode = await db.locationNode.findUnique({
    where: { id: fromNodeId },
    select: navigationNodeSelect,
  });
  if (!currentNode || currentNode.locationId !== campaign.currentLocationId) {
    throw new NavigationServiceError("CURRENT_NODE_NOT_FOUND", "Current node not found.");
  }

  const targetNode = await findDestinationNode(db, campaign.currentLocationId, input);
  if (!targetNode) {
    throw new NavigationServiceError(
      "DESTINATION_NODE_NOT_FOUND",
      input.toNodeIndex === undefined
        ? "Destination node not found."
        : `Node index ${input.toNodeIndex} not found in location.`
    );
  }
  if (targetNode.locationId !== campaign.currentLocationId) {
    throw new NavigationServiceError(
      "DESTINATION_LOCATION_MISMATCH",
      "Destination node does not belong to the active location."
    );
  }

  const edges = await db.locationEdge.findMany({
    where: { locationId: campaign.currentLocationId },
    select: { locationId: true, fromNodeId: true, toNodeId: true, passageType: true },
  });
  const connectingEdge =
    currentNode.id === targetNode.id
      ? {
          locationId: campaign.currentLocationId,
          fromNodeId: currentNode.id,
          toNodeId: targetNode.id,
          passageType: "open",
        }
      : findConnectingEdge(edges, currentNode.id, targetNode.id);

  if (!connectingEdge) {
    throw new NavigationServiceError(
      "NODES_NOT_CONNECTED",
      `Node ${targetNode.index} is not adjacent to current node ${currentNode.index}.`,
      {
        currentNodeIndex: currentNode.index,
        targetNodeIndex: targetNode.index,
      }
    );
  }

  if (isBlockedPassage(connectingEdge.passageType)) {
    throw new NavigationServiceError(
      "PASSAGE_BLOCKED",
      blockedPassageMessage(connectingEdge.passageType),
      { passageType: connectingEdge.passageType }
    );
  }

  await db.campaign.update({
    where: { id: input.campaignId },
    data: { currentNodeId: targetNode.id },
  });

  const adjacentNodes = await buildAdjacentNodes(
    db,
    campaign.currentLocationId,
    targetNode.id
  );

  const facts: CampaignNodeMovedFacts = {
    type: "campaign_node_moved",
    campaignId: input.campaignId,
    characterId,
    locationId: campaign.currentLocationId,
    fromNodeId: currentNode.id,
    fromNodeIndex: currentNode.index,
    toNodeId: targetNode.id,
    toNodeIndex: targetNode.index,
    passageType: connectingEdge.passageType,
  };

  return {
    ok: true,
    campaignId: input.campaignId,
    characterId,
    fromNodeId: currentNode.id,
    fromNodeIndex: currentNode.index,
    toNodeId: targetNode.id,
    toNodeIndex: targetNode.index,
    locationId: campaign.currentLocationId,
    passageType: connectingEdge.passageType,
    targetNode: {
      id: targetNode.id,
      index: targetNode.index,
      name: targetNode.name,
      description: targetNode.description,
      feature: targetNode.feature,
      npcSeed: targetNode.npcSeed,
      featureData: targetNode.featureData,
      x: targetNode.x,
      y: targetNode.y,
    },
    adjacentNodes,
    explorationXPHints: buildExplorationXpHints(targetNode),
    facts,
  };
}

export async function moveCampaignToNode(
  input: MoveCampaignToNodeInput
): Promise<MoveCampaignToNodeResult> {
  const db = resolveDb(input);

  if (input.tx || !db.$transaction) {
    return moveCampaignToNodeInTransaction(db, input);
  }

  return db.$transaction((tx) => moveCampaignToNodeInTransaction(tx, input));
}