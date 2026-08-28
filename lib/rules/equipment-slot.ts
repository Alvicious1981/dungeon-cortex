/**
 * lib/rules/equipment-slot.ts
 *
 * Which slot an item occupies, and whether a proposed placement is legal.
 *
 * @pure — no database, no I/O, no randomness, and never throws.
 *
 * This module exists because the answer was decided in one place and validated
 * in none. `app/api/campaign/[id]/action/route.ts` chose a slot from the item's
 * `type` alone, sending every armour-typed row to the single ARMOR slot — so a
 * pair of boots evicted the body armour and switched off the proficiency rule
 * that decides attack rolls, STR and DEX checks, and whether a caster can cast.
 * `equipItem` took the slot as a parameter and validated nothing at all, not
 * even that the string was a slot.
 *
 * `slotAccepts` is derived from `slotFor` rather than written beside it. A
 * placement is legal exactly when it is the placement the rule would choose,
 * which makes "the rule chose ARMOR but rejects ARMOR" unrepresentable.
 *
 * Routing keys off the armour category, read through `readArmorProfile` — the
 * same reader `selectBodyArmor` uses. If the two read the category differently,
 * an item could occupy ARMOR and still not be found there.
 */

import { readArmorProfile } from "@/lib/rules/armor-class";
// `import type` deliberately: Task 2 makes `inventory.ts` import this module,
// and a value import here would close the cycle at runtime. A type-only import
// is erased, so `EQUIPMENT_SLOTS` stays the single definition of the vocabulary
// without either module depending on the other's evaluation order.
import type { EQUIPMENT_SLOTS } from "@/lib/rules/inventory";

export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];

export interface SlotDecision {
  slot: EquipmentSlot;
}

/**
 * The least an item must be for the rule to place it.
 *
 * `properties` is `unknown` because it arrives as untyped JSON from Postgres.
 * A blob the reader cannot parse resolves to ACCESSORY — the slot that grants
 * nothing, so a malformed row can never be routed into the one slot that would
 * disable a rule.
 */
export interface SlotCandidate {
  type: string;
  properties: unknown;
}

const ACCESSORY: SlotDecision = Object.freeze({ slot: "ACCESSORY" });

export function slotFor(item: SlotCandidate): SlotDecision {
  if (item.type === "weapon") return { slot: "MAIN_HAND" };

  if (item.type === "armor") {
    const { category } = readArmorProfile(item.properties);

    switch (category) {
      case "light":
      case "medium":
      case "heavy":
        return { slot: "ARMOR" };
      case "shield":
        return { slot: "OFF_HAND" };
      case null:
        // An armour-typed row that declares no category is a worn bonus, not
        // body armour. Eight of the ten loot rows are exactly this.
        return ACCESSORY;
      default: {
        const unreachable: never = category;
        return unreachable;
      }
    }
  }

  return ACCESSORY;
}

/**
 * Whether `item` may occupy `slot`.
 *
 * Note that this rejects a slot the rule would not choose even when that slot
 * is a real member of `EQUIPMENT_SLOTS` — a longsword may not go in ARMOR, and
 * body armour may not go in OFF_HAND.
 */
export function slotAccepts(item: SlotCandidate, slot: string): boolean {
  return slotFor(item).slot === slot;
}
