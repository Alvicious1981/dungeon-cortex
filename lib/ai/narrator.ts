/**
 * lib/ai/narrator.ts
 *
 * AI narration pipeline for Milestone D — Memory and continuity.
 *
 * Assembles full campaign context, formats it into a structured system prompt,
 * then calls the language model to generate the DM's narrative response.
 *
 * Architecture contract ("Code is Law"):
 *   - This module ONLY narrates. It never resolves rules or mutates state.
 *   - All game state passed in is already validated and persisted by the caller.
 *   - The model receives context as read-only reference; it cannot change it.
 *
 * Model choice: gpt-4o-mini — fast and cost-effective for real-time narration.
 * Swap the model string here when upgrading; no other code needs to change.
 */

import { generateText, tool, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { buildCampaignContext } from "@/lib/memory/context";
import { formatSystemPrompt } from "@/lib/memory/formatter";
import { generateTavernName, generateMundaneLoot } from "@/lib/rules/generators";
import { generateNPC } from "@/lib/rules/npc";
import { searchMemories } from "@/lib/memory/search";

/**
 * Generates a DM narrative response for a player's action within a campaign.
 *
 * Steps:
 *   1. Fetch live campaign context (character, encounter, recent logs)
 *   2. Format it into a structured system prompt section
 *   3. Call the LLM with the system context + player input as the prompt
 *   4. Return the generated narrative text
 *
 * @param campaignId  - The campaign to narrate for.
 * @param playerInput - The player's raw action text.
 * @returns           The AI DM's narrative response.
 * @throws            If the campaign is not found or the LLM call fails.
 */
export async function generateNarrative(
  campaignId: string,
  playerInput: string
): Promise<string> {
  const context = await buildCampaignContext(campaignId);
  const system = formatSystemPrompt(context);

  const { text } = await generateText({
    model: openai("gpt-4o-mini"),
    system,
    prompt: playerInput,
    stopWhen: stepCountIs(5),
    tools: {
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
    },
  });

  return text;
}
