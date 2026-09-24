/**
 * lib/rules/navigation.ts
 *
 * World Navigation Rules — Deterministic movement between LocationNodes.
 * 
 * Design contract ("Code is Law"):
 *   Adjacency and passage state (locked, hidden) are enforced by this module.
 *   The AI narrator may only describe a move once this function returns success.
 */

import { Prisma } from "@prisma/client";
import { generateNodeContent } from "@/lib/rules/generator";
import { syncSceneParticipants } from "@/lib/rules/scene-presence-service";

export interface NavigationResult {
  success: boolean;
  error?: string;
  passageType?: string;
  targetNodeId?: string;
}

/**
 * Validates and executes a move between nodes in a Location.
 * 
 * @param tx          - Prisma transaction client for atomic state updates.
 * @param campaignId  - The campaign moving the party.
 * @param targetNodeNameOrId - The identifier or name of the destination node.
 */
export async function moveToNode(
  tx: Prisma.TransactionClient,
  campaignId: string,
  targetNodeNameOrId: string
): Promise<NavigationResult> {
  const campaign = await tx.campaign.findUnique({
    where: { id: campaignId },
    select: {
      currentLocationId: true,
      currentNodeId: true,
    }
  });

  if (!campaign || !campaign.currentLocationId || !campaign.currentNodeId) {
    return { success: false, error: "Party is not currently in a dungeon or location." };
  }

  // Fetch all nodes and edges for the current location
  const location = await tx.location.findUnique({
    where: { id: campaign.currentLocationId },
    include: {
      nodes: true,
      edges: true,
    }
  });

  if (!location) {
    return { success: false, error: "Location data could not be retrieved." };
  }

  // Find target node by ID or Name (case insensitive fuzzy match)
  const targetNode = location.nodes.find(n => 
    n.id === targetNodeNameOrId || 
    n.name.toLowerCase().includes(targetNodeNameOrId.toLowerCase())
  );

  if (!targetNode) {
    return { success: false, error: `Destination "${targetNodeNameOrId}" is not a recognized area in this location.` };
  }

  if (targetNode.id === campaign.currentNodeId) {
    return { success: true, targetNodeId: targetNode.id }; // Already there
  }

  // Check adjacency in the edge graph
  // Edges are bidirectional in the world, but stored once.
  const edge = location.edges.find(e => 
    (e.fromNodeId === campaign.currentNodeId && e.toNodeId === targetNode.id) ||
    (e.fromNodeId === targetNode.id && e.toNodeId === campaign.currentNodeId)
  );

  if (!edge) {
    return { success: false, error: "There is no direct path to that area from your current location." };
  }

  // Passage type validation
  const blockedTypes = ["locked", "hidden", "collapsed"];
  if (blockedTypes.includes(edge.passageType)) {
    let msg = "The way is blocked.";
    if (edge.passageType === "locked") msg = "The door is locked and requires a key or a check to pass.";
    if (edge.passageType === "hidden") msg = "You do not see an exit in that direction.";
    if (edge.passageType === "collapsed") msg = "The passage has collapsed and is impassable.";
    
    return { success: false, error: msg, passageType: edge.passageType };
  }

  // Atomically claim the exact origin state that was validated above. Two
  // concurrent moves may both read the same origin, but only one may update
  // the campaign while it still matches that origin.
  const movementClaim = await tx.campaign.updateMany({
    where: {
      id: campaignId,
      currentLocationId: campaign.currentLocationId,
      currentNodeId: campaign.currentNodeId,
    },
    data: { currentNodeId: targetNode.id },
  });

  if (movementClaim.count !== 1) {
    return {
      success: false,
      error: "Party position changed before this move could be applied.",
    };
  }

  // JIT content generation happens only after the movement claim succeeds and
  // remains inside the same transaction, so a losing move cannot mutate its
  // target node.
  await generateNodeContent(tx, targetNode.id);

  // Authoritative scene-presence synchronization commits atomically with the move.
  // Stale participants from the previous scene are cleared and new presence established.
  await syncSceneParticipants(tx, {
    campaignId,
    targetNodeNpcSeed: targetNode.npcSeed,
  });

  return { 
    success: true, 
    targetNodeId: targetNode.id, 
    passageType: edge.passageType 
  };
}
