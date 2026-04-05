/**
 * Combat resolution module — Dungeon Cortex rules engine.
 *
 * Implements Milestone B combat primitives: initiative ordering.
 * All dice randomness is delegated to dice.ts so this module stays
 * deterministic and auditable given a fixed roll sequence.
 */

import { roll } from "./dice";
import type { RollResult } from "./dice";
import type { Zone } from "./spatial";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal combatant descriptor required to roll initiative. */
export interface CombatantInput {
  id: string;
  name: string;
  /** DEX modifier: floor((dex - 10) / 2). Caller is responsible for computing this. */
  dexModifier: number;
}

/** A combatant after initiative has been rolled, ready for encounter ordering. */
export interface InitiativeEntry extends CombatantInput {
  /** The raw 1d20 roll result, retained for display and audit. */
  roll: RollResult;
  /** Natural d20 result (1–20). */
  naturalRoll: number;
  /** Final initiative value: naturalRoll + dexModifier. */
  initiative: number;
}

/** Fully ordered initiative result for a combat encounter. */
export interface InitiativeOrder {
  /** Combatants sorted highest initiative first. Ties broken by dexModifier, then natural roll. */
  order: InitiativeEntry[];
}

// ---------------------------------------------------------------------------
// Range validation
// ---------------------------------------------------------------------------

/** The reach category of a weapon, derived from its item properties. */
export type WeaponRange = "melee" | "ranged";

/**
 * The result of a range validation check.
 * `reason` is only present when `valid` is false.
 */
export interface RangeValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validates whether an attack can reach its target given the attacker's and
 * target's current zones.
 *
 * Rules:
 *   - If either zone is null (spatial tracking disabled or combatant not yet
 *     placed), all attacks are permitted — backwards compatibility with
 *     encounters that predate the spatial system.
 *   - Melee: attacker and target must occupy the **same zone**.
 *   - Ranged: valid from any zone to any zone (point-blank included).
 *     Disadvantage mechanics for firing while engaged are out of scope here.
 *
 * This is a pure function: no I/O, no side effects.
 *
 * @example
 * validateAttackRange(zoneA, zoneA, "melee")  // { valid: true }
 * validateAttackRange(zoneA, zoneB, "melee")  // { valid: false, reason: "…" }
 * validateAttackRange(zoneA, zoneB, "ranged") // { valid: true }
 */
export function validateAttackRange(
  attackerZone: Zone | null,
  targetZone: Zone | null,
  weaponRange: WeaponRange
): RangeValidationResult {
  // Null guard — spatial tracking disabled; permit unconditionally.
  if (attackerZone === null || targetZone === null) {
    return { valid: true };
  }

  if (weaponRange === "melee") {
    if (attackerZone.id === targetZone.id) {
      return { valid: true };
    }
    return {
      valid: false,
      reason: `Melee weapons require being in the same zone. ` +
              `You are in "${attackerZone.name}" but the target is in "${targetZone.name}". ` +
              `Move to their zone first.`,
    };
  }

  // Ranged weapons reach any zone.
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Initiative
// ---------------------------------------------------------------------------

/**
 * Roll initiative for every combatant in the encounter and return them sorted
 * in descending initiative order (highest acts first).
 *
 * Tie-breaking (5e convention):
 *   1. Higher dexModifier wins.
 *   2. If dexModifier is also equal, higher natural d20 result wins.
 *   3. Remaining ties preserve original input order (stable sort).
 *
 * @example
 * const result = rollInitiative([
 *   { id: "player-1", name: "Aldric",  dexModifier: 2 },
 *   { id: "enemy-1",  name: "Goblin",  dexModifier: 1 },
 *   { id: "enemy-2",  name: "Hobgoblin", dexModifier: 0 },
 * ]);
 * // result.order[0] acts first this round
 */
export function rollInitiative(combatants: CombatantInput[]): InitiativeOrder {
  if (combatants.length === 0) {
    return { order: [] };
  }

  // Roll for every combatant and compute initiative totals.
  const entries: InitiativeEntry[] = combatants.map((combatant) => {
    const rollResult = roll("1d20");
    const naturalRoll = rollResult.dice[0].result;
    return {
      ...combatant,
      roll: rollResult,
      naturalRoll,
      initiative: naturalRoll + combatant.dexModifier,
    };
  });

  // Sort descending: initiative → dexModifier → naturalRoll.
  // Array.prototype.sort is stable in V8 (Node 11+), so equal entries
  // preserve original input order after the three explicit comparisons.
  entries.sort((a, b) => {
    if (b.initiative !== a.initiative) return b.initiative - a.initiative;
    if (b.dexModifier !== a.dexModifier) return b.dexModifier - a.dexModifier;
    return b.naturalRoll - a.naturalRoll;
  });

  return { order: entries };
}
