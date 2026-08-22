import { describe, expect, it } from "vitest";
import { buildSheetViewModel } from "@/lib/character-sheet/view-model";

describe("server character sheet projection", () => {
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
