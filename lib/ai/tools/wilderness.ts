/**
 * lib/ai/tools/wilderness.ts
 *
 * Vercel AI SDK tool: executeTravelWatch
 *
 * Architecture contract ("Code is Law"):
 *   This tool parses AI tool input, delegates resolution to wilderness-service,
 *   and returns already resolved structured facts for narration.
 */

import { tool } from "ai";
import { runTool } from "@/lib/ai/tool-result";
import { TravelWatchInputSchema } from "@/lib/rules/wilderness";
import {
  extractSurvivalMod,
  generateHexTerrain,
  getWatchName,
  makeHexSeed,
  resolveTravelWatch,
  type HexTerrainData,
} from "@/lib/rules/wilderness-service";

export {
  extractSurvivalMod,
  generateHexTerrain,
  getWatchName,
  makeHexSeed,
  type HexTerrainData,
};

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

/**
 * Builds the executeTravelWatch Vercel AI SDK tool bound to a specific campaign.
 *
 * Called by buildTools() in lib/ai/narrator.ts. The campaignId is closed over
 * so the AI never receives it as input (no injection surface).
 */
export function buildWildernessTool(campaignId: string) {
  return tool({
    description:
      "Advance the wilderness clock by one watch (4 hours) for the given overworld action. " +
      "MUST be called for every action in the overworld — traveling, foraging, resting, " +
      "making camp, or scouting. " +
      "Returns hex discovery state, weather, ration status, encounter trigger, and warnings. " +
      "NEVER narrate hex discovery, terrain, weather changes, ration loss, or encounters " +
      "without calling this tool first. " +
      "The hex does not exist for the party until WildernessMap.discovered is true — " +
      "NEVER describe an undiscovered hex. " +
      "If `restRequired` is true, the NEXT action MUST be action='rest'. " +
      "Voice `warnings[]` diegetically. Code is Law.",

    inputSchema: TravelWatchInputSchema,

    execute: async ({ action, direction, pace }) => {
      return runTool(() =>
        resolveTravelWatch({
          campaignId,
          action,
          direction,
          pace,
        }),
      );
    },
  });
}
