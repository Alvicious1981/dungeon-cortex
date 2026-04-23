/**
 * lib/ai/tools/srd-lookup.ts
 *
 * Database-backed SRD lookup layer for the AI narrator.
 *
 * All public functions query the `SrdMonster`, `SrdSpell`, and `SrdItem`
 * tables via the singleton Prisma client. Every lookup is case-insensitive
 * and prefers exact name matches over substring matches.
 *
 * Server-only — never import from client components.
 */

import { tool } from "ai";
import { prisma } from "@/lib/db/prisma";
import { SrdLookupInputSchema } from "@/lib/rules/srd";
import type { Monster } from "@/lib/rules/srd";
import { abilityModifier } from "@/lib/rules/dice";

// ─── Spell effect shape for the combat pipeline ───────────────────────────────

/**
 * The shape the combat pipeline's `spellEffect` field expects.
 * Derived from the typed SrdSpell columns — never from the raw markdown blob.
 */
export interface SpellEffect {
  /** Spell name for identification. */
  name: string;
  /** True if the spell requires concentration. */
  concentration: boolean;
  /** True if this is a ritual spell. */
  ritual: boolean;
  /** Damage dice notation, e.g. "8d6". Null for non-damaging spells. */
  dice: string | null;
  /** Damage type string, e.g. "fire". Null for non-damaging spells. */
  damageType: string | null;
  /** Whether the spell deals damage (false = utility/healing/buff). */
  hasDamage: boolean;
  /** Whether the spell includes a saving throw. */
  hasSavingThrow: boolean;
  /** Saving throw ability abbreviation, e.g. "DEX", "CON". Null if none. */
  saveAbility: string | null;
  /** Whether the spell restores hit points. */
  type: "damage" | "healing" | "utility";
  /** Whether the spell has an area of effect. */
  hasAreaOfEffect: boolean;
  /** Spell school, e.g. "evocation". */
  school: string | null;
  /** Spell level (0 = cantrip). */
  level: number;
  /** Optional condition imposed on failed save, e.g. "blinded". */
  condition?: string;
}

// ─── Single-entity lookup helpers ────────────────────────────────────────────

/**
 * Looks up a spell in the SRD database.
 *
 * Priority: exact ID → exact name → substring of name (all case-insensitive).
 * Returns the raw `data` JSON blob used for system-prompt context, or null.
 */
export async function getSpellInfo(query: string): Promise<SpellEffect | null> {
  // 1. Exact slug / ID match
  let spell = await prisma.srdSpell.findUnique({ where: { id: query } });

  if (!spell) {
    // 2. Case-insensitive exact name, then substring fallback
    const candidates = await prisma.srdSpell.findMany({
      where: { name: { contains: query, mode: "insensitive" } },
      orderBy: { name: "asc" },
      take: 5,
    });
    const q = query.toLowerCase().trim();
    spell =
      candidates.find((s) => s.name.toLowerCase() === q) ??
      candidates[0] ??
      null;
  }

  if (!spell) return null;

  const hasHealing = spell.hasHealing ?? false;
  const hasDamage = spell.damageType !== null && !hasHealing;

  return {
    name: spell.name,
    concentration: spell.concentration ?? false,
    ritual: spell.ritual ?? false,
    dice: null,            // The SRD markdown doesn't encode dice notation yet;
                           // keep null so the caller uses fallback dice logic.
    damageType: spell.damageType,
    hasDamage,
    hasSavingThrow: spell.saveAbility !== null,
    saveAbility: spell.saveAbility,
    type: hasHealing ? "healing" : hasDamage ? "damage" : "utility",
    hasAreaOfEffect: spell.hasAreaOfEffect ?? false,
    school: spell.school,
    level: spell.level ?? 0,
  };
}

/**
 * Looks up a monster in the SRD database.
 *
 * Priority: exact ID → exact name → substring of name (all case-insensitive).
 * Returns the raw `data` JSON blob, or null.
 */
