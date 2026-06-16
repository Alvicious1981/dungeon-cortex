import { z } from "zod";

import {
  createDnd5eApiClient,
  type Dnd5eApiClient,
  type Dnd5eApiClientOptions,
} from "./client";
import { Dnd5eApiIndexItemSchema, type Dnd5eApiIndexItem } from "./schemas";

const Dnd5eApiReferenceSchema = z.object({
  index: z.string(),
  name: z.string().optional(),
  url: z.string().optional(),
});

const Dnd5eApiArmorClassSchema = z
  .object({
    type: z.string().optional(),
    value: z.number(),
    desc: z.string().optional(),
  })
  .catchall(z.unknown());

const Dnd5eApiProficiencySchema = z
  .object({
    value: z.number(),
    proficiency: Dnd5eApiReferenceSchema,
  })
  .catchall(z.unknown());

const Dnd5eApiDamageSchema = z
  .object({
    damage_dice: z.string().optional(),
    damage_type: Dnd5eApiReferenceSchema.optional(),
  })
  .catchall(z.unknown());

const Dnd5eApiDcSchema = z
  .object({
    dc_type: Dnd5eApiReferenceSchema.optional(),
    dc_value: z.number().optional(),
    success_type: z.string().optional(),
  })
  .catchall(z.unknown());

const Dnd5eApiUsageSchema = z
  .object({
    type: z.string().optional(),
    times: z.number().optional(),
    dice: z.string().optional(),
    min_value: z.number().optional(),
  })
  .catchall(z.unknown());

const Dnd5eApiMonsterActionSchema = z
  .object({
    name: z.string(),
    desc: z.string().optional(),
    attack_bonus: z.number().optional(),
    damage: z.array(Dnd5eApiDamageSchema).optional(),
    dc: Dnd5eApiDcSchema.optional(),
    usage: Dnd5eApiUsageSchema.optional(),
  })
  .catchall(z.unknown());

const Dnd5eApiMonsterTraitSchema = z
  .object({
    name: z.string(),
    desc: z.string().optional(),
  })
  .catchall(z.unknown());

export const Dnd5eApiMonsterSchema = z
  .object({
    index: z.string(),
    name: z.string(),
    size: z.string(),
    type: z.string(),
    alignment: z.string(),
    armor_class: z.union([z.number(), z.array(Dnd5eApiArmorClassSchema)]),
    hit_points: z.number(),
    hit_dice: z.string(),
    speed: z.record(z.string(), z.string()),
    strength: z.number(),
    dexterity: z.number(),
    constitution: z.number(),
    intelligence: z.number(),
    wisdom: z.number(),
    charisma: z.number(),
    proficiencies: z.array(Dnd5eApiProficiencySchema).optional(),
    senses: z.record(z.string(), z.string()),
    languages: z.string(),
    challenge_rating: z.number(),
    proficiency_bonus: z.number().optional(),
    xp: z.number(),
    special_abilities: z.array(Dnd5eApiMonsterTraitSchema).optional(),
    actions: z.array(Dnd5eApiMonsterActionSchema).optional(),
    url: z.string(),
    updated_at: z.string().optional(),
  })
  .catchall(z.unknown());

export type Dnd5eApiMonster = z.infer<typeof Dnd5eApiMonsterSchema>;
export type SrdMonsterIndexItem = Dnd5eApiIndexItem;

export interface SrdMonsterArmorClass {
  type?: string;
  value: number;
  desc?: string;
}

export interface SrdMonsterAbilityScores {
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
}

export interface SrdMonsterDamage {
  damageDice?: string;
  damageType?: Dnd5eApiReference;
}

export interface Dnd5eApiReference {
  index: string;
  name?: string;
  url?: string;
}

export interface SrdMonsterDc {
  dcType?: Dnd5eApiReference;
  dcValue?: number;
  successType?: string;
}

export interface SrdMonsterUsage {
  type?: string;
  times?: number;
  dice?: string;
  minValue?: number;
}

export interface SrdMonsterTrait {
  name: string;
  description: string;
}

export interface SrdMonsterAction {
  name: string;
  description: string;
  attackBonus?: number;
  damage?: SrdMonsterDamage[];
  dc?: SrdMonsterDc;
  usage?: SrdMonsterUsage;
}

export interface SrdMonster {
  index: string;
  name: string;
  size: string;
  type: string;
  alignment: string;
  armorClass: SrdMonsterArmorClass[];
  hitPoints: number;
  hitDice: string;
  speed: Record<string, string>;
  abilityScores: SrdMonsterAbilityScores;
  savingThrows: Record<string, number>;
  skills: Record<string, number>;
  senses: Record<string, string>;
  languages: string;
  challengeRating: number;
  proficiencyBonus?: number;
  xp: number;
  traits: SrdMonsterTrait[];
  actions: SrdMonsterAction[];
  source: "dnd5eapi";
  sourceUrl: string;
  sourceVersion: "2014";
  updatedAt?: string;
  raw?: Dnd5eApiMonster;
}

export interface Dnd5eApiMonstersAdapterOptions extends Dnd5eApiClientOptions {
  client?: Dnd5eApiClient;
}

