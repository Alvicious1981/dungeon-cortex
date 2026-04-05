// Hit dice by class index (as returned by D&D 5e API).
// Used to calculate max HP at level 1 without an extra API call.
export const CLASS_HIT_DICE: Record<string, number> = {
  barbarian: 12,
  bard: 8,
  cleric: 8,
  druid: 8,
  fighter: 10,
  monk: 8,
  paladin: 10,
  ranger: 10,
  rogue: 8,
  sorcerer: 6,
  warlock: 8,
  wizard: 6,
};

// Fallback lists used when the D&D 5e API is unreachable.
export const FALLBACK_RACES = [
  { index: "human", name: "Human" },
  { index: "elf", name: "Elf" },
  { index: "dwarf", name: "Dwarf" },
  { index: "halfling", name: "Halfling" },
  { index: "half-orc", name: "Half-Orc" },
  { index: "tiefling", name: "Tiefling" },
];

export const FALLBACK_CLASSES = [
  { index: "fighter", name: "Fighter" },
  { index: "wizard", name: "Wizard" },
  { index: "rogue", name: "Rogue" },
  { index: "cleric", name: "Cleric" },
  { index: "barbarian", name: "Barbarian" },
  { index: "ranger", name: "Ranger" },
];

// D&D 5e standard array — the canonical balanced stat block.
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;

export const ABILITY_SCORES = ["STR", "DEX", "CON", "INT", "WIS", "CHA"] as const;
export type AbilityScore = (typeof ABILITY_SCORES)[number];
