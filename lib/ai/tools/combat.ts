import { tool } from "ai";
import { runTool } from "@/lib/ai/tool-result";
import { SpawnEncounterInputSchema } from "@/lib/rules/encounters";
import { ResolveAttackInputSchema } from "@/lib/rules/combat";
import { resolveCombatAttack } from "@/lib/rules/combat-service";
import { spawnCombatEncounter } from "@/lib/rules/encounter-service";
import { GenerateLootInputSchema } from "@/lib/rules/loot";
import { grantLoot } from "@/lib/rules/loot-service";

export function buildCombatTools(campaignId: string) {
  return {
    spawnEncounter: tool({
      description:
        "Spawn a new combat encounter by auto-selecting enemies from the SRD bestiary " +
        "using a Challenge Rating budget. Use this when the narrative leads to combat — " +
        "an ambush, dungeon room, wilderness encounter, or any hostile confrontation. " +
        "The tool creates the Encounter and Combatants in the database and rolls initiative. " +
        "After calling this tool, narrate the encounter opening using the returned enemy names " +
        "and their initiative positions. NEVER invent combat stats — always call this first.",
      inputSchema: SpawnEncounterInputSchema,
      execute: async ({ targetCR, theme }) => {
        return runTool(() =>
          spawnCombatEncounter({
            campaignId,
            targetCR,
            theme,
          }),
        );
      },
    }),

    resolveAttack: tool({
      description:
        "Resolve a single attack action through the Consequences Engine. " +
        "Rolls damage, picks hit location, computes overkill, tension, narrative intensity, " +
        "and combat beat — then persists the HP change to the database. " +
        "YOU MUST call this before narrating ANY attack. " +
        "Base every combat narration on the returned combat_facts, narrative_tags, " +
        "hit_location, combat_beat, narrative_intensity, and style_dsl. " +
        "NEVER invent damage numbers, hit locations, or overkill values.",
      inputSchema: ResolveAttackInputSchema,
      execute: async ({ attackerId, targetId, weaponDamageDice, attackModifier, damageType }) => {
        return runTool(() =>
          resolveCombatAttack({
            campaignId,
            attackerId,
            targetId,
            weaponDamageDice,
            attackModifier,
            damageType,
          }),
        );
      },
    }),

    generateLoot: tool({
      description:
        "Generate the loot reward for a resolved combat encounter. " +
        "MUST be called IMMEDIATELY after an encounter ends with all enemies dead. " +
        "The Tension Score from the encounter determines rarity and value. " +
        "Returns gold, mundane items, magic items, and flavor text. " +
        "You MUST narrate the loot using ONLY the returned item names, descriptions, " +
        "and gold amount — NEVER invent treasure or modify values.",
      inputSchema: GenerateLootInputSchema,
      execute: async ({ encounterId, tensionScore }) => {
        return runTool(async () => {
          const result = await grantLoot({
            campaignId,
            encounterId,
            tensionScore,
            source: "generateLoot",
          });

          return {
            ...(result.loot ?? { gold: result.gold, items: result.items }),
            facts: result.facts,
          };
        });
      },
    }),
  };
}