export function adaptMonster(apiMonster: Dnd5eApiMonster): SrdMonster {
  const parsedMonster = Dnd5eApiMonsterSchema.parse(apiMonster);
  const { savingThrows, skills } = adaptProficiencies(parsedMonster.proficiencies ?? []);

  return {
    index: parsedMonster.index,
    name: parsedMonster.name,
    size: parsedMonster.size,
    type: parsedMonster.type,
    alignment: parsedMonster.alignment,
    armorClass: normalizeArmorClass(parsedMonster.armor_class),
    hitPoints: parsedMonster.hit_points,
    hitDice: parsedMonster.hit_dice,
    speed: parsedMonster.speed,
    abilityScores: {
      str: parsedMonster.strength,
      dex: parsedMonster.dexterity,
      con: parsedMonster.constitution,
      int: parsedMonster.intelligence,
      wis: parsedMonster.wisdom,
      cha: parsedMonster.charisma,
    },
    savingThrows,
    skills,
    senses: parsedMonster.senses,
    languages: parsedMonster.languages,
    challengeRating: parsedMonster.challenge_rating,
    ...(parsedMonster.proficiency_bonus !== undefined
      ? { proficiencyBonus: parsedMonster.proficiency_bonus }
      : {}),
    xp: parsedMonster.xp,
    traits: (parsedMonster.special_abilities ?? []).map((trait) => ({
      name: trait.name,
      description: trait.desc ?? "",
    })),
    actions: (parsedMonster.actions ?? []).map(adaptAction),
    source: "dnd5eapi",
    sourceUrl: parsedMonster.url,
    sourceVersion: "2014",
    ...(parsedMonster.updated_at ? { updatedAt: parsedMonster.updated_at } : {}),
    raw: parsedMonster,
  };
}

export function createDnd5eApiMonstersAdapter(
  options: Dnd5eApiMonstersAdapterOptions = {},
) {
  const client = options.client ?? createDnd5eApiClient(options);

  return {
    async listMonsters(): Promise<SrdMonsterIndexItem[]> {
      const index = await client.getIndex("/monsters");

      return index.results.map((monster) => Dnd5eApiIndexItemSchema.parse(monster));
    },

    async getMonster(index: string): Promise<SrdMonster> {
      const apiMonster = await client.getResource(
        `/monsters/${index}`,
        Dnd5eApiMonsterSchema,
      );

      return adaptMonster(apiMonster);
    },
  };
}

export function listMonsters(): Promise<SrdMonsterIndexItem[]> {
  return createDnd5eApiMonstersAdapter().listMonsters();
}

export function getMonster(index: string): Promise<SrdMonster> {
  return createDnd5eApiMonstersAdapter().getMonster(index);
}

function normalizeArmorClass(
  armorClass: Dnd5eApiMonster["armor_class"],
): SrdMonsterArmorClass[] {
  if (typeof armorClass === "number") {
    return [{ value: armorClass }];
  }

  return armorClass.map((entry) => ({
    ...(entry.type ? { type: entry.type } : {}),
    value: entry.value,
    ...(entry.desc ? { desc: entry.desc } : {}),
  }));
}

function adaptProficiencies(proficiencies: Dnd5eApiMonster["proficiencies"]): {
  savingThrows: Record<string, number>;
  skills: Record<string, number>;
} {
  const savingThrows: Record<string, number> = {};
  const skills: Record<string, number> = {};

  for (const proficiency of proficiencies ?? []) {
    const proficiencyIndex = proficiency.proficiency.index;

    if (proficiencyIndex.startsWith("saving-throw-")) {
      savingThrows[proficiencyIndex.replace("saving-throw-", "")] = proficiency.value;
      continue;
    }

    if (proficiencyIndex.startsWith("skill-")) {
      skills[proficiencyIndex.replace("skill-", "")] = proficiency.value;
    }
  }

  return { savingThrows, skills };
}

function adaptAction(action: z.infer<typeof Dnd5eApiMonsterActionSchema>): SrdMonsterAction {
  return {
    name: action.name,
    description: action.desc ?? "",
    ...(action.attack_bonus !== undefined ? { attackBonus: action.attack_bonus } : {}),
    ...(action.damage ? { damage: action.damage.map(adaptDamage) } : {}),
    ...(action.dc ? { dc: adaptDc(action.dc) } : {}),
    ...(action.usage ? { usage: adaptUsage(action.usage) } : {}),
  };
}

function adaptDamage(damage: z.infer<typeof Dnd5eApiDamageSchema>): SrdMonsterDamage {
  return {
    ...(damage.damage_dice ? { damageDice: damage.damage_dice } : {}),
    ...(damage.damage_type ? { damageType: damage.damage_type } : {}),
  };
}

function adaptDc(dc: z.infer<typeof Dnd5eApiDcSchema>): SrdMonsterDc {
  return {
    ...(dc.dc_type ? { dcType: dc.dc_type } : {}),
    ...(dc.dc_value !== undefined ? { dcValue: dc.dc_value } : {}),
    ...(dc.success_type ? { successType: dc.success_type } : {}),
  };
}

function adaptUsage(usage: z.infer<typeof Dnd5eApiUsageSchema>): SrdMonsterUsage {
  return {
    ...(usage.type ? { type: usage.type } : {}),
    ...(usage.times !== undefined ? { times: usage.times } : {}),
    ...(usage.dice ? { dice: usage.dice } : {}),
    ...(usage.min_value !== undefined ? { minValue: usage.min_value } : {}),
  };
}
