import { prisma } from "@/lib/db/prisma";
import type { Monster } from "@/lib/rules/srd";

export interface MonsterQueryOptions {
  nameQuery?: string;
  type?: string;
  size?: string;
  minCR?: number;
  maxCR?: number;
  limit?: number;
}

export async function queryMonsters(opts: MonsterQueryOptions): Promise<Monster[]> {
  const { nameQuery, type, size, minCR, maxCR, limit = 10 } = opts;
  const safeLimit = Math.min(limit, 50);

  const rows = await prisma.srdMonster.findMany({
    where: {
      ...(nameQuery && {
        name: { contains: nameQuery, mode: "insensitive" },
      }),
      ...(type && {
        type: { equals: type, mode: "insensitive" },
      }),
      ...(size && {
        size: { equals: size, mode: "insensitive" },
      }),
      ...((minCR !== undefined || maxCR !== undefined) && {
        cr: {
          ...(minCR !== undefined && { gte: minCR }),
          ...(maxCR !== undefined && { lte: maxCR }),
        },
      }),
      hitPoints: { not: null },
      armorClass: { not: null },
    },
    orderBy: [{ cr: "asc" }, { name: "asc" }],
    take: safeLimit,
    select: {
      id: true,
      name: true,
      indexSlug: true,
      cr: true,
      xp: true,
      type: true,
      size: true,
      alignment: true,
      hitPoints: true,
      hitDice: true,
      armorClass: true,
      speed: true,
      languages: true,
      strength: true,
      dexterity: true,
      constitution: true,
      intelligence: true,
      wisdom: true,
      charisma: true,
      damageImmunities: true,
      damageResistances: true,
      damageVulnerabilities: true,
      conditionImmunities: true,
      hasLegendaryActions: true,
      hasSpellcasting: true,
    },
  });

  return rows
    .filter((row) => row.hitPoints !== null && row.armorClass !== null)
    .map((row): Monster => ({
      index: row.indexSlug ?? row.id,
      name: row.name,
      hit_points: row.hitPoints!,
      armor_class:
        row.armorClass !== null
          ? [{ type: "natural", value: row.armorClass }]
          : undefined,
      size: row.size ?? undefined,
      type: row.type ?? undefined,
      alignment: row.alignment ?? undefined,
      challenge_rating: row.cr ?? undefined,
      xp: row.xp ?? undefined,
      hit_dice: row.hitDice ?? undefined,
      speed: row.speed ? { walk: row.speed } : undefined,
      strength: row.strength ?? undefined,
      dexterity: row.dexterity ?? undefined,
      constitution: row.constitution ?? undefined,
      intelligence: row.intelligence ?? undefined,
      wisdom: row.wisdom ?? undefined,
      charisma: row.charisma ?? undefined,
      damage_immunities: row.damageImmunities,
      damage_resistances: row.damageResistances,
      damage_vulnerabilities: row.damageVulnerabilities,
      condition_immunities: row.conditionImmunities,
      url: undefined,
    }));
}

export function buildMonsterRawData(monster: Monster): Record<string, unknown> {
  return {
    armor_class: monster.armor_class ?? [],
    hit_points: monster.hit_points,
    challenge_rating: monster.challenge_rating,
    dexterity: monster.dexterity,
  };
}
