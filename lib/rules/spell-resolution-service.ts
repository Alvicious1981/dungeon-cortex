import { prisma } from "@/lib/db/prisma";
import {
  resolveSpellEffect,
  type SpellEffect,
} from "@/lib/rules/magic";

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

function normalizeSpellName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

async function findCachedSpell(
  db: SpellResolutionDb,
  query: string
): Promise<CachedSpellRecord | null> {
  const exactId = await db.srdSpell.findUnique({
    where: { id: query },
    select: SPELL_SELECT,
  });
  if (exactId) return exactId;

  const normalizedQuery = normalizeSpellName(query);
  if (!normalizedQuery) return null;

  const candidates = await db.srdSpell.findMany({
    where: { name: { contains: normalizedQuery, mode: "insensitive" } },
    orderBy: { name: "asc" },
    take: 5,
    select: SPELL_SELECT,
  });
  const exactMatches = candidates.filter(
    (spell) => normalizeSpellName(spell.name) === normalizedQuery
  );

  return exactMatches.length === 1 ? exactMatches[0] : null;
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
  };
}
