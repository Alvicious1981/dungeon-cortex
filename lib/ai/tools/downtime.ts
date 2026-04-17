import { tool } from "ai";
import { prisma } from "@/lib/db/prisma";
import { 
  convertGoldToXP, 
  payLivingExpenses, 
  rollRetainerMorale,
  ResolveDowntimeInputSchema,
} from "@/lib/rules/downtime";

export function buildDowntimeTools(campaignId: string) {
  return {
    resolveDowntime: tool({
    description:
      "Resolve haven downtime mechanically: living expenses, gold-to-XP conversion, and retainer morale updates. " +
      "Use this when the party rests in a haven, pays upkeep, or deposits gold for XP. " +
      "NEVER narrate gold, XP, or morale changes before this tool confirms them.",
    inputSchema: ResolveDowntimeInputSchema,
    execute: async ({
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
    },
    }),
  };
}
