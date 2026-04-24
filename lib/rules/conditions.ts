/**
 * Condition Registry — Dungeon Cortex rules engine.
 *
 * Implements authoritative mechanics for 5e status effects.
 * Every condition has specific flags that modulate combat resolution.
 *
 * Canon: D&D 5e 2014 SRD — all 15 standard conditions.
 * Source of truth for condition validation: SrdCondition DB table (seeded via
 * scripts/seed-conditions.ts). This registry is the compile-time guard.
 */

export interface ConditionRegistryEntry {
  id: string;
  name: string;
  /** Disadvantage on attack rolls when the combatant has this condition. */
  selfDisadvantageOnAttack?: boolean;
  /** Advantage on attack rolls when the combatant has this condition. */
  selfAdvantageOnAttack?: boolean;
  /** Attackers gain advantage against a target with this condition. */
  attackerAdvantage?: boolean;
  /** Attackers suffer disadvantage against a target with this condition. */
  attackerDisadvantage?: boolean;
  /** Combatant cannot take actions or reactions. */
  incapacitated?: boolean;
}

/**
 * The complete D&D 5e 2014 SRD Condition Registry (all 15 conditions).
 *
 * Maps lowercase condition slugs to their mechanical impacts.
 * Used as the compile-time validation set in isKnownCondition().
 * Attack-roll modifiers are consumed by evaluateAdvantage().
 */
export const CONDITION_REGISTRY: Record<string, ConditionRegistryEntry> = {
  // ── Attack-roll modifiers ─────────────────────────────────────────────────
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
    // Prone melee vs ranged is handled in evaluateAdvantage — see the isMelee branch.
  },
  paralyzed: {
    id: "paralyzed",
    name: "Paralyzed",
    attackerAdvantage: true,
    incapacitated: true,
  },
  petrified: {
    id: "petrified",
    name: "Petrified",
    attackerAdvantage: true,
    incapacitated: true,
  },
  stunned: {
    id: "stunned",
    name: "Stunned",
    attackerAdvantage: true,
    incapacitated: true,
  },
  unconscious: {
    id: "unconscious",
    name: "Unconscious",
    attackerAdvantage: true,
    incapacitated: true,
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
  poisoned: {
    id: "poisoned",
    name: "Poisoned",
    selfDisadvantageOnAttack: true,
  },
  // ── No direct attack-roll modifier (tracked for state completeness) ────────
  charmed: {
    id: "charmed",
    name: "Charmed",
    // Cannot attack the charmer — enforced at intent-parse level, not roll level.
  },
  deafened: {
    id: "deafened",
    name: "Deafened",
    // No attack-roll modifier per 5e 2014 SRD.
  },
  exhaustion: {
    id: "exhaustion",
    name: "Exhaustion",
    // Level-dependent penalties tracked via Character.exhaustionLevel, not this flag.
  },
  grappled: {
    id: "grappled",
    name: "Grappled",
    // Speed 0; no direct attack-roll modifier per 5e 2014 SRD.
  },
  incapacitated: {
    id: "incapacitated",
    name: "Incapacitated",
    incapacitated: true,
  },
};

/**
 * Returns true when `conditionId` is a recognized D&D 5e 2014 SRD condition.
 *
 * This is a synchronous compile-time guard. DB-level validation
 * (SrdCondition table) is performed asynchronously at the route/pipeline layer.
 *
 * Comparison is case-insensitive.
 */
export function isKnownCondition(conditionId: string): boolean {
  return conditionId.toLowerCase() in CONDITION_REGISTRY;
}

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
