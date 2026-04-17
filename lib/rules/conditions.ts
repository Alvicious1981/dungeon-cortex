/**
 * Condition Registry — Dungeon Cortex rules engine.
 *
 * Implements authoritative mechanics for 5e status effects.
 * Every condition has specific flags that modulate combat resolution.
 */

export interface ConditionRegistryEntry {
  id: string;
  name: string;
  /** Advantage derived from this condition when it applies to the combatant. */
  selfDisadvantageOnAttack?: boolean;
  selfAdvantageOnAttack?: boolean;
  /** Advantage derived from this condition when it applies to the target. */
  attackerAdvantage?: boolean;
  attackerDisadvantage?: boolean;
}

/**
 * The Standard 5e Condition Registry.
 *
 * This dictionary maps condition IDs (case-insensitive) to their mechanical
 * impacts on attack rolls and defenses.
 */
export const CONDITION_REGISTRY: Record<string, ConditionRegistryEntry> = {
  blinded: {
    id: "blinded",
    name: "Blinded",
    selfDisadvantageOnAttack: true,
    attackerAdvantage: true,
  },
  prone: {
    id: "prone",
    name: "Prone",
    selfDisadvantageOnAttack: true,
    // Note: Prone logic requires 'isMelee' check in evaluateAdvantage.
  },
  paralyzed: {
    id: "paralyzed",
    name: "Paralyzed",
    attackerAdvantage: true,
  },
  stunned: {
    id: "stunned",
    name: "Stunned",
    attackerAdvantage: true,
  },
  unconscious: {
    id: "unconscious",
    name: "Unconscious",
    attackerAdvantage: true,
  },
  restrained: {
    id: "restrained",
    name: "Restrained",
    selfDisadvantageOnAttack: true,
    attackerAdvantage: true,
  },
  invisible: {
    id: "invisible",
    name: "Invisible",
    selfAdvantageOnAttack: true,
    attackerDisadvantage: true,
  },
  frightened: {
    id: "frightened",
    name: "Frightened",
    selfDisadvantageOnAttack: true,
  },
};

/**
 * Evaluates the net advantage/disadvantage for an attack roll.
 *
 * Implements 5e RAW Neutralization:
 * If there is at least one source of advantage and at least one source of
 * disadvantage, they cancel out into a normal roll, regardless of the quantity.
 *
 * @param attackerConditions List of conditions currently affecting the attacker.
 * @param defenderConditions List of conditions currently affecting the defender.
 * @param isMelee True if the attack is a melee attack.
 */
export function evaluateAdvantage(
  attackerConditions: string[],
  defenderConditions: string[],
  isMelee: boolean
): { advantage: boolean; disadvantage: boolean } {
  let hasAdvantage = false;
  let hasDisadvantage = false;

  // 1. Process Attacker's own conditions.
  for (const condId of attackerConditions) {
    const entry = CONDITION_REGISTRY[condId.toLowerCase()];
    if (!entry) continue;

    if (entry.selfAdvantageOnAttack) hasAdvantage = true;
    if (entry.selfDisadvantageOnAttack) hasDisadvantage = true;
  }

  // 2. Process Defender's conditions (impact on attacker).
  for (const condId of defenderConditions) {
    const entry = CONDITION_REGISTRY[condId.toLowerCase()];
    if (!entry) continue;

    // Prone is a special case in 5e RAW:
    // Melee vs Prone = Advantage.
    // Ranged vs Prone = Disadvantage.
    if (condId.toLowerCase() === "prone") {
      if (isMelee) hasAdvantage = true;
      else hasDisadvantage = true;
      continue;
    }

    if (entry.attackerAdvantage) hasAdvantage = true;
    if (entry.attackerDisadvantage) hasDisadvantage = true;
  }

  // 3. Apply RAW Neutralization.
  if (hasAdvantage && hasDisadvantage) {
    return { advantage: false, disadvantage: false };
  }

  return { advantage: hasAdvantage, disadvantage: hasDisadvantage };
}
