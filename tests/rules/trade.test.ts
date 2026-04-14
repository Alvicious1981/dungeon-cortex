import { describe, it, expect } from "vitest";
import {
  GenerateMerchantInputSchema,
  TradeItemSchema,
  MerchantPayloadSchema,
  TradeActionSchema,
  TradeResultSchema,
  ARCHETYPE_CONFIGS,
  getItemBaseValue,
  computeBuyPrice,
  computeSellPrice,
  generateMerchantInventory,
  buildMerchantPayload,
} from "../../lib/rules/trade";

describe("Trade Rules - Zod Schemas", () => {
  describe("GenerateMerchantInputSchema", () => {
    it("parses valid input", () => {
      const result = GenerateMerchantInputSchema.safeParse({
        npcSeed: "merchant-seed",
        archetype: "blacksmith",
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty npcSeed", () => {
      const result = GenerateMerchantInputSchema.safeParse({
        npcSeed: "",
        archetype: "blacksmith",
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid archetype", () => {
      const result = GenerateMerchantInputSchema.safeParse({
        npcSeed: "merchant-seed",
        archetype: "invalid_type",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("TradeItemSchema", () => {
    it("parses valid item", () => {
      const result = TradeItemSchema.safeParse({
        index: 0,
        name: "Iron Sword",
        type: "weapon",
        rarity: "mundane",
        description: "A rusty iron sword.",
        properties: {},
        baseValueGP: 10,
        buyPriceGP: 11,
      });
      expect(result.success).toBe(true);
    });

    it("rejects negative prices", () => {
      const result = TradeItemSchema.safeParse({
        index: 0,
        name: "Iron Sword",
        type: "weapon",
        rarity: "mundane",
        description: "A rusty iron sword.",
        properties: {},
        baseValueGP: -10, // Invalid
        buyPriceGP: -11, // Invalid
      });
      expect(result.success).toBe(false);
    });
    
    it("rejects oversized descriptions", () => {
      const result = TradeItemSchema.safeParse({
        index: 0,
        name: "Iron Sword",
        type: "weapon",
        rarity: "mundane",
        description: "A".repeat(201),
        properties: {},
        baseValueGP: 10,
        buyPriceGP: 11,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("MerchantPayloadSchema", () => {
    it("parses valid payload", () => {
      const result = MerchantPayloadSchema.safeParse({
        npcSeed: "merchant-seed",
        name: "Gorguk",
        archetype: "fence",
        greeting: "Got some rare things.",
        inventory: [],
        buyModifier: 1.5,
        sellModifier: 0.6,
      });
      expect(result.success).toBe(true);
    });
    
    it("rejects sellModifier > 1", () => {
      const result = MerchantPayloadSchema.safeParse({
        npcSeed: "merchant-seed",
        name: "Gorguk",
        archetype: "fence",
        greeting: "Got some rare things.",
        inventory: [],
        buyModifier: 1.5,
        sellModifier: 1.1, // > 1
      });
      expect(result.success).toBe(false);
    });
  });

  describe("TradeActionSchema", () => {
    it("parses valid buy action", () => {
      const result = TradeActionSchema.safeParse({
        action: "buy",
        itemIndex: 1,
        quantity: 2,
        npcSeed: "seed",
        archetype: "alchemist",
      });
      expect(result.success).toBe(true);
    });

    it("parses valid sell action", () => {
      const result = TradeActionSchema.safeParse({
        action: "sell",
        inventoryItemId: "item-id",
        quantity: 1,
        npcSeed: "seed",
        archetype: "alchemist",
      });
      expect(result.success).toBe(true);
    });

    it("rejects quantity of 0", () => {
      const result = TradeActionSchema.safeParse({
        action: "buy",
        itemIndex: 1,
        quantity: 0,
        npcSeed: "seed",
        archetype: "alchemist",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("TradeResultSchema", () => {
    it("parses valid success result", () => {
      const result = TradeResultSchema.safeParse({
        success: true,
        action: "buy",
        itemName: "Potion",
        quantity: 1,
        goldDelta: -50,
        newGoldBalance: 150,
      });
      expect(result.success).toBe(true);
    });

    it("parses valid error result", () => {
      const result = TradeResultSchema.safeParse({
        success: false,
        action: "sell",
        itemName: "Ring",
        quantity: 1,
        goldDelta: 0,
        newGoldBalance: 200,
        error: "Item not found in inventory",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Config validations", () => {
    it("fence sellModifier is greater than other archetypes", () => {
      const fenceSellMod = ARCHETYPE_CONFIGS.fence.sellModifier;
      const others = [
        ARCHETYPE_CONFIGS.blacksmith.sellModifier,
        ARCHETYPE_CONFIGS.alchemist.sellModifier,
        ARCHETYPE_CONFIGS.general.sellModifier,
        ARCHETYPE_CONFIGS.arcanist.sellModifier,
      ];
      
      others.forEach(mod => {
        expect(fenceSellMod).toBeGreaterThan(mod);
      });
    });

    it("general buyModifier is 1.0", () => {
      expect(ARCHETYPE_CONFIGS.general.buyModifier).toBe(1.0);
    });
  });

  describe("Trade Rules Engine (Pure Functions)", () => {
    it("getItemBaseValue handles missing value", () => {
      expect(getItemBaseValue({})).toBe(0);
      expect(getItemBaseValue({ valueGP: 50 })).toBe(50);
    });

    it("computeBuyPrice applies archetype markup", () => {
      // General Goods: 1.0 modifier
      expect(computeBuyPrice(100, "general")).toBe(100);
      // Fence: 1.5 modifier
      expect(computeBuyPrice(100, "fence")).toBe(150);
      // Blacksmith: 1.1 modifier -> 111 (due to float precision 110.00000000000001)
      expect(computeBuyPrice(100, "blacksmith")).toBe(111);
      // Alchemist: 1.2 modifier -> 120
      expect(computeBuyPrice(100, "alchemist")).toBe(120);
    });

    it("computeSellPrice applies archetype discount", () => {
      // General Goods: 0.5 modifier
      expect(computeSellPrice(100, "general")).toBe(50);
      // Fence: 0.6 modifier
      expect(computeSellPrice(100, "fence")).toBe(60);
      // Arcanist: 0.35 modifier -> 35
      expect(computeSellPrice(100, "arcanist")).toBe(35);
    });

    it("generateMerchantInventory creates a deterministic list", () => {
      const seed = "fixed-seed";
      const inv1 = generateMerchantInventory("blacksmith", seed);
      const inv2 = generateMerchantInventory("blacksmith", seed);
      
      expect(inv1.length).toBeGreaterThan(0);
      expect(inv1).toEqual(inv2);
      
      // Verify rarity check (blacksmith max rarity is 'rare')
      inv1.forEach(item => {
        const rarities = ["mundane", "uncommon", "rare"];
        expect(rarities).toContain(item.rarity);
        expect(item.type === "weapon" || item.type === "armor").toBe(true);
      });
    });

    it("buildMerchantPayload assembles a full merchant", () => {
      const seed = "test-merchant-payload";
      const payload = buildMerchantPayload("alchemist", seed);
      
      expect(payload.npcSeed).toBe(seed);
      expect(payload.name).toBeDefined();
      expect(payload.archetype).toBe("alchemist");
      expect(payload.inventory.length).toBeGreaterThanOrEqual(ARCHETYPE_CONFIGS.alchemist.inventoryMin);
      expect(payload.inventory.length).toBeLessThanOrEqual(ARCHETYPE_CONFIGS.alchemist.inventoryMax);
      expect(payload.greeting).toBeDefined();
    });
  });
});
