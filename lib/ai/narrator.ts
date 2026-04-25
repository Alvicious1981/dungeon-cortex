/**
 * lib/ai/narrator.ts
 *
 * AI narration pipeline — Milestone I upgrade.
 *
 * Architecture contract ("Code is Law"):
 *   - This module ONLY narrates. It never resolves rules or mutates state.
 *   - All game state passed in is already validated and persisted by the caller.
 *   - The model receives context as read-only reference; it cannot change it.
 *
 * Streaming: streamNarrative() returns the token stream and a Promise for the
 * complete text so the route can pipe tokens to the client immediately while
 * persisting the full text to the DB once the LLM finishes.
 *
 * Model choice: gpt-4o-mini — fast and cost-effective for real-time narration.
 * Swap the model string here when upgrading; no other code needs to change.
 */

import { streamText, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { buildCampaignContext } from "@/lib/memory/context";
import { formatSystemPrompt } from "@/lib/memory/formatter";
import type { AsyncIterableStream } from "ai";
import { buildWildernessTool } from "@/lib/ai/tools/wilderness";
import { buildCombatTools } from "@/lib/ai/tools/combat";
import { buildProgressionTools } from "@/lib/ai/tools/progression";
import { buildSocialTools } from "@/lib/ai/tools/social";
import { buildExplorationTools } from "@/lib/ai/tools/exploration";
import { buildWorldTools } from "@/lib/ai/tools/world";
import { buildInventoryTools } from "@/lib/ai/tools/inventory";
import { buildSrdTools } from "@/lib/ai/tools/srd-lookup";
import { buildDowntimeTools } from "@/lib/ai/tools/downtime";
import type { LevelUpPayload } from "@/lib/rules/progression";
import type { MerchantPayload } from "@/lib/rules/trade";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NarrativeStream {
  /** Token-by-token async iterable — consume to stream to the client. */
  textStream: AsyncIterableStream<string>;
  /** Resolves to the full assembled text once the LLM finishes. */
  textPromise: PromiseLike<string>;
  /**
   * Resolves to the LevelUpPayload if `triggerLevelUp` was called during this
   * narrative turn, or null if no level-up occurred.
   * Always resolves (never hangs) because it falls back to null when the text
   * stream ends without a level-up tool call.
   */
  levelUpPayload: Promise<LevelUpPayload | null>;
  /**
   * Resolves to the MerchantPayload if `generateMerchant` was called during this
   * narrative turn, or null if no merchant was generated.
   */
  merchantPayload: Promise<MerchantPayload | null>;
}

// ─── Tool definitions (shared) ────────────────────────────────────────────────

function buildTools(
  campaignId: string,
  callbacks?: { 
    onLevelUp?: (payload: LevelUpPayload) => void;
    onMerchantGenerated?: (payload: MerchantPayload) => void;
  },
) {
  return {
    ...buildCombatTools(campaignId),
    ...buildProgressionTools(campaignId, callbacks),
    ...buildSocialTools(campaignId, callbacks),
    ...buildExplorationTools(campaignId),
    executeTravelWatch: buildWildernessTool(campaignId),
    ...buildWorldTools(campaignId),
    ...buildSrdTools(),
    ...buildInventoryTools(campaignId),
    ...buildDowntimeTools(campaignId),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Starts a streaming DM narrative response.
 *
 * Returns both the token stream (for immediate client delivery) and a
 * Promise for the complete text (for DB persistence after streaming ends).
 * These are independent: consuming `textStream` does not block `textPromise`.
 *
 * @param campaignId  - The campaign to narrate for.
 * @param playerInput - The player's raw action text.
 */
export async function streamNarrative(
  campaignId: string,
  playerInput: string,
): Promise<NarrativeStream> {
  // Shared promise that resolves once we know whether a level-up occurred.
  // The onLevelUp callback resolves it with the payload; the text-completion
  // fallback resolves it with null so the promise never hangs.
  let resolveLevelUp!: (p: LevelUpPayload | null) => void;
  const levelUpPayload = new Promise<LevelUpPayload | null>((resolve) => {
    resolveLevelUp = resolve;
  });

  let resolveMerchant!: (p: MerchantPayload | null) => void;
  const merchantPayload = new Promise<MerchantPayload | null>((resolve) => {
    resolveMerchant = resolve;
  });

  // ─── MOCK TEMPORAL PARA TESTING LOCAL ───────────────────────────────────────
  // Para evitar bloqueos por falta de OPENAI_API_KEY. 
  // Retorna una narrativa estática determinista.
  const mockContent = "El héroe realiza su acción con determinación en el campo de batalla (MODO MOCK).";
  
  // Resolvemos los payloads de herramientas como null para que no queden colgando
  resolveLevelUp(null);
  resolveMerchant(null);

  return {
    textStream: (async function* () {
      yield mockContent;
    })() as any,
    textPromise: Promise.resolve(mockContent),
    levelUpPayload: Promise.resolve(null),
    merchantPayload: Promise.resolve(null),
  };

  /* CÓDIGO ORIGINAL COMENTADO (Requiere OPENAI_API_KEY)
  const context = await buildCampaignContext(campaignId);
  const system = formatSystemPrompt(context);

  const result = streamText({
    model: openai("gpt-4o-mini"),
    system,
    prompt: playerInput,
    stopWhen: stepCountIs(5),
    tools: buildTools(campaignId, {
      onLevelUp: (payload) => resolveLevelUp(payload),
      onMerchantGenerated: (payload) => resolveMerchant(payload),
    }),
  });

  // Fallback: if the text stream ends without a level-up tool call, resolve null.
  // Promise.resolve wraps the PromiseLike so we can chain .catch().
  // A second resolveLevelUp call after onLevelUp fires is a no-op (Promises resolve once).
  Promise.resolve(result.text).then(() => {
    resolveLevelUp(null);
    resolveMerchant(null);
  }).catch(() => {
    resolveLevelUp(null);
    resolveMerchant(null);
  });

  return {
    textStream: result.textStream,
    textPromise: result.text,
    levelUpPayload,
    merchantPayload,
  };
  */
}
