"use server";

import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { buildMerchantPayload, MerchantArchetype, TradeResult } from "@/lib/rules/trade";
import { revalidatePath } from "next/cache";

export async function executeTradeAction(
  campaignId: string,
  action: "buy" | "sell",
  itemIndex: number | undefined,
  inventoryItemId: string | undefined,
  quantity: number,
  npcSeed: string,
  archetype: MerchantArchetype
): Promise<TradeResult> {
  const user = await getAuthUser();
  if (!user) {
    return { success: false, action, itemName: "Unknown", quantity: 0, goldDelta: 0, newGoldBalance: 0, error: "Unauthorized" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const campaign = await tx.campaign.findUnique({
        where: { id: campaignId },
        include: { character: { include: { inventory: true } } },
      });
      if (!campaign || campaign.userId !== user.id) {
        throw new Error("Campaign not found or unauthorized.");
      }

      const merchantPayload = buildMerchantPayload(archetype, npcSeed);

      if (action === "buy") {
        if (itemIndex === undefined) throw new Error("Missing itemIndex for buy.");
        const mItem = merchantPayload.inventory[itemIndex];
        if (!mItem) throw new Error("Item not found in merchant inventory.");
        
        const totalCost = mItem.buyPriceGP * quantity;
        if (campaign.gold < totalCost) {
          throw new Error(`Insufficient gold. Needs ${totalCost}, has ${campaign.gold}.`);
        }

        const newCampaign = await tx.campaign.update({
          where: { id: campaignId },
          data: { gold: { decrement: totalCost } },
        });

        // Add to inventory
        // Stackable items (same name and type)
        const existing = campaign.character.inventory.find(i => i.name === mItem.name && i.type === mItem.type);
        if (existing) {
          await tx.inventoryItem.update({
            where: { id: existing.id },
            data: { quantity: { increment: quantity } }
          });
        } else {
          await tx.inventoryItem.create({
            data: {
              characterId: campaign.characterId,
              name: mItem.name,
              type: mItem.type,
              quantity,
              properties: mItem.properties as object,
            },
          });
        }

        // Add a game log entry so the AI knows about the transaction
        await tx.gameLog.create({
          data: {
            campaignId: campaignId,
            role: "system",
            content: `💰 Trade: Purchased ${quantity}x ${mItem.name} for ${totalCost} GP from ${merchantPayload.name}.`,
          }
        });

        return {
          success: true,
          action: "buy" as const,
          itemName: mItem.name,
          quantity,
          goldDelta: -totalCost,
          newGoldBalance: newCampaign.gold,
        };
      } else {
        if (!inventoryItemId) throw new Error("Missing inventoryItemId for sell.");
        const pItem = campaign.character.inventory.find(i => i.id === inventoryItemId);
        if (!pItem) throw new Error("Item not found in character inventory.");
        if (pItem.quantity < quantity) throw new Error("Insufficient quantity to sell.");

        const properties = pItem.properties as Record<string, unknown>;
        const baseValueGP = typeof properties.valueGP === "number" ? properties.valueGP : 0;
        const sellPriceGP = Math.max(1, Math.floor(baseValueGP * merchantPayload.sellModifier));
        const totalRevenue = sellPriceGP * quantity;

        const newCampaign = await tx.campaign.update({
          where: { id: campaignId },
          data: { gold: { increment: totalRevenue } },
        });

        if (pItem.quantity === quantity) {
          await tx.inventoryItem.delete({ where: { id: pItem.id } });
        } else {
          await tx.inventoryItem.update({
            where: { id: pItem.id },
            data: { quantity: { decrement: quantity } },
          });
        }

        // Add a game log entry
        await tx.gameLog.create({
          data: {
            campaignId: campaignId,
            role: "system",
            content: `💰 Trade: Sold ${quantity}x ${pItem.name} to ${merchantPayload.name} for ${totalRevenue} GP.`,
          }
        });

        return {
          success: true,
          action: "sell" as const,
          itemName: pItem.name,
          quantity,
          goldDelta: totalRevenue,
          newGoldBalance: newCampaign.gold,
        };
      }
    });

    revalidatePath(`/campaign/${campaignId}`);
    return result;
  } catch (error: any) {
    return {
      success: false,
      action,
      itemName: "Unknown",
      quantity,
      goldDelta: 0,
      newGoldBalance: 0,
      error: error.message || "Trade failed.",
    };
  }
}
