/**
 * lib/ai/tools/world.ts
 *
 * Vercel AI SDK tool: manageEquipment
 *
 * Architecture contract ("Code is Law"):
 *   The backend equipment service is the authority for gear state changes.
 *   The AI tool requests the action and returns resolved facts for narration.
 */

import { tool } from "ai";
import { z } from "zod";
import { runTool } from "@/lib/ai/tool-result";
import { ManageEquipmentInputSchema } from "@/lib/rules/inventory";
import { equipCharacterItem } from "@/lib/rules/equipment-service";
import {
  generateTavernName,
  generateMundaneLoot,
  GetTavernNameInputSchema,
  GetMundaneLootInputSchema,
} from "@/lib/rules/generators";
import { searchMemories } from "@/lib/memory/search";

/**
 * Builds the manageEquipment Vercel AI SDK tool bound to a specific campaign.
 */
export function buildWorldTools(campaignId: string) {
  return {
    getTavernName: tool({
      description:
        "Get the canonical, deterministic name of a tavern for a given location ID.",
      inputSchema: GetTavernNameInputSchema,
      execute: async ({ locationId }) => {
        return runTool(() => ({ tavernName: generateTavernName(locationId) }));
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
    manageEquipment: tool({
      description:
        "Equip an item from the character's inventory into a specific gear slot. " +
        "Enforces slot exclusivity — the prior occupant of the slot is automatically unequipped. " +
        "Call this when the player explicitly equips, wields, dons, or switches a piece of gear. " +
        "NEVER narrate an item as equipped without calling this tool first.",
      inputSchema: ManageEquipmentInputSchema,
      execute: async ({ characterId, itemId, targetSlot }) => {
        return runTool(async () => {
          const result = await equipCharacterItem({
            campaignId,
            characterId,
            itemId,
            targetSlot,
          });

          return {
            itemId: result.itemId,
            targetSlot: result.targetSlot,
            itemName: result.itemName,
            facts: result.facts,
          };
        });
      },
    }),
  };
}
