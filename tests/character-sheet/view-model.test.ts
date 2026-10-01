import { describe, expect, it } from "vitest";
import { buildSheetViewModel } from "@/lib/character-sheet/view-model";

describe("server character sheet projection", () => {
  it("preserves each equipment slot and projects only supplied item details", () => {
    const view = buildSheetViewModel({
      character: {
        id: "character-1", name: "Mira", race: "Human", class: "Fighter", level: 1,
        hp: 10, maxHp: 10, xp: 0, stats: {},
      },
      inventory: [
        { id: "sword", name: "Espada", type: "weapon", quantity: 1, equippedSlot: "MAIN_HAND", properties: { damageDice: "1d8", damageType: "slashing", weaponProperties: ["Versatile"] } },
        { id: "shield", name: "Escudo", type: "armor", quantity: 1, equippedSlot: "OFF_HAND", properties: { baseAC: 2, armorClass: "shield" } },
        { id: "armor", name: "Cota", type: "armor", quantity: 1, equippedSlot: "ARMOR", properties: { baseAC: 16, stealthDisadvantage: true } },
        { id: "ring", name: "Anillo", type: "misc", quantity: 1, equippedSlot: "ACCESSORY", properties: { description: "Un anillo de cobre.", weightLbs: 0 } },
        { id: "rope", name: "Cuerda", type: "misc", quantity: 1, equippedSlot: null, properties: {} },
      ],
    });
    expect(view.inventory.map(({ id, equippedSlot }) => ({ id, equippedSlot }))).toEqual([
      { id: "sword", equippedSlot: "MAIN_HAND" },
      { id: "shield", equippedSlot: "OFF_HAND" },
      { id: "armor", equippedSlot: "ARMOR" },
      { id: "ring", equippedSlot: "ACCESSORY" },
      { id: "rope", equippedSlot: null },
    ]);
    expect(view.inventory[0].tooltipLines).toContain("Daño base: 1d8 slashing");
    expect(view.inventory[2].tooltipLines).toContain("Sigilo: desventaja");
    expect(view.inventory[3].summary).toBe("Un anillo de cobre.");
    expect(view.inventory[3].tooltipLines).toContain("Peso: 0 lb");
    expect(view.inventory[4].summary).toBeUndefined();
    expect(view.inventory[4].tooltipLines).toEqual([]);
  });
  it("derives combat display values without inventing movement speed", () => {
    const view = buildSheetViewModel({
      character: {
        id: "character-1", name: "Mira", race: "Human", class: "Fighter", level: 5,
        hp: 30, maxHp: 40, xp: 6_500,
        stats: { STR: 16, DEX: 14, CON: 14, INT: 10, WIS: 12, CHA: 8 },
        spellSlots: { "1": { current: 1, max: 2 } },
      },
      inventory: [
        { id: "armor", name: "Scale Mail", type: "armor", quantity: 1, equippedSlot: "ARMOR", properties: { baseAC: 14, addDexModifier: true, maxDexBonus: 2 } },
        { id: "sword", name: "Rapier", type: "weapon", quantity: 1, equippedSlot: "MAIN_HAND", properties: { damageDice: "1d8", damageType: "piercing", weaponCategory: "Martial", weaponProperties: ["Finesse"] } },
      ],
    });
    expect(view.core).toMatchObject({ armorClass: 16, initiative: 2, speedFeet: null, proficiencyBonus: 3, passivePerception: 11 });
    expect(view.attacks[0]).toMatchObject({ name: "Rapier", bonus: 6, damage: "1d8+3 piercing" });
    expect(view.spellSlots).toEqual([{ level: 1, total: 2, used: 1 }]);
  });
});
