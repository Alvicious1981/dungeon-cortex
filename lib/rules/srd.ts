/**
 * lib/rules/srd.ts
 *
 * Local SRD data layer — Spanish 5e SRD (Magical20-ai/5e-database-spanish).
 *
 * Validates and indexes the bundled JSON at module load time using Zod.
 * Invalid records are silently skipped so a single malformed entry never
 * crashes the lookup. All public functions return null on miss — never throw.
 *
 * Server-only: never import this module from client components.
 */

import { z } from "zod";
import rawSpells from "@/data/srd-es/spells.json";
import rawEquipment from "@/data/srd-es/equipment.json";

// ─── Shared sub-schemas ───────────────────────────────────────────────────────

const SrdRefSchema = z.object({
  index: z.string(),
  name: z.string(),
  url: z.string(),
});

// ─── Spell schema ─────────────────────────────────────────────────────────────

const SpellDamageSchema = z.object({
  damage_type: SrdRefSchema.optional(),
  damage_at_slot_level: z.record(z.string(), z.string()).optional(),
  damage_at_character_level: z.record(z.string(), z.string()).optional(),
});

const SpellDcSchema = z.object({
  dc_type: SrdRefSchema,
  dc_success: z.string(),
  desc: z.string().optional(),
});

export const SpellSchema = z.object({
  index: z.string(),
  name: z.string(),
  desc: z.array(z.string()),
  higher_level: z.array(z.string()).optional(),
  range: z.string(),
  components: z.array(z.string()),
  material: z.string().optional(),
  ritual: z.boolean(),
  duration: z.string(),
  concentration: z.boolean(),
  casting_time: z.string(),
  level: z.number().int().min(0).max(9),
  attack_type: z.string().optional(),
  damage: SpellDamageSchema.optional(),
  dc: SpellDcSchema.optional(),
  school: SrdRefSchema,
  classes: z.array(SrdRefSchema),
  subclasses: z.array(SrdRefSchema),
  url: z.string(),
});

export type Spell = z.infer<typeof SpellSchema>;

// ─── Weapon schema ────────────────────────────────────────────────────────────

const DamageBlockSchema = z.object({
  damage_dice: z.string(),
  damage_type: SrdRefSchema,
});

export const WeaponSchema = z.object({
  index: z.string(),
  name: z.string(),
  equipment_category: SrdRefSchema,
  weapon_category: z.string(),
  weapon_range: z.enum(["Melee", "Ranged"]),
  category_range: z.string(),
  cost: z.object({ quantity: z.number(), unit: z.string() }).optional(),
  damage: DamageBlockSchema.optional(),
  two_handed_damage: DamageBlockSchema.optional(),
  range: z.object({ normal: z.number(), long: z.number().optional() }).optional(),
  weight: z.number().optional(),
  properties: z.array(SrdRefSchema).optional(),
  url: z.string(),
});

export type Weapon = z.infer<typeof WeaponSchema>;

// ─── Armor schema ─────────────────────────────────────────────────────────────

export const ArmorSchema = z.object({
  index: z.string(),
  name: z.string(),
  equipment_category: SrdRefSchema,
  armor_category: z.string(),
  armor_class: z.object({
    base: z.number(),
    dex_bonus: z.boolean(),
    max_bonus: z.number().nullable().optional(),
  }),
  str_minimum: z.number().optional(),
  stealth_disadvantage: z.boolean().optional(),
  weight: z.number().optional(),
  cost: z.object({ quantity: z.number(), unit: z.string() }).optional(),
  url: z.string(),
});

export type Armor = z.infer<typeof ArmorSchema>;

// ─── Monster schema ───────────────────────────────────────────────────────────

export const MonsterSchema = z.object({
  index: z.string(),
  name: z.string(),
  size: z.string().optional(),
  type: z.string().optional(),
  alignment: z.string().optional(),
  // armor_class may be an array of objects (Open5e) or a flat number (older sources)
  armor_class: z
    .array(z.object({ type: z.string().optional(), value: z.number() }))
    .optional(),
  hit_points: z.number(),
  hit_dice: z.string().optional(),
  speed: z.record(z.string(), z.unknown()).optional(),
  strength: z.number().optional(),
  dexterity: z.number().optional(),
  constitution: z.number().optional(),
  intelligence: z.number().optional(),
  wisdom: z.number().optional(),
  charisma: z.number().optional(),
  challenge_rating: z.number().optional(),
  xp: z.number().optional(),
  url: z.string().optional(),
});

export type Monster = z.infer<typeof MonsterSchema>;

// ─── Parse and index ──────────────────────────────────────────────────────────
//
// Splitting by equipment_category.index before schema validation prevents
// cross-contamination between weapon and armor parse runs and is faster
// than running both schemas over every record.

function categoryIndex(entry: unknown): string {
  const e = entry as { equipment_category?: { index?: unknown } };
  return typeof e.equipment_category?.index === "string"
    ? e.equipment_category.index
    : "";
}

const spells: Spell[] = (rawSpells as unknown[]).flatMap((entry) => {
  const r = SpellSchema.safeParse(entry);
  return r.success ? [r.data] : [];
});

const weapons: Weapon[] = (rawEquipment as unknown[]).flatMap((entry) => {
  if (categoryIndex(entry) !== "weapon") return [];
  const r = WeaponSchema.safeParse(entry);
  return r.success ? [r.data] : [];
});

