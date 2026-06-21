import { tool } from "ai";
import {
  ConsumableServiceError,
  useConsumableItem,
} from "@/lib/rules/consumable-service";
import { UseConsumableInputSchema } from "@/lib/rules/inventory";

export function buildInventoryTools(campaignId: string) {
  return {
    useConsumable: tool({
      description: "Requests consumption of an inventory item and returns backend-resolved facts for narration.",
      inputSchema: UseConsumableInputSchema,
      execute: async ({ characterId, itemName }) => {
        try {
          const result = await useConsumableItem({
            campaignId,
            characterId,
            itemName,
          });

          return {
            success: true,
            itemConsumed: result.itemName,
            hpRestored: result.hpRestored,
            currentHp: result.currentHp,
            maxHp: result.maxHp,
            facts: result.facts,
          };
        } catch (error) {
          if (error instanceof ConsumableServiceError) {
            return {
              success: false,
              error: error.code,
            };
          }

          throw error;
        }
      }
    }),
  };
}
