/**
 * lib/narrative/combat-narrative-types.ts
 *
 * Authoritative TypeScript contracts for the Dungeon Cortex narrative system.
 * These types define data containers representing resolved backend facts
 * that can be passed to the AI narrator or fallback engine.
 *
 * Rules: D&D 5e/SRD 2014 only. No legacy rules or forbidden terminology allowed.
 */

import { z } from 'zod';

const MAX_FACTS = 100;
const MAX_TARGETS = 50;
const MAX_SOURCE_EVENTS = 100;
const MAX_IDENTIFIER_LENGTH = 200;
export const MAX_NARRATIVE_NAME_LENGTH = 160;
const MAX_DESCRIPTION_LENGTH = 1_000;
const MAX_TONE_LENGTH = 120;
const MAX_PROMPT_LENGTH = 32_000;
const MAX_NARRATIVE_LENGTH = 4_000;

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

export const NarrativeFactTypeSchema = z.enum([
  'attack_hit',
  'attack_miss',
  'critical_hit',
  'critical_miss',
  'damage_confirmed',
  'healing_confirmed',
  'condition_applied',
  'condition_removed',
  'enemy_defeated',
  'spell_cast',
  'concentration_broken',
  'turn_started',
  'turn_ended',
]);

/** A single resolved game event from the backend. */
export interface NarrativeFact {
  type: NarrativeFactType;
  description: string;
  payload?: Record<string, unknown>;
}

export const NarrativeFactSchema = z.object({
  type: NarrativeFactTypeSchema,
  description: z.string().max(MAX_DESCRIPTION_LENGTH),
  payload: z.record(z.string(), z.unknown()).optional(),
}).strict();

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

const NarrativeActorSchema = z.object({
  id: z.string().max(MAX_IDENTIFIER_LENGTH),
  name: z.string().min(1).max(MAX_NARRATIVE_NAME_LENGTH),
  isPlayer: z.boolean(),
}).strict();

const NarrativeTargetSchema = z.object({
  id: z.string().max(MAX_IDENTIFIER_LENGTH),
  name: z.string().min(1).max(MAX_NARRATIVE_NAME_LENGTH),
  isPlayer: z.boolean(),
  hpBefore: z.number().finite().optional(),
  hpAfter: z.number().finite(),
}).strict();

/** Runtime boundary for resolved backend facts before they reach a prompt. */
export const CombatNarrativeContextSchema = z.object({
  facts: z.array(NarrativeFactSchema).max(MAX_FACTS),
  actor: NarrativeActorSchema.optional(),
  targets: z.array(NarrativeTargetSchema).max(MAX_TARGETS).optional(),
  tone: z.string().max(MAX_TONE_LENGTH).optional(),
  intensity: z.number().finite().optional(),
  sourceEvents: z.array(z.unknown()).max(MAX_SOURCE_EVENTS).optional(),
}).strict();

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

export const NarrativePromptSchema = z.object({
  system: z.string().min(1).max(MAX_PROMPT_LENGTH),
  user: z.string().min(1).max(MAX_PROMPT_LENGTH),
}).strict();

export const NarrativeTextSchema = z.string().trim().min(1).max(MAX_NARRATIVE_LENGTH);
