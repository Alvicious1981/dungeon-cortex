import { z } from "zod";
import type { NPCStatblock } from "@/lib/rules/npc";
import type { Monster } from "@/lib/rules/srd";
import type { EquipmentInfo, SpellEffect } from "@/lib/ai/tools/srd-lookup";

const AbilityScoresSchema = z.object({
  STR: z.number().int(),
  DEX: z.number().int(),
  CON: z.number().int(),
  INT: z.number().int(),
  WIS: z.number().int(),
  CHA: z.number().int(),
}).strict();

const NpcTraitsSchema = z.object({
  personality: z.string(),
  ideal: z.string(),
  bond: z.string(),
  flaw: z.string(),
}).strict();

export const NpcDetailsOutputSchema = z.object({
  name: z.string(),
  role: z.enum(["guard", "bandit", "commoner"]),
  hp: z.number().int().nonnegative(),
  maxHp: z.number().int().nonnegative(),
  ac: z.number().int().nonnegative(),
  attackString: z.string(),
  race: z.string(),
  profession: z.string(),
  alignment: z.string(),
  abilityScores: AbilityScoresSchema,
  traits: NpcTraitsSchema,
}).strict();

export const TavernNameOutputSchema = z.object({
  tavernName: z.string().min(1).max(200),
}).strict();

export const SpellInfoOutputSchema = z.object({
  name: z.string(),
  concentration: z.boolean(),
  ritual: z.boolean(),
  dice: z.string().nullable(),
  damageType: z.string().nullable(),
  hasDamage: z.boolean(),
  hasSavingThrow: z.boolean(),
  saveAbility: z.string().nullable(),
  type: z.enum(["damage", "healing", "utility"]),
  hasAreaOfEffect: z.boolean(),
  school: z.string().nullable(),
  level: z.number().int().min(0).max(9),
}).strict();

export const ItemInfoOutputSchema = z.object({
  name: z.string(),
  index: z.string().nullable(),
  description: z.array(z.string()),
  category: z.string().nullable(),
  rarity: z.string().nullable(),
  properties: z.array(z.string()),
}).strict();

export const EquipmentInfoOutputSchema = z.object({
  name: z.string(),
  equipmentCategory: z.string().nullable(),
  weaponCategory: z.string().nullable(),
  weaponRange: z.string().nullable(),
  categoryRange: z.string().nullable(),
  costQuantity: z.number().int().nullable(),
  costUnit: z.string().nullable(),
  weight: z.number().nullable(),
  damageDice: z.string().nullable(),
  damageType: z.string().nullable(),
  twoHandedDamageDice: z.string().nullable(),
  twoHandedDamageType: z.string().nullable(),
  rangeNormal: z.number().int().nullable(),
  rangeLong: z.number().int().nullable(),
  armorCategory: z.string().nullable(),
  armorClassBase: z.number().int().nullable(),
  armorClassDexBonus: z.boolean().nullable(),
  armorClassMaxBonus: z.number().int().nullable(),
  strMinimum: z.number().int().nullable(),
  stealthDisadvantage: z.boolean().nullable(),
  desc: z.string().nullable(),
  properties: z.array(z.string()),
}).strict();

const ArmorClassSchema = z.object({
  type: z.string().nullable(),
  value: z.number(),
}).strict();

export const MonsterInfoOutputSchema = z.object({
  index: z.string(),
  name: z.string(),
  hit_points: z.number(),
  armor_class: z.array(ArmorClassSchema).nullable(),
  size: z.string().nullable(),
  type: z.string().nullable(),
  alignment: z.string().nullable(),
  challenge_rating: z.number().nullable(),
  xp: z.number().nullable(),
  hit_dice: z.string().nullable(),
  speed: z.object({ walk: z.string() }).strict().nullable(),
  strength: z.number().nullable(),
  dexterity: z.number().nullable(),
  constitution: z.number().nullable(),
  intelligence: z.number().nullable(),
  wisdom: z.number().nullable(),
  charisma: z.number().nullable(),
}).strict();

