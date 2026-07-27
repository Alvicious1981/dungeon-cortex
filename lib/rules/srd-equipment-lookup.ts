import { prisma } from "@/lib/db/prisma";

export interface EquipmentInfo {
  name: string;
  equipmentCategory: string | null;
  weaponCategory: string | null;
  weaponRange: string | null;
  categoryRange: string | null;
  costQuantity: number | null;
  costUnit: string | null;
  weight: number | null;
  damageDice: string | null;
  damageType: string | null;
  twoHandedDamageDice: string | null;
  twoHandedDamageType: string | null;
  rangeNormal: number | null;
  rangeLong: number | null;
  throwRangeNormal: number | null;
  throwRangeLong: number | null;
  armorCategory: string | null;
  armorClassBase: number | null;
  armorClassDexBonus: boolean | null;
  armorClassMaxBonus: number | null;
  strMinimum: number | null;
  stealthDisadvantage: boolean | null;
  desc: string | null;
  properties: string[];
}

function extractThrowRange(data: unknown): { normal: number | null; long: number | null } {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { normal: null, long: null };
  }
  const throwRange = (data as { throw_range?: unknown }).throw_range;
  if (!throwRange || typeof throwRange !== "object" || Array.isArray(throwRange)) {
    return { normal: null, long: null };
  }

  const normal = (throwRange as { normal?: unknown }).normal;
  const long = (throwRange as { long?: unknown }).long;
  return {
    normal: typeof normal === "number" ? normal : null,
    long: typeof long === "number" ? long : null,
  };
}

export async function getEquipmentInfo(query: string): Promise<EquipmentInfo | null> {
  let item = await prisma.srdEquipment.findUnique({ where: { id: query } });

  if (!item) {
    const candidates = await prisma.srdEquipment.findMany({
      where: { name: { contains: query, mode: "insensitive" } },
      orderBy: { name: "asc" },
      take: 5,
    });
    const q = query.toLowerCase().trim();
    item =
      candidates.find((candidate) => candidate.name.toLowerCase() === q) ??
      candidates[0] ??
      null;
  }

  if (!item) return null;

  const throwRange = extractThrowRange(item.data);

  return {
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
    throwRangeNormal: throwRange.normal,
    throwRangeLong: throwRange.long,
    armorCategory: item.armorCategory,
    armorClassBase: item.armorClassBase,
    armorClassDexBonus: item.armorClassDexBonus,
    armorClassMaxBonus: item.armorClassMaxBonus,
    strMinimum: item.strMinimum,
    stealthDisadvantage: item.stealthDisadvantage,
    desc: item.desc,
    properties: item.properties,
  };
}
