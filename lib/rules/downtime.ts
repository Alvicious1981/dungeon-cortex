/**
 * OSR/AD&D 1e Downtime Rules Engine
 * Handles the logic required for Haven operations and Retainer upkeep.
 */

export type LivingExpenseResult = {
  totalCost: number;
  fundsRemaining: number;
  isBankrupt: boolean;
};

export type MoraleRollResult = {
  roll: number;
  total: number;
  success: boolean;
  newState: string;
};

/**
 * Calculates XP from gold deposited. Ratio is strictly 1:1.
 * 
 * @param goldDeposited The amount of gold physically brought to the haven and deposited.
 * @returns The amount of XP granted.
 */
export function convertGoldToXP(goldDeposited: number): number {
  if (goldDeposited <= 0) return 0;
  return goldDeposited; // 1:1 ratio strictly enforced
}

/**
 * Calculates living expenses for the passed days and deducts from current funds.
 * Base upkeep cost per character per day is 10 gp by default (from Haven.baseUpkeepCost).
 * 
 * @param currentFunds The party's current total wealth
 * @param baseUpkeepCost The Haven's required tax/upkeep cost per day per character
 * @param daysSpent Number of days spent in the Haven
 * @param partySize The number of party members that need upkeep (defaults to 1)
 * @returns An object containing the calculated cost, remaining funds, and bankruptcy flag
 */
export function payLivingExpenses(
  currentFunds: number,
  baseUpkeepCost: number,
  daysSpent: number,
  partySize: number = 1
): LivingExpenseResult {
  if (daysSpent < 0 || baseUpkeepCost < 0 || partySize < 0) {
    throw new Error('Invalid negative parameters for living expenses.');
  }

  const totalCost = baseUpkeepCost * daysSpent * partySize;
  const isBankrupt = currentFunds < totalCost;
  const fundsRemaining = isBankrupt ? 0 : currentFunds - totalCost;
  
  return {
    totalCost,
    fundsRemaining,
    isBankrupt
  };
}

/**
 * Rolls morale for a retainer based on a 2d6 scale.
 * Roll 2d6; if it's less than or equal to their loyalty, they succeed.
 * Modifiers decrease the base loyalty for this roll.
 * 
 * @param roll2d6 The purely injected random 2d6 roll (2-12).
 * @param baseLoyalty The retainer's base loyalty score.
 * @param unpaidWages Whether the party failed to pay their wage.
 * @param partyLeaderCharismaMod Charisma modifier of the party's primary negotiator.
 * @param recentTrauma Whether the party suffered major trauma (deaths, TPK, etc).
 * @returns Details on success and the resulting morale state.
 */
export function rollRetainerMorale(
  rollAndResult2d6: number,
  baseLoyalty: number,
  unpaidWages: boolean = false,
  partyLeaderCharismaMod: number = 0,
  recentTrauma: boolean = false
): MoraleRollResult {
  if (rollAndResult2d6 < 2 || rollAndResult2d6 > 12) {
    throw new Error('Invalid 2d6 roll: must be between 2 and 12');
  }

  let modifiedLoyalty = baseLoyalty + partyLeaderCharismaMod;
  
  // Negative modifiers lower their effective threshold for loyalty checks
  if (unpaidWages) modifiedLoyalty -= 2;
  if (recentTrauma) modifiedLoyalty -= 1;
  
  const success = rollAndResult2d6 <= modifiedLoyalty;
  
  let newState = "confident";
  
  // Failure states
  if (!success) {
    if (unpaidWages && rollAndResult2d6 >= 10) {
      newState = "hostile"; // Unpaid + very bad roll = open hostility
    } else {
      newState = "wavering"; // Just losing faith
    }
  }

  return {
    roll: rollAndResult2d6,
    total: modifiedLoyalty,
    success,
    newState
  };
}
