import { tool } from "ai";
import { runTool } from "@/lib/ai/tool-result";
import {
  TriggerLevelUpInputSchema,
  AwardXPInputSchema,
  UpdateQuestStatusInputSchema,
  type LevelUpPayload,
} from "@/lib/rules/progression";
import { applyExperienceAward } from "@/lib/rules/progression-service";
import { applyLevelUp } from "@/lib/rules/level-up-service";
import { GenerateAndTrackQuestInputSchema } from "@/lib/rules/quests";
import {
  createTrackedQuest,
  updateQuestStatus as updateTrackedQuestStatus,
} from "@/lib/rules/quest-service";

export function buildProgressionTools(
  campaignId: string,
  callbacks?: { onLevelUp?: (payload: LevelUpPayload) => void }
) {
  return {
    updateQuestStatus: tool({
      description:
        "Mark a quest as 'completed' or 'failed' after the backend-resolved outcome definitively settles it. The quest ID is provided in the system prompt under ## Active Quests. ONLY call this when the player has unambiguously succeeded or failed an objective - never speculatively.",
      inputSchema: UpdateQuestStatusInputSchema,
      execute: async ({ questId, status }) => {
        return runTool(() =>
          updateTrackedQuestStatus({
            campaignId,
            questId,
            status,
            reason: "ai_tool_updateQuestStatus",
          }),
        );
      },
    }),

    generateAndTrackQuest: tool({
      description:
        "Generate a new procedural quest and persist it to the campaign database. " +
        "Use this when the player inspects a bounty board, asks an NPC for work, " +
        "hears a rumor at a tavern, or otherwise seeks a new objective. " +
        "The tool returns backend-resolved quest details: title, hook, location, objective, and reward. " +
        "NEVER invent quest details without calling this tool first.",
      inputSchema: GenerateAndTrackQuestInputSchema,
      execute: async ({ giverId }) => {
        return runTool(() =>
          createTrackedQuest({
            campaignId,
            context: "ai_tool_generateAndTrackQuest",
            giverId,
          }),
        );
      },
    }),
    awardXP: tool({
      description:
        "Request an experience award for a resolved player-character achievement. " +
        "The backend validates and persists XP and level state, then returns structured facts. " +
        "Use the returned facts only to describe already resolved progression.",
      inputSchema: AwardXPInputSchema,
      execute: async ({ characterId, amount, reason }) => {
        return runTool(() =>
          applyExperienceAward({
            campaignId,
            characterId,
            xpAmount: amount,
            reason,
            source: "awardXP",
          }),
        );
      },
    }),
    triggerLevelUp: tool({
      description:
        "Request backend resolution for the physical effects of a character level-up. " +
        "MUST be called immediately after `awardXP` returns `leveledUp: true`. " +
        "The backend validates XP and persisted level state, updates HP and hit dice, " +
        "and returns structured level-up facts for narration. " +
        "NEVER invent HP increases, stat changes, or level-up effects without backend facts. " +
        "Code is Law.",
      inputSchema: TriggerLevelUpInputSchema,
      execute: async ({ characterId, useAverage }) => {
        return runTool(async () => {
          const result = await applyLevelUp({
            campaignId,
            characterId,
            useAverage,
            source: "triggerLevelUp",
          });

          callbacks?.onLevelUp?.(result);

          return result;
        });
      },
    }),
  };
}
