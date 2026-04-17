/**
 * lib/ai/tools/world.ts
 *
 * Vercel AI SDK tool: manageEquipment
 *
 * Architecture contract ("Code is Law"):
 *   This tool is the sole authority for gear state changes.
 *   The AI narrator only voices the outcome of the equipment change.
 */

import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { equipItem, ManageEquipmentInputSchema } from "@/lib/rules/inventory";
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
          const rawItems = await prisma.inventoryItem.findMany({
            where: { characterId },
            select: {
              id: true,
              characterId: true,
              name: true,
              type: true,
              quantity: true,
              properties: true,
              equippedSlot: true,
            },
          });

          const updated = equipItem(itemId, targetSlot, rawItems);

          // Persist only items whose equippedSlot changed.
          const changed = updated.filter(
            (item, i) => item.equippedSlot !== rawItems[i].equippedSlot
          );
          await Promise.all(
            changed.map((item) =>
              prisma.inventoryItem.update({
                where: { id: item.id },
                data: { equippedSlot: item.equippedSlot ?? null },
              })
            )
          );

          const equippedItem = updated.find((i) => i.id === itemId);
          return JSON.stringify({
            ok: true,
            itemId,
            targetSlot,
            itemName: equippedItem?.name ?? itemId,
          });
        } catch (e) {
          if (e instanceof RangeError) {
            return JSON.stringify({ error: e.message });
          }
          return JSON.stringify({ error: "Equipment update failed mechanically." });
        }
      },
    }),
  };
}