export function projectNpcDetails(npc: NPCStatblock) {
  return NpcDetailsOutputSchema.parse({
    name: npc.name,
    role: npc.role,
    hp: npc.hp,
    maxHp: npc.maxHp,
    ac: npc.ac,
    attackString: npc.attackString,
    race: npc.race,
    profession: npc.profession,
    alignment: npc.alignment,
    abilityScores: npc.abilityScores,
    traits: npc.traits,
  });
}

export function projectTavernName(tavernName: string) {
  return TavernNameOutputSchema.parse({ tavernName });
}

export function projectSpellInfo(spell: SpellEffect) {
  return SpellInfoOutputSchema.parse({
    name: spell.name,
    concentration: spell.concentration,
    ritual: spell.ritual,
    dice: spell.dice,
    damageType: spell.damageType,
    hasDamage: spell.hasDamage,
    hasSavingThrow: spell.hasSavingThrow,
    saveAbility: spell.saveAbility,
    type: spell.type,
    hasAreaOfEffect: spell.hasAreaOfEffect,
    school: spell.school,
    level: spell.level,
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function namedValue(value: unknown): string | null {
  const record = asRecord(value);
  return stringValue(record.name) ?? stringValue(value);
}

function namedList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(namedValue).filter((entry): entry is string => entry !== null)
    : [];
}

export function projectItemInfo(name: string, data: unknown) {
  const item = asRecord(data);
  return ItemInfoOutputSchema.parse({
    name,
    index: stringValue(item.index),
    description: stringList(item.desc),
    category: namedValue(item.equipment_category),
    rarity: namedValue(item.rarity),
    properties: namedList(item.properties),
  });
}

export function projectEquipmentInfo(item: EquipmentInfo) {
  return EquipmentInfoOutputSchema.parse({
    name: item.name,
    equipmentCategory: item.equipmentCategory,
    weaponCategory: item.weaponCategory,
    weaponRange: item.weaponRange,
    categoryRange: item.categoryRange,
    costQuantity: item.costQuantity,
    costUnit: item.costUnit,
    weight: item.weight,
    damageDice: item.damageDice,
    damageType: item.damageType,
    twoHandedDamageDice: item.twoHandedDamageDice,
    twoHandedDamageType: item.twoHandedDamageType,
    rangeNormal: item.rangeNormal,
    rangeLong: item.rangeLong,
    armorCategory: item.armorCategory,
    armorClassBase: item.armorClassBase,
    armorClassDexBonus: item.armorClassDexBonus,
    armorClassMaxBonus: item.armorClassMaxBonus,
    strMinimum: item.strMinimum,
    stealthDisadvantage: item.stealthDisadvantage,
    desc: item.desc,
    properties: item.properties,
  });
}

export function projectMonsterInfo(monster: Monster) {
  const walk = monster.speed?.walk;
  return MonsterInfoOutputSchema.parse({
    index: monster.index,
    name: monster.name,
    hit_points: monster.hit_points,
    armor_class: monster.armor_class
      ? monster.armor_class.map((armorClass) => ({
          type: armorClass.type ?? null,
          value: armorClass.value,
        }))
      : null,
    size: monster.size ?? null,
    type: monster.type ?? null,
    alignment: monster.alignment ?? null,
    challenge_rating: monster.challenge_rating ?? null,
    xp: monster.xp ?? null,
    hit_dice: monster.hit_dice ?? null,
    speed: typeof walk === "string" ? { walk } : null,
    strength: monster.strength ?? null,
    dexterity: monster.dexterity ?? null,
    constitution: monster.constitution ?? null,
    intelligence: monster.intelligence ?? null,
    wisdom: monster.wisdom ?? null,
    charisma: monster.charisma ?? null,
  });
}