import type { CharacterSheetProps, CharacterSpellSlot } from "@/components/character/CharacterSheetVTT";
import type { ItemType } from "@/lib/rules/inventory";

interface CharacterSheetSource {
  character: {
    id: string;
    name: string;
    race: string;
    class: string;
    level: number;
    hp: number;
    maxHp: number;
    xp: number;
    stats: unknown;
    spellSlots?: unknown;
    concentrationSpellId?: string | null;
  };
  inventory: Array<{
    id: string;
    name: string;
    type: string;
    quantity: number;
    equippedSlot?: string | null;
    properties: unknown;
  }>;
}

function getModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

function formatModifier(modifier: number): string {
  return modifier >= 0 ? `+${modifier}` : `${modifier}`;
}

function getStats(raw: unknown): Record<"STR" | "DEX" | "CON" | "INT" | "WIS" | "CHA", number> {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    STR: typeof source.STR === "number" ? source.STR : 10,
    DEX: typeof source.DEX === "number" ? source.DEX : 10,
    CON: typeof source.CON === "number" ? source.CON : 10,
    INT: typeof source.INT === "number" ? source.INT : 10,
    WIS: typeof source.WIS === "number" ? source.WIS : 10,
    CHA: typeof source.CHA === "number" ? source.CHA : 10,
  };
}

function buildSpellSlots(raw: unknown): CharacterSpellSlot[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];

  return Object.entries(raw as Record<string, unknown>).flatMap(([level, value]) => {
    if (!value || typeof value !== "object") return [];
    const slot = value as Record<string, unknown>;
    if (typeof slot.total !== "number" || typeof slot.used !== "number") return [];

    return [{
      level: Number(level),
      total: slot.total,
      used: slot.used,
    }];
  });
}

export function buildSheetViewModel({ character, inventory }: CharacterSheetSource): CharacterSheetProps {
  const stats = getStats(character.stats);
  const proficiencyBonus = 2 + Math.floor((character.level - 1) / 4);
  const dexMod = getModifier(stats.DEX);
  const wisMod = getModifier(stats.WIS);

  return {
    identity: {
      name: character.name,
      className: character.class,
      level: character.level,
      race: character.race,
    },
    core: {
      armorClass: 10 + dexMod,
      hitPoints: { current: character.hp, max: character.maxHp },
      initiative: dexMod,
      speedFeet: 30,
      proficiencyBonus,
      passivePerception: 10 + wisMod,
    },
    abilities: {
      str: { score: stats.STR, modifier: getModifier(stats.STR) },
      dex: { score: stats.DEX, modifier: dexMod },
      con: { score: stats.CON, modifier: getModifier(stats.CON) },
      int: { score: stats.INT, modifier: getModifier(stats.INT) },
      wis: { score: stats.WIS, modifier: wisMod },
      cha: { score: stats.CHA, modifier: getModifier(stats.CHA) },
    },
    savingThrows: [
      { label: "Strength", value: formatModifier(getModifier(stats.STR)) },
      { label: "Dexterity", value: formatModifier(dexMod) },
      { label: "Constitution", value: formatModifier(getModifier(stats.CON)) },
      { label: "Intelligence", value: formatModifier(getModifier(stats.INT)) },
      { label: "Wisdom", value: formatModifier(wisMod) },
      { label: "Charisma", value: formatModifier(getModifier(stats.CHA)) },
    ],
    skills: [
      { label: "Athletics", value: formatModifier(getModifier(stats.STR)) },
      { label: "Acrobatics", value: formatModifier(dexMod) },
      { label: "Stealth", value: formatModifier(dexMod) },
      { label: "Perception", value: formatModifier(wisMod) },
      { label: "Insight", value: formatModifier(wisMod) },
      { label: "Persuasion", value: formatModifier(getModifier(stats.CHA)) },
    ],
    attacks: inventory.filter((item) => item.type === "weapon").map((weapon) => ({
      id: weapon.id,
      name: weapon.name,
      bonus: getModifier(stats.STR) + proficiencyBonus,
      damage: "1d6 slashing",
      traits: [],
    })),
    spellSlots: buildSpellSlots(character.spellSlots),
    inventory: inventory.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      category: item.type as ItemType,
      equipped: item.equippedSlot !== null && item.equippedSlot !== undefined,
      summary: item.name,
    })),
    notes: [],
  };
}
