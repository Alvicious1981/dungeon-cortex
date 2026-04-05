/**
 * lib/memory/consolidator.ts
 *
 * Background memory consolidation for Milestone G.
 *
 * Responsibility: receive a slice of GameLog entries, ask the LLM to produce
 * a concise third-person summary, and persist it as a MemoryEntry via
 * saveMemory. This converts raw chat history into compact, queryable memory.
 *
 * Architecture contract ("Code is Law"):
 *   - This module is write-only from the game-state perspective. It never
 *     reads canonical state or influences rules resolution.
 *   - The summary is labelled as a derived consolidation, not a canonical
 *     record. If the LLM summary conflicts with live state tables, the live
 *     tables win.
 *   - Any failure here is silent: the main game loop must never crash because
 *     a background consolidation step failed.
 */

import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import type { GameLog } from "@/app/generated/prisma/client";
import { saveMemory } from "@/lib/memory/store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Maps a GameLog role value to a readable label for the consolidation prompt. */
function roleLabel(role: string): string {
  switch (role) {
    case "user":      return "Player";
    case "assistant": return "DM";
    case "system":    return "System";
    default:          return role;
  }
}

/**
 * Formats a GameLog[] into a single text block for the summarisation prompt.
 * Oldest entry first (natural reading order).
 */
function buildLogBlock(logs: GameLog[]): string {
  return logs
    .map((log) => `${roleLabel(log.role)}: ${log.content}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Summarises a sequence of GameLog entries and stores the result as a
 * MemoryEntry for future semantic recall.
 *
 * Designed to run in the background after state mutations are complete.
 * Never throws — all failures are caught, logged, and swallowed.
 *
 * @param campaignId - The campaign these logs belong to.
 * @param logs       - The GameLog slice to consolidate (oldest-first preferred).
 */
export async function summarizeAndStore(
  campaignId: string,
  logs: GameLog[]
): Promise<void> {
  if (logs.length === 0) return;

  try {
    const logBlock = buildLogBlock(logs);

    const { text: summary } = await generateText({
      model: openai("gpt-4o-mini"),
      system: [
        "You are a clinical record-keeper for a tabletop RPG campaign.",
        "Summarize the following sequence of game events in one concise paragraph.",
        "Focus strictly on: locations visited, mechanical outcomes (damage dealt, items used, spells cast, HP changes), and decisions made.",
        "Do not use dialogue, flowery prose, or embellishment.",
        "Write in third-person past tense. Be brief and factual.",
      ].join(" "),
      prompt: logBlock,
    });

    if (!summary.trim()) {
      console.error("[consolidator] LLM returned empty summary — skipping memory write.");
      return;
    }

    await saveMemory(campaignId, summary.trim());
  } catch (err) {
    console.error("[consolidator] Failed to consolidate memory for campaign", campaignId, err);
  }
}
