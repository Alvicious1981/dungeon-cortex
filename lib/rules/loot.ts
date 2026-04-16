import { z } from "zod";
import { seededFloat } from "@/lib/rules/generators";
import lootTables from "@/data/loot-tables.json";

// ---------------------------------------------------------------------------
// Rarity type
// ---------------------------------------------------------------------------

export type LootRarity =
  | "mundane"    // Common items, no magical properties
  | "uncommon"   // Minor magical items
  | "rare"       // Significant magical items
  | "very_rare"  // Powerful magical items
  | "legendary"; // Campaign-defining artifacts (tension ≥ 0.95 only)

const RARITY_ORDER: LootRarity[] = [
  "mundane",
  "uncommon",
  "rare",
  "very_rare",
  "legendary",
];

// ---------------------------------------------------------------------------
// Input schema — for the `generateLoot` AI tool
// ---------------------------------------------------------------------------

export const GenerateLootInputSchema = z.object({
  encounterId: z.string().min(1),
  tensionScore: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "The encounter's final Tension Score [0..1] from the Consequences Engine. " +
        "Drives rarity bracket and gold multiplier."
    ),
});

export type GenerateLootInput = z.infer<typeof GenerateLootInputSchema>;

// ---------------------------------------------------------------------------
// Item schema
// ---------------------------------------------------------------------------

export const LootItemSchema = z.object({
  name: z.string(),
  type: z.enum(["weapon", "armor", "consumable", "misc", "spell"]),
  rarity: z.enum(["mundane", "uncommon", "rare", "very_rare", "legendary"]),
  description: z.string().max(200),
  properties: z.record(z.string(), z.unknown()),
  valueGP: z.number().int().nonnegative(),
});

export type LootItem = z.infer<typeof LootItemSchema>;

// ---------------------------------------------------------------------------
// Payload schema — returned by the `generateLoot` tool
// ---------------------------------------------------------------------------

export const LootPayloadSchema = z.object({
  gold: z.number().int().nonnegative(),
  mundaneItems: z.array(LootItemSchema),
  magicItems: z.array(LootItemSchema),
  totalValue: z.number().int().nonnegative(),
  rarityBracket: z.enum(["mundane", "uncommon", "rare", "very_rare", "legendary"]),
  flavorText: z.string().max(300),
});

export type LootPayload = z.infer<typeof LootPayloadSchema>;

// ---------------------------------------------------------------------------
// Internal table types
// ---------------------------------------------------------------------------

interface RawTableItem {
  name: string;
  description: string;
  type: string;
  properties?: Record<string, unknown>;
  valueGP: number;
}

// ---------------------------------------------------------------------------
// tensionToRarityBracket
// ---------------------------------------------------------------------------

/**
 * Maps a Tension Score [0..1] to a rarity bracket ceiling.
 * The bracket is the best possible item rarity for the encounter.
 *
 * @pure — deterministic, no side effects.
 */
export function tensionToRarityBracket(tensionScore: number): LootRarity {
  if (tensionScore < 0.20) return "mundane";
  if (tensionScore < 0.40) return "uncommon";
  if (tensionScore < 0.70) return "rare";
  if (tensionScore < 0.95) return "very_rare";
  return "legendary";
}

// ---------------------------------------------------------------------------
// rollGoldReward
// ---------------------------------------------------------------------------

/**
 * Calculates gold reward based on encounter difficulty and danger.
 *
 * Formula:
 *   baseGold = floor(avgCR * 10 + enemyCount * 5)
 *   tensionMultiplier = 1.0 + tensionScore * 2.0  →  [1.0 .. 3.0]
 *   variance = seededFloat in [0.8 .. 1.2]
 *   gold = floor(baseGold * tensionMultiplier * variance)
 *   return max(1, gold)
 *
 * @pure — deterministic given the same seed.
 */
export function rollGoldReward(
  tensionScore: number,
  enemyCount: number,
  avgCR: number,
  seed: string
): number {
  const baseGold = Math.floor(avgCR * 10 + enemyCount * 5);
  const tensionMultiplier = 1.0 + tensionScore * 2.0;
  const variance = 0.8 + seededFloat(seed, 7) * 0.4; // [0.8, 1.2)
  const gold = Math.floor(baseGold * tensionMultiplier * variance);
  return Math.max(1, gold);
}

// ---------------------------------------------------------------------------
// rollIndividualRarity
// ---------------------------------------------------------------------------

/**
 * Rolls an individual item's rarity, which may be lower than the bracket ceiling.
 * d100 sub-roll ensures legendary is still rare even at ceiling.
 *
 * @pure — deterministic given the same seed.
 */
export function rollIndividualRarity(ceiling: LootRarity, seed: string): LootRarity {
  if (ceiling === "uncommon") return "uncommon";

  const d100 = seededFloat(seed, 11) * 100;

  if (ceiling === "legendary") {
    if (d100 < 10) return "legendary";
    if (d100 < 35) return "very_rare";
    if (d100 < 70) return "rare";
    return "uncommon";
  }
  if (ceiling === "very_rare") {
    if (d100 < 20) return "very_rare";
    if (d100 < 55) return "rare";
    return "uncommon";
  }
  if (ceiling === "rare") {
    if (d100 < 30) return "rare";
    return "uncommon";
  }
  return "uncommon";
}

