import { tool } from "ai";
import { runTool } from "@/lib/ai/tool-result";
import { useConsumableItem as consumeInventoryItem } from "@/lib/rules/consumable-service";
import { UseConsumableInputSchema } from "@/lib/rules/inventory";

export function buildInventoryTools(campaignId: string) {
  return {
    useConsumable: tool({
      description: "Requests consumption of an inventory item and returns backend-resolved facts for narration.",
      inputSchema: UseConsumableInputSchema,
      execute: async ({ characterId, itemName }) => {
        return runTool(async () => {
          const result = await consumeInventoryItem({
            campaignId,
            characterId,
            itemName,
          });

          return {
            itemConsumed: result.itemName,
            hpRestored: result.hpRestored,
            currentHp: result.currentHp,
            maxHp: result.maxHp,
            facts: result.facts,
          };
        });
      },
    }),
  };
}
