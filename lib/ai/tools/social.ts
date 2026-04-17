import { tool } from "ai";
import { prisma } from "@/lib/db/prisma";
import {
  generateNPC,
  GenerateNPCInputSchema,
  TrackNPCInputSchema,
  type NPCRole,
  type AbilityScores,
} from "@/lib/rules/npc";
import { abilityModifier } from "@/lib/rules/dice";
import {
  ReactionRollInputSchema,
  SocialCheckInputSchema,
  GetRumorsInputSchema,
} from "@/lib/rules/social";
import {
  rollReaction as rollReactionPure,
  resolveSocialCheck,
  getRumorsPayload,
} from "@/lib/rules/social-logic";
import {
  GenerateMerchantInputSchema,
  TradeActionSchema,
  buildMerchantPayload,
  type MerchantPayload,
} from "@/lib/rules/trade";

export function buildSocialTools(
  campaignId: string,
  callbacks?: { onMerchantGenerated?: (payload: MerchantPayload) => void }
) {
  return {
    getNPCDetails: tool({
      description:
        "Get the deterministic statblock and persistent proper name of an NPC. Use this before narrating interactions with unknown or generic NPCs. The attackString field is dice notation (e.g. '1d6+2'), not a pre-rolled number.",
      inputSchema: GenerateNPCInputSchema,
      execute: async ({ seed, role }) => {
        try {
          return generateNPC(seed, role);
        } catch {
          return JSON.stringify({ error: "Action failed mechanically. Narrate a brief failure or silence." });
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
      inputSchema: TrackNPCInputSchema,
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
              abilityScores: statblock.abilityScores as unknown as object,
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
      inputSchema: TrackNPCInputSchema,
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
          const result = rollReactionPure({ npcSeed, npcRole, charismaModifier });
          const statblock = generateNPC(npcSeed, npcRole as NPCRole);

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
          const result = await prisma.$transaction(async (tx) => {
            const npc = await tx.nPC.findUnique({
              where: { campaignId_seed: { campaignId, seed: npcSeed } },
            });
            if (!npc) {
              throw new Error("NPC not found. Call rollReaction first to establish first contact.");
            }
            if (!npc.hasMetPlayer) {
              throw new Error("Call rollReaction before socialCheck — the party has not yet met this NPC.");
            }

            const character = await tx.character.findUnique({
              where: { id: characterId },
              select: { stats: true },
            });
            if (!character) {
              throw new Error("Character not found.");
            }
            const stats = character.stats as Record<string, number> | null;
            const cha = typeof stats?.CHA === "number" ? stats.CHA : 10;
            const charismaModifier = abilityModifier(cha);

            const currentDisposition = npc.disposition ?? 0;
            const socialResult = resolveSocialCheck(
              { npcSeed, characterId, approach, dispositionDelta, intent },
              charismaModifier,
              currentDisposition,
            );

            await tx.nPC.update({
              where: { campaignId_seed: { campaignId, seed: npcSeed } },
              data: { disposition: socialResult.dispositionAfter },
            });

            return socialResult;
          });

          return JSON.stringify(result);
        } catch (err: any) {
          return JSON.stringify({ error: err.message || "Social check failed mechanically." });
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
          const npc = await prisma.nPC.findUnique({
            where: { campaignId_seed: { campaignId: targetCampaignId, seed: npcSeed } },
          });
          if (!npc) {
            return JSON.stringify({ error: "NPC not found. Cannot retrieve rumors." });
          }

          const campaign = await prisma.campaign.findUnique({
            where: { id: targetCampaignId },
            select: { currentLocationId: true },
          });
          if (!campaign?.currentLocationId) {
            return JSON.stringify({ error: "No active location — explore a location first." });
          }

          const nodes = await prisma.locationNode.findMany({
            where: { locationId: campaign.currentLocationId },
            select: { id: true, name: true, feature: true, description: true },
          });

          const payload = getRumorsPayload(npcSeed, npc.name, npc.disposition ?? 0, nodes);

          return JSON.stringify(payload);
        } catch {
          return JSON.stringify({ error: "Rumor retrieval failed mechanically. The NPC goes quiet." });
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
  };
}
