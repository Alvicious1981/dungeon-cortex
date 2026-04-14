import { z } from "zod";
import type { LootRarity } from "./loot";
import { seededFloat, pickSeeded } from "./generators";
import { generateNPC } from "./npc";
import lootTables from "@/data/loot-tables.json";

export type ItemType = "weapon" | "armor" | "consumable" | "spell" | "misc";

export const MERCHANT_ARCHETYPES = [
  "blacksmith",
  "alchemist",
  "general",
  "fence",
  "arcanist",
] as const;

export type MerchantArchetype = (typeof MERCHANT_ARCHETYPES)[number];

export interface MerchantArchetypeConfig {
  /** Display label for the archetype, e.g. "Blacksmith" */
  label: string;
  /** Multiplier applied to base item valueGP for buy prices. [1.0 .. 1.5] */
  buyModifier: number;
  /** Multiplier applied to base item valueGP for sell prices. [0.3 .. 0.6] */
  sellModifier: number;
  /** Item types this archetype stocks — filters the loot tables. */
  preferredTypes: ItemType[];
  /** Rarity tiers this archetype can stock — caps inventory quality. */
  maxRarity: LootRarity;
  /** Minimum number of items in stock. */
  inventoryMin: number;
  /** Maximum number of items in stock. */
  inventoryMax: number;
  /** Curated greeting templates for diegetic flavor. */
  greetings: string[];
}

export const ARCHETYPE_CONFIGS: Readonly<Record<MerchantArchetype, MerchantArchetypeConfig>> = {
  blacksmith: {
    label: "Blacksmith",
    buyModifier: 1.1,       // 10% markup — honest trade
    sellModifier: 0.5,      // 50% of value — standard
    preferredTypes: ["weapon", "armor"],
    maxRarity: "rare",
    inventoryMin: 4,
    inventoryMax: 8,
    greetings: [
      "Steel and sweat, friend. What do you need forged?",
      "The anvil's still warm. Come, see what I've hammered out.",
      "You look like someone who knows the weight of a good blade.",
    ],
  },
  alchemist: {
    label: "Alchemist",
    buyModifier: 1.2,       // 20% markup — specialized knowledge
    sellModifier: 0.4,      // 40% — alchemists are picky buyers
    preferredTypes: ["consumable"],
    maxRarity: "rare",
    inventoryMin: 5,
    inventoryMax: 10,
    greetings: [
      "Careful with that one — it bites. What ailment troubles you?",
      "Vapors and vials, friend. Everything measured twice.",
      "I've distilled something new. Want a look before I sell out?",
    ],
  },
  general: {
    label: "General Goods",
    buyModifier: 1.0,       // No markup — competitive pricing
    sellModifier: 0.5,      // 50% — standard
    preferredTypes: ["consumable", "misc"],
    maxRarity: "uncommon",
    inventoryMin: 6,
    inventoryMax: 12,
    greetings: [
      "Rope, rations, lanterns — I've got the lot.",
      "Nothing fancy, but everything you'll wish you'd bought later.",
      "Take a look around. Fair prices, honest weights.",
    ],
  },
  fence: {
    label: "Fence",
    buyModifier: 1.5,       // 50% markup — high risk goods
    sellModifier: 0.6,      // 60% — fences pay more for stolen goods
    preferredTypes: ["weapon", "misc"],
    maxRarity: "very_rare",
    inventoryMin: 3,
    inventoryMax: 7,
    greetings: [
      "Keep your voice down. Let me see what you've got.",
      "I don't ask where it came from. You don't ask where it goes.",
      "Rare goods, friend. The kind that don't exist on any ledger.",
    ],
  },
  arcanist: {
    label: "Arcanist",
    buyModifier: 1.3,       // 30% markup — arcane knowledge has a price
    sellModifier: 0.35,     // 35% — arcanists lowball mundane goods
    preferredTypes: ["spell", "misc", "consumable"],
    maxRarity: "very_rare",
    inventoryMin: 3,
    inventoryMax: 6,
    greetings: [
      "The weave recognises you. Perhaps you'll appreciate my collection.",
      "Careful what you touch — some of these are... temperamental.",
      "Knowledge is the true currency. Gold is merely the medium.",
    ],
  },
};

export const GenerateMerchantInputSchema = z.object({
  npcSeed: z
    .string()
    .min(1)
    .describe(
      "The NPC seed from the shop node's `npcSeed` field. " +
      "Deterministically generates the merchant identity and inventory. " +
      "MUST match the current shop node's npcSeed."
    ),
  archetype: z
    .enum(MERCHANT_ARCHETYPES)
    .describe(
      "The merchant's specialisation. Determines inventory composition, " +
      "pricing modifiers, and greeting flavor. " +
      "Choose based on the LocationNode context: " +
      "blacksmith for forges, alchemist for apothecaries, fence for back-alleys, " +
      "arcanist for arcane shops, general for general stores."
    ),
});

export type GenerateMerchantInput = z.infer<typeof GenerateMerchantInputSchema>;

export const TradeItemSchema = z.object({
  /** Index within the merchant's inventory — used for buy actions. */
  index: z.number().int().nonnegative(),
  name: z.string(),
  type: z.enum(["weapon", "armor", "consumable", "spell", "misc"]),
  rarity: z.enum(["mundane", "uncommon", "rare", "very_rare", "legendary"]),
  description: z.string().max(200),
  properties: z.record(z.string(), z.unknown()),
  /** The item's intrinsic value in GP — canonical reference price. */
  baseValueGP: z.number().int().nonnegative(),
  /** The price the player must pay to BUY this item. baseValueGP × buyModifier. */
  buyPriceGP: z.number().int().nonnegative(),
});