export async function getMonsterInfo(query: string): Promise<Monster | null> {
  let monster = await prisma.srdMonster.findUnique({ where: { id: query } });

  if (!monster) {
    const candidates = await prisma.srdMonster.findMany({
      where: { name: { contains: query, mode: "insensitive" } },
      orderBy: { name: "asc" },
      take: 5,
    });
    const q = query.toLowerCase().trim();
    monster =
      candidates.find((m) => m.name.toLowerCase() === q) ??
      candidates[0] ??
      null;
  }

  if (!monster) return null;

  return {
    index: monster.indexSlug ?? monster.id,
    name: monster.name,
    hit_points: monster.hitPoints ?? 0,
    armor_class: monster.armorClass !== null
      ? [{ type: "natural", value: monster.armorClass }]
      : undefined,
    size: monster.size ?? undefined,
    type: monster.type ?? undefined,
    alignment: monster.alignment ?? undefined,
    challenge_rating: monster.cr ?? undefined,
    xp: monster.xp ?? undefined,
    hit_dice: monster.hitDice ?? undefined,
    speed: monster.speed ? { walk: monster.speed } : undefined,
    strength: monster.strength ?? undefined,
    dexterity: monster.dexterity ?? undefined,
    constitution: monster.constitution ?? undefined,
    intelligence: monster.intelligence ?? undefined,
    wisdom: monster.wisdom ?? undefined,
    charisma: monster.charisma ?? undefined,
  };
}

/**
 * Looks up an equipment item in the SRD database.
 *
 * Priority: exact ID → exact name → substring of name.
 * Returns the raw `data` JSON blob, or null.
 */
export async function getItemInfo(query: string): Promise<unknown | null> {
  let item = await prisma.srdItem.findUnique({ where: { id: query } });

  if (!item) {
    const candidates = await prisma.srdItem.findMany({
      where: { name: { contains: query, mode: "insensitive" } },
      orderBy: { name: "asc" },
      take: 5,
    });
    const q = query.toLowerCase().trim();
    item =
      candidates.find((i) => i.name.toLowerCase() === q) ??
      candidates[0] ??
      null;
  }

  return item ? item.data : null;
}

// ─── Equipment lookup ─────────────────────────────────────────────────────────

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
  armorCategory: string | null;
  armorClassBase: number | null;
  armorClassDexBonus: boolean | null;
  armorClassMaxBonus: number | null;
  strMinimum: number | null;
  stealthDisadvantage: boolean | null;
  desc: string | null;
  properties: string[];
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
      candidates.find((i) => i.name.toLowerCase() === q) ??
      candidates[0] ??
      null;
  }

  if (!item) return null;

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

// ─── Tool definitions ─────────────────────────────────────────────────────────

export function buildSrdTools() {
  return {
    getSpellInfo: tool({
      description:
        "Fetch exact mechanical JSON data for a spell by name or ID. MUST be used before narrating spell effects.",
      inputSchema: SrdLookupInputSchema,
      execute: async ({ query }) => {
        try {
          const data = await getSpellInfo(query);
          return data
            ? JSON.stringify(data)
            : JSON.stringify({ error: "Spell not found mechanically." });
        } catch {
          return JSON.stringify({ error: "Action failed mechanically." });
        }
      },
    }),
    getItemInfo: tool({
      description:
        "Fetch exact mechanical JSON data for an item or piece of equipment by name or ID. MUST be used before narrating the properties of magical or mundane items.",
      inputSchema: SrdLookupInputSchema,
      execute: async ({ query }) => {
        try {
          const data = await getItemInfo(query);
          return data
            ? JSON.stringify(data)
            : JSON.stringify({ error: "Item not found mechanically." });
        } catch {
          return JSON.stringify({ error: "Action failed mechanically." });
        }
      },
    }),
    getEquipmentInfo: tool({
      description:
        "Fetch strongly typed mechanical data for an equipment item, weapon, or armor by name or ID.",
      inputSchema: SrdLookupInputSchema,
      execute: async ({ query }) => {
        try {
          const data = await getEquipmentInfo(query);
          return data
            ? JSON.stringify(data)
            : JSON.stringify({ error: "Equipment not found mechanically." });
        } catch {
          return JSON.stringify({ error: "Action failed mechanically." });
        }
      },
    }),
    getMonsterInfo: tool({
      description:
        "Fetch exact mechanical JSON data for a monster by name or ID. MUST be used before narrating combat encounters, describing enemy abilities, or resolving monster actions. Never invent AC, HP, or attack stats.",
      inputSchema: SrdLookupInputSchema,
      execute: async ({ query }) => {
        try {
          const data = await getMonsterInfo(query);
          return data
            ? JSON.stringify(data)
            : JSON.stringify({ error: "Monster not found mechanically." });
        } catch {
          return JSON.stringify({ error: "Action failed mechanically." });
        }
      },
    }),
  };
}

