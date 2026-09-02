/**
 * lib/ai/tools/world.ts
 *
 * Vercel AI SDK tool: mundane loot.
 *
 * Two siblings are gone. `getTavernName` was deleted in #113 as a rival to
 * `generateLocationName`, which already names taverns and persists the result.
 * `recallLore` was deleted here: it searched semantic memory on demand, but
 * `buildCampaignContext` already puts the relevant memories in the narrator's
 * context every turn, so the tool could only re-fetch what had arrived.
 *
 * (This header claimed "tavern names" for one PR after that name was deleted —
 * the symbol grep found the code and missed the prose.)
 */

import { tool } from "ai";
import { runTool } from "@/lib/ai/tool-result";
import {
  generateMundaneLoot,
  GetMundaneLootInputSchema,
} from "@/lib/rules/generators";

/**
 * Builds the world-flavour Vercel AI SDK tools.
 *
 * No campaign argument: `recallLore` was the only tool here that needed one,
 * and a parameter nothing reads is the defect this series exists to close.
 */
export function buildWorldTools() {
  return {
    getMundaneLoot: tool({
      description:
        "Get the deterministic mundane loot found on an entity or in a container.",
      inputSchema: GetMundaneLootInputSchema,
      execute: async ({ entityId }) => {
        return runTool(() => ({ loot: generateMundaneLoot(entityId) }));
      },
    }),
  };
}
