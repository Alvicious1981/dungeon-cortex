import { describe, it, expect } from "vitest";
import {
  equipItem,
  useConsumable,
  type InventoryItem,
  type ConsumableProperties,
} from "@/lib/rules/inventory";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const BASE = { characterId: "char-1", quantity: 1, equippedSlot: null } as const;

const sword: InventoryItem = {
  ...BASE,
  id: "item-sword",
  name: "Longsword",
  type: "weapon",
  properties: { damageDice: "1d8", damageBonus: 0, damageType: "slashing" },
};

const dagger: InventoryItem = {
  ...BASE,
  id: "item-dagger",
  name: "Dagger",
  type: "weapon",
  properties: { damageDice: "1d4", damageBonus: 0, damageType: "piercing" },
};

const shield: InventoryItem = {
  ...BASE,
  id: "item-shield",
  name: "Shield",
  type: "armor",
  properties: { baseAC: 2, armorClass: "shield", addDexModifier: false, maxDexBonus: null },
};

const potion: InventoryItem = {
  ...BASE,
  id: "item-potion",
  name: "Healing Potion",
  type: "consumable",
  quantity: 3,
  properties: { healingDice: "2d4+2" },
};

const wandWithCharges: InventoryItem = {
  ...BASE,
  id: "item-wand",
  name: "Wand of Magic Missiles",
  type: "consumable",
  quantity: 1,
  properties: { effects: ["magic_missile"], charges: 7 },
};

// ─── equipItem ────────────────────────────────────────────────────────────────

describe("equipItem", () => {
  it("equips an item into an empty slot", () => {
    const result = equipItem("item-sword", "MAIN_HAND", [sword, dagger]);
    expect(result.find(i => i.id === "item-sword")?.equippedSlot).toBe("MAIN_HAND");
  });

  it("does not mutate the original inventory", () => {
    equipItem("item-sword", "MAIN_HAND", [sword, dagger]);
    expect(sword.equippedSlot).toBeNull();
  });

  it("leaves items in different slots untouched", () => {
    const shieldInOffHand = { ...shield, equippedSlot: "OFF_HAND" };
    const result = equipItem("item-sword", "MAIN_HAND", [sword, shieldInOffHand]);
    expect(result.find(i => i.id === "item-shield")?.equippedSlot).toBe("OFF_HAND");
  });

  it("unequips the prior occupant when slot is already taken", () => {
    const equippedSword = { ...sword, equippedSlot: "MAIN_HAND" };
    const result = equipItem("item-dagger", "MAIN_HAND", [equippedSword, dagger]);
    expect(result.find(i => i.id === "item-sword")?.equippedSlot).toBeNull();
    expect(result.find(i => i.id === "item-dagger")?.equippedSlot).toBe("MAIN_HAND");
  });

  it("equipping an item to the slot it already occupies is idempotent", () => {
    const equippedSword = { ...sword, equippedSlot: "MAIN_HAND" };
    const result = equipItem("item-sword", "MAIN_HAND", [equippedSword, dagger]);
    expect(result.find(i => i.id === "item-sword")?.equippedSlot).toBe("MAIN_HAND");
  });

  it("equipping moves an item from its old slot to the new slot", () => {
    const swordInOffHand = { ...sword, equippedSlot: "OFF_HAND" };
    const result = equipItem("item-sword", "MAIN_HAND", [swordInOffHand]);
    expect(result.find(i => i.id === "item-sword")?.equippedSlot).toBe("MAIN_HAND");
  });

  it("throws RangeError when itemId is not found in inventory", () => {
    expect(() => equipItem("ghost-id", "MAIN_HAND", [sword])).toThrow(RangeError);
  });

  it("throws RangeError on empty inventory", () => {
    expect(() => equipItem("item-sword", "MAIN_HAND", [])).toThrow(RangeError);
  });
});

