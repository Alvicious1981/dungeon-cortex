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
  /** The spell's own level in the SRD. 0 for a cantrip. */
  level: number;
  /**
   * The slot level this effect was actually resolved at, and therefore the one
   * the caller must charge. Equals the requested `slotLevel` when the caller
   * named one, and the spell's own level otherwise.
   *
   * Reported rather than left implicit because the caller cannot recompute it:
   * a caller that omitted `slotLevel` does not know what it got.
   */
  slotLevel: number;
  concentration: boolean;
  sourceEndpoint: string;
}

export interface ResolveSpellInput {
  query: string;
  /**
   * Slot level to cast at. Omit when the player did not name one — the spell's
   * own SRD level is then used, which is the level a caster spends by default.
   *
   * Leaving this optional is what lets "I cast Fireball" resolve at all. The
   * caller used to skip the whole resolution when the player named no level,
   * so nothing was charged, nothing was rolled, and the narrator described a
   * spell the rules engine never cast.
   */
  slotLevel?: number;
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

  // The SRD record is the authority on what the spell costs. A caller that
  // named no slot level gets the spell's own level, not a guess and not a skip.
  const spellLevel = spell.level ?? input.slotLevel ?? 0;
  const slotLevel = input.slotLevel ?? spellLevel;

  const effect = resolveSpellEffect(
    spell.data as Record<string, unknown>,
    slotLevel,
    input.spellcastingMod,
    input.characterLevel
  );
  const sourceSlug = spell.indexSlug ?? spell.id;

  return {
    ...effect,
    id: spell.id,
    name: spell.name,
    level: spellLevel,
    slotLevel,
    concentration: spell.concentration ?? false,
    sourceEndpoint: `https://www.dnd5eapi.co/api/2014/spells/${sourceSlug}`,
  };
}
