/**
 * lib/rules/armor-class.ts
 *
 * What armour class a character has, and which armour produced it.
 *
 * @pure — no database, no I/O, no randomness, and never throws.
 *
 * This module exists because the answer was computed in two places that
 * disagreed. `acFromInventory` took the first row typed "armor" regardless of
 * slot, and added the Dexterity modifier whenever the row did not explicitly
 * forbid it. The character sheet required the row to be equipped, and added the
 * modifier only when the row explicitly allowed it. One decided what the player
 * was attacked against; the other decided what the player was shown.
 *
 * Both ignored `ArmorProperties.armorClass` — the SRD category, declared in the
 * types since the beginning and read by nothing. It is what makes an absent
 * `addDexModifier` answerable instead of a guess.
 *
 * Note on where the answer is used: `lib/rules/encounter-service.ts` persists the
 * player's armour class into the combatant row at spawn, while the character
 * sheet recomputes it live on every read. Equipping armour mid-encounter
 * therefore leaves the two showing different numbers until the next spawn. That
 * is the existing design, not a defect of this module; it is recorded here so it
 * is not rediscovered as a bug.
 */

import type { ArmorCategory } from "@/lib/rules/proficiency";

const UNARMORED_BASE = 10;
const MEDIUM_DEX_CAP = 2;

const CATEGORIES: ArmorCategory[] = ["light", "medium", "heavy", "shield"];

export interface ArmorInventoryRow {
  type: string;
  equippedSlot?: string | null;
  properties: unknown;
}

export interface ArmorProfile {
  category: ArmorCategory | null;
  baseAC: number | null;
  /** The row's own dex flag, or null when the row does not say. */
  declaredAddsDex: boolean | null;
  /** The row's own cap, or null when the row does not say. */
  declaredMaxDexBonus: number | null;
}

export interface ArmorClassResult {
  armorClass: number;
  /** The category that produced the number, or null when unarmoured. */
  category: ArmorCategory | null;
  /** False for the 10 + DEX case. */
  armored: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toCategory(value: unknown): ArmorCategory | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().toLowerCase();
  return CATEGORIES.find((candidate) => candidate === raw) ?? null;
}

/**
 * Reads a persisted `InventoryItem.properties` blob into a checked profile.
 *
 * Absent is reported as null rather than defaulted. "The row does not say" and
 * "the row says no" are different answers, and the two implementations this
 * module replaces disagreed about precisely that.
 *
 * Naming, because the persisted shape makes it confusing: the stored
 * `properties.armorClass` is the SRD **category string** ("light", "heavy", …),
 * which is why it is read into `category`. The number called `armorClass` is the
 * one this module computes, on `ArmorClassResult`. Both names are forced by
 * shapes already in the database; neither is free to be renamed here.
 */
export function readArmorProfile(properties: unknown): ArmorProfile {
  const root = asRecord(properties);

  return {
    category: toCategory(root?.armorClass),
    baseAC: num(root?.baseAC),
    declaredAddsDex:
      typeof root?.addDexModifier === "boolean" ? root.addDexModifier : null,
    declaredMaxDexBonus: num(root?.maxDexBonus),
  };
}

/** How much Dexterity a category contributes when the row itself is silent. */
function dexBonusFromCategory(
  category: ArmorCategory,
  dexModifier: number,
): number | null {
  switch (category) {
    case "light":
      return dexModifier;
    case "medium":
      return Math.min(dexModifier, MEDIUM_DEX_CAP);
    case "heavy":
      return 0;
    case "shield":
      // Never selected as body armour; present so adding a category is a
      // compile error here rather than a silent fall-through.
      return null;
  }
}

const UNARMORED = (dexModifier: number): ArmorClassResult => ({
  armorClass: UNARMORED_BASE + dexModifier,
  category: null,
  armored: false,
});

/**
 * Which row, if any, is the character's body armour.
 *
 * Split out of `armorClassFor` because two rules now ask about the same armour
 * for different reasons: one wants the number it grants, the other wants the
 * category to judge proficiency against. Asking twice through two selectors
 * would be how they come to disagree.
 *
 * A shield is excluded — the SRD stores it as an additive base of 2 — and so is
 * any row whose base is below the unarmoured 10, because armour that leaves you
 * worse than naked is a bonus row wearing armour's type.
 */
export function selectBodyArmor(
  inventory: readonly ArmorInventoryRow[],
): ArmorProfile | null {
  for (const row of inventory) {
    if (row.type !== "armor" || row.equippedSlot !== "ARMOR") continue;

    const profile = readArmorProfile(row.properties);
    if (profile.category === "shield") continue;
    if (profile.baseAC === null) continue;
    if (profile.baseAC < UNARMORED_BASE) continue;
    if (profile.declaredAddsDex === null && profile.category === null) continue;

    return profile;
  }

  return null;
}

/**
 * The character's armour class.
 *
 * Only equipped body armour counts. A shield is excluded outright: the SRD
 * stores it as base 2, an additive bonus, so treating it as armour would set a
 * character's AC to 2 + DEX.
 *
 * A row whose base is below the unarmoured 10 is excluded too: it is a bonus,
 * not a total, whatever its category says.
 *
 * A row that declares neither a category nor a dex flag cannot say how it
 * behaves, so it is ignored rather than trusted for its base alone — the only
 * direction that never inflates.
 */
export function armorClassFor(input: {
  inventory: readonly ArmorInventoryRow[];
  dexModifier: number;
}): ArmorClassResult {
  const { inventory, dexModifier } = input;

  const profile = selectBodyArmor(inventory);
  if (profile === null || profile.baseAC === null) return UNARMORED(dexModifier);

  if (profile.declaredAddsDex !== null) {
    const bonus = profile.declaredAddsDex
      ? profile.declaredMaxDexBonus === null
        ? dexModifier
        : Math.min(dexModifier, Math.max(profile.declaredMaxDexBonus, 0))
      : 0;
    return { armorClass: profile.baseAC + bonus, category: profile.category, armored: true };
  }

  if (profile.category === null) return UNARMORED(dexModifier);

  const bonus = dexBonusFromCategory(profile.category, dexModifier);
  if (bonus === null) return UNARMORED(dexModifier);

  return { armorClass: profile.baseAC + bonus, category: profile.category, armored: true };
}
