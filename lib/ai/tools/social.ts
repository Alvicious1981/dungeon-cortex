import { tool } from "ai";
import { prisma } from "@/lib/db/prisma";
import {
  generateNPC,
  GenerateNPCInputSchema,
  TrackNPCInputSchema,
  type NPCRole,
  type AbilityScores,
} from "@/lib/rules/npc";
import {
  InitialDispositionInputSchema,
  SocialCheckInputSchema,
  GetRumorsInputSchema,
} from "@/lib/rules/social";
import {
  establishInitialDisposition as establishInitialDispositionPure,
  getRumorsPayload,
} from "@/lib/rules/social-logic";
import { resolveSocialCheck } from "@/lib/rules/social-service";
import {
  GenerateMerchantInputSchema,
  TradeActionSchema,
  buildMerchantPayload,
  type MerchantPayload,
} from "@/lib/rules/trade";
import { resolveTradeTransaction } from "@/lib/rules/trade-service";
import {
  establishInitialNpcDisposition,
  trackNpcState,
  upsertGeneratedNpc,
  type NpcDescriptor,
} from "@/lib/rules/npc-service";


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
          const result = await trackNpcState({
            campaignId,
            npcSeed: seed,
            role,
            descriptor: {
              seed,
              role,
              name: statblock.name,
              maxHp: statblock.maxHp,
              hp: hp ?? statblock.hp,
              ac: statblock.ac,
              abilityScores: statblock.abilityScores,
              notes: notes ?? "",
            },
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: err instanceof Error ? err.message : "NPC tracking failed mechanically." });
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
          const result = await upsertGeneratedNpc({
            campaignId,
            npcSeed: seed,
            role,
            descriptor: {
              seed,
              role,
              name: statblock.name,
              maxHp: statblock.maxHp,
              hp: statblock.hp,
              ac: statblock.ac,
              notes,
              race: statblock.race,
              profession: statblock.profession,
              alignment: statblock.alignment,
              abilityScores: statblock.abilityScores,
              traits: statblock.traits,
            },
          });
          return JSON.stringify({
            ok: result.ok,
            seed: result.seed,
            name: result.name,
            race: result.race,
            profession: result.profession,
            alignment: result.alignment,
            traits: result.traits,
            facts: result.facts,
          });
        } catch {
          return JSON.stringify({ error: "NPC generation failed mechanically." });
        }
      },
    }),
    establishInitialDisposition: tool({
      description:
        "Establish an NPC's first-contact disposition with the D&D 5e/SRD 2014-compatible backend d20 Charisma check. " +
        "MUST be called the FIRST TIME the party speaks to any NPC in a scene. " +
        "Do NOT call this if NPC.hasMetPlayer is true — use the persisted disposition instead. " +
        "The backend result determines the NPC's opening attitude and persists disposition, personalityTags, and hasMetPlayer. " +
        "The Narrator MUST voice the NPC using ONLY the returned dispositionBand and personality tags. " +
        "NEVER invent NPC attitudes, motivations, or secrets without calling this tool first. " +
        "Code is Law.",
      inputSchema: InitialDispositionInputSchema,
      execute: async ({ npcSeed, npcRole, charismaModifier }) => {
        try {
          const result = establishInitialDispositionPure({ npcSeed, npcRole, charismaModifier });
          const statblock = generateNPC(npcSeed, npcRole as NPCRole);
          const descriptor: NpcDescriptor = {
            seed: npcSeed,
            role: npcRole,
            name: statblock.name,
            maxHp: statblock.maxHp,
            hp: statblock.hp,
            ac: statblock.ac,
            race: statblock.race,
            profession: statblock.profession,
            alignment: statblock.alignment,
            abilityScores: statblock.abilityScores,
            traits: statblock.traits,
          };

          await establishInitialNpcDisposition({
            campaignId,
            npcSeed,
            disposition: result.initialDisposition,
            personalityTags: result.personality,
            descriptor,
          });

          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: err instanceof Error ? err.message : "Initial disposition check failed mechanically." });
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
      execute: async ({ npcSeed, approach, dispositionDelta, intent }) => {
        try {
          const result = await resolveSocialCheck({
            campaignId,
            npcSeed,
            approach,
            dispositionDelta,
            intent,
          });

          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: err instanceof Error ? err.message : "Social check failed mechanically." });
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
      execute: async ({ npcSeed }) => {
        try {
          const npc = await prisma.nPC.findUnique({
            where: { campaignId_seed: { campaignId, seed: npcSeed } },
          });
          if (!npc) {
            return JSON.stringify({ error: "NPC not found. Cannot retrieve rumors." });
          }

          const campaign = await prisma.campaign.findUnique({
            where: { id: campaignId },
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
          const campaign = await prisma.campaign.findUnique({
            where: { id: campaignId },
            select: { characterId: true },
          });
          if (!campaign) throw new Error("Campaign not found.");

          const merchantPayload = buildMerchantPayload(archetype, npcSeed);
          const result =
            action === "buy"
              ? await resolveTradeTransaction({
                  campaignId,
                  characterId: campaign.characterId,
                  npcId: npcSeed,
                  operation: "buy",
                  itemDescriptor: getMerchantItemDescriptor(merchantPayload, itemIndex),
                  price: getMerchantItemPrice(merchantPayload, itemIndex),
                  quantity,
                })
              : await resolveTradeTransaction({
                  campaignId,
                  characterId: campaign.characterId,
                  npcId: npcSeed,
                  operation: "sell",
                  itemId: inventoryItemId,
                  price: 0,
                  quantity,
                  sellModifier: merchantPayload.sellModifier,
                });
          return JSON.stringify(result);
        } catch (error: unknown) {
          return JSON.stringify({ error: error instanceof Error ? error.message : "Trade execution failed mechanically." });
        }
      },
    }),
  };
}
function getMerchantItemDescriptor(payload: MerchantPayload, itemIndex: number | undefined) {
  if (itemIndex === undefined) throw new Error("Missing itemIndex for buy.");

  const item = payload.inventory[itemIndex];
  if (!item) throw new Error("Item not found in merchant inventory.");

  return {
    name: item.name,
    type: item.type,
    properties: item.properties,
  };
}

function getMerchantItemPrice(payload: MerchantPayload, itemIndex: number | undefined) {
  if (itemIndex === undefined) throw new Error("Missing itemIndex for buy.");

  const item = payload.inventory[itemIndex];
  if (!item) throw new Error("Item not found in merchant inventory.");

  return item.buyPriceGP;
}

