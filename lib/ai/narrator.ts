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
import { buildSrdTools } from "@/lib/ai/tools/srd-lookup";
import type { LevelUpPayload } from "@/lib/rules/progression";
import type { MerchantPayload } from "@/lib/rules/trade";
import type { CombatNarrativeContext } from "@/lib/narrative/combat-narrative-types";
import { buildNarrativePrompt } from "@/lib/narrative/prompt-builder";
import { validateNarrativeText } from "@/lib/narrative/narrative-validator";
import { generateFallbackProse } from "@/lib/narrative/fallback-prose";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StreamNarrativeOptions {
  mockNarrativeText?: string;
}

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

function buildReadOnlyTools() {
  // Narration may inspect canonical cached SRD data, but it cannot call any
  // state-changing tool. All mutations must have completed before this point.
  return buildSrdTools();
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
  narrativeContext?: CombatNarrativeContext,
  options?: StreamNarrativeOptions,
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

  const useMock = (process.env.NODE_ENV !== "test" && !process.env.OPENAI_API_KEY) ||
                  (process.env.NODE_ENV === "test" && options?.mockNarrativeText !== undefined);

  if (useMock) {
    let mockContent = "El héroe realiza su acción con determinación en el campo de batalla (MODO MOCK).";
    if (options?.mockNarrativeText && process.env.NODE_ENV === "test") {
      mockContent = options.mockNarrativeText;
    }

    if (narrativeContext) {
      const validation = validateNarrativeText(mockContent, narrativeContext);
      if (!validation.ok) {
        mockContent = generateFallbackProse(narrativeContext);
      }
    }
    
    // Resolvemos los payloads de herramientas como null para que no queden colgando
    resolveLevelUp(null);
    resolveMerchant(null);

    return {
      textStream: (async function* () {
        yield mockContent;
      })() as unknown as AsyncIterableStream<string>,
      textPromise: Promise.resolve(mockContent),
      levelUpPayload: Promise.resolve(null),
      merchantPayload: Promise.resolve(null),
    };
  }

  const context = await buildCampaignContext(campaignId);
  let system = formatSystemPrompt(context);
  let prompt = playerInput;

  if (narrativeContext) {
    const safetyPrompt = buildNarrativePrompt(narrativeContext);
    system = system + "\n\n" + safetyPrompt.system;
    prompt = playerInput + "\n\nResolved Facts for this action:\n" + safetyPrompt.user;
  }

  const result = streamText({
    model: openai("gpt-4o-mini"),
    system,
    prompt,
    stopWhen: stepCountIs(5),
    tools: buildReadOnlyTools(),
  });

  // If narrativeContext exists, we buffer and validate the result.text before yielding/resolving.
  let finalNarrativeTextPromise: Promise<string>;
  let finalNarrativeTextStream: AsyncIterableStream<string>;

  if (narrativeContext) {
    finalNarrativeTextPromise = Promise.resolve(result.text).then((fullText) => {
      const validation = validateNarrativeText(fullText, narrativeContext);
      return validation.ok ? fullText : generateFallbackProse(narrativeContext);
    }).catch(() => {
      return generateFallbackProse(narrativeContext);
    });

    finalNarrativeTextStream = (async function* () {
      const verifiedText = await finalNarrativeTextPromise;
      yield verifiedText;
    })() as unknown as AsyncIterableStream<string>;
  } else {
    finalNarrativeTextPromise = Promise.resolve(result.text);
    finalNarrativeTextStream = result.textStream;
  }

  // Fallback: if the text stream ends without a level-up tool call, resolve null.
  // Promise.resolve wraps the PromiseLike so we can chain .catch().
  // A second resolveLevelUp call after onLevelUp fires is a no-op (Promises resolve once).
  Promise.resolve(finalNarrativeTextPromise).then(() => {
    resolveLevelUp(null);
    resolveMerchant(null);
  }).catch(() => {
    resolveLevelUp(null);
    resolveMerchant(null);
  });

  return {
    textStream: finalNarrativeTextStream,
    textPromise: finalNarrativeTextPromise,
    levelUpPayload,
    merchantPayload,
  };
}
