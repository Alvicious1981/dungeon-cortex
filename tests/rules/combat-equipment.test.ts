import { describe, expect, it } from "vitest";
import { resolveCombatEquipment } from "@/lib/rules/combat-equipment";

const weapon = { type: "weapon", properties: {} };
const accessory = { type: "misc", properties: {} };
const armour = { type: "armor", properties: { armorClass: "heavy" } };
const shield = { type: "armor", properties: { armorClass: "shield" } };

describe("resolveCombatEquipment", () => {
  it("implements the approved combat equipment cost matrix", () => {
    expect(resolveCombatEquipment({ item: armour, alreadyEquipped: false, slotOccupied: false, interactionUsed: false })).toEqual({ ok: false, code: "EQUIP_REQUIRES_OUT_OF_COMBAT" });
    expect(resolveCombatEquipment({ item: shield, alreadyEquipped: false, slotOccupied: false, interactionUsed: null })).toEqual({ ok: true, mode: "action", endsTurn: true });
    expect(resolveCombatEquipment({ item: shield, alreadyEquipped: false, slotOccupied: true, interactionUsed: false })).toEqual({ ok: false, code: "EQUIPMENT_CHANGE_REQUIRES_MULTIPLE_TURNS" });
    expect(resolveCombatEquipment({ item: weapon, alreadyEquipped: true, slotOccupied: true, interactionUsed: false })).toEqual({ ok: false, code: "ITEM_ALREADY_EQUIPPED" });
    expect(resolveCombatEquipment({ item: weapon, alreadyEquipped: false, slotOccupied: false, interactionUsed: false })).toEqual({ ok: true, mode: "interaction", endsTurn: false });
    expect(resolveCombatEquipment({ item: accessory, alreadyEquipped: false, slotOccupied: false, interactionUsed: true })).toEqual({ ok: true, mode: "action", endsTurn: true });
    expect(resolveCombatEquipment({ item: weapon, alreadyEquipped: false, slotOccupied: true, interactionUsed: false })).toEqual({ ok: true, mode: "action", endsTurn: true });
    expect(resolveCombatEquipment({ item: weapon, alreadyEquipped: false, slotOccupied: true, interactionUsed: true })).toEqual({ ok: false, code: "EQUIPMENT_CHANGE_REQUIRES_MULTIPLE_TURNS" });
    expect(resolveCombatEquipment({ item: accessory, alreadyEquipped: false, slotOccupied: false, interactionUsed: null })).toEqual({ ok: false, code: "OBJECT_INTERACTION_BUDGET_UNAVAILABLE" });
  });
});
