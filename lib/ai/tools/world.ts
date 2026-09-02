/**
 * lib/ai/tools/world.ts
 *
 * Vercel AI SDK tools: tavern names, mundane loot, and lore recall.
 *
 * Architecture contract ("Code is Law"):
 *   The backend equipment service is the authority for gear state changes.
 *   The AI tool requests the action and returns resolved facts for narration.
 */

import { tool } from "ai";
import { z } from "zod";
import { runTool } from "@/lib/ai/tool-result";
import { projectTavernName } from "@/lib/ai/read-only-projections";
import {
  generateTavernName,
  generateMundaneLoot,
  GetTavernNameInputSchema,
  GetMundaneLootInputSchema,
} from "@/lib/rules/generators";
import { searchMemories } from "@/lib/memory/search";

/**
 * Builds the world-flavour Vercel AI SDK tools bound to a specific campaign.
 */
export function buildWorldTools(campaignId: string) {
  return {
    getTavernName: tool({
      description:
        "Generate a deterministic reference tavern name for a location already identified and authorized by backend context. This result does not persist or establish a tavern.",
      inputSchema: GetTavernNameInputSchema,
      execute: async ({ locationId }) => {
        return runTool(() => projectTavernName(generateTavernName(locationId)));
      },
    }),
    getMundaneLoot: tool({
      description:
        "Get the deterministic mundane loot found on an entity or in a container.",
      inputSchema: GetMundaneLootInputSchema,
      execute: async ({ entityId }) => {
        return runTool(() => ({ loot: generateMundaneLoot(entityId) }));
      },
    }),
    recallLore: tool({
      description:
        "Search the campaign's semantic memory for lore, past events, or specific details. Use this when the player references something you don't have in your current context.",
      inputSchema: z.object({
        query: z.string().min(1).max(200),
      }).strict(),
      execute: async ({ query }) => {
        return runTool(async () => ({
          memories: await searchMemories(campaignId, query),
        }));
      },
    }),
  };
}
