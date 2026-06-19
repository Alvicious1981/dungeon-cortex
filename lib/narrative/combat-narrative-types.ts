/**
 * lib/narrative/combat-narrative-types.ts
 *
 * Authoritative TypeScript contracts for the Dungeon Cortex narrative system.
 * These types define data containers representing resolved backend facts
 * that can be passed to the AI narrator or fallback engine.
 *
 * Rules: D&D 5e/SRD 2014 only. No legacy rules or forbidden terminology allowed.
 */

/** Valid 5e-compatible backend fact types. */
export type NarrativeFactType =
  | 'attack_hit'
  | 'attack_miss'
  | 'critical_hit'
  | 'critical_miss'
  | 'damage_confirmed'
  | 'healing_confirmed'
  | 'condition_applied'
  | 'condition_removed'
  | 'enemy_defeated'
  | 'spell_cast'
  | 'concentration_broken'
  | 'turn_started'
  | 'turn_ended';

/** A single resolved game event from the backend. */
export interface NarrativeFact {
  type: NarrativeFactType;
  description: string;
  payload?: Record<string, unknown>;
}

/** Complete resolved facts layout used in the negative unit tests. */
export interface CombatFacts {
  attackerName: string;
  defenderName: string;
  weaponName: string;
  damage: number;
  damageType: string;
  hpBefore: number;
  hpAfter: number;
  targetMaxHp: number;
  isCrit: boolean;
  isFumble: boolean;
  isKill: boolean;
  conditionsApplied: string[];
}

/** Narrative context container passed to prompt builders and fallback engines. */
export interface CombatNarrativeContext {
  facts: NarrativeFact[];
  actor?: {
    id: string;
    name: string;
    isPlayer: boolean;
  };
  targets?: Array<{
    id: string;
    name: string;
    isPlayer: boolean;
    hpBefore?: number;
    hpAfter: number;
  }>;
  tone?: string;
  intensity?: number;
  sourceEvents?: unknown[];
}

/** Issues detected when validating the AI's generated narrative output. */
export interface NarrativeValidationIssue {
  code: string;
  message: string;
  severity: 'warning' | 'error';
  matchedText?: string;
}

/** Outcome of the validation checks run against the stream. */
export interface NarrativeValidationResult {
  ok: boolean;
  /** Alias for backward compatibility with first draft tests. */
  isValid: boolean;
  issues: NarrativeValidationIssue[];
}

/** Input schema for the deterministic fallback text generator. */
export type FallbackProseInput = CombatNarrativeContext;

/** Output structure of the narrative prompt builder. */
export interface NarrativePrompt {
  system: string;
  user: string;
}