// ---------------------------------------------------------------------------
// rollMundaneItems
// ---------------------------------------------------------------------------

/**
 * Generates a list of mundane (non-magical) loot items from the mundane table.
 *
 * Count:
 *   tensionScore < 0.30  →  1 item
 *   tensionScore < 0.60  →  1–2 items
 *   tensionScore ≥ 0.60  →  2–3 items
 *
 * @pure — deterministic given the same seed.
 */
export function rollMundaneItems(tensionScore: number, seed: string): LootItem[] {
  const table = lootTables.mundane as RawTableItem[];

  let count: number;
  if (tensionScore < 0.30) {
    count = 1;
  } else if (tensionScore < 0.60) {
    count = seededFloat(seed, 13) < 0.5 ? 1 : 2;
  } else {
    count = seededFloat(seed, 13) < 0.5 ? 2 : 3;
  }

  const items: LootItem[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(seededFloat(seed, 17 + i) * table.length);
    const raw = table[idx]!;
    items.push({
      name: raw.name,
      type: raw.type as LootItem["type"],
      rarity: "mundane",
      description: raw.description,
      properties: raw.properties ?? {},
      valueGP: raw.valueGP,
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// rollMagicItems
// ---------------------------------------------------------------------------

/**
 * Generates magic items based on the rarity bracket.
 * Returns [] for the "mundane" bracket — trivial fights yield no magic.
 *
 * @pure — deterministic given the same seed.
 */
export function rollMagicItems(
  rarityBracket: LootRarity,
  tensionScore: number,
  seed: string
): LootItem[] {
  if (rarityBracket === "mundane") return [];

  let count: number;
  if (rarityBracket === "uncommon") {
    count = seededFloat(seed, 19) < 0.5 ? 0 : 1;
  } else if (rarityBracket === "rare") {
    count = 1;
  } else if (rarityBracket === "very_rare") {
    count = seededFloat(seed, 19) < 0.5 ? 1 : 2;
  } else {
    // legendary
    count = 1;
  }

  if (count === 0) return [];

  const items: LootItem[] = [];
  for (let i = 0; i < count; i++) {
    const effectiveRarity = rollIndividualRarity(rarityBracket, `${seed}:item${i}`);
    const table = lootTables[effectiveRarity] as RawTableItem[];
    const idx = Math.floor(seededFloat(`${seed}:pick${i}`, 23) * table.length);
    const raw = table[idx]!;
    items.push({
      name: raw.name,
      type: raw.type as LootItem["type"],
      rarity: effectiveRarity,
      description: raw.description,
      properties: raw.properties ?? {},
      valueGP: raw.valueGP,
    });
  }

  void tensionScore; // available for future weighting
  return items;
}

// ---------------------------------------------------------------------------
// generateFlavorText
// ---------------------------------------------------------------------------

/**
 * Returns an atmospheric sentence describing the loot discovery moment.
 * Picked deterministically from a curated table by rarity bracket.
 *
 * @pure — deterministic given the same seed.
 */
export function generateFlavorText(rarityBracket: LootRarity, seed: string): string {
  const table = (lootTables.flavorText as Record<LootRarity, string[]>)[rarityBracket];
  const idx = Math.floor(seededFloat(seed, 29) * table.length);
  return table[idx]!;
}

// ---------------------------------------------------------------------------
// generateLootPayload  (orchestrator — pure)
// ---------------------------------------------------------------------------

export interface GenerateLootPayloadInput {
  tensionScore: number;
  enemyCount: number;
  avgCR: number;
  seed: string;
}

/**
 * Orchestrates the full loot generation pipeline from a single Tension Score.
 * Deterministic given identical inputs — same seed always produces same payload.
 *
 * @pure — no I/O, no side effects.
 */
export function generateLootPayload(input: GenerateLootPayloadInput): LootPayload {
  const { tensionScore, enemyCount, avgCR, seed } = input;

  const rarityBracket = tensionToRarityBracket(tensionScore);
  const gold = rollGoldReward(tensionScore, enemyCount, avgCR, seed);
  const mundaneItems = rollMundaneItems(tensionScore, `${seed}:mundane`);
  const magicItems = rollMagicItems(rarityBracket, tensionScore, `${seed}:magic`);
  const flavorText = generateFlavorText(rarityBracket, `${seed}:flavor`);

  const totalValue =
    gold +
    mundaneItems.reduce((sum, i) => sum + i.valueGP, 0) +
    magicItems.reduce((sum, i) => sum + i.valueGP, 0);

  return {
    gold,
    mundaneItems,
    magicItems,
    totalValue,
    rarityBracket,
    flavorText,
  };
}
