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

import { streamText, tool, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { buildCampaignContext } from "@/lib/memory/context";
import { formatSystemPrompt } from "@/lib/memory/formatter";
import { generateTavernName, generateMundaneLoot } from "@/lib/rules/generators";
import { generateNPC } from "@/lib/rules/npc";
import { searchMemories } from "@/lib/memory/search";
import type { AsyncIterableStream } from "ai";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NarrativeStream {
  /** Token-by-token async iterable — consume to stream to the client. */
  textStream: AsyncIterableStream<string>;
  /** Resolves to the full assembled text once the LLM finishes. */
  textPromise: PromiseLike<string>;
}

// ─── Tool definitions (shared) ────────────────────────────────────────────────

function buildTools(campaignId: string) {
  return {
    getTavernName: tool({
      description:
        "Get the canonical, deterministic name of a tavern for a given location ID.",
      inputSchema: z.object({
        locationId: z.string().min(1).max(100),
      }).strict(),
      execute: async ({ locationId }) => {
        try {
          return generateTavernName(locationId);
        } catch {
          return JSON.stringify({ error: "Action failed mechanically. Narrate a brief failure or silence." });
        }
      },
    }),
    getMundaneLoot: tool({
      description:
        "Get the deterministic mundane loot found on an entity or in a container.",
      inputSchema: z.object({
        entityId: z.string().min(1).max(100),
      }).strict(),
      execute: async ({ entityId }) => {
        try {
          return generateMundaneLoot(entityId);
        } catch {
          return JSON.stringify({ error: "Action failed mechanically. Narrate a brief failure or silence." });
        }
      },
    }),
    recallLore: tool({
      description:
        "Search the campaign's semantic memory for lore, past events, or specific details. Use this when the player references something you don't have in your current context.",
      inputSchema: z.object({
        query: z.string().min(1).max(200),
      }).strict(),
      execute: async ({ query }) => {
        try {
          return await searchMemories(campaignId, query);
        } catch {
          return JSON.stringify({ error: "Memory recall failed mechanically." });
        }
      },
    }),
    getNPCDetails: tool({
      description:
        "Get the deterministic statblock and persistent proper name of an NPC. Use this before narrating interactions with unknown or generic NPCs. The attackString field is dice notation (e.g. '1d6+2'), not a pre-rolled number.",
      inputSchema: z.object({
        seed: z.string().min(1).max(100).describe(
          "A unique, stable identifier for this specific NPC, e.g., 'town_guard_north_gate'"
        ),
        role: z.enum(["guard", "bandit", "commoner"]),
      }).strict(),
      execute: async ({ seed, role }) => {
        try {
          return generateNPC(seed, role);
        } catch {
          return JSON.stringify({ error: "Action failed mechanically. Narrate a brief failure or silence." });
        }
      },
    }),
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
  const context = await buildCampaignContext(campaignId);
  const system = formatSystemPrompt(context);

  const result = streamText({
    model: openai("gpt-4o-mini"),
    system,
    prompt: playerInput,
    stopWhen: stepCountIs(5),
    tools: buildTools(campaignId),
  });

  return {
    textStream: result.textStream,
    textPromise: result.text,
  };
}
