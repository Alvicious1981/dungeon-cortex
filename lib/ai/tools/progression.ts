import { tool } from "ai";
import { prisma } from "@/lib/db/prisma";
import {
  TriggerLevelUpInputSchema,
  AwardXPInputSchema,
  UpdateQuestStatusInputSchema,
  type LevelUpPayload,
} from "@/lib/rules/progression";
import { applyExperienceAward } from "@/lib/rules/progression-service";
import { applyLevelUp } from "@/lib/rules/level-up-service";
import { generateQuest, GenerateAndTrackQuestInputSchema } from "@/lib/rules/quests";
import { seededFloat } from "@/lib/rules/generators";

export function buildProgressionTools(
  campaignId: string,
  callbacks?: { onLevelUp?: (payload: LevelUpPayload) => void }
) {
  return {
    updateQuestStatus: tool({
      description:
        "Mark a quest as 'completed' or 'failed' when the narrative outcome definitively resolves it. The quest ID is provided in the system prompt under ## Active Quests. ONLY call this when the player has unambiguously succeeded or failed an objective — never speculatively.",
      inputSchema: UpdateQuestStatusInputSchema,
      execute: async ({ questId, status }) => {
        try {
          await prisma.quest.update({ where: { id: questId }, data: { status } });
          return JSON.stringify({ ok: true, questId, status });
        } catch {
          return JSON.stringify({ error: "Quest update failed mechanically." });
        }
      },
    }),

    generateAndTrackQuest: tool({
      description:
        "Generate a new procedural quest and persist it to the campaign database. " +
        "Use this when the player inspects a bounty board, asks an NPC for work, " +
        "hears a rumor at a tavern, or otherwise seeks a new objective. " +
        "The tool returns the full quest details — title, hook, location, objective, and reward — " +
        "which the narrator MUST use verbatim when presenting the quest to the player. " +
        "NEVER invent quest details without calling this tool first.",
      inputSchema: GenerateAndTrackQuestInputSchema,
      execute: async ({ giverId }) => {
        try {
          const seedKey = `${campaignId}:quest:${giverId ?? "anon"}`;
          const seed = Math.floor(seededFloat(seedKey) * Number.MAX_SAFE_INTEGER);
          const questData = generateQuest(seed, giverId);

          const quest = await prisma.quest.create({
            data: {
              campaignId,
              title:       questData.title,
              description: questData.description,
              status:      "active",
              giverId:     questData.giverId ?? null,
              location:    questData.location,
              hook:        questData.hook,
              objective:   questData.objective,
              reward:      questData.reward,
            },
          });

          return JSON.stringify({
            ok:        true,
            questId:   quest.id,
            title:     questData.title,
            hook:      questData.hook,
            location:  questData.location,
            objective: questData.objective,
            reward:    questData.reward,
          });
        } catch {
          return JSON.stringify({ error: "Quest generation failed mechanically." });
        }
      },
    }),
    awardXP: tool({
      description:
        "Request an experience award for a resolved player-character achievement. " +
        "The backend validates and persists XP and level state, then returns structured facts. " +
        "Use the returned facts only to describe already resolved progression.",
      inputSchema: AwardXPInputSchema,
      execute: async ({ characterId, amount, reason }) => {
        try {
          const result = await applyExperienceAward({
            campaignId,
            characterId,
            xpAmount: amount,
            reason,
            source: "awardXP",
          });
          return JSON.stringify(result);
        } catch {
          return JSON.stringify({ error: "XP award failed mechanically." });
        }
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
        try {
          const result = await applyLevelUp({
            campaignId,
            characterId,
            useAverage,
            source: "triggerLevelUp",
          });

          callbacks?.onLevelUp?.(result);

          return JSON.stringify(result);
        } catch {
          return JSON.stringify({ error: "Level-up resolution failed mechanically." });
        }
      },
    }),
  };
}
