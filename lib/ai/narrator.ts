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
import { formatIronLaws, formatCanonicalState } from "@/lib/memory/formatter";
import { buildNarratorRequest } from "@/lib/ai/trust-boundary";
import { getActiveNarratorToolNames } from "@/lib/ai/tool-policy";
import type { AsyncIterableStream } from "ai";
import { buildWildernessTool } from "@/lib/ai/tools/wilderness";
import { buildCombatTools } from "@/lib/ai/tools/combat";
import { buildProgressionTools } from "@/lib/ai/tools/progression";
import { buildSocialTools } from "@/lib/ai/tools/social";
import { buildExplorationTools } from "@/lib/ai/tools/exploration";
import { buildWorldTools } from "@/lib/ai/tools/world";
import { buildInventoryTools } from "@/lib/ai/tools/inventory";
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
  };
}

/** Every tool name in the catalogue. */
type NarratorToolName = keyof ReturnType<typeof buildTools>;

/**
 * Least-privilege tool containment (SEC-AI-001).
 *
 * Resolved once, at module load, from the policy constant. The type annotation
 * makes the compiler reject any name that is not a real catalogue key, and the
 * absence of parameters makes it impossible for campaign state, scene, player
 * input, memory, dialogue or tool output to widen the set.
 *
 * TEMPORARY: the remaining catalogue tools stay defined but inactive until
 * SEC-AI-001 PR 3.
 */
const ACTIVE_NARRATOR_TOOLS: readonly NarratorToolName[] = getActiveNarratorToolNames();

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

  // Backend-resolved facts (highest authority) and the extra safety rules that
  // accompany them are kept apart: the rules are stable instructions, the facts
  // are data.
  const safetyPrompt = narrativeContext ? buildNarrativePrompt(narrativeContext) : null;

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
    playerAction: playerInput,
    backendResolvedFacts: safetyPrompt?.user ?? null,
  });

  const result = streamText({
    model: openai("gpt-4o-mini"),
    system: request.system,
    messages: request.messages,
    stopWhen: stepCountIs(5),
    tools: buildTools(campaignId, {
      onLevelUp: (payload) => resolveLevelUp(payload),
      onMerchantGenerated: (payload) => resolveMerchant(payload),
    }),
    // Least-privilege containment: the full catalogue is registered, but only
    // the fixed read-only subset is callable. Never recomputed per step.
    activeTools: [...ACTIVE_NARRATOR_TOOLS],
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
