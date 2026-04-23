/**
 * lib/ai/intent.ts
 *
 * Structured intent parsing for "Code is Law" enforcement.
 *
 * Converts free-text player input into a typed, validated Intent object.
 * The rules engine uses the returned type to gate mechanics deterministically:
 *   - "cast_spell"  → validate spell slots via lib/rules/magic
 *   - "attack"      → resolve attack roll via lib/rules/combat
 *   - "use_item"    → validate inventory via lib/rules/inventory
 *   - "general"     → no mechanical gate; pass straight to narration
 *
 * Architecture contract:
 *   - This module ONLY classifies intent. It never validates rules or mutates state.
 *   - The caller is responsible for acting on the returned type.
 */

import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { getSpellInfo, type SpellEffect } from "@/lib/ai/tools/srd-lookup";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Strict schema for a player's classified action intent.
 * Used both as the LLM output contract and as the TypeScript type source.
 */
export const IntentSchema = z.object({
  /**
   * Canonical action classification:
   * - "cast_spell" — player is attempting to cast a spell
   * - "attack"     — player is attempting a weapon/unarmed attack
   * - "use_item"   — player is attempting to use an inventory item
   * - "equip"      — player is attempting to equip an item
   * - "rest"       — player is attempting to take a short or long rest
   * - "explore"    — player is interacting with the environment (search, move, etc.)
   * - "travel"     — player is traveling overland
   * - "general"    — roleplay, dialogue, or anything non-mechanical
   */
  actionType: z.enum(["cast_spell", "attack", "use_item", "equip", "rest", "explore", "travel", "general"]),

  /**
   * Name of the target (creature, NPC, object) if one is present in the input.
   * Omitted for untargeted or general actions.
   */
  targetName: z.string().optional(),

  /**
   * Canonical name of the spell being cast (e.g. "Fireball", "Cure Wounds").
   * Only present when actionType is "cast_spell". Used for SRD lookup.
   */
  spellName: z.string().optional(),

  /**
   * Spell slot level the player intends to use (1–9).
   * Only relevant when actionType is "cast_spell".
   * Omitted for cantrips (slot-free) and all other action types.
   */
  spellLevel: z.number().int().min(1).max(9).optional(),

  /**
   * Whether the player is taking a "short" or "long" rest.
   * Only relevant when actionType is "rest".
   */
  restType: z.enum(["short", "long"]).optional(),
});

export type BaseIntent = z.infer<typeof IntentSchema>;

export interface Intent extends BaseIntent {
  /** The strongly typed mechanical spell data resolved from the SRD, if applicable. */
  spellEffect?: SpellEffect | null;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parses a player's free-text action into a structured Intent.
 *
 * @param playerInput   - Raw text the player typed (e.g. "I cast Fireball at level 3 on the orc").
 * @param systemContext - Formatted game-state context from formatSystemPrompt —
 *                        gives the model awareness of active encounter, inventory, etc.
 * @returns             A validated Intent object ready for rules-engine gating.
 */
export async function parseIntent(
  playerInput: string,
  systemContext: string
): Promise<Intent> {
  const { object } = await generateObject({
    model: openai("gpt-4o-mini"),
    schema: IntentSchema,
    system: [
      "You are a D&D 5e rules classifier. Your only job is to extract structured intent from a player's action.",
      "Classify the actionType as precisely as possible based on the player's words and the game state below.",
      "For 'cast_spell': include spellLevel only if the player specifies a slot level; omit it for cantrips.",
      "For 'attack', 'use_item', or 'equip': include targetName if a target is named.",
      "When in doubt, classify as 'general'.",
      "",
      systemContext,
    ].join("\n"),
    prompt: playerInput,
  });

  const intent: Intent = { ...object };

  // Consume strongly typed SpellEffect immediately if spell was identified.
  // The caller acts on this without hallucinating raw JSON stats.
  if (intent.actionType === "cast_spell" && intent.spellName) {
    intent.spellEffect = await getSpellInfo(intent.spellName);
  }

  return intent;
}
