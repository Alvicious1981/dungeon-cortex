import { tool } from "ai";
import { runTool } from "@/lib/ai/tool-result";
import { projectNpcDetails } from "@/lib/ai/read-only-projections";
import {
  generateNPC,
  GenerateNPCInputSchema,
  TrackNPCInputSchema,
  type NPCRole,
} from "@/lib/rules/npc";
import {
  InitialDispositionInputSchema,
  SocialCheckInputSchema,
  GetRumorsInputSchema,
} from "@/lib/rules/social";
import {
  initialAttitudeFor,
  INITIAL_DISPOSITION,
  generateNPCPersonality,
} from "@/lib/rules/social-logic";
import {
  resolveRumors,
  resolveSocialCheck,
} from "@/lib/rules/social-service";
import {
  GenerateMerchantInputSchema,
  TradeActionSchema,
  buildMerchantPayload,
  type MerchantPayload,
} from "@/lib/rules/trade";
import {
  getCampaignCharacterIdForTrade,
  resolveTradeTransaction,
} from "@/lib/rules/trade-service";
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
        "Generate a deterministic reference statblock and proper name for an NPC already identified and authorized by backend context. This result does not persist or establish an NPC. The attackString field is dice notation (e.g. '1d6+2'), not a pre-rolled number.",
      inputSchema: GenerateNPCInputSchema,
      execute: async ({ seed, role }) => {
        return runTool(() => projectNpcDetails(generateNPC(seed, role)));
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
        return runTool(() => {
          const statblock = generateNPC(seed, role as NPCRole);
          return trackNpcState({
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
        });
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
        return runTool(async () => {
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

          return {
            seed: result.seed,
            name: result.name,
            race: result.race,
            profession: result.profession,
            alignment: result.alignment,
            traits: result.traits,
            facts: result.facts,
          };
        });
      },
    }),
    establishInitialDisposition: tool({
      description:
        "Establish an NPC's first-contact attitude, deterministically derived from the NPC's seed and role — no roll. " +
        "MUST be called the FIRST TIME the party speaks to any NPC in a scene. " +
        "Do NOT call this if NPC.hasMetPlayer is true — use the persisted disposition instead. " +
        "The backend result determines the NPC's opening attitude and persists disposition, personalityTags, and hasMetPlayer. " +
        "The Narrator MUST voice the NPC using ONLY the returned attitude and personality tags. " +
        "NEVER invent NPC attitudes, motivations, or secrets without calling this tool first. " +
        "Code is Law.",
      inputSchema: InitialDispositionInputSchema,
      execute: async ({ npcSeed, npcRole }) => {
        return runTool(async () => {
          const attitude = initialAttitudeFor(npcSeed, npcRole as NPCRole);
          const disposition = INITIAL_DISPOSITION[attitude];
          const personality = generateNPCPersonality(npcSeed);
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
            disposition,
            personalityTags: personality,
            descriptor,
          });

          return { attitude, disposition, personality };
        });
      },
    }),

    socialCheck: tool({
      description:
        "Resolve a social action — Persuade, Intimidate, or Deceive — against an NPC. " +
        "Rolls the matching SRD 5e Charisma skill (Persuasion, Intimidation, or Deception) " +
        "against a DC set by the NPC's current attitude. " +
        "On success, the NPC's disposition improves; on failure, it worsens. " +
        "MUST be called whenever the player attempts to influence an NPC through social means. " +
        "NEVER decide the outcome of a social interaction without calling this tool. " +
        "Narrate the result — and ONLY the result — that the tool returns. " +
        "Code is Law.",
      inputSchema: SocialCheckInputSchema,
      execute: async ({ npcSeed, approach, intent }) => {
        return runTool(() =>
          resolveSocialCheck({
            campaignId,
            npcSeed,
            approach,
            intent,
          }),
        );
      },
    }),

    getRumors: tool({
      description:
        "Ask an NPC what they know about nearby areas. " +
        "Only NPCs with a Friendly attitude will share information. " +
        "The returned rumors are derived ENTIRELY from persisted database records — " +
        "the NPC cannot share information the world does not contain. " +
        "MUST be called when a player asks an NPC for directions, local knowledge, " +
        "rumors, or information about nearby locations. " +
        "NEVER invent rumors, location details, or quest hooks. " +
        "Narrate ONLY the information this tool returns. " +
        "Code is Law.",
      inputSchema: GetRumorsInputSchema,
      execute: async ({ npcSeed }) => {
        return runTool(() =>
          resolveRumors({
            campaignId,
            npcSeed,
          }),
        );
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
        return runTool(() => {
          const block = generateNPC(npcSeed, "commoner");
          const payload = buildMerchantPayload(archetype, npcSeed);
          callbacks?.onMerchantGenerated?.(payload);
          return { archetype, npcName: block.name, itemCount: payload.inventory.length };
        });
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
        return runTool(async () => {
          const characterId = await getCampaignCharacterIdForTrade(campaignId);

          const merchantPayload = buildMerchantPayload(archetype, npcSeed);
          return action === "buy"
            ? await resolveTradeTransaction({
                campaignId,
                characterId,
                npcId: npcSeed,
                operation: "buy",
                itemDescriptor: getMerchantItemDescriptor(merchantPayload, itemIndex),
                price: getMerchantItemPrice(merchantPayload, itemIndex),
                quantity,
              })
            : await resolveTradeTransaction({
                campaignId,
                characterId,
                npcId: npcSeed,
                operation: "sell",
                itemId: inventoryItemId,
                price: 0,
                quantity,
                sellModifier: merchantPayload.sellModifier,
              });
        });
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
