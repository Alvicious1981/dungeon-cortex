/**
 * Combat resolution module — Dungeon Cortex rules engine.
 *
 * Implements Milestone B combat primitives: initiative ordering.
 * All dice randomness is delegated to dice.ts so this module stays
 * deterministic and auditable given a fixed roll sequence.
 */

import { roll } from "./dice";
import type { RollResult } from "./dice";

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

// ---------------------------------------------------------------------------
// Turn advancement
// ---------------------------------------------------------------------------

export interface TurnAdvanceInput {
  currentTurnIndex: number;
  round: number;
  /** Total number of combatants in the encounter (including dead — 5e RAW). */
  combatantCount: number;
}

export interface TurnAdvanceResult {
  nextTurnIndex: number;
  nextRound: number;
  /** True when the index wrapped back to 0, i.e., a new round began. */
  roundAdvanced: boolean;
}

/**
 * Advances the initiative pointer to the next combatant.
 *
 * Dead combatants remain in the order per 5e RAW — the narrator is
 * responsible for describing that their turn is skipped.
 *
 * @pure — no side effects, deterministic output.
 */
export function advanceTurn(input: TurnAdvanceInput): TurnAdvanceResult {
  const rawNext = input.currentTurnIndex + 1;
  const wraps = rawNext >= input.combatantCount;
  return {
    nextTurnIndex: wraps ? 0 : rawNext,
    nextRound: wraps ? input.round + 1 : input.round,
    roundAdvanced: wraps,
  };
}

/** Clamps a damage application to a floor of 0 HP. @pure */
export function applyDamage(currentHp: number, damage: number): number {
  return Math.max(0, currentHp - damage);
}

/** Returns true when a combatant has reached 0 HP. @pure */
export function checkDeath(hp: number): boolean {
  return hp <= 0;
}

// ---------------------------------------------------------------------------
// Encounter end detection
// ---------------------------------------------------------------------------

export interface EncounterResolution {
  shouldEnd: boolean;
  reason: "all_enemies_dead" | "player_dead" | "ongoing";
}

/**
 * Determines whether the encounter should end based on current HP values.
 *
 * Priority: player death is checked before enemy death so a mutual-kill
 * scenario is correctly reported as a player death.
 *
 * @pure — no side effects, deterministic output.
 */
export function resolveEncounterEnd(
  combatants: Array<{ isPlayer: boolean; hp: number }>
): EncounterResolution {
  const player = combatants.find((c) => c.isPlayer);
  if (player && checkDeath(player.hp)) {
    return { shouldEnd: true, reason: "player_dead" };
  }
  const allEnemiesDead = combatants
    .filter((c) => !c.isPlayer)
    .every((c) => checkDeath(c.hp));
  if (allEnemiesDead) {
    return { shouldEnd: true, reason: "all_enemies_dead" };
  }
  return { shouldEnd: false, reason: "ongoing" };
}

// ---------------------------------------------------------------------------
// Armor Class derivation
// ---------------------------------------------------------------------------

/**
 * Reads the first numeric AC value from a SrdMonster `data` JSON blob.
 * The SRD structure is: `armor_class: [{ type: string, value: number }]`.
 * Falls back to 10 (unarmored baseline) if the field is absent or malformed.
 *
 * @pure — no side effects.
 */
export function acFromMonsterData(data: Record<string, unknown>): number {
  const ac = data.armor_class;
  if (!Array.isArray(ac) || ac.length === 0) return 10;
  const first = ac[0] as Record<string, unknown>;
  return typeof first.value === "number" ? first.value : 10;
}

/**
 * Derives a player character's AC from their inventory.
 *
 * Rules (5e 2014 SRD):
 *   - Unarmored: 10 + DEX modifier.
 *   - Light armor: base AC + DEX modifier (no cap).
 *   - Medium armor: base AC + DEX modifier (max +2).
 *   - Heavy armor: base AC, no DEX modifier.
 *   - Shield: +2 AC (stacks with any armor — not yet implemented here).
 *
 * The first item with type "armor" in the inventory is used.
 * If no armor is found the character is treated as unarmored.
 *
 * @pure — no side effects.
 */
export function acFromInventory(
  inventory: Array<{ type: string; properties: unknown }>,
  dexModifier: number
): number {
  const armorItem = inventory.find((i) => i.type === "armor");
  if (!armorItem) return 10 + dexModifier;

  const props = armorItem.properties as Record<string, unknown>;
  const base = typeof props.baseAC === "number" ? props.baseAC : 10;
  const addDex = props.addDexModifier !== false;
  const rawMax = props.maxDexBonus;
  const maxDex = typeof rawMax === "number" ? rawMax : Infinity;
  const dexBonus = addDex ? Math.min(dexModifier, maxDex) : 0;
  return base + dexBonus;
}

// ---------------------------------------------------------------------------
// Attack roll resolution
// ---------------------------------------------------------------------------

export interface AttackRollResult {
  /** The raw d20 face result (1–20). */
  roll: number;
  /** roll + attackModifier. */
  total: number;
  /** True when the attack hits (natural 20 always hits; natural 1 always misses). */
  hit: boolean;
  /** Natural 20 — damage dice are doubled per 5e 2014 SRD p. 196. */
  critical: boolean;
  /** Natural 1 — automatic miss regardless of modifiers. */
  fumble: boolean;
}

/**
 * Resolves a single melee/ranged attack roll against a target's AC.
 *
 * Critical hit rule (5e 2014 SRD p. 196):
 *   A natural 20 always hits, regardless of the target's AC.
 * Fumble rule:
 *   A natural 1 always misses, regardless of modifiers.
 *
 * @pure — uses Math.random() internally; not deterministic across runs.
 */
export function resolveAttackRoll(
  attackModifier: number,
  targetAC: number
): AttackRollResult {
  const rollValue = Math.floor(Math.random() * 20) + 1;
  const total = rollValue + attackModifier;
  const critical = rollValue === 20;
  const fumble = rollValue === 1;
  return {
    roll: rollValue,
    total,
    hit: critical || (!fumble && total >= targetAC),
    critical,
    fumble,
  };
}