describe("equipItem slot legality", () => {
  const sword = {
    id: "sword",
    characterId: "c1",
    name: "Longsword",
    type: "weapon",
    quantity: 1,
    properties: { damageDice: "1d8" },
    equippedSlot: null,
  };
  const mail = {
    id: "mail",
    characterId: "c1",
    name: "Chain Mail",
    type: "armor",
    quantity: 1,
    properties: { baseAC: 16, armorClass: "heavy", addDexModifier: false },
    equippedSlot: null,
  };

  it("refuses a weapon placed in the armour slot", () => {
    expect(() => equipItem("sword", "ARMOR", [sword, mail])).toThrow(RangeError);
    expect(() => equipItem("sword", "ARMOR", [sword, mail])).toThrow(
      /cannot occupy "ARMOR"/,
    );
  });

  it("refuses body armour placed in the off hand", () => {
    expect(() => equipItem("mail", "OFF_HAND", [sword, mail])).toThrow(RangeError);
  });

  it("refuses a slot that is not a slot", () => {
    expect(() => equipItem("sword", "HEAD", [sword, mail])).toThrow(RangeError);
  });

  it("still equips a legal placement, and still evicts the prior occupant", () => {
    const occupied = [{ ...sword, equippedSlot: null }, { ...mail, equippedSlot: "ARMOR" }];
    const other = {
      ...mail,
      id: "plate",
      name: "Plate",
      properties: { baseAC: 18, armorClass: "heavy", addDexModifier: false },
      equippedSlot: null,
    };
    const result = equipItem("plate", "ARMOR", [...occupied, other]);
    expect(result.find((i) => i.id === "plate")?.equippedSlot).toBe("ARMOR");
    expect(result.find((i) => i.id === "mail")?.equippedSlot).toBeNull();
  });

  it("still reports an unknown item, and reports it as not found rather than illegal", () => {
    expect(() => equipItem("ghost", "MAIN_HAND", [sword])).toThrow(/not found/);
  });
});

// ─── useConsumable ────────────────────────────────────────────────────────────

describe("useConsumable", () => {
  it("decrements quantity when item has no charges field", () => {
    const result = useConsumable(potion);
    expect(result.quantity).toBe(2);
  });

  it("does not mutate the original item", () => {
    useConsumable(potion);
    expect(potion.quantity).toBe(3);
  });

  it("decrements charges (not quantity) when charges are present", () => {
    const result = useConsumable(wandWithCharges);
    expect((result.properties as ConsumableProperties).charges).toBe(6);
    expect(result.quantity).toBe(1); // quantity unchanged
  });

  it("does not mutate the original item's properties when decrementing charges", () => {
    useConsumable(wandWithCharges);
    expect((wandWithCharges.properties as ConsumableProperties).charges).toBe(7);
  });

  it("charges stop at zero and do not go negative", () => {
    const lastCharge = {
      ...wandWithCharges,
      properties: { effects: ["magic_missile"], charges: 1 },
    };
    const result = useConsumable(lastCharge);
    expect((result.properties as ConsumableProperties).charges).toBe(0);
  });

  it("throws TypeError when item type is not consumable", () => {
    expect(() => useConsumable(sword)).toThrow(TypeError);
  });

  it("throws RangeError when quantity-based consumable is already depleted (quantity 0)", () => {
    expect(() => useConsumable({ ...potion, quantity: 0 })).toThrow(RangeError);
  });

  it("throws RangeError when charge-based consumable has 0 charges remaining", () => {
    const exhausted = {
      ...wandWithCharges,
      properties: { effects: ["magic_missile"], charges: 0 },
    };
    expect(() => useConsumable(exhausted)).toThrow(RangeError);
  });

  it("quantity depletion stops at zero (single-use potion with quantity 1)", () => {
    const singlePotion = { ...potion, quantity: 1 };
    const result = useConsumable(singlePotion);
    expect(result.quantity).toBe(0);
  });
});
