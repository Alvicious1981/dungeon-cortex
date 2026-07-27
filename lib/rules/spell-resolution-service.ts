import { prisma } from "@/lib/db/prisma";
import {
  resolveSpellEffect,
  type SpellEffect,
} from "@/lib/rules/magic";
import type { AreaShape } from "@/lib/rules/geometry";

interface CachedSpellRecord {
  id: string;
  indexSlug: string | null;
  name: string;
  level: number | null;
  concentration: boolean | null;
  data: unknown;
}

interface SpellResolutionDb {
  srdSpell: {
    findUnique(args: {
      where: { id: string };
      select: Record<string, boolean>;
    }): Promise<CachedSpellRecord | null>;
    findMany(args: {
      where: { name: { contains: string; mode: "insensitive" } };
      orderBy: { name: "asc" };
      take: number;
      select: Record<string, boolean>;
    }): Promise<CachedSpellRecord[]>;
  };
}

export interface ResolvedSpellEffect extends SpellEffect {
  id: string;
  name: string;
  level: number;
  concentration: boolean;
  sourceEndpoint: string;
  areaOfEffect: {
    shape: AreaShape;
    sizeFt: number;
  } | null;
}

export interface ResolveSpellInput {
  query: string;
  slotLevel: number;
  spellcastingMod: number;
  characterLevel: number;
  db?: SpellResolutionDb;
}

const SPELL_SELECT = {
  id: true,
  indexSlug: true,
  name: true,
  level: true,
  concentration: true,
  data: true,
};

async function findCachedSpell(
  db: SpellResolutionDb,
  query: string
): Promise<CachedSpellRecord | null> {
  const exactId = await db.srdSpell.findUnique({
    where: { id: query },
    select: SPELL_SELECT,
  });
  if (exactId) return exactId;

  const candidates = await db.srdSpell.findMany({
    where: { name: { contains: query, mode: "insensitive" } },
    orderBy: { name: "asc" },
    take: 5,
    select: SPELL_SELECT,
  });
  const normalizedQuery = query.toLowerCase().trim();
  return (
    candidates.find((spell) => spell.name.toLowerCase() === normalizedQuery) ??
    candidates[0] ??
    null
  );
}

function resolveAreaOfEffect(data: Record<string, unknown>): ResolvedSpellEffect["areaOfEffect"] {
  const rawArea = data.area_of_effect;
  if (!rawArea || typeof rawArea !== "object") return null;

  const area = rawArea as Record<string, unknown>;
  const rawType = typeof area.type === "string" ? area.type.toUpperCase() : "";
  const sizeFt = area.size;
  const supportedShapes: AreaShape[] = ["CONE", "SPHERE", "CUBE", "LINE"];

  if (!supportedShapes.includes(rawType as AreaShape)
    || typeof sizeFt !== "number"
    || !Number.isFinite(sizeFt)
    || sizeFt < 0) {
    return null;
  }

  return { shape: rawType as AreaShape, sizeFt };
}

export async function resolveCachedSpell(
  input: ResolveSpellInput
): Promise<ResolvedSpellEffect | null> {
  const db = input.db ?? (prisma as unknown as SpellResolutionDb);
  const spell = await findCachedSpell(db, input.query);
  if (!spell) return null;

  const effect = resolveSpellEffect(
    spell.data as Record<string, unknown>,
    input.slotLevel,
    input.spellcastingMod,
    input.characterLevel
  );
  const sourceSlug = spell.indexSlug ?? spell.id;

  return {
    ...effect,
    id: spell.id,
    name: spell.name,
    level: spell.level ?? input.slotLevel,
    concentration: spell.concentration ?? false,
    sourceEndpoint: `https://www.dnd5eapi.co/api/2014/spells/${sourceSlug}`,
    areaOfEffect: resolveAreaOfEffect(spell.data as Record<string, unknown>),
  };
}
