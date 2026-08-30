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
 * Streaming: streamNarrative() returns a verified text stream and a Promise for
 * the same complete text. Model output is buffered and validated before a
 * single safe chunk is emitted or persisted.
 *
 * Model choice: gpt-4o-mini — fast and cost-effective for real-time narration.
 * Swap the model string here when upgrading; no other code needs to change.
 */

import { streamText, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { buildCampaignContext } from "@/lib/memory/context";
import { formatIronLaws, formatCanonicalState } from "@/lib/memory/formatter";
import { buildNarratorRequest, NARRATOR_DATA_LIMITS } from "@/lib/ai/trust-boundary";
import type { AsyncIterableStream } from "ai";
import { buildSrdTools } from "@/lib/ai/tools/srd-lookup";
import { selectActiveNarratorTools, type ActiveNarratorToolName } from "@/lib/ai/tool-policy";
import type { LevelUpPayload } from "@/lib/rules/progression";
import type { MerchantPayload } from "@/lib/rules/trade";
import {
  CombatNarrativeContextSchema,
  type CombatNarrativeContext,
} from "@/lib/narrative/combat-narrative-types";
import { buildNarrativePrompt } from "@/lib/narrative/prompt-builder";
import { validateNarrativeText } from "@/lib/narrative/narrative-validator";
import { generateFallbackProse } from "@/lib/narrative/fallback-prose";

const PlayerInputSchema = z
  .string()
  .trim()
  .min(1)
  .max(NARRATOR_DATA_LIMITS.playerActionChars);

const NEUTRAL_NARRATIVE_FALLBACK = "La escena continúa.";

function validatedFallbackProse(context: CombatNarrativeContext): string {
  const fallback = generateFallbackProse(context);
  const validation = validateNarrativeText(fallback, context);
  return validation.ok ? fallback.trim() : NEUTRAL_NARRATIVE_FALLBACK;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StreamNarrativeOptions {
  mockNarrativeText?: string;
}

export interface NarrativeStream {
  /** Async iterable that emits the complete verified narrative as one chunk. */
  textStream: AsyncIterableStream<string>;
  /** Resolves to the full assembled text once the LLM finishes. */
  textPromise: PromiseLike<string>;
  /**
   * Temporarily resolves to null while mutating narrator tools are absent.
   * Retained to preserve the existing stream return shape for callers.
   */
  levelUpPayload: Promise<LevelUpPayload | null>;
  /**
   * Temporarily resolves to null while mutating narrator tools are absent.
   * Retained to preserve the existing stream return shape for callers.
   */
  merchantPayload: Promise<MerchantPayload | null>;
}

function staticNarrativeStream(text: string): NarrativeStream {
  return {
    textStream: (async function* () {
      yield text;
    })() as unknown as AsyncIterableStream<string>,
    textPromise: Promise.resolve(text),
    levelUpPayload: Promise.resolve(null),
    merchantPayload: Promise.resolve(null),
  };
}

// ─── Tool definitions (shared) ────────────────────────────────────────────────

/**
 * Builds the complete model-visible tool surface.
 *
 * This is deliberately a physical projection, not an `activeTools` hint over
 * a larger catalogue. A model response that names an excluded tool therefore
 * has no executable function to reach. State-changing callbacks are not wired
 * into this builder while narrator mutations are contained.
 */
export function buildNarratorTools(campaignId: string) {
  void campaignId;
  const toolCatalogue = {
    ...buildSrdTools(),
  } satisfies Record<ActiveNarratorToolName, unknown>;

  return selectActiveNarratorTools(toolCatalogue);
}
// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Starts a streaming DM narrative response.
 *
 * Returns both a verified text stream (for SSE delivery) and a Promise for the
 * same complete text (for DB persistence). Output is emitted only after the
 * complete model response passes validation.
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
  const safePlayerInput = PlayerInputSchema.parse(playerInput);
  const contextResult = narrativeContext
    ? CombatNarrativeContextSchema.safeParse(narrativeContext)
    : null;
  if (contextResult && !contextResult.success) {
    return staticNarrativeStream(NEUTRAL_NARRATIVE_FALLBACK);
  }
  const safeNarrativeContext = contextResult?.data;
  const fallbackContext: CombatNarrativeContext = safeNarrativeContext ?? { facts: [] };

  // Shared promise that resolves once we know whether a level-up occurred.
  // Mutating tool callbacks are disconnected; text completion resolves this with null.
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

    const validation = validateNarrativeText(mockContent, safeNarrativeContext);
    if (!validation.ok) {
      mockContent = validatedFallbackProse(fallbackContext);
    } else {
      mockContent = mockContent.trim();
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

  // Backend-resolved facts (highest authority) and the extra safety rules that
  // accompany them are kept apart: the rules are stable instructions, the facts
  // are data.
  let safetyPrompt: ReturnType<typeof buildNarrativePrompt> | null = null;
  if (safeNarrativeContext) {
    try {
      safetyPrompt = buildNarrativePrompt(safeNarrativeContext);
    } catch {
      return staticNarrativeStream(NEUTRAL_NARRATIVE_FALLBACK);
    }
  }

  const context = await buildCampaignContext(campaignId);

  // Stable instructions go to `system`; every variable value — player input,
  // memory, logs, quest/NPC/location text — travels in the JSON data message.
  const request = buildNarratorRequest({
    personaInstructions: formatIronLaws(),
    extraInstructions: safetyPrompt?.system ?? null,
    canonicalState: formatCanonicalState(context),
    memory: context.relevantMemories,
    recentDialogue: context.recentLogs.map((log) => ({
      role: log.role,
      content: log.content,
    })),
    playerAction: safePlayerInput,
    backendResolvedFacts: safetyPrompt?.user ?? null,
  });

  const result = streamText({
    model: openai("gpt-4o-mini"),
    system: request.system,
    messages: request.messages,
    maxOutputTokens: 450,
    temperature: 0.2,
    stopWhen: stepCountIs(5),
    tools: buildNarratorTools(campaignId),
  });

  // Buffer every model response before emission. Streaming unsafe tokens cannot
  // be retracted, so validation must complete before the SSE text chunk exists.
  const optionalSteps = (result as { steps?: PromiseLike<Array<{ text: string }>> }).steps;
  const generatedTextPromise = optionalSteps
    ? Promise.resolve(optionalSteps).then((steps) => steps
        .map((step) => step.text)
        .filter((textPart) => textPart.trim().length > 0)
        .join('\n'))
    : Promise.resolve(result.text);
  const finalNarrativeTextPromise = generatedTextPromise.then((fullText) => {
    const validation = validateNarrativeText(fullText, safeNarrativeContext);
    return validation.ok ? fullText.trim() : validatedFallbackProse(fallbackContext);
  }).catch(() => {
    return validatedFallbackProse(fallbackContext);
  });

  const finalNarrativeTextStream = (async function* () {
    const verifiedText = await finalNarrativeTextPromise;
    yield verifiedText;
  })() as unknown as AsyncIterableStream<string>;

  // Fallback: if the text stream ends without a level-up tool call, resolve null.
  // Promise.resolve wraps the PromiseLike so we can chain .catch().
  // Promises resolve once, so the completion fallback is safe on every outcome.
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
