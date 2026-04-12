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
import { generateNPC, type NPCRole } from "@/lib/rules/npc";
import { searchMemories } from "@/lib/memory/search";
import type { AsyncIterableStream } from "ai";
import { getSpellInfo, getItemInfo, getMonsterInfo, queryMonsters } from "@/lib/ai/tools/srd-lookup";
import { generateQuest } from "@/lib/rules/quests";
import { prisma } from "@/lib/db/prisma";
import { computeXPAward } from "@/lib/rules/progression";
import { equipItem } from "@/lib/rules/inventory";
import { MonsterSchema, type Monster } from "@/lib/rules/srd";
import { buildEncounter, xpForCR, encounterMultiplier } from "@/lib/rules/encounters";
import {
  rollInitiative, acFromMonsterData, acFromInventory,
  computeConsequences, deriveCombatBeat, DAMAGE_TYPES,
  type DamageType, type EncounterSnapshot,
} from "@/lib/rules/combat";
import { abilityModifier } from "@/lib/rules/dice";

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
    getSpellInfo: tool({
      description:
        "Fetch exact mechanical JSON data for a spell by name or ID. MUST be used before narrating spell effects.",
      inputSchema: z.object({
        query: z.string().min(1).max(100),
      }).strict(),
      execute: async ({ query }) => {
        try {
          const data = await getSpellInfo(query);
          return data ? JSON.stringify(data) : JSON.stringify({ error: "Spell not found mechanically." });
        } catch {
          return JSON.stringify({ error: "Action failed mechanically." });
        }
      },
    }),
    getItemInfo: tool({
      description:
        "Fetch exact mechanical JSON data for an item or piece of equipment by name or ID. MUST be used before narrating the properties of magical or mundane items.",
      inputSchema: z.object({
        query: z.string().min(1).max(100),
      }).strict(),
      execute: async ({ query }) => {
        try {
          const data = await getItemInfo(query);
          return data ? JSON.stringify(data) : JSON.stringify({ error: "Item not found mechanically." });
        } catch {
          return JSON.stringify({ error: "Action failed mechanically." });
        }
      },
    }),
    getMonsterInfo: tool({
      description:
        "Fetch exact mechanical JSON data for a monster by name or ID. MUST be used before narrating combat encounters, describing enemy abilities, or resolving monster actions. Never invent AC, HP, or attack stats.",
      inputSchema: z.object({
        query: z.string().min(1).max(100),
      }).strict(),
      execute: async ({ query }) => {
        try {
          const data = await getMonsterInfo(query);
          return data
            ? JSON.stringify(data)
            : JSON.stringify({ error: "Monster not found mechanically." });
        } catch {
          return JSON.stringify({ error: "Action failed mechanically." });
        }
      },
    }),
    updateQuestStatus: tool({
      description:
        "Mark a quest as 'completed' or 'failed' when the narrative outcome definitively resolves it. The quest ID is provided in the system prompt under ## Active Quests. ONLY call this when the player has unambiguously succeeded or failed an objective — never speculatively.",
      inputSchema: z.object({
        questId: z.string().min(1).describe("The quest ID from the ## Active Quests section of the system prompt."),
        status: z.enum(["completed", "failed"]),
      }).strict(),
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
      inputSchema: z.object({
        giverId: z
          .string()
          .optional()
          .describe(
            "Seed of the NPC who is issuing this quest (e.g. 'innkeeper_saltmarsh_main'). " +
            "Omit for anonymous sources like bounty boards or posted notices."
          ),
      }).strict(),
      execute: async ({ giverId }) => {
        try {
          // Epoch-based seed ensures variety across sessions while keeping
          // the pure function deterministic for any given seed value.
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

    trackNPC: tool({
      description:
        "Persist an NPC into the campaign memory so they can be recalled in future sessions. " +
        "Call this the FIRST time you interact with a named NPC, and whenever their state " +
        "meaningfully changes (damage taken, disposition shift, plot relevance). " +
        "Use a stable, descriptive seed like 'innkeeper_saltmarsh_harborview' — " +
        "the same seed always maps to the same person. " +
        "Notes should be brief: who they are, their attitude toward the party, and any plot hooks.",
      inputSchema: z.object({
        seed: z
          .string()
          .min(1)
          .max(100)
          .describe(
            "Stable unique identifier for this NPC, e.g. 'blacksmith_ironhaven_old_marta'. " +
            "Must not change between calls for the same individual."
          ),
        role: z.enum(["guard", "bandit", "commoner"]),
        notes: z
          .string()
          .max(500)
          .optional()
          .describe("Brief DM notes: who they are, attitude, plot hooks. Max 500 chars."),
        hp: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Current HP — supply only if the NPC took damage this scene."),
      }).strict(),
      execute: async ({ seed, role, notes, hp }) => {
        try {
          const statblock = generateNPC(seed, role as NPCRole);
          await prisma.nPC.upsert({
            where: { campaignId_seed: { campaignId, seed } },
            create: {
              campaignId,
              seed,
              role,
              name: statblock.name,
              maxHp: statblock.maxHp,
              hp: hp ?? statblock.hp,
              ac: statblock.ac,
              notes: notes ?? "",
            },
            update: {
              ...(notes !== undefined && { notes }),
              ...(hp !== undefined && { hp }),
            },
          });
          return JSON.stringify({ ok: true, seed, name: statblock.name });
        } catch {
          return JSON.stringify({ error: "NPC tracking failed mechanically." });
        }
      },
    }),

    generateAndTrackNPC: tool({
      description:
        "Generate a fully-realized NPC with race, profession, alignment, ability scores, " +
        "and personality traits, then persist them to the campaign database. " +
        "Use this when introducing ANY new named character — even background figures. " +
        "The same seed always produces the same person, so a 'town_guard_gate' is the same " +
        "guard every time the party returns to that gate. " +
        "The returned summary includes personality traits — use them to drive immediate narration.",
      inputSchema: z.object({
        seed: z
          .string()
          .min(1)
          .max(100)
          .describe(
            "Stable unique identifier, e.g. 'blacksmith_ironhaven_oskar'. " +
            "Must not change between sessions for the same individual."
          ),
        role: z.enum(["guard", "bandit", "commoner"]),
        notes: z
          .string()
          .max(500)
          .optional()
          .describe("Brief contextual notes: plot relevance, attitude, last seen location."),
      }).strict(),
      execute: async ({ seed, role, notes }) => {
        try {
          const statblock = generateNPC(seed, role as NPCRole);
          await prisma.nPC.upsert({
            where: { campaignId_seed: { campaignId, seed } },
            create: {
              campaignId,
              seed,
              role,
              name:         statblock.name,
              maxHp:        statblock.maxHp,
              hp:           statblock.hp,
              ac:           statblock.ac,
              notes:        notes ?? "",
              race:         statblock.race,
              profession:   statblock.profession,
              alignment:    statblock.alignment,
              abilityScores: statblock.abilityScores as object,
              traits:       statblock.traits as object,
            },
            update: {
              // Always refresh rich fields — pure function guarantees consistency.
              race:         statblock.race,
              profession:   statblock.profession,
              alignment:    statblock.alignment,
              abilityScores: statblock.abilityScores as object,
              traits:       statblock.traits as object,
              ...(notes !== undefined && { notes }),
            },
          });
          return JSON.stringify({
            ok:          true,
            seed,
            name:        statblock.name,
            race:        statblock.race,
            profession:  statblock.profession,
            alignment:   statblock.alignment,
            traits:      statblock.traits,
          });
        } catch {
          return JSON.stringify({ error: "NPC generation failed mechanically." });
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
      inputSchema: z.object({
        characterId: z.string().min(1).describe("The character's ID from the Character State section."),
        amount: z.number().int().positive().describe("XP to award. Typical ranges: minor (10–50), moderate (100–300), major (300–1000)."),
        reason: z.string().min(1).max(200).describe("Brief reason for the award, e.g. 'Defeated the goblin ambush' or 'Convinced the merchant to reveal the smuggler'."),
      }).strict(),
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

    spawnEncounter: tool({
      description:
        "Spawn a new combat encounter by auto-selecting enemies from the SRD bestiary " +
        "using a Challenge Rating budget. Use this when the narrative leads to combat — " +
        "an ambush, dungeon room, wilderness encounter, or any hostile confrontation. " +
        "The tool creates the Encounter and Combatants in the database and rolls initiative. " +
        "After calling this tool, narrate the encounter opening using the returned enemy names " +
        "and their initiative positions. NEVER invent combat stats — always call this first.",
      inputSchema: z.object({
        targetCR: z
          .number()
          .min(0)
          .max(30)
          .describe(
            "Target Challenge Rating for the encounter (0–30). " +
            "Match to the party's level: 1/4 CR per level 1–4, CR ≈ level/4 for higher levels."
          ),
        theme: z
          .string()
          .optional()
          .describe(
            "Optional creature type filter, e.g. 'undead', 'beast', 'humanoid', 'dragon'. " +
            "Leave unset for a mixed encounter."
          ),
      }).strict(),
      execute: async ({ targetCR, theme }) => {
        try {
          const campaign = await prisma.campaign.findUnique({
            where: { id: campaignId },
            include: { character: { include: { inventory: true } } },
          });
          if (!campaign) return JSON.stringify({ error: "Campaign not found." });

          // Guard: only one active encounter at a time
          const existing = await prisma.encounter.findFirst({
            where: { campaignId, status: "active" },
          });
          if (existing) {
            return JSON.stringify({
              error: "An active encounter already exists.",
              encounterId: existing.id,
            });
          }

          // Query monsters from DB using typed columns (broad pool for budget math)
          const rawMonsters = await queryMonsters({
            type: theme,
            maxCR: targetCR === 0 ? 1 : Math.min(targetCR * 2, 30),
            limit: 30,
          });

          // Parse raw blobs into typed Monster[], tracking raw data for AC derivation
          const monsterPairs: Array<{ parsed: Monster; raw: Record<string, unknown> }> = [];
          for (const raw of rawMonsters) {
            const result = MonsterSchema.safeParse(raw);
            if (result.success) {
              monsterPairs.push({ parsed: result.data, raw: raw as Record<string, unknown> });
            }
          }

          const selectedMonsters = buildEncounter(
            targetCR,
            monsterPairs.map((p) => p.parsed),
            theme
          );

          if (selectedMonsters.length === 0) {
            return JSON.stringify({
              error: "No suitable monsters found for this encounter configuration.",
            });
          }

          // Derive player stats for initiative and AC
          const stats = campaign.character.stats as Record<string, number>;
          const playerDexMod = abilityModifier(stats.DEX ?? 10);
          const playerAC = acFromInventory(campaign.character.inventory, playerDexMod);

          // Build initiative inputs: player first, then each selected enemy
          const initiativeInputs = [
            {
              id: `player-${campaign.character.id}`,
              name: campaign.character.name,
              dexModifier: playerDexMod,
            },
            ...selectedMonsters.map((m, i) => ({
              id: `enemy-${i}`,
              name: m.name,
              dexModifier: abilityModifier(m.dexterity ?? 10),
            })),
          ];

          const { order } = rollInitiative(initiativeInputs);

          // Map initiative order back to full combatant data
          const combatantData = order.map((entry) => {
            const isPlayer = entry.id.startsWith("player-");
            if (isPlayer) {
              return {
                name: campaign.character.name,
                isPlayer: true,
                hp: campaign.character.hp,
                maxHp: campaign.character.maxHp,
                ac: playerAC,
                initiativeTotal: entry.initiative,
              };
            }
            const idx = parseInt(entry.id.replace("enemy-", ""), 10);
            const monster = selectedMonsters[idx];
            const pair = monsterPairs.find((p) => p.parsed === monster);
            const rawData = pair?.raw ?? {};
            return {
              name: monster.name,
              isPlayer: false,
              hp: monster.hit_points,
              maxHp: monster.hit_points,
              ac: acFromMonsterData(rawData),
              initiativeTotal: entry.initiative,
            };
          });

          const encounter = await prisma.encounter.create({
            data: {
              campaignId,
              status: "active",
              round: 1,
              currentTurnIndex: 0,
              combatants: { create: combatantData },
            },
            include: {
              combatants: { orderBy: { initiativeTotal: "desc" } },
            },
          });

          // Compute encounter XP summary for the narrator
          const rawXP = selectedMonsters.reduce(
            (sum, m) => sum + xpForCR(m.challenge_rating ?? 0),
            0
          );
          const adjustedXP = Math.round(
            rawXP * encounterMultiplier(selectedMonsters.length)
          );

          return JSON.stringify({
            ok: true,
            encounterId: encounter.id,
            enemies: selectedMonsters.map((m) => ({
              name: m.name,
              cr: m.challenge_rating ?? 0,
              hp: m.hit_points,
            })),
            adjustedXP,
            initiativeOrder: encounter.combatants.map((c) => ({
              name: c.name,
              initiative: c.initiativeTotal,
              isPlayer: c.isPlayer,
            })),
          });
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
      inputSchema: z.object({
        attackerId: z
          .string()
          .min(1)
          .describe("Combatant ID of the attacker (from initiative order)."),
        targetId: z
          .string()
          .min(1)
          .describe("Combatant ID of the target (from initiative order)."),
        weaponDamageDice: z
          .string()
          .min(1)
          .describe("Dice notation for the weapon's damage, e.g. '1d8', '2d6'."),
        attackModifier: z
          .number()
          .int()
          .describe("Total attack modifier (proficiency + ability mod, etc)."),
        damageType: z
          .enum(DAMAGE_TYPES as [DamageType, ...DamageType[]])
          .describe("Damage type — must be a valid SRD damage type."),
      }).strict(),
      execute: async ({ attackerId, targetId, weaponDamageDice, attackModifier, damageType }) => {
        try {
          const encounter = await prisma.encounter.findFirst({
            where: { campaignId, status: "active" },
            include: { combatants: true },
          });
          if (!encounter) {
            return JSON.stringify({ error: "No active encounter found." });
          }

          const attacker = encounter.combatants.find((c) => c.id === attackerId);
          const defender = encounter.combatants.find((c) => c.id === targetId);
          if (!defender) {
            return JSON.stringify({ error: `Target combatant '${targetId}' not found in encounter.` });
          }

          const enemyCombatants = encounter.combatants.filter((c) => !c.isPlayer);
          const encStatus: "active" | "resolved" | "fled" =
            encounter.status === "active" ? "active" : "resolved";
          const snapshot: EncounterSnapshot = {
            round: encounter.round,
            totalDamageDealt: (encounter as any).totalDamageDealt ?? 0,
            status: encStatus,
            currentBeat: "opening",
            defenderId: targetId,
            combatants: encounter.combatants.map((c) => ({
              id: c.id,
              isPlayer: c.isPlayer,
              hp: c.hp,
              maxHp: c.maxHp,
              hpBeforeThisTurn: c.hp, // approximation — no per-turn history yet
              isBoss: !c.isPlayer && enemyCombatants.length === 1,
            })),
          };

          const consequences = computeConsequences({
            attacker: attacker?.name ?? attackerId,
            defender: defender.name,
            weapon: weaponDamageDice,
            weaponDice: weaponDamageDice,
            attackModifier,
            damageType,
            targetAC: defender.ac,
            targetHp: defender.hp,
            targetMaxHp: defender.maxHp,
            targetIsPlayer: defender.isPlayer,
            targetIsBoss: !defender.isPlayer && enemyCombatants.length === 1,
            statusApplied: [],
            encounterSnapshot: snapshot,
            usedSenses: [],
            zones: [],
          });

          // Re-derive beat with corrected totalDamageDealt (post-roll)
          const correctedTotal =
            snapshot.totalDamageDealt + consequences.combat_facts.damage;
          const finalBeat = deriveCombatBeat(
            { ...snapshot, totalDamageDealt: correctedTotal },
            consequences.combat_facts
          );
          const finalConsequences = { ...consequences, combat_beat: finalBeat };

          // Persist HP change only when damage was dealt
          const { hp_after, damage } = consequences.combat_facts;
          if (damage > 0) {
            await prisma.combatant.update({
              where: { id: targetId },
              data: { hp: hp_after },
            });
          }

          return JSON.stringify({ ok: true, ...finalConsequences });
        } catch {
          return JSON.stringify({ error: "Attack resolution failed mechanically." });
        }
      },
    }),

    manageEquipment: tool({
      description:
        "Equip an item from the character's inventory into a specific gear slot. " +
        "Enforces slot exclusivity — the prior occupant of the slot is automatically unequipped. " +
        "Call this when the player explicitly equips, wields, dons, or switches a piece of gear. " +
        "NEVER narrate an item as equipped without calling this tool first.",
      inputSchema: z.object({
        characterId: z.string().min(1).describe("The character's ID from the Character State section."),
        itemId: z.string().min(1).describe("The inventory item ID to equip."),
        targetSlot: z
          .enum(["MAIN_HAND", "OFF_HAND", "ARMOR", "ACCESSORY"])
          .describe("The gear slot to equip the item into."),
      }).strict(),
      execute: async ({ characterId, itemId, targetSlot }) => {
        try {
          const rawItems = await prisma.inventoryItem.findMany({
            where: { characterId },
            select: {
              id: true,
              characterId: true,
              name: true,
              type: true,
              quantity: true,
              properties: true,
              equippedSlot: true,
            },
          });

          const updated = equipItem(itemId, targetSlot, rawItems);

          // Persist only items whose equippedSlot changed.
          const changed = updated.filter(
            (item, i) => item.equippedSlot !== rawItems[i].equippedSlot
          );
          await Promise.all(
            changed.map((item) =>
              prisma.inventoryItem.update({
                where: { id: item.id },
                data: { equippedSlot: item.equippedSlot ?? null },
              })
            )
          );

          const equippedItem = updated.find((i) => i.id === itemId);
          return JSON.stringify({
            ok: true,
            itemId,
            targetSlot,
            itemName: equippedItem?.name ?? itemId,
          });
        } catch (e) {
          if (e instanceof RangeError) {
            return JSON.stringify({ error: e.message });
          }
          return JSON.stringify({ error: "Equipment update failed mechanically." });
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
