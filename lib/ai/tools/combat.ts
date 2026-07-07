import { tool } from "ai";
import { SpawnEncounterInputSchema } from "@/lib/rules/encounters";
import { ResolveAttackInputSchema } from "@/lib/rules/combat";
import { CombatServiceError, resolveCombatAttack } from "@/lib/rules/combat-service";
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
        try {
          const result = await spawnCombatEncounter({
            campaignId,
            targetCR,
            theme,
          });

          return JSON.stringify(result);
        } catch {
          return JSON.stringify({ error: "Encounter spawning failed mechanically." });
        }
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
        try {
          const result = await resolveCombatAttack({
            campaignId,
            attackerId,
            targetId,
            weaponDamageDice,
            attackModifier,
            damageType,
          });

          return JSON.stringify(result);
        } catch (error) {
          if (error instanceof CombatServiceError) {
            return JSON.stringify({ error: error.message });
          }

          return JSON.stringify({ error: "Attack resolution failed mechanically." });
        }
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
        try {
          const result = await grantLoot({
            campaignId,
            encounterId,
            tensionScore,
            source: "generateLoot",
          });

          return JSON.stringify({
            ok: true,
            ...(result.loot ?? { gold: result.gold, items: result.items }),
            facts: result.facts,
          });
        } catch {
          return JSON.stringify({ error: "Loot generation failed mechanically." });
        }
      },
    }),
  };
}
