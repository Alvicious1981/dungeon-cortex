/**
 * lib/rules/weapon-attack.ts
 *
 * Everything one weapon attack needs, resolved once.
 *
 * The action route had two attack sites, each computing the attack modifier and
 * the damage bonus by hand from the Strength modifier. Two parallel copies of
 * one rule is what let the route drift from `lib/character-sheet/view-model.ts`,
 * so both now call this.
 *
 * Server-only — never import from a client component.
 */

import { weaponAttackBonus } from "@/lib/rules/weapon-profile";
import { resolveWeaponProfile } from "@/lib/rules/weapon-profile-service";

const UNARMED_DICE = "1d4";

export interface ResolvedWeaponAttack {
  attackModifier: number;
  flatDamageBonus: number;
  weaponDice: string;
  damageType: string;
  abilityUsed: "STR" | "DEX";
  proficiencyApplied: boolean;
  categoryResolved: boolean;
}

/**
 * Resolves one attack's numbers from the weapon, the character, and the SRD.
 *
 * `weapon: null` is an unarmed strike, which the first attack site permits.
 *
 * `flatDamageBonus` uses the same ability the attack roll used. SRD 2014 on
 * Finesse: "You must use the same modifier for both." Leaving damage on
 * Strength while the attack moved to Dexterity would be a rule contradicting
 * itself inside a single attack.
 */
export async function resolveWeaponAttack(input: {
  weapon: { name: string; properties: unknown } | null;
  stats: Record<string, number>;
  characterClass: string;
  level: number;
  /** Each attack site has its own pre-existing default; both are preserved. */
  fallbackDamageType: string;
}): Promise<ResolvedWeaponAttack> {
  const { weapon, stats, characterClass, level, fallbackDamageType } = input;

  const profile = weapon === null ? null : await resolveWeaponProfile(weapon);
  const bonus = weaponAttackBonus({ profile, stats, characterClass, level });

  const properties =
    typeof weapon?.properties === "object" && weapon.properties !== null
      ? (weapon.properties as Record<string, unknown>)
      : {};
  const weaponDamageBonus =
    typeof properties.damageBonus === "number" ? properties.damageBonus : 0;

  return {
    attackModifier: bonus.bonus,
    // The same modifier the attack roll used, taken from the rule that decided
    // it rather than re-derived here. SRD 2014 on Finesse: "You must use the
    // same modifier for both" — one source makes that structural, not a habit.
    flatDamageBonus: bonus.abilityMod + weaponDamageBonus,
    weaponDice: profile?.damageDice ?? UNARMED_DICE,
    damageType: profile?.damageType ?? fallbackDamageType,
    abilityUsed: bonus.abilityUsed,
    proficiencyApplied: bonus.proficiencyApplied,
    categoryResolved: bonus.categoryResolved,
  };
}

/**
 * The line to write when a weapon's category could not be resolved.
 *
 * Declared rather than silent: a rule that did not apply and left no trace is
 * how a gap survives unnoticed. The previous increment declares an unenforceable
 * spell range the same way instead of implying it held.
 *
 * Returns null for an unarmed strike, which is proficient by SRD rule and has no
 * category to resolve — a line on every punch would be noise, not signal.
 */
export function unresolvedCategoryLog(input: {
  weaponName: string;
  attack: ResolvedWeaponAttack;
}): string | null {
  const { weaponName, attack } = input;
  if (attack.categoryResolved || attack.proficiencyApplied) return null;

  return (
    `⚠️ ${weaponName}: weapon category not resolved — the SRD has no entry ` +
    `under that name, so the attack was rolled without a proficiency bonus.`
  );
}
