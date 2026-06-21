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
import { ManageEquipmentInputSchema } from "@/lib/rules/inventory";
import {
  EquipmentServiceError,
  equipCharacterItem,
} from "@/lib/rules/equipment-service";
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
        try {
          return generateTavernName(locationId);
        } catch {
          return JSON.stringify({ error: "Action failed mechanically. Narrate a brief failure or silence." });
        }
      },
    }),
    getMundaneLoot: tool({
      description:
        "Get the deterministic mundane loot found on an entity or in a container.",
      inputSchema: GetMundaneLootInputSchema,
      execute: async ({ entityId }) => {
        try {
          return generateMundaneLoot(entityId);
        } catch {
          return JSON.stringify({ error: "Action failed mechanically. Narrate a brief failure or silence." });
        }
      },
    }),
    recallLore: tool({
      description:
        "Search the campaign's semantic memory for lore, past events, or specific details. Use this when the player references something you don't have in your current context.",
      inputSchema: z.object({
        query: z.string().min(1).max(200),
      }).strict(),
      execute: async ({ query }) => {
        try {
          return await searchMemories(campaignId, query);
        } catch {
          return JSON.stringify({ error: "Memory recall failed mechanically." });
        }
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
        try {
          const result = await equipCharacterItem({
            campaignId,
            characterId,
            itemId,
            targetSlot,
          });

          return JSON.stringify({
            ok: true,
            itemId: result.itemId,
            targetSlot: result.targetSlot,
            itemName: result.itemName,
            facts: result.facts,
          });
        } catch (e) {
          if (e instanceof EquipmentServiceError) {
            return JSON.stringify({ error: e.message });
          }
          return JSON.stringify({ error: "Equipment update failed mechanically." });
        }
      },
    }),
  };
}
