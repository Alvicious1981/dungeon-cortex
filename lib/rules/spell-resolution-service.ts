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

import type { AreaShape, SpellArea, SpellRange } from "./geometry";

export type { SpellArea };

/**
 * The ten `area_of_effect.type` strings the live SrdSpell table holds, mapped
 * onto the four shapes the rules engine resolves.
 *
 * The column is bilingual with neither language dominant — 51 Spanish rows
 * against 34 English — so both spellings must be here.
 *
 * Two house rulings, stated rather than implied:
 *   - cylinder/cilindro is a real SRD area whose footprint on a flat grid is a
 *     circle, so it resolves as a sphere of the same radius; height is ignored.
 *   - cuadrado is not an SRD area type and reads as a translation artifact of
 *     "cube", so it maps to cube.
 */
const AREA_TYPE_TO_SHAPE: Record<string, AreaShape> = {
  esfera: "sphere",
  sphere: "sphere",
  cilindro: "sphere",
  cylinder: "sphere",
  cubo: "cube",
  cube: "cube",
  cuadrado: "cube",
  cono: "cone",
  cone: "cone",
  line: "line",
};

/**
 * Reads `area_of_effect` from a cached SRD spell.
 *
 * Returns `unsupportedType` rather than silently reporting "no area" when the
 * type is unrecognised: all ten observed strings are covered, so a new value
 * means the data changed underneath us, and the caller must refuse the cast
 * instead of letting the client choose targets again.
 *
 * @pure — deterministic, no side effects.
 */
export function parseSpellArea(raw: unknown): {
  area: SpellArea | null;
  unsupportedType: string | null;
} {
  if (!raw || typeof raw !== "object") return { area: null, unsupportedType: null };

  const record = raw as Record<string, unknown>;
  const rawType = typeof record.type === "string" ? record.type.trim().toLowerCase() : null;
  const size = record.size;

  if (!rawType) return { area: null, unsupportedType: null };

  const shape = AREA_TYPE_TO_SHAPE[rawType];
  if (!shape) return { area: null, unsupportedType: rawType };

  // The column is untyped JSON, so a size that is not a finite number is not
  // usable geometry. Fail closed for the same reason an unknown shape does.
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
    return { area: null, unsupportedType: rawType };
  }

  return { area: { shape, sizeFt: size }, unsupportedType: null };
}

const FEET_PER_MILE = 5280;

/** Every SRD spelling that means "the caster is the origin". */
const SELF_KEYWORDS = ["lanzador", "personal", "self", "autolanzado"];

/** Every SRD spelling that means "an adjacent creature". */
const TOUCH_KEYWORDS = ["toque", "touch"];

/**
 * Reads a distance and its unit, in either language. Returns null when the text
 * is not a plain distance.
 */
function parseDistanceFt(text: string): number | null {
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(pies|pie|feet|foot|millas|milla|miles|mile)\b/);
  if (!match) return null;

  const amount = Number(match[1]!.replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unit = match[2]!;
  const inMiles = unit.startsWith("milla") || unit.startsWith("mile");
  return inMiles ? amount * FEET_PER_MILE : amount;
}

/**
 * Reads the area some SRD range strings carry in parentheses, e.g.
 * "Personal (radio de 15 pies)".
 *
 * Only two wordings appear in the data — a radius and a straight line. Anything
 * else extracts nothing, which leaves the spell arealess: the behaviour before
 * this parser existed.
 */
function parseEmbeddedArea(text: string): SpellArea | null {
  const inner = text.match(/\(([^)]*)\)/)?.[1];
  if (!inner) return null;

  const sizeFt = parseDistanceFt(inner);
  if (sizeFt === null) return null;

  // "radio" is a radius, which is exactly what `size` means for a sphere in
  // area_of_effect, so the two agree without conversion.
  if (inner.includes("radio") || inner.includes("radius")) {
    return { shape: "sphere" as AreaShape, sizeFt };
  }
  if (inner.includes("línea") || inner.includes("linea") || inner.includes("line")) {
    return { shape: "line" as AreaShape, sizeFt };
  }
  return null;
}

/**
 * Normalises the SRD's free-text `range` into a rule the engine can enforce.
 *
 * ─── Order matters, and it is the trap in this field ─────────────────────────
 * Three of the 26 observed values are caster-only WITH a number inside them:
 * "Personal (radio de 15 pies)" and two siblings. Matching a distance first
 * would classify Espíritus Guardianes as a 15 ft range, making a spell that
 * emanates from the caster aimable 15 ft away. So self and touch are tested
 * before any distance.
 *
 * ─── Why an unknown value is allowed rather than refused ─────────────────────
 * The opposite of parseSpellArea, deliberately. Without an area shape the target
 * set cannot be computed and proceeding would hand selection back to the client.
 * Without a range only one constraint is missing, while the set is still entirely
 * backend-derived. "Ilimitado" is also a real SRD rule, not a data gap, and
 * refusing it would block a legal spell.
 *
 * @pure — deterministic, no side effects.
 */
export function parseSpellRange(raw: unknown): {
  range: SpellRange;
  embeddedArea: SpellArea | null;
} {
  if (typeof raw !== "string" || !raw.trim()) {
    return { range: { kind: "unenforceable", raw: null }, embeddedArea: null };
  }

  const text = raw.trim().toLowerCase();
  const embeddedArea = parseEmbeddedArea(text);

  if (SELF_KEYWORDS.some((word) => text.startsWith(word))) {
    return { range: { kind: "self" }, embeddedArea };
  }
  if (TOUCH_KEYWORDS.some((word) => text.startsWith(word))) {
    return { range: { kind: "touch" }, embeddedArea };
  }

  const feet = parseDistanceFt(text);
  if (feet !== null) {
    return { range: { kind: "distance", feetFromCaster: feet }, embeddedArea };
  }

  return { range: { kind: "unenforceable", raw: raw.trim() }, embeddedArea };
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
  /** The spell's area, when it has one the engine can resolve. */
  area: SpellArea | null;
  /**
   * Set when the SRD record declares an area whose type is unrecognised. The
   * caller must refuse the cast: the spell has an area, and we do not know
   * its shape.
   */
  unsupportedAreaType: string | null;
  /** How far this spell reaches, normalised from the SRD text. */
  range: SpellRange;
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
  const spellData = (spell.data as Record<string, unknown> | null) ?? {};
  const parsedArea = parseSpellArea(spellData.area_of_effect);
  const parsedRange = parseSpellRange(spellData.range);

  return {
    ...effect,
    id: spell.id,
    name: spell.name,
    level: spellLevel,
    slotLevel,
    concentration: spell.concentration ?? false,
    sourceEndpoint: `https://www.dnd5eapi.co/api/2014/spells/${sourceSlug}`,
    // area_of_effect wins when both exist; the range's parenthetical is the only
    // source for Controlar el clima and Espíritus Guardianes.
    area: parsedArea.area ?? parsedRange.embeddedArea,
    range: parsedRange.range,
    unsupportedAreaType: parsedArea.unsupportedType,
  };
}
