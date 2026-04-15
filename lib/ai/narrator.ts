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
import {
  computeXPAward,
  buildLevelUpPayload,
  TriggerLevelUpInputSchema,
  LevelUpPayloadSchema,
  EXPLORATION_XP,
  type LevelUpPayload,
} from "@/lib/rules/progression";
import type { CharacterClass } from "@/lib/rules/proficiency";
import { equipItem } from "@/lib/rules/inventory";
import { MonsterSchema, type Monster } from "@/lib/rules/srd";
import { buildEncounter, xpForCR, encounterMultiplier } from "@/lib/rules/encounters";
import {
  rollInitiative, acFromMonsterData, acFromInventory,
  computeConsequences, deriveCombatBeat, DAMAGE_TYPES,
  type DamageType, type EncounterSnapshot,
} from "@/lib/rules/combat";
import { abilityModifier } from "@/lib/rules/dice";
import {
  GenerateLootInputSchema,
  generateLootPayload,
} from "@/lib/rules/loot";
import {
  GenerateLocationInputSchema,
  MoveToNodeInputSchema,
  LocationPayloadSchema,
  generateLocationPayload,
  canMoveToNode,
  advanceTurn,
  consumeResources,
  checkRandomEncounter,
  applyRest,
  REST_INTERVAL_TURNS,
  type CampaignTimeState,
  type PartyInventoryState,
  type EdgePayload,
  type PassageType,
} from "@/lib/rules/exploration";
import {
  GenerateMerchantInputSchema,
  TradeActionSchema,
  buildMerchantPayload,
  type MerchantPayload,
} from "@/lib/rules/trade";
import {
  rollReaction as rollReactionPure,
  resolveSocialCheck,
  getRumorsPayload,
  ReactionRollInputSchema,
  SocialCheckInputSchema,
  GetRumorsInputSchema,
} from "@/lib/rules/social";