// ─── Monster query options ────────────────────────────────────────────────────

export interface MonsterQueryOptions {
  /** Substring match against monster name (case-insensitive). */
  nameQuery?: string;
  /** Exact creature type, e.g. "dragon", "undead" (case-insensitive). */
  type?: string;
  /** Exact size category, e.g. "Large", "Tiny" (case-insensitive). */
  size?: string;
  /** Minimum CR (inclusive). */
  minCR?: number;
  /** Maximum CR (inclusive). Useful for encounter budget filtering. */
  maxCR?: number;
  /** Maximum number of results to return (default 10, max 50). */
  limit?: number;
}

/**
 * Queries the SrdMonster table using typed columns for efficient server-side
 * filtering and returns an array of values shaped to match `MonsterSchema`
 * from `lib/rules/srd.ts`.
 *
 * This is the primary feed for the encounter-builder tool. Each returned
 * object is compatible with `MonsterSchema.safeParse()` so that
 * `buildEncounter` and `acFromMonsterData` operate on well-typed data
 * instead of raw markdown blobs.
 *
 * Mapping from DB columns → MonsterSchema fields:
 *   hitPoints    → hit_points
 *   armorClass   → armor_class[0].value
 *   cr           → challenge_rating
 *   strength/…   → strength/…
 */
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
      // Require at minimum HP and AC to guarantee encounter math works.
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

  // Project DB columns → MonsterSchema-compatible shape.
  // MonsterSchema uses Open5e-style field names; we map our flat columns to them.
  return rows
    .filter((r) => r.hitPoints !== null && r.armorClass !== null)
    .map((r): Monster => ({
      // Required by MonsterSchema
      index: r.indexSlug ?? r.id,
      name: r.name,
      hit_points: r.hitPoints!,
      // MonsterSchema expects armor_class as Array<{type, value}> | undefined
      armor_class: r.armorClass !== null
        ? [{ type: "natural", value: r.armorClass }]
        : undefined,
      // Optional stat fields
      size: r.size ?? undefined,
      type: r.type ?? undefined,
      alignment: r.alignment ?? undefined,
      challenge_rating: r.cr ?? undefined,
      xp: r.xp ?? undefined,
      hit_dice: r.hitDice ?? undefined,
      speed: r.speed ? { walk: r.speed } : undefined,
      strength: r.strength ?? undefined,
      dexterity: r.dexterity ?? undefined,
      constitution: r.constitution ?? undefined,
      intelligence: r.intelligence ?? undefined,
      wisdom: r.wisdom ?? undefined,
      charisma: r.charisma ?? undefined,
      // url is optional in MonsterSchema
      url: undefined,
    }));
}

// ─── Encounter-builder helper (convenience wrapper) ───────────────────────────

/**
 * Returns a minimal set of monster stats needed to compute AC for a spawned
 * combatant. Used by `acFromMonsterData` in the encounter creation flow.
 *
 * Returns the Open5e-compatible `armor_class` array so existing helpers
 * don't need to change.
 */