const armors: Armor[] = (rawEquipment as unknown[]).flatMap((entry) => {
  if (categoryIndex(entry) !== "armor") return [];
  const r = ArmorSchema.safeParse(entry);
  return r.success ? [r.data] : [];
});

// monsters.json is fetched at runtime because it may not exist at build time
// (it requires a manual data-acquisition step). Once committed, this can be
// converted to a static import matching rawSpells / rawEquipment above.
let rawMonsters: unknown[] = [];
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  rawMonsters = require("@/data/srd-es/monsters.json") as unknown[];
} catch {
  // monsters.json not yet present — getMonster() returns null for all queries
}

const monsters: Monster[] = rawMonsters.flatMap((entry) => {
  const r = MonsterSchema.safeParse(entry);
  return r.success ? [r.data] : [];
});

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Case-insensitive lookup for a spell by name or index.
 *
 * Match priority: exact name → exact index → substring of name.
 * Returns the first match, or null if none found.
 */
export function getSpell(name: string): Spell | null {
  const q = name.toLowerCase().trim();
  return (
    spells.find((s) => s.name.toLowerCase() === q) ??
    spells.find((s) => s.index.toLowerCase() === q) ??
    spells.find((s) => s.name.toLowerCase().includes(q)) ??
    null
  );
}

/**
 * Case-insensitive lookup for a weapon by name or index.
 *
 * Match priority: exact name → exact index → substring of name.
 * Returns the first match, or null if none found.
 */
export function getWeapon(name: string): Weapon | null {
  const q = name.toLowerCase().trim();
  return (
    weapons.find((w) => w.name.toLowerCase() === q) ??
    weapons.find((w) => w.index.toLowerCase() === q) ??
    weapons.find((w) => w.name.toLowerCase().includes(q)) ??
    null
  );
}

/**
 * Case-insensitive lookup for armor by name or index.
 *
 * Match priority: exact name → exact index → substring of name.
 * Returns the first match, or null if none found.
 */
export function getArmor(name: string): Armor | null {
  const q = name.toLowerCase().trim();
  return (
    armors.find((a) => a.name.toLowerCase() === q) ??
    armors.find((a) => a.index.toLowerCase() === q) ??
    armors.find((a) => a.name.toLowerCase().includes(q)) ??
    null
  );
}

/**
 * Case-insensitive lookup for a monster by name or index.
 *
 * Match priority: exact name → exact index → substring of name.
 * Returns null when monsters.json has not yet been seeded.
 */
export function getMonster(name: string): Monster | null {
  const q = name.toLowerCase().trim();
  return (
    monsters.find((m) => m.name.toLowerCase() === q) ??
    monsters.find((m) => m.index.toLowerCase() === q) ??
    monsters.find((m) => m.name.toLowerCase().includes(q)) ??
    null
  );
}

// ─── Monster filtering ────────────────────────────────────────────────────────

export interface MonsterFilter {
  /** Creature type, e.g. "dragon", "undead", "humanoid" (case-insensitive). */
  type?: string;
  /** Size category, e.g. "Large", "Medium" (case-insensitive). */
  size?: string;
  /** Minimum Challenge Rating (inclusive). */
  minCR?: number;
  /** Maximum Challenge Rating (inclusive). */
  maxCR?: number;
  /** Alignment substring, e.g. "evil", "lawful" (case-insensitive contains). */
  alignment?: string;
}

/**
 * Returns all in-memory monsters that satisfy every provided filter criterion.
 * Omitted criteria are ignored (no-op filter).
 *
 * Results are sorted by challenge_rating ascending, then name ascending.
 *
 * @pure — deterministic, no side effects.
 */
export function filterMonsters(filter: MonsterFilter): Monster[] {
  const { type, size, minCR, maxCR, alignment } = filter;

  return monsters
    .filter((m) => {
      if (type !== undefined && m.type?.toLowerCase() !== type.toLowerCase()) return false;
      if (size !== undefined && m.size?.toLowerCase() !== size.toLowerCase()) return false;
      if (alignment !== undefined && !m.alignment?.toLowerCase().includes(alignment.toLowerCase())) return false;
      if (minCR !== undefined && (m.challenge_rating ?? 0) < minCR) return false;
      if (maxCR !== undefined && (m.challenge_rating ?? 0) > maxCR) return false;
      return true;
    })
    .sort((a, b) => {
      const crDiff = (a.challenge_rating ?? 0) - (b.challenge_rating ?? 0);
      return crDiff !== 0 ? crDiff : a.name.localeCompare(b.name);
    });
}

export const SrdLookupInputSchema = z.object({
  query: z.string().min(1).max(100),
}).strict();

export type SrdLookupInput = z.infer<typeof SrdLookupInputSchema>;

/** Number of valid spells parsed from the SRD. */
export const SPELL_COUNT = spells.length;

/** Number of valid weapons parsed from the SRD. */
export const WEAPON_COUNT = weapons.length;

/** Number of valid armor pieces parsed from the SRD. */
export const ARMOR_COUNT = armors.length;

/** Number of valid monsters parsed from the SRD (0 until monsters.json is present). */
export const MONSTER_COUNT = monsters.length;