// ─── Types ────────────────────────────────────────────────────────────────────

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
            totalDamageDealt: encounter.totalDamageDealt,
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

          // Persist HP change and encounter-wide damage total only when damage was dealt.
          // This ensures the "Code is Law" pillar: state must be persisted before narration.
          const { hp_after, damage } = consequences.combat_facts;
          if (damage > 0) {
            await prisma.$transaction([
              prisma.combatant.update({
                where: { id: targetId },
                data: { hp: hp_after },
              }),
              prisma.encounter.update({
                where: { id: encounter.id },
                data: { totalDamageDealt: { increment: damage } },
              }),
            ]);
          }

          return JSON.stringify({ ok: true, ...finalConsequences });
        } catch {
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
          const encounter = await prisma.encounter.findUnique({
            where: { id: encounterId },
            include: { combatants: true },
          });
          if (!encounter) {
            return JSON.stringify({ error: "Encounter not found." });
          }

          const campaign = await prisma.campaign.findUnique({
            where: { id: campaignId },
            select: { characterId: true },
          });
          if (!campaign) {
            return JSON.stringify({ error: "Campaign not found." });
          }

          const enemies = encounter.combatants.filter((c) => !c.isPlayer);
          const payload = generateLootPayload({
            tensionScore,
            enemyCount: enemies.length,
            avgCR: 1, // simplified — no CR on Combatant; future: SrdMonster lookup by name
            seed: encounterId,
          });

          const allItems = [...payload.mundaneItems, ...payload.magicItems];
          await prisma.$transaction([
            prisma.campaign.update({
              where: { id: campaignId },
              data: { gold: { increment: payload.gold } },
            }),
            ...allItems.map((item) =>
              prisma.inventoryItem.create({
                data: {
                  characterId: campaign.characterId,
                  name: item.name,
                  type: item.type,
                  quantity: 1,
                  properties: item.properties as object,
                },
              })
            ),
          ]);

          return JSON.stringify({ ok: true, ...payload });
        } catch {
          return JSON.stringify({ error: "Loot generation failed mechanically." });
        }
      },
    }),

    generateLocation: tool({
      description:
        "Generate a new procedural location when the player travels, explores, " +
        "or enters a new area. Creates a persistent graph of interconnected rooms/zones " +
        "that the player navigates node-by-node. " +
        "MUST be called BEFORE narrating any new environment. " +
        "NEVER describe rooms, exits, NPCs, or spatial layout that isn't in the response. " +
        "The returned nodes define the ONLY rooms that exist. Code is Law.",
      inputSchema: GenerateLocationInputSchema,
      execute: async ({ locationType, seed, parentLocationId }) => {
        try {
          // Derive seed if not provided
          const resolvedSeed = seed ?? `${campaignId}:${Date.now()}`;

          // Idempotency guard: return existing location for same seed
          const existing = await prisma.location.findUnique({
            where: { campaignId_seed: { campaignId, seed: resolvedSeed } },
            include: {
              nodes: { orderBy: { index: "asc" } },
              edges: true,
            },
          });
          if (existing) {
            const nodeById = new Map(existing.nodes.map((n) => [n.id, n]));
            return JSON.stringify({
              ok: true,
              idempotent: true,
              locationId: existing.id,
              name: existing.name,
              type: existing.type,
              description: existing.description,
              seed: existing.seed,
              entryNodeIndex: 0,
              nodes: existing.nodes.map((n) => ({
                index: n.index, name: n.name, description: n.description,
                feature: n.feature, npcSeed: n.npcSeed, featureData: n.featureData,
                x: n.x, y: n.y,
              })),
              edges: existing.edges.map((e) => ({
                fromIndex: nodeById.get(e.fromNodeId)?.index ?? 0,
                toIndex: nodeById.get(e.toNodeId)?.index ?? 0,
                passageType: e.passageType,
              })),
            });
          }

          // Generate and validate payload
          const payload = generateLocationPayload({ locationType, seed: resolvedSeed });
          const validated = LocationPayloadSchema.parse(payload);

          // Persist in a single transaction
          const result = await prisma.$transaction(async (tx) => {
            const loc = await tx.location.create({
              data: {
                campaignId,
                seed: resolvedSeed,
                type: validated.type,
                name: validated.name,
                description: validated.description,
                parentId: parentLocationId ?? null,
              },
            });

            const createdNodes = await Promise.all(
              validated.nodes.map((node) =>
                tx.locationNode.create({
                  data: {
                    locationId: loc.id,
                    index: node.index,
                    name: node.name,
                    description: node.description,
                    feature: node.feature,
                    npcSeed: node.npcSeed,
                    featureData: node.featureData as object,
                    x: node.x,
                    y: node.y,
                  },
                })
              )
            );

            const nodeIdByIndex = new Map(createdNodes.map((n) => [n.index, n.id]));

            await Promise.all(
              validated.edges.map((edge) => {
                const fromNodeId = nodeIdByIndex.get(edge.fromIndex);
                const toNodeId = nodeIdByIndex.get(edge.toIndex);
                if (!fromNodeId || !toNodeId) {
                  throw new Error(`Edge references unknown node index: ${edge.fromIndex}→${edge.toIndex}`);
                }
                return tx.locationEdge.create({
                  data: {
                    locationId: loc.id,
                    fromNodeId,
                    toNodeId,
                    passageType: edge.passageType,
                  },
                });
              })
            );

            const entryNodeId = nodeIdByIndex.get(validated.entryNodeIndex);
            await tx.campaign.update({
              where: { id: campaignId },
              data: {
                currentLocationId: loc.id,
                currentNodeId: entryNodeId,
              },
            });

            return { locationId: loc.id, entryNodeId };
          });

          return JSON.stringify({
            ok: true,
            locationId: result.locationId,
            entryNodeId: result.entryNodeId,
            ...validated,
          });
        } catch {
          return JSON.stringify({ error: "Location generation failed mechanically." });
        }
      },
    }),

    moveToNode: tool({
      description:
        "Move the player to an adjacent node within the current location. " +
        "The target node MUST be connected to the current node via an edge. " +
        "Call this when the player declares movement to a specific room or area. " +
        "After calling, narrate the movement and the destination using the returned node data. " +
        "NEVER describe a room the player hasn't moved to. Code is Law.",
      inputSchema: MoveToNodeInputSchema,
      execute: async ({ targetNodeIndex }) => {
        try {
          const campaign = await prisma.campaign.findUnique({
            where: { id: campaignId },
            select: { currentLocationId: true, currentNodeId: true },
          });

          if (!campaign?.currentLocationId) {
            return JSON.stringify({
              error: "No active location. Call generateLocation first.",
            });
          }

          const location = await prisma.location.findUnique({
            where: { id: campaign.currentLocationId },
            include: {
              nodes: { orderBy: { index: "asc" } },
              edges: true,
            },
          });

          if (!location) {
            return JSON.stringify({ error: "Active location not found in database." });
          }

          const nodeById = new Map(location.nodes.map((n) => [n.id, n]));

          // Build EdgePayload[] from DB edges for movement validation
          const edges: EdgePayload[] = location.edges.map((e) => ({
            fromIndex: nodeById.get(e.fromNodeId)?.index ?? 0,
            toIndex: nodeById.get(e.toNodeId)?.index ?? 0,
            passageType: e.passageType as PassageType,
          }));

          const currentDbNode = campaign.currentNodeId
            ? nodeById.get(campaign.currentNodeId)
            : null;

          if (!currentDbNode) {
            return JSON.stringify({ error: "Current node not found." });
          }

          // Validate adjacency
          if (!canMoveToNode(currentDbNode.index, targetNodeIndex, edges)) {
            return JSON.stringify({
              error: `Node ${targetNodeIndex} is not adjacent to current node ${currentDbNode.index}.`,
              currentNodeIndex: currentDbNode.index,
              targetNodeIndex,
            });
          }

          const targetDbNode = location.nodes.find((n) => n.index === targetNodeIndex);
          if (!targetDbNode) {
            return JSON.stringify({ error: `Node index ${targetNodeIndex} not found in location.` });
          }

          // Check passage type — locked and hidden require skill checks first
          const connectingEdge = edges.find(
            (e) =>
              (e.fromIndex === currentDbNode.index && e.toIndex === targetNodeIndex) ||
              (e.fromIndex === targetNodeIndex && e.toIndex === currentDbNode.index)
          );

          if (connectingEdge?.passageType === "locked") {
            return JSON.stringify({
              error: "The passage is locked. A key, lockpick check, or force is required.",
              passageType: "locked",
            });
          }
          if (connectingEdge?.passageType === "hidden") {
            return JSON.stringify({
              error: "The passage is hidden. A Search or Perception check is required to find it.",
              passageType: "hidden",
            });
          }

          // Persist movement
          await prisma.campaign.update({
            where: { id: campaignId },
            data: { currentNodeId: targetDbNode.id },
          });

          // Compute adjacent nodes for returned context
          const adjacentNodes = edges
            .filter(
              (e) =>
                e.fromIndex === targetNodeIndex || e.toIndex === targetNodeIndex
            )
            .map((e) => {
              const adjIndex =
                e.fromIndex === targetNodeIndex ? e.toIndex : e.fromIndex;
              const adjDbNode = location.nodes.find((n) => n.index === adjIndex);
              return adjDbNode
                ? {
                    index: adjDbNode.index,
                    name: adjDbNode.name,
                    feature: adjDbNode.feature,
                    passageType: e.passageType,
                  }
                : null;
            })
            .filter((n): n is NonNullable<typeof n> => n !== null);

          // Build exploration XP hints — AI must call awardXP for each.
          const explorationXPHints: Array<{ event: string; amount: number; reason: string }> = [];
          // Every successfully entered node counts as a discovery.
          explorationXPHints.push({
            event: "node_discovery",
            amount: EXPLORATION_XP.node_discovery,
            reason: `First visit to ${targetDbNode.name}`,
          });
          // Feature-based hints.
          if (targetDbNode.feature === "hazard") {
            explorationXPHints.push({
              event: "hazard_survived",
              amount: EXPLORATION_XP.hazard_survived,
              reason: `Survived the hazard in ${targetDbNode.name}`,
            });
          } else if (targetDbNode.feature === "exit") {
            explorationXPHints.push({
              event: "exit_reached",
              amount: EXPLORATION_XP.exit_reached,
              reason: `Reached the exit at ${targetDbNode.name}`,
            });
          } else if (targetDbNode.feature === "treasure") {
            explorationXPHints.push({
              event: "treasure_found",
              amount: EXPLORATION_XP.treasure_found,
              reason: `Discovered treasure in ${targetDbNode.name}`,
            });
          } else if (targetDbNode.feature === "quest_hook") {
            explorationXPHints.push({
              event: "quest_hook_found",
              amount: EXPLORATION_XP.quest_hook_found,
              reason: `Found a quest hook in ${targetDbNode.name}`,
            });
          }

          return JSON.stringify({
            ok: true,
            targetNode: {
              index: targetDbNode.index,
              name: targetDbNode.name,
              description: targetDbNode.description,
              feature: targetDbNode.feature,
              npcSeed: targetDbNode.npcSeed,
              featureData: targetDbNode.featureData,
              x: targetDbNode.x,
              y: targetDbNode.y,
            },
            adjacentNodes,
            passageType: connectingEdge?.passageType ?? "open",
            explorationXPHints,
          });
        } catch {
          return JSON.stringify({ error: "Movement failed mechanically." });
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

    generateMerchant: tool({
      description:
        "Generate a deterministic merchant inventory and statblock when players encounter a merchant NPC. " +
        "MUST be called immediately when players initiate trade. " +
        "Prices are dynamic based on archetype. The UI will automatically display the generated inventory. " +
        "Code is Law.",
      inputSchema: GenerateMerchantInputSchema,
      execute: async ({ archetype, npcSeed }) => {
        try {
          const block = generateNPC(npcSeed, "commoner");
          const payload = buildMerchantPayload(archetype, npcSeed);
          callbacks?.onMerchantGenerated?.(payload);
          return JSON.stringify({ ok: true, archetype, npcName: block.name, itemCount: payload.inventory.length });
        } catch {
          return JSON.stringify({ error: "Merchant generation failed mechanically." });
        }
      },
    }),

    executeTrade: tool({
      description:
        "Execute a single trade transaction (buy or sell) after the player commits to it. " +
        "MUST be used to deduct/add gold and add/remove items from inventory. " +
        "Never invent gold or items. Code is Law. " +
        "The current transaction must only involve ONE item.",
      inputSchema: TradeActionSchema,
      execute: async ({ action, itemIndex, inventoryItemId, quantity, npcSeed, archetype }) => {
        try {
          const result = await prisma.$transaction(async (tx) => {
            const campaign = await tx.campaign.findUnique({
              where: { id: campaignId },
              include: { character: { include: { inventory: true } } },
            });
            if (!campaign) throw new Error("Campaign not found.");

            const merchantPayload = buildMerchantPayload(archetype, npcSeed);

            if (action === "buy") {
              if (itemIndex === undefined) throw new Error("Missing itemIndex for buy.");
              const mItem = merchantPayload.inventory[itemIndex];
              if (!mItem) throw new Error("Item not found in merchant inventory.");
              
              const totalCost = mItem.buyPriceGP * quantity;
              if (campaign.gold < totalCost) {
                throw new Error(`Insufficient gold. Needs ${totalCost}, has ${campaign.gold}.`);
              }

              const newCampaign = await tx.campaign.update({
                where: { id: campaignId },
                data: { gold: { decrement: totalCost } },
              });

              // Add to inventory with stacking
              const existing = campaign.character.inventory.find(i => i.name === mItem.name && i.type === mItem.type);
              if (existing) {
                await tx.inventoryItem.update({
                  where: { id: existing.id },
                  data: { quantity: { increment: quantity } }
                });
              } else {
                await tx.inventoryItem.create({
                  data: {
                    characterId: campaign.characterId,
                    name: mItem.name,
                    type: mItem.type,
                    quantity,
                    properties: mItem.properties as object,
                  },
                });
              }

              // Add a game log entry
              await tx.gameLog.create({
                data: {
                  campaignId: campaignId,
                  role: "system",
                  content: `💰 Trade: Purchased ${quantity}x ${mItem.name} for ${totalCost} GP from ${merchantPayload.name}.`,
                }
              });

              return { ok: true, action: "buy", itemName: mItem.name, totalCost, newGoldBalance: newCampaign.gold };
            } else {
              if (!inventoryItemId) throw new Error("Missing inventoryItemId for sell.");
              const pItem = campaign.character.inventory.find(i => i.id === inventoryItemId);
              if (!pItem) throw new Error("Item not found in character inventory.");
              if (pItem.quantity < quantity) throw new Error("Insufficient quantity to sell.");

              const properties = pItem.properties as Record<string, unknown>;
              const baseValueGP = typeof properties.valueGP === "number" ? properties.valueGP : 0;
              const sellPriceGP = Math.max(1, Math.floor(baseValueGP * merchantPayload.sellModifier));
              const totalRevenue = sellPriceGP * quantity;

              const newCampaign = await tx.campaign.update({
                where: { id: campaignId },
                data: { gold: { increment: totalRevenue } },
              });

              if (pItem.quantity === quantity) {
                await tx.inventoryItem.delete({ where: { id: pItem.id } });
              } else {
                await tx.inventoryItem.update({
                  where: { id: pItem.id },
                  data: { quantity: { decrement: quantity } },
                });
              }

              // Add a game log entry
              await tx.gameLog.create({
                data: {
                  campaignId: campaignId,
                  role: "system",
                  content: `💰 Trade: Sold ${quantity}x ${pItem.name} to ${merchantPayload.name} for ${totalRevenue} GP.`,
                }
              });

              return { ok: true, action: "sell", itemName: pItem.name, totalRevenue, newGoldBalance: newCampaign.gold };
            }
          });
          return JSON.stringify(result);
        } catch (error: any) {
          return JSON.stringify({ error: error.message || "Trade execution failed mechanically." });
        }
      },
    }),

    // ── Social Interaction Tools (Milestone N) ──────────────────────────────

    rollReaction: tool({
      description:
        "Perform the 2d6 AD&D 1e Reaction Roll to determine an NPC's initial disposition " +
        "toward the party when they are first approached. " +
        "MUST be called the FIRST TIME the party speaks to any NPC in a scene. " +
        "Do NOT call this if NPC.hasMetPlayer is true — use the persisted disposition instead. " +
        "The roll result determines the NPC's opening attitude. " +
        "The Narrator MUST voice the NPC using ONLY the returned dispositionBand and personality tags. " +
        "NEVER invent NPC attitudes, motivations, or secrets without calling this tool first. " +
        "Code is Law.",
      inputSchema: ReactionRollInputSchema,
      execute: async ({ npcSeed, npcRole, charismaModifier }) => {
        try {
          // 1. Pure reaction roll — dice + personality determinism
          const result = rollReactionPure({ npcSeed, npcRole, charismaModifier });

          // 2. Deterministic statblock for CREATE branch (same seed = same person)
          const statblock = generateNPC(npcSeed, npcRole as NPCRole);

          // 3. Upsert NPC — create if first meeting, update social fields either way
          await prisma.nPC.upsert({
            where: { campaignId_seed: { campaignId, seed: npcSeed } },
            create: {
              campaignId,
              seed:         npcSeed,
              role:         npcRole,
              name:         statblock.name,
              maxHp:        statblock.maxHp,
              hp:           statblock.hp,
              ac:           statblock.ac,
              race:         statblock.race,
              profession:   statblock.profession,
              alignment:    statblock.alignment,
              abilityScores: statblock.abilityScores as object,
              traits:       statblock.traits as object,
              disposition:  result.initialDisposition,
              personalityTags: result.personality as object,
              hasMetPlayer: true,
            },
            update: {
              disposition:     result.initialDisposition,
              personalityTags: result.personality as object,
              hasMetPlayer:    true,
            },
          });

          return JSON.stringify(result);
        } catch {
          return JSON.stringify({ error: "Reaction roll failed mechanically. Narrate a moment of silence." });
        }
      },
    }),

    socialCheck: tool({
      description:
        "Resolve a social action — Persuade, Intimidate, or Deceive — against an NPC. " +
        "Rolls 1d20 + the character's CHA modifier against a DC derived from " +
        "the NPC's current disposition and the magnitude of the shift attempted. " +
        "On success, the NPC's disposition increases. Intimidation failure causes backfire. " +
        "MUST be called whenever the player attempts to influence an NPC through social means. " +
        "NEVER decide the outcome of a social interaction without calling this tool. " +
        "Narrate the result — and ONLY the result — that the tool returns. " +
        "Code is Law.",
      inputSchema: SocialCheckInputSchema,
      execute: async ({ npcSeed, characterId, approach, dispositionDelta, intent }) => {
        try {
          // 1. Verify NPC exists and has been formally met
          const npc = await prisma.nPC.findUnique({
            where: { campaignId_seed: { campaignId, seed: npcSeed } },
          });
          if (!npc) {
            return JSON.stringify({ error: "NPC not found. Call rollReaction first to establish first contact." });
          }
          if (!npc.hasMetPlayer) {
            return JSON.stringify({ error: "Call rollReaction before socialCheck — the party has not yet met this NPC." });
          }

          // 2. Derive CHA modifier from character stats
          const character = await prisma.character.findUnique({
            where: { id: characterId },
            select: { stats: true },
          });
          if (!character) {
            return JSON.stringify({ error: "Character not found." });
          }
          const stats = character.stats as Record<string, number> | null;
          const cha = typeof stats?.CHA === "number" ? stats.CHA : 10;
          const charismaModifier = abilityModifier(cha);

          // 3. Pure resolution — no I/O, deterministic given the d20 roll
          const currentDisposition = npc.disposition ?? 0;
          const result = resolveSocialCheck(
            { npcSeed, characterId, approach, dispositionDelta, intent },
            charismaModifier,
            currentDisposition,
          );

          // 4. Persist disposition change (single row, no cascade risk)
          await prisma.nPC.update({
            where: { campaignId_seed: { campaignId, seed: npcSeed } },
            data: { disposition: result.dispositionAfter },
          });

          return JSON.stringify(result);
        } catch {
          return JSON.stringify({ error: "Social check failed mechanically. Narrate a moment of ambiguity." });
        }
      },
    }),

    getRumors: tool({
      description:
        "Ask an NPC what they know about nearby areas. " +
        "Only NPCs with disposition ≥ 3 (Friendly or better) will share information. " +
        "The returned rumors are derived ENTIRELY from persisted database records — " +
        "the NPC cannot share information the world does not contain. " +
        "MUST be called when a player asks an NPC for directions, local knowledge, " +
        "rumors, or information about nearby locations. " +
        "NEVER invent rumors, location details, or quest hooks. " +
        "Narrate ONLY the information this tool returns. " +
        "Code is Law.",
      inputSchema: GetRumorsInputSchema,
      execute: async ({ npcSeed, campaignId: targetCampaignId }) => {
        try {
          // 1. Fetch NPC disposition
          const npc = await prisma.nPC.findUnique({
            where: { campaignId_seed: { campaignId: targetCampaignId, seed: npcSeed } },
          });
          if (!npc) {
            return JSON.stringify({ error: "NPC not found. Cannot retrieve rumors." });
          }

          // 2. Fetch current location from campaign
          const campaign = await prisma.campaign.findUnique({
            where: { id: targetCampaignId },
            select: { currentLocationId: true },
          });
          if (!campaign?.currentLocationId) {
            return JSON.stringify({ error: "No active location — explore a location first." });
          }

          // 3. Fetch all nodes in the current location (NPC only knows their own floor)
          const nodes = await prisma.locationNode.findMany({
            where: { locationId: campaign.currentLocationId },
            select: { id: true, name: true, feature: true, description: true },
          });

          // 4. Pure payload builder — no invention, no hallucination
          const payload = getRumorsPayload(npcSeed, npc.name, npc.disposition ?? 0, nodes);

          return JSON.stringify(payload);
        } catch {
          return JSON.stringify({ error: "Rumor retrieval failed mechanically. The NPC goes quiet." });
        }
      },
    }),

    // ── Exploration Time Engine (Milestone O) ───────────────────────────────

    executeExplorationTurn: tool({
      description:
        "Advance the dungeon clock by one exploration turn (10 minutes) for the given action. " +
        "MUST be called for every dungeon action the party takes — moving, searching, resting, " +
        "interacting, or making noise. " +
        "Handles torch/lantern burn, ration consumption, random encounter checks, " +
        "and mandatory rest enforcement automatically. " +
        "NEVER narrate the passage of time, torch burn, ration loss, exhaustion, or encounters " +
        "without calling this tool first. " +
        "If the response contains `restRequired: true`, the NEXT call MUST use action='rest'. " +
        "Voice the returned `warnings[]` diegetically. Code is Law.",
      inputSchema: z.object({
        action: z
          .enum(["move", "search", "rest", "interact", "loud"])
          .describe(
            "The type of exploration action taken. " +
            "'move': standard movement to adjacent node, 1 turn. " +
            "'search': careful room examination, 1 turn. " +
            "'rest': mandatory rest turn — resets the rest cycle, no resources consumed. " +
            "'interact': non-combat interaction with environment or NPC, 1 turn. " +
            "'loud': noisy action (breaking down door, shouting) — forces an immediate encounter check.",
          ),
        turnsToAdvance: z
          .number()
          .int()
          .min(1)
          .max(6)
          .default(1)
          .describe(
            "How many turns this action consumes. Default 1. " +
            "Only exceed 1 for explicitly multi-turn tasks such as extended rituals or camp setup.",
          ),
      }).strict(),

      execute: async ({ action, turnsToAdvance }) => {
        try {
          // 1. Fetch current state from DB — single round-trip
          const [campaignRec, campaignTime, partyInventory] = await Promise.all([
            prisma.campaign.findUnique({
              where: { id: campaignId },
              select: { characterId: true },
            }),
            prisma.campaignTime.findUnique({ where: { campaignId } }),
            prisma.partyInventory.findUnique({ where: { campaignId } }),
          ]);

          if (!campaignRec) {
            return JSON.stringify({ error: "Campaign not found." });
          }

          // 2. Derive partySize from active encounter combatants (Q2 — never trust AI input)
          const activeEncounter = await prisma.encounter.findFirst({
            where: { campaignId, status: "active" },
            select: { combatants: { where: { isPlayer: true }, select: { id: true } } },
          });
          const partySize = activeEncounter?.combatants.length ?? 1;

          // 3. Bootstrap CampaignTime / PartyInventory if they don't exist yet
          const currentTime: CampaignTimeState = campaignTime ?? {
            totalTurns: 0,
            totalHours: 0,
            turnsSinceRest: 0,
            turnsSinceEncounterCheck: 0,
            turnsSinceRation: 0,
          };
          const currentInventory: PartyInventoryState = partyInventory
            ? {
                torches:                   partyInventory.torches,
                oilFlasks:                 partyInventory.oilFlasks,
                rations:                   partyInventory.rations,
                activeLightSource:         partyInventory.activeLightSource as "torch" | "lantern" | "none",
                lightSourceTurnsRemaining: partyInventory.lightSourceTurnsRemaining,
              }
            : {
                torches: 0,
                oilFlasks: 0,
                rations: 0,
                activeLightSource: "none",
                lightSourceTurnsRemaining: 0,
              };

          // 4. REST branch — resets rest cycle, no resource consumption
          if (action === "rest") {
            const nextTime = applyRest(currentTime);
            await prisma.campaignTime.upsert({
              where: { campaignId },
              create: { campaignId, ...nextTime },
              update: nextTime,
            });
            return JSON.stringify({
              action: "rest",
              turnsAdvanced: 0,
              totalTurns: nextTime.totalTurns,
              totalHours: nextTime.totalHours,
              restRequired: false,
              encounter: null,
              lightSource: currentInventory.activeLightSource,
              lightSourceTurnsLeft: currentInventory.lightSourceTurnsRemaining,
              lightExpired: false,
              rationsDepleted: false,
              warnings: ["The party rests for one turn. The rest cycle has been reset."],
            });
          }

          // 5. NON-REST branch
          // 5a. Check if rest was already overdue BEFORE advancing (Q1 exhaustion trigger)
          const restAlreadyOverdue = currentTime.turnsSinceRest >= REST_INTERVAL_TURNS;

          // 5b. Advance the clock
          const turnResult = advanceTurn(currentTime, turnsToAdvance);

          // 5c. Apply Exhaustion Level 1 immediately if rest was skipped (Q1)
          if (restAlreadyOverdue && turnResult.restRequired) {
            await prisma.character.update({
              where: { id: campaignRec.characterId },
              data: { exhaustionLevel: { increment: 1 } },
            });
          }

          // 5d. Consume resources (light + rations)
          const resourceResult = consumeResources(currentInventory, {
            rationConsumptionDue: turnResult.rationConsumptionDue,
            partySize,
          });

          // 5e. Random encounter check (every 2 turns, or forced for loud actions)
          let encounter: { triggered: boolean; roll: number } | null = null;
          if (turnResult.encounterCheckDue || action === "loud") {
            const enc = checkRandomEncounter(action === "loud");
            encounter = { triggered: enc.triggered, roll: enc.roll };
          }

          // 5f. Persist both records atomically
          await prisma.$transaction([
            prisma.campaignTime.upsert({
              where: { campaignId },
              create: { campaignId, ...turnResult.next },
              update: turnResult.next,
            }),
            prisma.partyInventory.upsert({
              where: { campaignId },
              create: { campaignId, ...resourceResult.next },
              update: resourceResult.next,
            }),
          ]);

          return JSON.stringify({
            action,
            turnsAdvanced:      turnResult.turnsAdvanced,
            totalTurns:         turnResult.next.totalTurns,
            totalHours:         turnResult.next.totalHours,
            restRequired:       turnResult.restRequired,
            exhaustionApplied:  restAlreadyOverdue && turnResult.restRequired,
            encounter,
            lightSource:        resourceResult.next.activeLightSource,
            lightSourceTurnsLeft: resourceResult.next.lightSourceTurnsRemaining,
            lightExpired:       resourceResult.lightExpired,
            rationsDepleted:    resourceResult.rationsDepleted,
            warnings:           resourceResult.warnings,
          });
        } catch {
          return JSON.stringify({ error: "Exploration turn failed mechanically. The moment hangs suspended." });
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

  const context = await buildCampaignContext(campaignId);
  const system = formatSystemPrompt(context);

  const result = streamText({
    model: openai("gpt-4o-mini"),
    system,
    prompt: playerInput,
    stopWhen: stepCountIs(5),
    tools: buildTools(campaignId, {
      onLevelUp: (payload) => resolveLevelUp(payload),
      onMerchantGenerated: (payload) => resolveMerchant(payload),
    }),
  });

  // Fallback: if the text stream ends without a level-up tool call, resolve null.
  // Promise.resolve wraps the PromiseLike so we can chain .catch().
  // A second resolveLevelUp call after onLevelUp fires is a no-op (Promises resolve once).
  Promise.resolve(result.text).then(() => {
    resolveLevelUp(null);
    resolveMerchant(null);
  }).catch(() => {
    resolveLevelUp(null);
    resolveMerchant(null);
  });

  return {
    textStream: result.textStream,
    textPromise: result.text,
    levelUpPayload,
    merchantPayload,
  };
}
