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

/** Number of valid spells parsed from the SRD. */
export const SPELL_COUNT = spells.length;

/** Number of valid weapons parsed from the SRD. */
export const WEAPON_COUNT = weapons.length;

/** Number of valid armor pieces parsed from the SRD. */
export const ARMOR_COUNT = armors.length;
