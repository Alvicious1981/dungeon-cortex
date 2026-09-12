import { slotFor, type SlotCandidate } from "@/lib/rules/equipment-slot";

export type EquipmentRefusalCode =
  | "EQUIP_REQUIRES_OUT_OF_COMBAT"
  | "EQUIPMENT_CHANGE_REQUIRES_MULTIPLE_TURNS"
  | "ITEM_ALREADY_EQUIPPED"
  | "OBJECT_INTERACTION_BUDGET_UNAVAILABLE";

export type CombatEquipmentDecision =
  | { ok: true; mode: "interaction" | "action"; endsTurn: boolean }
  | { ok: false; code: EquipmentRefusalCode };

export function resolveCombatEquipment(input: {
  item: SlotCandidate;
  alreadyEquipped: boolean;
  slotOccupied: boolean;
  interactionUsed: boolean | null;
}): CombatEquipmentDecision {
  const slot = slotFor(input.item).slot;
  if (slot === "ARMOR") return { ok: false, code: "EQUIP_REQUIRES_OUT_OF_COMBAT" };
  if (input.alreadyEquipped) return { ok: false, code: "ITEM_ALREADY_EQUIPPED" };
  if (slot === "OFF_HAND") {
    return input.slotOccupied
      ? { ok: false, code: "EQUIPMENT_CHANGE_REQUIRES_MULTIPLE_TURNS" }
      : { ok: true, mode: "action", endsTurn: true };
  }
  if (input.interactionUsed === null) {
    return { ok: false, code: "OBJECT_INTERACTION_BUDGET_UNAVAILABLE" };
  }
  if (!input.slotOccupied && !input.interactionUsed) {
    return { ok: true, mode: "interaction", endsTurn: false };
  }
  if (input.slotOccupied && input.interactionUsed) {
    return { ok: false, code: "EQUIPMENT_CHANGE_REQUIRES_MULTIPLE_TURNS" };
  }
  return { ok: true, mode: "action", endsTurn: true };
}
