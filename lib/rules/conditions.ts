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
  /**
   * Disadvantage on the creature's own ability checks.
   *
   * Distinct from `selfDisadvantageOnAttack`: the SRD applies these to different
   * sets of conditions, so a single flag cannot serve both. Poisoned imposes
   * both; Restrained imposes only the attack penalty.
   */
  selfDisadvantageOnAbilityCheck?: boolean;
  /**
   * The creature is unaware of its surroundings and cannot notice anything.
   *
   * Reserved for the two conditions whose SRD text says exactly that. It is not
   * a synonym for `incapacitated`: a stunned creature cannot act but is still
   * watching the room.
   */
  unawareOfSurroundings?: boolean;
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
    // SRD: "the creature ... is unaware of its surroundings".
    unawareOfSurroundings: true,
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
    // SRD: "the creature ... is unaware of its surroundings".
    unawareOfSurroundings: true,
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
    // SRD conditions this on the source of the fear being within line of sight.
    // Line of sight is not modelled, so the penalty is applied whenever the
    // condition is present. The approximation is deliberate and errs towards the
    // stricter reading rather than silently dropping the rule.
    selfDisadvantageOnAbilityCheck: true,
  },
  poisoned: {
    id: "poisoned",
    name: "Poisoned",
    selfDisadvantageOnAttack: true,
    selfDisadvantageOnAbilityCheck: true,
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

/**
 * Evaluates the net advantage/disadvantage for an ability check.
 *
 * Sibling of evaluateAdvantage, and separate on purpose: the SRD applies
 * different conditions to attack rolls and to ability checks, so one function
 * cannot serve both without quietly applying the wrong rule to one of them.
 *
 * Exhaustion arrives as a level rather than a condition because that is how it
 * is persisted (Character.exhaustionLevel), and it is the only source available
 * outside combat — conditions live on Combatant, which exists only during an
 * encounter.
 *
 * Not covered, deliberately: Blinded and Deafened make a creature automatically
 * *fail* checks that rely on sight or hearing. Applying that needs to know which
 * sense a given check uses, which is not modelled; inventing that classification
 * would be worse than leaving the rule out and saying so.
 *
 * @param conditions      Conditions currently affecting the creature.
 * @param exhaustionLevel D&D 5e exhaustion level (0-6). 1 or more imposes
 *                        disadvantage on all ability checks.
 */
export function evaluateAbilityCheckAdvantage(
  conditions: readonly string[],
  exhaustionLevel = 0
): { advantage: boolean; disadvantage: boolean } {
  // Multiple sources of disadvantage do not stack in 5e — one is the same as
  // three — so this is a boolean, not a count.
  let hasDisadvantage = exhaustionLevel >= 1;

  for (const condId of conditions) {
    const entry = CONDITION_REGISTRY[condId.toLowerCase()];
    if (!entry) continue;

    if (entry.selfDisadvantageOnAbilityCheck) hasDisadvantage = true;
  }

  // No neutralization step, unlike evaluateAdvantage: no condition in the 5e
  // 2014 SRD grants advantage on ability checks, so there is never anything to
  // cancel against. `advantage` is reported anyway so the result can be handed
  // straight to resolveAbilityCheck, and so that adding a future source of
  // advantage is a change here rather than at every call site.
  return { advantage: false, disadvantage: hasDisadvantage };
}

/**
 * Whether a creature can notice anything at all.
 *
 * Used to decide who may oppose a contested check: a creature that is unaware
 * of its surroundings sets no difficulty for someone sneaking past it.
 *
 * ─── Why only two conditions ─────────────────────────────────────────────────
 * Only Unconscious and Petrified say, in the SRD's own words, that the creature
 * is unaware of its surroundings. Incapacitated, Stunned and Paralyzed stop a
 * creature acting, not perceiving — a stunned guard still sees you walk past.
 *
 * Blinded and Deafened are deliberately not included. Each removes one sense
 * and leaves the other, so a blinded creature still hears and a deafened one
 * still looks. Excluding them would let a player hide in plain sight from a
 * creature whose hearing is untouched, which is further from the rules than
 * leaving them in. Modelling them properly needs to know which sense a given
 * check relies on, which is not represented anywhere in this codebase — the
 * same limit recorded on evaluateAbilityCheckAdvantage.
 */
export function isUnawareOfSurroundings(conditions: readonly string[]): boolean {
  return conditions.some(
    (condId) => CONDITION_REGISTRY[condId.toLowerCase()]?.unawareOfSurroundings === true
  );
}
