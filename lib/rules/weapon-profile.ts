/**
 * lib/rules/weapon-profile.ts
 *
 * What a weapon is, and what bonus it grants the character wielding it.
 *
 * @pure — no database, no I/O, no randomness, and never throws.
 *
 * This module exists because `isWeaponProficient` had ten tests and no consumer:
 * the proficiency bonus was added to every attack unconditionally, because
 * nothing carried a weapon's simple/martial category. It reads that category —
 * and the rest of the weapon's properties — and lets them decide the roll.
 *
 * Everything here arrives from Postgres as untyped JSON or free text, so every
 * read is checked and every unusable value degrades to the conservative answer.
 * A rule that throws on a persisted row turns a corrupt column into a 500.
 */

import { abilityModifier } from "@/lib/rules/dice";
import {
  isWeaponProficient,
  proficiencyBonus,
  type CharacterClass,
  type WeaponCategory,
} from "@/lib/rules/proficiency";

export interface WeaponProfile {
  /** null when the row declares no category and the SRD could not supply one. */
  category: WeaponCategory | null;
  isRanged: boolean;
  /** SRD weapon properties, lowercased. */
  traits: readonly string[];
  damageDice: string | null;
  damageType: string | null;
}

export interface WeaponAttackBonus {
  bonus: number;
  abilityUsed: "STR" | "DEX";
  proficiencyApplied: boolean;
  categoryResolved: boolean;
}

/**
 * The SRD spelling of each category, keyed by the internal one.
 *
 * Keyed as `Record<WeaponCategory, string>` on purpose: adding a member to
 * `WeaponCategory` becomes a compile error here rather than a category that
 * silently never matches. A hand-written array would still type-check with a
 * member missing.
 */
const SRD_CATEGORY: Record<WeaponCategory, string> = {
  simple: "Simple",
  martial: "Martial",
};

const CATEGORIES = Object.keys(SRD_CATEGORY) as WeaponCategory[];

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toCategory(value: unknown): WeaponCategory | null {
  const raw = str(value)?.trim().toLowerCase();
  return CATEGORIES.find((candidate) => candidate === raw) ?? null;
}

function toTraits(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => str(entry)?.toLowerCase() ?? null)
    .filter((entry): entry is string => entry !== null);
}

/**
 * Reads a persisted `InventoryItem.properties` blob into a checked profile.
 *
 * `getItemProperties` (`inventory.ts:211`) is a bare `as` over `Prisma.JsonValue`;
 * this validates instead, which is the difference between a wrong shape being
 * caught and a wrong shape reaching a die roll.
 */
export function readWeaponProfile(properties: unknown): WeaponProfile {
  const root = asRecord(properties);

  return {
    category: toCategory(root?.weaponCategory),
    isRanged: str(root?.weaponRange)?.trim().toLowerCase() === "ranged",
    traits: toTraits(root?.weaponProperties),
    damageDice: str(root?.damageDice),
    damageType: str(root?.damageType),
  };
}

/** Level is a persisted column; proficiencyBonus() throws outside 1-20. */
function clampLevel(level: number): number {
  return Number.isFinite(level) && level >= 1 && level <= 20 ? level : 1;
}

/**
 * Which ability the attack uses.
 *
 * Finesse is checked **before** ranged, and the order is load-bearing. `Dart` is
 * the only SRD weapon that is both, and SRD 2014 says of Finesse: "you use your
 * choice of Strength or Dexterity modifier for the attack and damage rolls",
 * without excluding ranged weapons. Checking ranged first would take that
 * choice away.
 */
function abilityFor(
  profile: WeaponProfile | null,
  stats: Record<string, number>,
): "STR" | "DEX" {
  if (profile === null) return "STR";

  if (profile.traits.includes("finesse")) {
    return score(stats, "DEX") > score(stats, "STR") ? "DEX" : "STR";
  }

  return profile.isRanged ? "DEX" : "STR";
}

function score(stats: Record<string, number>, key: "STR" | "DEX"): number {
  const raw = stats?.[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 10;
}

/**
 * The attack bonus, and why it is what it is.
 *
 * `profile: null` means **no weapon** — an unarmed strike. SRD 2014 grants
 * proficiency with unarmed strikes, so it is proficient. That is a different
 * case from a weapon whose category could not be resolved, which is not
 * proficient; both report `categoryResolved: false` and differ in
 * `proficiencyApplied`.
 *
 * `abilityUsed` is returned, not just the number, because the damage bonus must
 * use the same ability — SRD 2014 on Finesse: "You must use the same modifier
 * for both." A caller that took the number and left damage on Strength would
 * ship a rule contradicting itself inside one attack.
 */
export function weaponAttackBonus(input: {
  profile: WeaponProfile | null;
  stats: Record<string, number>;
  characterClass: string;
  level: number;
}): WeaponAttackBonus {
  const { profile, stats, characterClass, level } = input;

  const abilityUsed = abilityFor(profile, stats);
  const abilityMod = abilityModifier(score(stats, abilityUsed));

  const category = profile?.category ?? null;
  const normalisedClass = characterClass.trim().toLowerCase() as CharacterClass;

  const proficiencyApplied =
    profile === null
      ? true
      : category !== null && isWeaponProficient(normalisedClass, category);

  const bonus =
    abilityMod + (proficiencyApplied ? proficiencyBonus(clampLevel(level)) : 0);

  return {
    bonus,
    abilityUsed,
    proficiencyApplied,
    categoryResolved: category !== null,
  };
}
