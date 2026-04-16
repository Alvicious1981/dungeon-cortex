import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { 
  convertGoldToXP, 
  payLivingExpenses, 
  rollRetainerMorale 
} from "@/lib/rules/downtime";

export function buildDowntimeTool() {
  return tool({
    description: "Executes downtime operations at a Haven: pays living expenses, converts gold to XP, and updates retainer morale.",
    inputSchema: z.object({
      campaignId: z.string().describe("The ID of the campaign."),
      characterId: z.string().describe("The ID of the character gaining XP."),
      havenUpkeepCost: z.number().describe("The daily upkeep cost of the haven."),
      daysSpent: z.number().describe("The number of days spent resting in the haven."),
      goldDeposited: z.number().describe("The amount of gold deposited to convert into XP."),
      partySize: z.number().optional().default(1).describe("The number of characters paying upkeep."),
      retainerMoraleChecks: z.array(z.object({
        retainerId: z.string(),
        baseLoyalty: z.number(),
        roll2d6: z.number().min(2).max(12),
        unpaidWages: z.boolean().optional().default(false),
        partyLeaderCharismaMod: z.number().optional().default(0),
        recentTrauma: z.boolean().optional().default(false)
      })).optional().default([])
    }),
    execute: async ({
      campaignId,
      characterId,
      havenUpkeepCost,
      daysSpent,
      goldDeposited,
      partySize,
      retainerMoraleChecks
    }) => {
      return await prisma.$transaction(async (tx) => {
        // Fetch campaign to get current party gold/wealth
        const campaign = await tx.campaign.findUnique({
          where: { id: campaignId }
        });
        
        if (!campaign) {
          throw new Error(`Campaign not found: ${campaignId}`);
        }

        // Calculate expenses
        const expenseResult = payLivingExpenses(campaign.gold, havenUpkeepCost, daysSpent, partySize);
        
        // Calculate XP from gold deposited
        const xpGained = convertGoldToXP(goldDeposited);
        
        // Final wealth deducting living expenses and the gold deposited for XP
        const finalWealth = Math.max(0, expenseResult.fundsRemaining - goldDeposited);

        // Update Campaign Gold (wealth)
        await tx.campaign.update({
          where: { id: campaignId },
          data: { gold: finalWealth }
        });

        // Update Character XP
        const updatedCharacter = await tx.character.update({
          where: { id: characterId },
          data: { xp: { increment: xpGained } }
        });

        // Resolve Retainers Morale
        const processedRetainers = [];
        for (const check of retainerMoraleChecks) {
          const result = rollRetainerMorale(
            check.roll2d6,
            check.baseLoyalty,
            check.unpaidWages,
            check.partyLeaderCharismaMod,
            check.recentTrauma
          );

          const updatedRetainer = await tx.retainer.update({
            where: { id: check.retainerId },
            data: { moraleState: result.newState }
          });

          processedRetainers.push({
            retainerId: updatedRetainer.id,
            name: updatedRetainer.name,
            roll: result.roll,
            success: result.success,
            newState: result.newState
          });
        }

        return {
          expenses: {
            totalCost: expenseResult.totalCost,
            isBankrupt: expenseResult.isBankrupt
          },
          goldDeposited,
          xpGained,
          characterXpTotal: updatedCharacter.xp,
          partyGoldRemaining: finalWealth,
          retainerMoraleResults: processedRetainers,
          message: "Downtime resolved successfully."
        };
      });
    }
  });
}
