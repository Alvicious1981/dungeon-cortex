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
 *   - "mechanical_ambiguous" → request clarification; never narrate as resolved
 *   - "general"     → no mechanical gate; pass straight to narration
 *
 * Architecture contract:
 *   - This module ONLY classifies intent. It never validates rules or mutates state.
 *   - The caller is responsible for acting on the returned type.
 */

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
   * - "mechanical_ambiguous" — potentially mechanical, but not safely classifiable
   * - "general"    — roleplay, dialogue, or anything non-mechanical
   */
  actionType: z.enum([
    "cast_spell",
    "attack",
    "use_item",
    "equip",
    "rest",
    "explore",
    "travel",
    "move",
    "mechanical_ambiguous",
    "general",
  ]),

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

  /**
   * The name or ID of the destination node the player wants to move to.
   * Only present when actionType is "move".
   */
  destination: z.string().optional(),
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
  void systemContext;
  const input = playerInput.trim().replace(/\s+/g, " ");
  const lower = input.toLocaleLowerCase("en");

  // Fail closed: anything this parser cannot positively classify is treated as
  // a possible mechanical action and sent back for clarification, never handed
  // to the narrator as if it had already resolved.
  let intent: Intent = { actionType: "mechanical_ambiguous" };

  const prefixedValue = (pattern: RegExp): string | undefined => {
    const match = input.match(pattern);
    const value = (match?.[1] ?? match?.[2])
      ?.trim()
      .replace(/^(?:the|el|la|los|las|al)\s+/i, "");
    return value || undefined;
  };

  const castMatch = input.match(
    /^(?:i\s+)?(?:cast|conjure|lanzo|lanzar|conjuro|conjurar)\s+(.+)$/i
  );
  if (castMatch) {
    let remainder = castMatch[1].trim();
    const levelMatch = remainder.match(
      /\s+(?:at|using|a|al|usando)\s+(?:slot\s+)?(?:level|nivel)\s*(\d)\b/i
    );
    const spellLevel = levelMatch ? Number(levelMatch[1]) : undefined;
    if (levelMatch?.index !== undefined) {
      remainder =
        remainder.slice(0, levelMatch.index) +
        remainder.slice(levelMatch.index + levelMatch[0].length);
    }

    const targetMatch = remainder.match(
      /\s+(?:on|against|at|sobre|contra|hacia)\s+(.+)$/i
    );
    const targetName = targetMatch?.[1]?.trim();
    const spellName = (
      targetMatch?.index === undefined
        ? remainder
        : remainder.slice(0, targetMatch.index)
    )
      .replace(/^(?:the\s+spell|el\s+conjuro|el\s+hechizo)\s+/i, "")
      .trim();

    intent = {
      actionType: "cast_spell",
      ...(spellName ? { spellName } : {}),
      ...(spellLevel !== undefined ? { spellLevel } : {}),
      ...(targetName ? { targetName } : {}),
    };
  } else if (
    /^(?:i\s+)?(?:attack|strike|hit|shoot|fire|stab|slash|punch|kick|ataco|atacar|golpeo|golpear|disparo|disparar|apuñalo|apuñalar)\b/i.test(
      input
    )
  ) {
    intent = {
      actionType: "attack",
      targetName: prefixedValue(
        /^(?:i\s+)?(?:attack|strike|hit|shoot|fire|stab|slash|punch|kick|ataco|atacar|golpeo|golpear|disparo|disparar|apuñalo|apuñalar)(?:\s+(?:at|al|a|contra))?\s*(.*)$/i
      ),
    };
  } else if (/^(?:i\s+)?(?:use|drink|usar|uso|beber|bebo)\b/i.test(input)) {
    intent = {
      actionType: "use_item",
      targetName: prefixedValue(
        /^(?:i\s+)?(?:use|drink|usar|uso|beber|bebo)\s+(.+?)(?:\s+(?:on|sobre)\s+.+)?$/i
      ),
    };
  } else if (/^(?:i\s+)?(?:equip|wield|don|equipar|equipo|empuñar|empuño)\b/i.test(input)) {
    intent = {
      actionType: "equip",
      targetName: prefixedValue(
        /^(?:i\s+)?(?:equip|wield|don|equipar|equipo|empuñar|empuño)\s+(.+)$/i
      ),
    };
  } else if (
    /\b(?:short|long)\s+rest\b/i.test(input) ||
    /\bdescanso\s+(?:corto|largo)\b/i.test(input)
  ) {
    intent = {
      actionType: "rest",
      restType: /\b(?:long\s+rest|descanso\s+largo)\b/i.test(input)
        ? "long"
        : "short",
    };
  } else if (
    /^(?:i\s+)?(?:move|go|walk)\s+to\b/i.test(input) ||
    /^(?:moverme|mover|ir|caminar)\s+(?:a|hacia)\b/i.test(input)
  ) {
    intent = {
      actionType: "move",
      destination: prefixedValue(
        /^(?:i\s+)?(?:move|go|walk)\s+to\s+(.+)$|^(?:moverme|mover|ir|caminar)\s+(?:a|hacia)\s+(.+)$/i
      ),
    };
  } else if (/^(?:i\s+)?(?:travel|journey|viajar|viajo)\b/i.test(input)) {
    intent = { actionType: "travel" };
  } else if (
    /^(?:i\s+)?(?:explore|search|investigate|scout|hide|explorar|buscar|investigar|registrar|ocultarme)\b/i.test(
      input
    )
  ) {
    intent = { actionType: "explore" };
  } else if (lower === "rest" || lower === "descansar" || lower === "descanso") {
    intent = { actionType: "rest", restType: "short" };
  } else if (
    /^(?:(?:i\s+)?(?:say|ask|tell|greet|speak|talk|reply|answer|smile|laugh|cry|nod|bow|wave|sing|whisper|shout)|(?:digo|pregunto|saludo|hablo|respondo|sonrío|rio|río|lloro|asiento|me\s+inclino|canto|susurro|grito))\b|^(?:hello|hi|greetings|hola|buenas)\b/i.test(
      input
    )
  ) {
    intent = { actionType: "general" };
  }

  intent = IntentSchema.parse(intent);

  // Consume strongly typed SpellEffect immediately if spell was identified.
  // The caller acts on this without hallucinating raw JSON stats.
  if (intent.actionType === "cast_spell" && intent.spellName) {
    intent.spellEffect = await getSpellInfo(intent.spellName);
  }

  return intent;
}
