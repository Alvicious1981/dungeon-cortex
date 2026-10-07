import { describe, expect, it } from "vitest";
import { buildSheetViewModel } from "@/lib/character-sheet/view-model";

describe("canonical character sheet projection", () => {
  it("projects stats and modifiers from canonical CharacterAbility records", () => {
    const view = buildSheetViewModel({
      character: {
        id: "char-canonical-stats",
        name: "Valeros",
        race: "Human",
        class: "Fighter",
        level: 1,
        hp: 12,
        maxHp: 12,
        xp: 0,
        stats: { STR: 10, DEX: 10 }, // legacy should be overridden by canonical abilities
        abilities: [
          { abilityCode: "STR", baseScore: 18 },
          { abilityCode: "DEX", baseScore: 14 },
          { abilityCode: "CON", baseScore: 16 },
          { abilityCode: "INT", baseScore: 10 },
          { abilityCode: "WIS", baseScore: 12 },
          { abilityCode: "CHA", baseScore: 8 },
        ] as any,
      },
      inventory: [],
    });

    expect(view.abilities).toEqual({
      str: { score: 18, modifier: 4, proficient: true },
      dex: { score: 14, modifier: 2, proficient: false },
      con: { score: 16, modifier: 3, proficient: true },
      int: { score: 10, modifier: 0, proficient: false },
      wis: { score: 12, modifier: 1, proficient: false },
      cha: { score: 8, modifier: -1, proficient: false },
    });
  });

  it("projects saving throws using canonical proficiencies", () => {
    const view = buildSheetViewModel({
      character: {
        id: "char-canonical-saves",
        name: "Valeros",
        race: "Human",
        class: "Fighter",
        level: 1, // profBonus = 2
        hp: 12,
        maxHp: 12,
        xp: 0,
        stats: { STR: 16, DEX: 14, CON: 14, INT: 10, WIS: 10, CHA: 8 },
        proficiencies: [
          { type: "SAVING_THROW", code: "STR" },
          { type: "SAVING_THROW", code: "CON" },
        ] as any,
      },
      inventory: [],
    });

    const strSave = view.savingThrows.find((s) => s.label === "Fuerza");
    const dexSave = view.savingThrows.find((s) => s.label === "Destreza");
    const conSave = view.savingThrows.find((s) => s.label === "Constitución");

    // STR: mod (+3) + prof (+2) = +5
    expect(strSave).toEqual({ label: "Fuerza", value: "+5", proficient: true });
    // DEX: mod (+2) = +2
    expect(dexSave).toEqual({ label: "Destreza", value: "+2", proficient: false });
    // CON: mod (+2) + prof (+2) = +4
    expect(conSave).toEqual({ label: "Constitución", value: "+4", proficient: true });
  });

  it("projects all 18 SRD skills with canonical proficiency and expertise", () => {
    const view = buildSheetViewModel({
      character: {
        id: "char-canonical-skills",
        name: "Lidda",
        race: "Halfling",
        class: "Rogue",
        level: 1, // profBonus = 2
        hp: 9,
        maxHp: 9,
        xp: 0,
        stats: { STR: 8, DEX: 16, CON: 12, INT: 14, WIS: 14, CHA: 10 },
        skills: [
          { skillCode: "stealth", level: "EXPERTISE" }, // DEX +3, prof +2, expertise => 3 + 4 = 7
          { skillCode: "perception", level: "PROFICIENT" }, // WIS +2, prof +2 => 4
          { skillCode: "athletics", level: "NONE" }, // STR -1 => -1
        ] as any,
      },
      inventory: [],
    });

    expect(view.skills).toHaveLength(18);

    const stealth = view.skills.find((s) => s.label === "Sigilo");
    expect(stealth).toEqual({
      label: "Sigilo",
      value: "+7",
      proficient: true,
    });

    const perception = view.skills.find((s) => s.label === "Percepción");
    expect(perception).toEqual({
      label: "Percepción",
      value: "+4",
      proficient: true,
    });

    const athletics = view.skills.find((s) => s.label === "Atletismo");
    expect(athletics).toEqual({
      label: "Atletismo",
      value: "-1",
      proficient: false,
    });

    // Passive perception: 10 + wisMod (+2) + prof (+2) = 14
    expect(view.core.passivePerception).toBe(14);
  });

  it("resolves speedFeet and identity from canonical origin", () => {
    const view = buildSheetViewModel({
      character: {
        id: "char-canonical-origin",
        name: "Eldrin",
        race: "LegacyElf",
        class: "Wizard",
        level: 1,
        hp: 7,
        maxHp: 7,
        xp: 0,
        stats: { STR: 10, DEX: 14, CON: 12, INT: 16, WIS: 12, CHA: 10 },
        origin: {
          race: { name: "Alto Elfo", speed: 30 },
          background: { name: "Sabio" },
        } as any,
      },
      inventory: [],
    });

    expect(view.core.speedFeet).toBe(30);
    expect(view.identity.race).toBe("Alto Elfo");
    expect(view.identity.background).toBe("Sabio");
  });

  it("projects spellSlots from canonical CharacterSpellSlot records", () => {
    const view = buildSheetViewModel({
      character: {
        id: "char-canonical-slots",
        name: "Eldrin",
        race: "Elf",
        class: "Wizard",
        level: 3,
        hp: 16,
        maxHp: 16,
        xp: 900,
        stats: { STR: 10, DEX: 14, CON: 12, INT: 16, WIS: 12, CHA: 10 },
        spellSlotRecords: [
          { spellLevel: 1, maxSlots: 4, usedSlots: 1 },
          { spellLevel: 2, maxSlots: 2, usedSlots: 0 },
        ] as any,
      },
      inventory: [],
    });

    expect(view.spellSlots).toEqual([
      { level: 1, total: 4, used: 1 },
      { level: 2, total: 2, used: 0 },
    ]);
  });

  it("falls back gracefully when canonical relations are missing or empty", () => {
    const view = buildSheetViewModel({
      character: {
        id: "char-legacy",
        name: "Garrick",
        race: "Dwarf",
        class: "Cleric",
        level: 2,
        hp: 18,
        maxHp: 18,
        xp: 300,
        stats: { STR: 14, DEX: 8, CON: 16, INT: 10, WIS: 16, CHA: 12 },
        skills: [],
        spellSlots: { "1": { current: 1, max: 3 } },
      },
      inventory: [],
    });

    // speedFeet is null because there is no canonical origin with race.speed
    expect(view.core.speedFeet).toBeNull();
    // Cleric saves: WIS and CHA
    const wisSave = view.savingThrows.find((s) => s.label === "Sabiduría");
    const chaSave = view.savingThrows.find((s) => s.label === "Carisma");
    const strSave = view.savingThrows.find((s) => s.label === "Fuerza");
    // WIS mod +3 + prof 2 = +5
    expect(wisSave).toEqual({ label: "Sabiduría", value: "+5", proficient: true });
    // CHA mod +1 + prof 2 = +3
    expect(chaSave).toEqual({ label: "Carisma", value: "+3", proficient: true });
    // STR mod +2 = +2
    expect(strSave).toEqual({ label: "Fuerza", value: "+2", proficient: false });

    // Fallback spellSlots from JSON
    expect(view.spellSlots).toEqual([{ level: 1, total: 3, used: 2 }]);
  });
});
