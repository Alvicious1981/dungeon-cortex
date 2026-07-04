import { tool } from "ai";
import {
  GenerateLocationInputSchema,
  MoveToNodeInputSchema,
  ExplorationTurnInputSchema,
} from "@/lib/rules/exploration";
import { generateExplorationLocation } from "@/lib/rules/exploration-service";
import { resolveExplorationTurn } from "@/lib/rules/exploration-turn-service";
import { moveCampaignToNode, NavigationServiceError } from "@/lib/rules/navigation-service";

export function buildExplorationTools(campaignId: string) {
  return {
    generateLocation: tool({
      description:
        "Generate a new procedural location when the player travels, explores, " +
        "or enters a new area. Creates a persistent graph of interconnected rooms/zones " +
        "that the player navigates node-by-node. " +
        "MUST be called BEFORE narrating any new environment. " +
        "NEVER describe rooms, exits, NPCs, or spatial layout that isn't in the response. " +
        "The returned nodes define the ONLY rooms that exist. Code is Law.",
      inputSchema: GenerateLocationInputSchema,
      execute: async ({ locationType, seed, parentLocationId }) => {
        try {
          const result = await generateExplorationLocation({
            campaignId,
            locationType,
            seed,
            parentLocationId,
          });

          return JSON.stringify(result);
        } catch {
          return JSON.stringify({ error: "Location generation failed mechanically." });
        }
      },
    }),

    moveToNode: tool({
      description:
        "Move the player to an adjacent node within the current location. " +
        "The target node MUST be connected to the current node via an edge. " +
        "Call this when the player declares movement to a specific room or area. " +
        "After calling, narrate the movement and the destination using the returned node data. " +
        "NEVER describe a room the player hasn't moved to. Code is Law.",
      inputSchema: MoveToNodeInputSchema,
      execute: async ({ targetNodeIndex }) => {
        try {
          const result = await moveCampaignToNode({
            campaignId,
            toNodeIndex: targetNodeIndex,
          });

          return JSON.stringify({
            ok: true,
            targetNode: result.targetNode,
            adjacentNodes: result.adjacentNodes,
            passageType: result.passageType,
            explorationXPHints: result.explorationXPHints,
            facts: result.facts,
          });
        } catch (error) {
          if (error instanceof NavigationServiceError) {
            return JSON.stringify({
              error: error.message,
              code: error.code,
              ...error.details,
            });
          }

          return JSON.stringify({ error: "Movement failed mechanically." });
        }
      },
    }),
    executeExplorationTurn: tool({
      description:
        "Advance the dungeon clock by one exploration turn (10 minutes) for the given action. " +
        "MUST be called for every dungeon action the party takes — moving, searching, resting, " +
        "interacting, or making noise. " +
        "Handles torch/lantern burn, ration consumption, random encounter checks, " +
        "and mandatory rest enforcement automatically. " +
        "NEVER narrate the passage of time, torch burn, ration loss, exhaustion, or encounters " +
        "without calling this tool first. " +
        "If the response contains `restRequired: true`, the NEXT call MUST use action='rest'. " +
        "Voice the returned `warnings[]` diegetically. Code is Law.",
      inputSchema: ExplorationTurnInputSchema,
      execute: async ({ action, turnsToAdvance }) => {
        try {
          const result = await resolveExplorationTurn({
            campaignId,
            turnAction: action,
            turnsToAdvance,
          });
          return JSON.stringify(result);
        } catch {
          return JSON.stringify({ error: "Exploration turn failed mechanically. The moment hangs suspended." });
        }
      },
    }),
  };
}

