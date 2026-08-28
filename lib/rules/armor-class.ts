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
  /**
   * An additive bonus the row grants while equipped, or null when it declares
   * none. Read from `ac_bonus` — snake_case, unlike its four neighbours,
   * because that is the key the loot data has always used and renaming it
   * would orphan every persisted row that carries one.
   */
  bonusAC: number | null;
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
    bonusAC: num(root?.ac_bonus),
  };
}

/**
 * The shield the character is holding, if any.
 *
 * Deliberately a second selector rather than a flag on `selectBodyArmor`: the
 * two answer different questions about different slots, and a shield is not
 * armour that happens to be excluded — under the SRD it is an additive 2, which
 * is why `selectBodyArmor` skips the category outright and why a row with a
 * base below the unarmoured 10 is rejected there but expected here.
 *
 * The off-hand requirement is what makes this safe on old data. Rows persisted
 * before the slot rule shipped can still hold a shield in ARMOR; those must not
 * start granting a bonus retroactively, and they do not.
 */
export function selectShield(
  inventory: readonly ArmorInventoryRow[],
): ArmorProfile | null {
  for (const row of inventory) {
    if (row.type !== "armor" || row.equippedSlot !== "OFF_HAND") continue;

    const profile = readArmorProfile(row.properties);
    if (profile.category !== "shield") continue;
    if (profile.baseAC === null) continue;

    return profile;
  }

  return null;
}

/**
 * Every additive bonus the character's equipped rows grant, summed.
 *
 * A row pays only from the slot the slot rule would have chosen for it. Being
 * equipped is not enough, and an earlier draft of this function believed it
 * was: `equippedSlot` is an unconstrained string, and the route that predates
 * `lib/rules/equipment-slot.ts` sent every armour-typed row to ARMOR. So a
 * shield can be sitting in ARMOR right now, where `selectBodyArmor` skips it
 * for its category and `selectShield` skips it for its slot — which means
 * `armorPenaltyFor` never charges proficiency for it. Paying its bonus anyway
 * would have raised armour class from a row invisible to the rule that is
 * supposed to make it cost something.
 *
 * The placement test mirrors `slotFor` rather than calling it, because
 * `equipment-slot.ts` imports `readArmorProfile` from this module and the call
 * would close a runtime import cycle. A mirror nothing pins is a mirror that
 * drifts, so `tests/rules/armor-class.test.ts` asserts the two agree across
 * every shape — that test is the only thing keeping this honest.
 */
function bonusACFrom(inventory: readonly ArmorInventoryRow[]): number {
  let total = 0;

  for (const row of inventory) {
    if (row.type !== "armor") continue;

    const { category, bonusAC } = readArmorProfile(row.properties);
    if (bonusAC === null || !Number.isInteger(bonusAC)) continue;

    const belongs =
      category === null
        ? "ACCESSORY"
        : category === "shield"
          ? "OFF_HAND"
          : "ARMOR";

    if (row.equippedSlot !== belongs) continue;

    total += bonusAC;
  }

  return total;
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

  const base = bodyArmorClass(inventory, dexModifier);
  const additive = (selectShield(inventory)?.baseAC ?? 0) + bonusACFrom(inventory);

  if (additive === 0) return base;

  // `category` and `armored` keep describing the body armour, not the total.
  // They answer "what is this character wearing", which is the question the
  // proficiency rule puts to them; a helm granting +1 has not dressed anyone.
  return { ...base, armorClass: base.armorClass + additive };
}

/** The half of the answer that only body armour and Dexterity decide. */
function bodyArmorClass(
  inventory: readonly ArmorInventoryRow[],
  dexModifier: number,
): ArmorClassResult {
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