export function buildMonsterRawData(monster: Monster): Record<string, unknown> {
  return {
    armor_class: monster.armor_class ?? [],
    hit_points: monster.hit_points,
    challenge_rating: monster.challenge_rating,
    dexterity: monster.dexterity,
  };
}

// ─── Spell query options ──────────────────────────────────────────────────────

export interface SpellQueryOptions {
  /** Substring match against spell name (case-insensitive). */
  nameQuery?: string;
  /** Minimum spell level (0 = cantrips). */
  minLevel?: number;
  /** Maximum spell level. */
  maxLevel?: number;
  /** Spell school, e.g. "evocation" (case-insensitive). */
  school?: string;
  /** Filter to ritual spells only. */
  ritualOnly?: boolean;
  /** Filter to concentration spells only. */
  concentrationOnly?: boolean;
  /** Filter to spells with a saving throw. */
  hasSavingThrow?: boolean;
  /** Filter to healing spells. */
  healingOnly?: boolean;
  /** Maximum number of results (default 10, max 50). */
  limit?: number;
}

/**
 * Queries the SrdSpell table using typed columns and returns an array of
 * `SpellEffect` objects ready for the combat pipeline.
 */
export async function querySpells(opts: SpellQueryOptions): Promise<SpellEffect[]> {
  const {
    nameQuery, minLevel, maxLevel, school,
    ritualOnly, concentrationOnly, hasSavingThrow, healingOnly,
    limit = 10,
  } = opts;
  const safeLimit = Math.min(limit, 50);

  const rows = await prisma.srdSpell.findMany({
    where: {
      ...(nameQuery && { name: { contains: nameQuery, mode: "insensitive" } }),
      ...((minLevel !== undefined || maxLevel !== undefined) && {
        level: {
          ...(minLevel !== undefined && { gte: minLevel }),
          ...(maxLevel !== undefined && { lte: maxLevel }),
        },
      }),
      ...(school && { school: { equals: school, mode: "insensitive" } }),
      ...(ritualOnly && { ritual: true }),
      ...(concentrationOnly && { concentration: true }),
      ...(hasSavingThrow && { saveAbility: { not: null } }),
      ...(healingOnly && { hasHealing: true }),
    },
    orderBy: [{ level: "asc" }, { name: "asc" }],
    take: safeLimit,
  });

  return rows.map((s): SpellEffect => {
    const hasHealing = s.hasHealing ?? false;
    const hasDamage = s.damageType !== null && !hasHealing;
    return {
      name: s.name,
      concentration: s.concentration ?? false,
      ritual: s.ritual ?? false,
      dice: null,
      damageType: s.damageType,
      hasDamage,
      hasSavingThrow: s.saveAbility !== null,
      saveAbility: s.saveAbility,
      type: hasHealing ? "healing" : hasDamage ? "damage" : "utility",
      hasAreaOfEffect: s.hasAreaOfEffect ?? false,
      school: s.school,
      level: s.level ?? 0,
    };
  });
}

// ─── Proficiency bonus helper (SRD table) ────────────────────────────────────

/**
 * Returns the proficiency bonus for a given CR per the 5e 2014 SRD table.
 * Used when spawning monsters without explicit proficiency data.
 */
export function proficiencyBonusForCR(cr: number): number {
  if (cr < 5) return 2;
  if (cr < 9) return 3;
  if (cr < 13) return 4;
  if (cr < 17) return 5;
  if (cr < 21) return 6;
  if (cr < 25) return 7;
  if (cr < 29) return 8;
  return 9;
}

/**
 * Derives the attack modifier for a monster given its primary attack ability
 * score and CR (for proficiency). Defaults to STR for melee attacks.
 */
export function monsterAttackModifier(monster: Monster, useStr = true): number {
  const abilityScore = useStr
    ? (monster.strength ?? 10)
    : (monster.dexterity ?? 10);
  const prof = proficiencyBonusForCR(monster.challenge_rating ?? 0);
  return abilityModifier(abilityScore) + prof;
}
