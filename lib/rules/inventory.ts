import { z } from "zod";
/**
 * lib/rules/inventory.ts
 *
 * Foundational rules module for inventory items (Milestone C — Magic and state depth).
 *
 * Mirrors the InventoryItem Prisma model. The `properties` JSON field carries a
 * type-specific payload; the interfaces below are the canonical shapes for each
 * `type` discriminant ("weapon" | "armor" | "consumable" | "spell" | "misc").
 */

// ---------------------------------------------------------------------------
// Local mirror of the Prisma InventoryItem model
// Replace with `import type { InventoryItem } from '../../app/generated/prisma'`
// once `pnpm prisma generate` has been run.
// ---------------------------------------------------------------------------

export interface InventoryItem {
  id: string;
  characterId: string;
  name: string;
  /** "weapon" | "armor" | "consumable" | "spell" | "misc" */
  type: string;
  quantity: number;
  properties: unknown;
  /** Equipped slot name, e.g. 'MAIN_HAND' | 'OFF_HAND' | 'ARMOR' | 'ACCESSORY'. Null = in bag. */
  equippedSlot?: string | null;
}

// ---------------------------------------------------------------------------
// Per-type property shapes
// ---------------------------------------------------------------------------

/** Properties for type === "weapon" */
export interface WeaponProperties {
  /** Dice notation for base damage, e.g. "1d8", "2d6" */
  damageDice: string;
  /** Flat bonus/penalty added after rolling damage */
  damageBonus: number;
  /** "slashing" | "piercing" | "bludgeoning" | "fire" | … */
  damageType: string;
  /** Weapon range in feet for ranged weapons; undefined for melee */
  rangeNormal?: number;
  rangeLong?: number;
  /** D&D 5e weapon properties, e.g. ["finesse", "light", "thrown"] */
  weaponProperties?: string[];
}

/** Properties for type === "armor" */
export interface ArmorProperties {
  /** Base AC granted */
  baseAC: number;
  /** "light" | "medium" | "heavy" | "shield" */
  armorClass: "light" | "medium" | "heavy" | "shield";
  /** Whether DEX modifier is added to AC */
  addDexModifier: boolean;
  /** Maximum DEX bonus allowed (null = no cap) */
  maxDexBonus: number | null;
  /** Minimum STR score required to wear without speed penalty */
  strengthRequirement?: number;
  /** True if wearing imposes disadvantage on Stealth checks */
  stealthDisadvantage?: boolean;
}

/** Properties for type === "consumable" */
export interface ConsumableProperties {
  /** Dice notation for healing, e.g. "2d4+2"; undefined for non-healing consumables */
  healingDice?: string;
  /** Flat healing applied in addition to any dice */
  healingBonus?: number;
  /** Free-form list of effects applied on use, e.g. ["remove_poisoned", "advantage_str_1_hour"] */
  effects?: string[];
  /** Number of charges remaining (undefined if single-use) */
  charges?: number;
}

/** Properties for type === "spell" (spell scroll or known spell record) */
export interface SpellProperties {
  /** Spell level (0 = cantrip) */
  spellLevel: number;
  /** Casting time, e.g. "1 action", "1 bonus action" */
  castingTime: string;
  /** Range, e.g. "Self", "60 feet" */
  range: string;
  /** Dice notation for spell damage if applicable, e.g. "8d6" */
  damageDice?: string;
  /** "fire" | "cold" | "necrotic" | … */
  damageType?: string;
  /** Saving throw ability if applicable, e.g. "DEX" */
  savingThrow?: string;
  /** Spell components required */
  components?: ("V" | "S" | "M")[];
  /** Duration, e.g. "Instantaneous", "Concentration, up to 1 minute" */
  duration?: string;
}

/** Properties for type === "misc" */
export interface MiscProperties {
  /** Human-readable description of what the item does */
  description?: string;
  /** Monetary value in gold pieces */
  valueGP?: number;
  /** Weight in pounds */
  weightLbs?: number;
}

// ---------------------------------------------------------------------------
// Discriminated union helpers
// ---------------------------------------------------------------------------

export type ItemType = "weapon" | "armor" | "consumable" | "spell" | "misc";

type ItemProperties = {
  weapon: WeaponProperties;
  armor: ArmorProperties;
  consumable: ConsumableProperties;
  spell: SpellProperties;
  misc: MiscProperties;
};

// ---------------------------------------------------------------------------
// Equip / unequip
// ---------------------------------------------------------------------------

/**
 * Returns a new inventory array with `itemId` equipped into `targetSlot`.
 *
 * Rules enforced:
 * - Each slot may hold at most one item — the previous occupant is unequipped.
 * - An item moving to a new slot is removed from its old slot automatically.
 * - Operation is idempotent if the item already occupies the target slot.
 * - Original array and items are never mutated.
 *
 * @throws {RangeError} if `itemId` is not found in `inventory`.
 */
