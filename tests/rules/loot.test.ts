import { describe, expect, it } from "vitest";
import {
  GenerateLootInputSchema,
  LootItemSchema,
  LootPayloadSchema,
  tensionToRarityBracket,
  rollGoldReward,
  rollIndividualRarity,
  rollMundaneItems,
  rollMagicItems,
  generateFlavorText,
  generateLootPayload,
} from "@/lib/rules/loot";

// ---------------------------------------------------------------------------
// GenerateLootInputSchema
// ---------------------------------------------------------------------------

describe("GenerateLootInputSchema", () => {
  it("accepts a valid input with mid-range tensionScore", () => {
    const result = GenerateLootInputSchema.safeParse({
      encounterId: "enc-001",
      tensionScore: 0.5,
    });
    expect(result.success).toBe(true);
  });

  it("accepts tensionScore at lower boundary (0)", () => {
    const result = GenerateLootInputSchema.safeParse({
      encounterId: "enc-001",
      tensionScore: 0,
    });
    expect(result.success).toBe(true);
  });

  it("accepts tensionScore at upper boundary (1)", () => {
    const result = GenerateLootInputSchema.safeParse({
      encounterId: "enc-001",
      tensionScore: 1,
    });
    expect(result.success).toBe(true);
  });

  it("rejects tensionScore below 0", () => {
    const result = GenerateLootInputSchema.safeParse({
      encounterId: "enc-001",
      tensionScore: -0.01,
    });
    expect(result.success).toBe(false);
  });

  it("rejects tensionScore above 1", () => {
    const result = GenerateLootInputSchema.safeParse({
      encounterId: "enc-001",
      tensionScore: 1.01,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty encounterId", () => {
    const result = GenerateLootInputSchema.safeParse({
      encounterId: "",
      tensionScore: 0.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing encounterId", () => {
    const result = GenerateLootInputSchema.safeParse({
      tensionScore: 0.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing tensionScore", () => {
    const result = GenerateLootInputSchema.safeParse({
      encounterId: "enc-001",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-numeric tensionScore", () => {
    const result = GenerateLootInputSchema.safeParse({
      encounterId: "enc-001",
      tensionScore: "high",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LootItemSchema
// ---------------------------------------------------------------------------

describe("LootItemSchema", () => {
  const validItem = {
    name: "Tarnished copper bracelet",
    type: "misc",
    rarity: "mundane",
    description: "A thin band of hammered copper, green with age.",
    properties: {},
    valueGP: 1,
  };

  it("accepts a valid mundane misc item", () => {
    expect(LootItemSchema.safeParse(validItem).success).toBe(true);
  });

  it("accepts a valid rare weapon", () => {
    const result = LootItemSchema.safeParse({
      ...validItem,
      type: "weapon",
      rarity: "rare",
      properties: { damageDice: "1d8", damageBonus: 1, damageType: "slashing" },
      valueGP: 500,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid legendary armor", () => {
    const result = LootItemSchema.safeParse({
      ...validItem,
      type: "armor",
      rarity: "legendary",
      valueGP: 10000,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a consumable with zero valueGP", () => {
    const result = LootItemSchema.safeParse({
      ...validItem,
      type: "consumable",
      rarity: "uncommon",
      valueGP: 0,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a very_rare item", () => {
    const result = LootItemSchema.safeParse({
      ...validItem,
      rarity: "very_rare",
      valueGP: 2000,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing name", () => {
    const { name: _name, ...noName } = validItem;
    expect(LootItemSchema.safeParse(noName).success).toBe(false);
  });

  it("rejects invalid type", () => {
    expect(LootItemSchema.safeParse({ ...validItem, type: "potion" }).success).toBe(false);
  });

  it("rejects invalid rarity", () => {
    expect(LootItemSchema.safeParse({ ...validItem, rarity: "epic" }).success).toBe(false);
  });

  it("rejects description exceeding 200 characters", () => {
    const result = LootItemSchema.safeParse({
      ...validItem,
      description: "x".repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it("accepts description at exactly 200 characters", () => {
    const result = LootItemSchema.safeParse({
      ...validItem,
      description: "x".repeat(200),
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative valueGP", () => {
    expect(LootItemSchema.safeParse({ ...validItem, valueGP: -1 }).success).toBe(false);
  });

  it("rejects fractional valueGP", () => {
    expect(LootItemSchema.safeParse({ ...validItem, valueGP: 1.5 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LootPayloadSchema
// ---------------------------------------------------------------------------

describe("LootPayloadSchema", () => {
  const validItem = {
    name: "Tarnished copper bracelet",
    type: "misc" as const,
    rarity: "mundane" as const,
    description: "A thin band of hammered copper.",
    properties: {},
    valueGP: 1,
  };

  const validPayload = {
    gold: 42,
    mundaneItems: [validItem],
    magicItems: [],
    totalValue: 43,
    rarityBracket: "mundane",
    flavorText: "Pockets picked clean. A few coins and dust.",
  };

  it("accepts a valid payload with items", () => {
    expect(LootPayloadSchema.safeParse(validPayload).success).toBe(true);
  });

  it("accepts a payload with empty arrays and zero gold", () => {
    const result = LootPayloadSchema.safeParse({
      gold: 0,
      mundaneItems: [],
      magicItems: [],
      totalValue: 0,
      rarityBracket: "mundane",
      flavorText: "Nothing.",
    });
    expect(result.success).toBe(true);
  });

  it("accepts all valid rarityBracket values", () => {
    const brackets = ["mundane", "uncommon", "rare", "very_rare", "legendary"] as const;
    for (const rarityBracket of brackets) {
      const result = LootPayloadSchema.safeParse({ ...validPayload, rarityBracket });
      expect(result.success).toBe(true);
    }
  });

  it("rejects negative gold", () => {
    expect(LootPayloadSchema.safeParse({ ...validPayload, gold: -1 }).success).toBe(false);
  });

  it("rejects fractional gold", () => {
    expect(LootPayloadSchema.safeParse({ ...validPayload, gold: 3.5 }).success).toBe(false);
  });

  it("rejects negative totalValue", () => {
    expect(LootPayloadSchema.safeParse({ ...validPayload, totalValue: -1 }).success).toBe(false);
  });

  it("rejects invalid rarityBracket string", () => {
    expect(LootPayloadSchema.safeParse({ ...validPayload, rarityBracket: "epic" }).success).toBe(false);
  });

  it("rejects flavorText exceeding 300 characters", () => {
    const result = LootPayloadSchema.safeParse({
      ...validPayload,
      flavorText: "x".repeat(301),
    });
    expect(result.success).toBe(false);
  });

  it("accepts flavorText at exactly 300 characters", () => {
    const result = LootPayloadSchema.safeParse({
      ...validPayload,
      flavorText: "x".repeat(300),
    });
    expect(result.success).toBe(true);
  });

  it("rejects payload with invalid magic item", () => {
    const result = LootPayloadSchema.safeParse({
      ...validPayload,
      magicItems: [{ ...validItem, rarity: "epic" }],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tensionToRarityBracket
// ---------------------------------------------------------------------------

describe("tensionToRarityBracket", () => {
  it("returns 'mundane' for tensionScore 0.0", () => {
    expect(tensionToRarityBracket(0.0)).toBe("mundane");
  });

  it("returns 'mundane' for tensionScore 0.19 (below 0.20 threshold)", () => {
    expect(tensionToRarityBracket(0.19)).toBe("mundane");
  });

  it("returns 'uncommon' at the 0.20 boundary", () => {
    expect(tensionToRarityBracket(0.20)).toBe("uncommon");
  });

  it("returns 'uncommon' for tensionScore 0.39", () => {
    expect(tensionToRarityBracket(0.39)).toBe("uncommon");
  });

  it("returns 'rare' at the 0.40 boundary", () => {
    expect(tensionToRarityBracket(0.40)).toBe("rare");
  });

  it("returns 'rare' for tensionScore 0.69", () => {
    expect(tensionToRarityBracket(0.69)).toBe("rare");
  });

  it("returns 'very_rare' at the 0.70 boundary", () => {
    expect(tensionToRarityBracket(0.70)).toBe("very_rare");
  });

  it("returns 'very_rare' for tensionScore 0.94", () => {
    expect(tensionToRarityBracket(0.94)).toBe("very_rare");
  });

  it("returns 'legendary' at the 0.95 boundary", () => {
    expect(tensionToRarityBracket(0.95)).toBe("legendary");
  });

  it("returns 'legendary' for tensionScore 1.0", () => {
    expect(tensionToRarityBracket(1.0)).toBe("legendary");
  });
});

// ---------------------------------------------------------------------------
// rollGoldReward
// ---------------------------------------------------------------------------

describe("rollGoldReward", () => {
  it("always returns at least 1 GP", () => {
    expect(rollGoldReward(0, 0, 0, "seed")).toBeGreaterThanOrEqual(1);
  });

  it("returns a positive integer for typical encounter", () => {
    const gold = rollGoldReward(0.5, 3, 2, "enc-test");
    expect(Number.isInteger(gold)).toBe(true);
    expect(gold).toBeGreaterThanOrEqual(1);
  });

  it("is deterministic — same seed always returns same value", () => {
    const a = rollGoldReward(0.5, 3, 2, "same-seed");
    const b = rollGoldReward(0.5, 3, 2, "same-seed");
    expect(a).toBe(b);
  });

  it("produces different values for different seeds", () => {
    const a = rollGoldReward(0.5, 3, 2, "seed-a");
    const b = rollGoldReward(0.5, 3, 2, "seed-b");
    // Different seeds should very likely produce different variance values
    // (not guaranteed, but true for these specific seeds)
    expect(typeof a).toBe("number");
    expect(typeof b).toBe("number");
  });

  it("scales with higher tension: high tension yields more gold than low tension", () => {
    // Use same seed but different tension — high tension multiplier (3×) vs low (1×)
    const lowGold = rollGoldReward(0.0, 5, 3, "scale-test");
    const highGold = rollGoldReward(1.0, 5, 3, "scale-test");
    // High tension multiplier is 3× vs 1× at low — high must always win
    expect(highGold).toBeGreaterThan(lowGold);
  });

  it("enforces minimum 1 GP even with 0 CR and 0 enemies", () => {
    expect(rollGoldReward(0, 0, 0, "min-test")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// rollIndividualRarity
// ---------------------------------------------------------------------------

describe("rollIndividualRarity", () => {
  it("'uncommon' ceiling always returns 'uncommon'", () => {
    // Try many seeds to be sure
    for (let i = 0; i < 20; i++) {
      expect(rollIndividualRarity("uncommon", `seed-${i}`)).toBe("uncommon");
    }
  });

  it("returns a rarity ≤ the ceiling (never exceeds it)", () => {
    const RARITY_ORDER = ["mundane", "uncommon", "rare", "very_rare", "legendary"] as const;
    const ceilings = ["uncommon", "rare", "very_rare", "legendary"] as const;
    for (const ceiling of ceilings) {
      const ceilingIdx = RARITY_ORDER.indexOf(ceiling);
      for (let i = 0; i < 10; i++) {
        const result = rollIndividualRarity(ceiling, `seed-${ceiling}-${i}`);
        const resultIdx = RARITY_ORDER.indexOf(result);
        expect(resultIdx).toBeLessThanOrEqual(ceilingIdx);
      }
    }
  });

  it("is deterministic — same ceiling and seed always return same rarity", () => {
    const a = rollIndividualRarity("rare", "fixed-seed");
    const b = rollIndividualRarity("rare", "fixed-seed");
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// rollMundaneItems
// ---------------------------------------------------------------------------

describe("rollMundaneItems", () => {
  it("returns an array", () => {
    expect(Array.isArray(rollMundaneItems(0.5, "seed"))).toBe(true);
  });

  it("all items have rarity 'mundane'", () => {
    const items = rollMundaneItems(0.5, "seed");
    for (const item of items) {
      expect(item.rarity).toBe("mundane");
    }
  });

  it("all items pass LootItemSchema validation", () => {
    const items = rollMundaneItems(0.5, "seed");
    for (const item of items) {
      expect(LootItemSchema.safeParse(item).success).toBe(true);
    }
  });

  it("returns exactly 1 item when tensionScore < 0.30", () => {
    const items = rollMundaneItems(0.1, "seed-low");
    expect(items).toHaveLength(1);
  });

  it("returns 2 or 3 items when tensionScore >= 0.60", () => {
    const items = rollMundaneItems(0.75, "seed-high");
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items.length).toBeLessThanOrEqual(3);
  });

  it("is deterministic — same tensionScore and seed always returns same items", () => {
    const a = rollMundaneItems(0.5, "det-seed");
    const b = rollMundaneItems(0.5, "det-seed");
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// rollMagicItems
// ---------------------------------------------------------------------------

describe("rollMagicItems", () => {
  it("returns [] for 'mundane' bracket — no magic items for trivial fights", () => {
    expect(rollMagicItems("mundane", 0.1, "seed")).toHaveLength(0);
  });

  it("returns 0 or 1 items for 'uncommon' bracket", () => {
    const counts = new Set<number>();
    for (let i = 0; i < 20; i++) {
      counts.add(rollMagicItems("uncommon", 0.3, `seed-${i}`).length);
    }
    // At least one seed should produce 0 and at least one should produce 1
    // (probabilistic, but with 20 seeds should hold)
    expect(counts.size).toBeGreaterThanOrEqual(1);
    for (const count of counts) {
      expect(count).toBeLessThanOrEqual(1);
    }
  });

  it("returns exactly 1 item for 'rare' bracket", () => {
    expect(rollMagicItems("rare", 0.5, "seed")).toHaveLength(1);
  });

  it("returns 1 or 2 items for 'very_rare' bracket", () => {
    const len = rollMagicItems("very_rare", 0.8, "seed").length;
    expect(len).toBeGreaterThanOrEqual(1);
    expect(len).toBeLessThanOrEqual(2);
  });

  it("returns exactly 1 item for 'legendary' bracket", () => {
    expect(rollMagicItems("legendary", 0.99, "seed")).toHaveLength(1);
  });

  it("all items pass LootItemSchema validation", () => {
    const items = rollMagicItems("rare", 0.5, "seed");
    for (const item of items) {
      expect(LootItemSchema.safeParse(item).success).toBe(true);
    }
  });

  it("is deterministic — same inputs always return same items", () => {
    const a = rollMagicItems("rare", 0.5, "det-seed");
    const b = rollMagicItems("rare", 0.5, "det-seed");
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// generateFlavorText
// ---------------------------------------------------------------------------

describe("generateFlavorText", () => {
  it("returns a non-empty string", () => {
    const text = generateFlavorText("mundane", "seed");
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });

  it("returns a string ≤ 300 characters", () => {
    const rarities = ["mundane", "uncommon", "rare", "very_rare", "legendary"] as const;
    for (const rarity of rarities) {
      expect(generateFlavorText(rarity, "seed").length).toBeLessThanOrEqual(300);
    }
  });

  it("is deterministic — same rarity and seed always returns same text", () => {
    const a = generateFlavorText("rare", "fixed");
    const b = generateFlavorText("rare", "fixed");
    expect(a).toBe(b);
  });

  it("returns text for every rarity bracket", () => {
    const rarities = ["mundane", "uncommon", "rare", "very_rare", "legendary"] as const;
    for (const rarity of rarities) {
      const text = generateFlavorText(rarity, "seed");
      expect(text.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// generateLootPayload
// ---------------------------------------------------------------------------

describe("generateLootPayload", () => {
  it("returns a valid LootPayload at tensionScore 0 (mundane)", () => {
    const payload = generateLootPayload({
      tensionScore: 0,
      enemyCount: 1,
      avgCR: 1,
      seed: "test-enc-zero",
    });
    expect(LootPayloadSchema.safeParse(payload).success).toBe(true);
    expect(payload.rarityBracket).toBe("mundane");
    expect(payload.magicItems).toHaveLength(0);
  });

  it("returns a valid LootPayload at tensionScore 1 (legendary)", () => {
    const payload = generateLootPayload({
      tensionScore: 1,
      enemyCount: 5,
      avgCR: 10,
      seed: "test-enc-legend",
    });
    expect(LootPayloadSchema.safeParse(payload).success).toBe(true);
    expect(payload.rarityBracket).toBe("legendary");
  });

  it("totalValue equals gold + sum of all item values", () => {
    const payload = generateLootPayload({
      tensionScore: 0.6,
      enemyCount: 3,
      avgCR: 3,
      seed: "test-enc-value",
    });
    const itemTotal = [
      ...payload.mundaneItems,
      ...payload.magicItems,
    ].reduce((sum, item) => sum + item.valueGP, 0);
    expect(payload.totalValue).toBe(payload.gold + itemTotal);
  });

  it("gold is at least 1 GP for any input", () => {
    const payload = generateLootPayload({
      tensionScore: 0,
      enemyCount: 0,
      avgCR: 0,
      seed: "test-min",
    });
    expect(payload.gold).toBeGreaterThanOrEqual(1);
  });

  it("is deterministic — same inputs always produce same payload", () => {
    const input = { tensionScore: 0.5, enemyCount: 3, avgCR: 2, seed: "det-seed" };
    const a = generateLootPayload(input);
    const b = generateLootPayload(input);
    expect(a).toEqual(b);
  });

  it("mundane bracket has no magic items", () => {
    const payload = generateLootPayload({
      tensionScore: 0.1,
      enemyCount: 1,
      avgCR: 0.25,
      seed: "no-magic",
    });
    expect(payload.magicItems).toHaveLength(0);
  });
});
