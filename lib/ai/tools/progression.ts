import { tool } from "ai";
import { prisma } from "@/lib/db/prisma";
import {
  computeXPAward,
  buildLevelUpPayload,
  TriggerLevelUpInputSchema,
  LevelUpPayloadSchema,
  AwardXPInputSchema,
  UpdateQuestStatusInputSchema,
  type LevelUpPayload,
} from "@/lib/rules/progression";
import type { CharacterClass } from "@/lib/rules/proficiency";
import { generateQuest, GenerateAndTrackQuestInputSchema } from "@/lib/rules/quests";

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
          const seed = Date.now();
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
        "Award experience points to the player character for narrative achievements — " +
        "defeating enemies, completing objectives, clever problem-solving, or exceptional roleplay. " +
        "YOU HAVE AUTHORITY to decide when and how much XP to award; do not wait to be asked. " +
        "The tool detects level-up automatically and returns whether one occurred. " +
        "When leveledUp is true, narrate the level-up as a significant moment.",
      inputSchema: AwardXPInputSchema,
      execute: async ({ characterId, amount, reason }) => {
        try {
          const character = await prisma.character.findUnique({
            where: { id: characterId },
            select: { xp: true, level: true },
          });
          if (!character) return JSON.stringify({ error: "Character not found." });

          const { newXP, newLevel, leveledUp } = computeXPAward(
            character.xp,
            character.level,
            amount
          );

          await prisma.character.update({
            where: { id: characterId },
            data: {
              xp: newXP,
              ...(leveledUp && { level: newLevel }),
            },
          });

          return JSON.stringify({ ok: true, newXP, newLevel, leveledUp, reason });
        } catch {
          return JSON.stringify({ error: "XP award failed mechanically." });
        }
      },
    }),

    triggerLevelUp: tool({
      description:
        "Resolve the mechanical effects of a character level-up. " +
        "MUST be called immediately after `awardXP` returns `leveledUp: true`. " +
        "Rolls the class-specific hit die + CON modifier to determine HP gained, " +
        "updates maxHp, hp, level, and hit dice in the database, " +
        "and returns the full LevelUpPayload for narration. " +
        "NEVER invent HP increases, stat changes, or level-up effects without calling this tool. " +
        "Code is Law.",
      inputSchema: TriggerLevelUpInputSchema,
      execute: async ({ characterId, useAverage }) => {
        try {
          const character = await prisma.character.findUnique({
            where: { id: characterId },
            select: { class: true, level: true, maxHp: true, hp: true, stats: true, hitDiceTotal: true },
          });
          if (!character) return JSON.stringify({ error: "Character not found." });

          // Safely extract CON from the stats JSON blob.
          const stats = character.stats as Record<string, number> | null;
          const con = typeof stats?.CON === "number" ? stats.CON : 10;
          const conModifier = Math.floor((con - 10) / 2);

          const payload = buildLevelUpPayload({
            characterId,
            className: character.class as CharacterClass,
            previousLevel: character.level - 1,
            newLevel: character.level,
            currentMaxHp: character.maxHp,
            conModifier,
            useAverage,
          });

          // Validate — belt-and-suspenders before any DB write.
          LevelUpPayloadSchema.parse(payload);

          await prisma.character.update({
            where: { id: characterId },
            data: {
              maxHp:             payload.newMaxHp,
              hp:                payload.newMaxHp,  // full heal on level-up
              hitDiceTotal:      payload.newHitDiceTotal,
              hitDiceRemaining:  payload.newHitDiceTotal,  // reset remaining on level-up
            },
          });

          // Notify the stream so the client receives the payload as an SSE frame.
          callbacks?.onLevelUp?.(payload);

          return JSON.stringify(payload);
        } catch {
          return JSON.stringify({ error: "Level-up resolution failed mechanically." });
        }
      },
    }),
  };
}