export function equipItem(
  itemId: string,
  targetSlot: string,
  inventory: InventoryItem[]
): InventoryItem[] {
  const target = inventory.find((i) => i.id === itemId);
  if (!target) {
    throw new RangeError(`Item "${itemId}" not found in inventory.`);
  }

  return inventory.map((item) => {
    if (item.id === itemId) {
      // Move target item into the slot.
      return { ...item, equippedSlot: targetSlot };
    }
    if (item.equippedSlot === targetSlot) {
      // Evict the prior occupant of this slot.
      return { ...item, equippedSlot: null };
    }
    return item;
  });
}

// ---------------------------------------------------------------------------
// Consumable use
// ---------------------------------------------------------------------------

/**
 * Returns a new item with one use consumed (charges decremented, or quantity
 * decremented when no `charges` field is present).
 *
 * Rules enforced:
 * - Charges take priority over quantity when the `charges` field is present.
 * - Neither charges nor quantity will go below zero.
 * - Original item is never mutated.
 *
 * @throws {TypeError}  if `item.type` is not "consumable".
 * @throws {RangeError} if the item is already depleted (charges === 0 or quantity === 0).
 */
export function useConsumable(item: InventoryItem): InventoryItem {
  if (item.type !== "consumable") {
    throw new TypeError(
      `useConsumable expects type "consumable", got "${item.type}".`
    );
  }

  const props = item.properties as ConsumableProperties;

  if (typeof props.charges === "number") {
    if (props.charges === 0) {
      throw new RangeError(`"${item.name}" has no charges remaining.`);
    }
    return {
      ...item,
      properties: { ...props, charges: props.charges - 1 },
    };
  }

  if (item.quantity === 0) {
    throw new RangeError(`"${item.name}" is depleted (quantity 0).`);
  }

  return { ...item, quantity: item.quantity - 1 };
}

/** Narrows `item.properties` to the correct typed shape for the given type. */
export function getItemProperties<T extends ItemType>(
  item: InventoryItem,
  type: T
): ItemProperties[T] | null {
  if (item.type !== type) return null;
  return item.properties as ItemProperties[T];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Stub: validates that an InventoryItem has the required fields for its type.
 * Returns true if the item is structurally sound; false otherwise.
 *
 * TODO (Milestone C): expand each branch with full rules validation
 * (e.g. valid dice notation via dice.ts, legal damage types from 5e constants).
 */
export function validateItem(item: InventoryItem): boolean {
  if (!item.id || !item.characterId || !item.name) return false;
  if (item.quantity < 0) return false;
  if (!item.properties || typeof item.properties !== "object") return false;

  const validTypes: ItemType[] = ["weapon", "armor", "consumable", "spell", "misc"];
  if (!validTypes.includes(item.type as ItemType)) return false;

  switch (item.type as ItemType) {
    case "weapon": {
      const p = item.properties as Partial<WeaponProperties>;
      return typeof p.damageDice === "string" && p.damageDice.length > 0;
    }
    case "armor": {
      const p = item.properties as Partial<ArmorProperties>;
      return typeof p.baseAC === "number" && p.baseAC >= 0;
    }
    case "consumable": {
      const p = item.properties as Partial<ConsumableProperties>;
      // A consumable must have either healing dice or at least one effect.
      return (
        typeof p.healingDice === "string" ||
        (Array.isArray(p.effects) && p.effects.length > 0)
      );
    }
    case "spell": {
      const p = item.properties as Partial<SpellProperties>;
      return typeof p.spellLevel === "number" && p.spellLevel >= 0;
    }
    case "misc":
      return true;
  }
}

// ---------------------------------------------------------------------------
// Tool Input Schemas (Single Source of Truth)
// ---------------------------------------------------------------------------

export const UseConsumableInputSchema = z.object({
  characterId: z.string().describe("The ID of the character consuming the item."),
  itemName: z.string().describe("The name of the item being consumed (e.g. 'Health Potion')."),
});

export type UseConsumableInput = z.infer<typeof UseConsumableInputSchema>;

export const EQUIPMENT_SLOTS = [
  "MAIN_HAND",
  "OFF_HAND",
  "ARMOR",
  "ACCESSORY",
] as const;

export const ManageEquipmentInputSchema = z.object({
  characterId: z.string().min(1).describe("The character's ID from Character State."),
  itemId: z.string().min(1).describe("The inventory item ID to equip."),
  targetSlot: z.enum(EQUIPMENT_SLOTS).describe("The target equipment slot."),
}).strict();

export type ManageEquipmentInput = z.infer<typeof ManageEquipmentInputSchema>;
