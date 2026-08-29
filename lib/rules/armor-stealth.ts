/**
 * lib/rules/armor-stealth.ts
 *
 * SRD: armour marked "Stealth: Disadvantage" gives its wearer disadvantage on
 * Dexterity (Stealth) checks. Seven SRD armours carry the flag — padded, ring
 * mail, chain mail, scale mail, splint, plate and half plate — and one loot row
 * does.
 *
 * @pure — no database, no I/O, no randomness, and never throws.
 *
 * ─── Why this is its own module ──────────────────────────────────────────────
 * The flag is not proficiency and it is not armour class, so it belongs beside
 * neither. It reaches the roll the way `armorPenaltyFor` does — as a value
 * passed at the call site rather than a `CONDITION_REGISTRY` entry — because
 * wearing chain mail is not an SRD condition, and modelling it as one would
 * leak into every place conditions are listed and narrated.
 *
 * It asks `selectBodyArmor` rather than scanning the inventory itself: three
 * rules now want to know what the character is wearing, and asking through
 * three selectors is how they would come to disagree. That also settles the
 * cases this module never has to name — a shield, an unequipped row, a bonus
 * row wearing armour's type — because the selector already excludes them.
 */

import type { Skill } from "@/lib/rules/ability-check";
import { selectBodyArmor, type ArmorInventoryRow } from "@/lib/rules/armor-class";

/**
 * Whether the character's worn armour costs them this particular check.
 *
 * The skill test lives here rather than at the call site, the way
 * `penalisedByArmor` holds its four skills: which checks armour touches is a
 * rules question, and the route is not where the answer should be spelled.
 *
 * Only Stealth. The SRD's armour table says "Stealth: Disadvantage" and names
 * no other skill, so widening it to, say, Sleight of Hand would be inventing a
 * rule rather than applying one.
 *
 * A row that says nothing grants nothing: `readArmorProfile` reports an absent
 * flag as null, and only an explicit `true` penalises.
 */
export function stealthDisadvantageFor(input: {
  inventory: readonly ArmorInventoryRow[];
  skill: Skill;
}): boolean {
  if (input.skill !== "Stealth") return false;

  const worn = selectBodyArmor(input.inventory);
  if (worn === null) return false;

  return worn.stealthDisadvantage === true;
}
