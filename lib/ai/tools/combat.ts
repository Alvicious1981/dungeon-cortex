import { tool } from "ai";
import { prisma } from "@/lib/db/prisma";
import { MonsterSchema, type Monster } from "@/lib/rules/srd";
import {
  buildEncounter,
  xpForCR,
  encounterMultiplier,
  SpawnEncounterInputSchema,
} from "@/lib/rules/encounters";
import {
  rollInitiative, acFromMonsterData, acFromInventory,
  computeConsequences, deriveCombatBeat, DAMAGE_TYPES,
  ResolveAttackInputSchema, InitiativeInputSchema,
  resolveConcentrationCheck,
  type DamageType, type EncounterSnapshot,
} from "@/lib/rules/combat";
import { abilityModifier } from "@/lib/rules/dice";
import {
  GenerateLootInputSchema,
  generateLootPayload,
} from "@/lib/rules/loot";
import { queryMonsters } from "@/lib/ai/tools/srd-lookup";

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
      inputSchema: ResolveAttackInputSchema,
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
            attackerConditions: attacker?.conditions as string[] ?? [],
            defenderConditions: defender.conditions as string[] ?? [],
            isMelee: true, // Defaulting to melee for now; can be refined in Slice 2
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
          const { hp_after, damage } = consequences.combat_facts;

          if (damage > 0) {
            await prisma.$transaction(async (tx) => {
              // 1. Update HP
              await tx.combatant.update({
                where: { id: targetId },
                data: { hp: hp_after },
              });

              // 2. Update Encounter-wide total
              await tx.encounter.update({
                where: { id: encounter.id },
                data: { totalDamageDealt: { increment: damage } },
              });

              // 3. Concentration Disruption Logic
              if (defender.concentrationSpellId) {
                // Fetch stats (denormalized from character/npc)
                const targetStats = (defender.stats as Record<string, number>) || {};
                const conMod = abilityModifier(targetStats.CON ?? 10);
                const conSave = resolveConcentrationCheck(damage, conMod);
                
                if (!conSave.success) {
                  // If player, also clear Character-level state
                  if (defender.isPlayer) {
                    const campaign = await tx.campaign.findUnique({
                      where: { id: campaignId },
                      select: { characterId: true }
                    });
                    if (campaign) {
                      await tx.character.update({
                        where: { id: campaign.characterId },
                        data: { concentrationSpellId: null }
                      });
                    }
                  }
                  
                  await tx.combatant.update({
                    where: { id: targetId },
                    data: { concentrationSpellId: null }
                  });
                }
              }
            });
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
            avgCR: 1,
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
  };
}