export type TradeItem = z.infer<typeof TradeItemSchema>;

export const MerchantPayloadSchema = z.object({
  npcSeed: z.string().min(1),
  name: z.string(),
  archetype: z.enum(MERCHANT_ARCHETYPES),
  greeting: z.string().max(300),
  inventory: z.array(TradeItemSchema),
  /** Multiplier applied to base valueGP for buy prices. Already baked into TradeItem.buyPriceGP. */
  buyModifier: z.number().positive(),
  /** Multiplier applied to base valueGP for sell prices. Used by executeTrade for selling. */
  sellModifier: z.number().positive().max(1),
});

export type MerchantPayload = z.infer<typeof MerchantPayloadSchema>;

export const TradeActionSchema = z.object({
  action: z
    .enum(["buy", "sell"])
    .describe(
      "Whether the player is BUYING from the merchant or SELLING to the merchant."
    ),
  /** For BUY: the item index in the merchant's inventory (from MerchantPayload.inventory[].index). */
  itemIndex: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Required for BUY actions. The merchant inventory item index."),
  /** For SELL: the player's InventoryItem ID to sell. */
  inventoryItemId: z
    .string()
    .min(1)
    .optional()
    .describe("Required for SELL actions. The character's InventoryItem.id."),
  quantity: z
    .number()
    .int()
    .min(1)
    .default(1)
    .describe("Number of units to buy or sell. Defaults to 1."),
  /** The merchant's npcSeed — required to reconstruct the merchant inventory for validation. */
  npcSeed: z
    .string()
    .min(1)
    .describe("The merchant's npcSeed. Used to reconstruct and validate the merchant inventory."),
  /** The merchant's archetype — required to reconstruct pricing. */
  archetype: z
    .enum(MERCHANT_ARCHETYPES)
    .describe("The merchant's archetype. Used to derive buy/sell modifiers."),
});

export type TradeAction = z.infer<typeof TradeActionSchema>;

export const TradeResultSchema = z.object({
  success: z.boolean(),
  action: z.enum(["buy", "sell"]),
  itemName: z.string(),
  quantity: z.number().int().min(1),
  /** Gold exchanged in this transaction. */
  goldDelta: z.number().int(),
  /** Party gold AFTER the transaction. */
  newGoldBalance: z.number().int().nonnegative(),
  /** Error message if success === false. */
  error: z.string().optional(),
});

export type TradeResult = z.infer<typeof TradeResultSchema>;

export function getItemBaseValue(item: { valueGP?: number }): number {
  return item.valueGP ?? 0;
}

export function computeBuyPrice(baseValueGP: number, archetype: MerchantArchetype): number {
  const config = ARCHETYPE_CONFIGS[archetype];
  return Math.ceil(baseValueGP * config.buyModifier);
}

export function computeSellPrice(baseValueGP: number, archetype: MerchantArchetype): number {
  const config = ARCHETYPE_CONFIGS[archetype];
  return Math.floor(baseValueGP * config.sellModifier);
}

const RARITY_ORDER: LootRarity[] = ["mundane", "uncommon", "rare", "very_rare", "legendary"];

export function generateMerchantInventory(archetype: MerchantArchetype, seed: string): TradeItem[] {
  const config = ARCHETYPE_CONFIGS[archetype];
  const maxRarityIndex = RARITY_ORDER.indexOf(config.maxRarity);
  
  let allowedItems: any[] = [];
  for (let i = 0; i <= maxRarityIndex; i++) {
    const table = (lootTables as any)[RARITY_ORDER[i]] || [];
    const filtered = table.filter((item: any) => config.preferredTypes.includes(item.type));
    
    // Attach rarity
    filtered.forEach((item: any) => item._rarity = RARITY_ORDER[i]);
    allowedItems = allowedItems.concat(filtered);
  }

  // Sort deterministically
  allowedItems.sort((a, b) => a.name.localeCompare(b.name));

  const itemCount = config.inventoryMin + Math.floor(seededFloat(`${seed}:count`) * (config.inventoryMax - config.inventoryMin + 1));
  
  const inventory: TradeItem[] = [];
  // Ensure we don't try to loop infinitely if allowedItems is empty
  if (allowedItems.length === 0) return inventory;

  for (let i = 0; i < itemCount; i++) {
    const picked = allowedItems[Math.floor(seededFloat(`${seed}:item:${i}`) * allowedItems.length)];
    const baseValueGP = getItemBaseValue(picked);
    
    inventory.push({
      index: i,
      name: picked.name,
      type: picked.type,
      rarity: picked._rarity as "mundane" | "uncommon" | "rare" | "very_rare" | "legendary",
      description: picked.description,
      properties: picked.properties ?? {},
      baseValueGP: baseValueGP,
      buyPriceGP: computeBuyPrice(baseValueGP, archetype)
    });
  }

  return inventory;
}

export function buildMerchantPayload(archetype: MerchantArchetype, npcSeed: string): MerchantPayload {
  const config = ARCHETYPE_CONFIGS[archetype];
  const npc = generateNPC(npcSeed, "commoner");
  const greeting = pickSeeded(npcSeed + ":greeting", config.greetings);
  const inventory = generateMerchantInventory(archetype, npcSeed);

  return {
    npcSeed,
    name: npc.name,
    archetype,
    greeting,
    inventory,
    buyModifier: config.buyModifier,
    sellModifier: config.sellModifier,
  };
}
