import { tool } from "ai";
import { prisma } from "@/lib/db/prisma";
import { UseConsumableInputSchema } from "@/lib/rules/inventory";

export function buildInventoryTools(campaignId: string) {
  return {
    useConsumable: tool({
      description: "Consumes an inventory item (like a health potion) to apply its effects to a character. Removes 1 from quantity, or deletes the item if 0. Validates ownership and applies healing if applicable.",
      inputSchema: UseConsumableInputSchema,
      execute: async ({ characterId, itemName }) => {
        return await prisma.$transaction(async (tx) => {
          // 1. Verify the character
          const character = await tx.character.findUnique({
            where: { id: characterId }
          });

          if (!character) {
            return { success: false, error: "Character not found." };
          }

          // 2. Verify the character owns the item and quantity > 0
          const item = await tx.inventoryItem.findFirst({
            where: {
              characterId: characterId,
              name: {
                equals: itemName,
                mode: "insensitive"
              },
              quantity: { gt: 0 }
            }
          });

          if (!item) {
            return { success: false, error: `Item '${itemName}' not found in inventory or quantity is 0.` };
          }

          // 3. Apply the effect. Check for healing amount in properties.
          let hpRestored = 0;
          let newHp = character.hp;
          if (item.properties && typeof item.properties === "object") {
            const props = item.properties as any;
            if (props.healingAmount && typeof props.healingAmount === "number") {
              hpRestored = props.healingAmount;
              newHp = Math.min(character.maxHp, character.hp + hpRestored);
            }
          }

          // Update character HP if changed
          if (newHp !== character.hp) {
            await tx.character.update({
              where: { id: characterId },
              data: { hp: newHp }
            });
          }

          // 4. Deduct 1 from InventoryItem.quantity, or delete if it becomes 0
          if (item.quantity <= 1) {
            await tx.inventoryItem.delete({
              where: { id: item.id }
            });
          } else {
            await tx.inventoryItem.update({
              where: { id: item.id },
              data: { quantity: item.quantity - 1 }
            });
          }

          // 5. Return structured payload for the AI to narrate
          return {
            success: true,
            itemConsumed: item.name,
            hpRestored,
            currentHp: newHp,
            maxHp: character.maxHp
          };
        });
      }
    }),
  };
}
