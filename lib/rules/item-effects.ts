/**
 * lib/rules/item-effects.ts
 *
 * What a worn item does, for the small set of effects the engine can resolve.
 *
 * @pure — no database, no I/O, no randomness, and never throws.
 *
 * `data/loot-tables.json` carries an `effect` key on forty rows, and every one
 * of those forty strings is distinct. They were written before any engine
 * existed to run them, so they are not a vocabulary the code forgot to read —
 * they are forty bespoke mechanics, most needing systems this codebase does not
 * have: damage resistance, surprise, cover, lighting, opportunity attacks.
 *
 * This module implements the two that have somewhere to go today, and is
 * deliberately not a framework for the other thirty-eight. An unrecognised
 * string grants nothing: the alternative is guessing at free text, and the one
 * rule this project does not bend is that mechanical outcomes are resolved by
 * code, never inferred from prose.
 *
 * The seam this plugs into was left open on purpose. `evaluateAbilityCheckAdvantage`
 * in `lib/rules/conditions.ts` returns `advantage` as a hardcoded false, and
 * says why: "no condition in the 5e 2014 SRD grants advantage on ability
 * checks… `advantage` is reported anyway so that adding a future source of
 * advantage is a change here rather than at every call site." This is that
 * source, and it arrives beside that value rather than inside it, because an
 * item is not a condition.
 */

import { SKILL_ABILITY, type Skill } from "@/lib/rules/ability-check";
import { slotFor } from "@/lib/rules/equipment-slot";

/** The least of an inventory row this module needs to judge it. */
export interface EffectInventoryRow {
  type: string;
  equippedSlot?: string | null;
  properties: unknown;
}

/**
 * Every effect string this module resolves.
 *
 * Exported so a test can assert it against the real loot file in both
 * directions: no entry here is missing from the data, and the count of what is
 * left unimplemented is a number somebody has to change on purpose.
 */
export const IMPLEMENTED_EFFECTS = ["advantage_climb_checks", "wisdom_advantage"] as const;

/** Not exported: nothing outside this module has a use for it, and the branch
 * before this one shipped an exported type with no consumer. */
type ImplementedEffect = (typeof IMPLEMENTED_EFFECTS)[number];

/**
 * Whether an effect grants advantage on a given skill check.
 *
 * `wisdom_advantage` is derived from `SKILL_ABILITY` rather than listed, the
 * same way `penalisedByArmor` derives its four, so that a nineteenth skill
 * inherits the right answer instead of being forgotten.
 *
 * `advantage_climb_checks` maps to Athletics entire. The Thornweave Gloves
 * describe gripping a surface, which is narrower than the skill — but the
 * engine has skills, not sub-uses, and inventing a sub-use concept for one
 * item would be building a system to avoid stating a limitation.
 *
 * `wisdom_advantage` runs the other way: the data string is unqualified, and
 * this covers only Wisdom *skill* checks. Saving throws resolve elsewhere and
 * are untouched. Nothing is lost today, because the only caller reaches this
 * behind a named skill — but the widening above and this narrowing are both
 * choices, and only one of them is visible from the string.
 */
function grantsAdvantageOn(effect: ImplementedEffect, skill: Skill): boolean {
  switch (effect) {
    case "advantage_climb_checks":
      return skill === "Athletics";
    case "wisdom_advantage":
      return SKILL_ABILITY[skill] === "WIS";
    default: {
      // A third entry in IMPLEMENTED_EFFECTS is a compile error here rather
      // than a silent "grants nothing". `strict` already makes the missing
      // return an error; this does not depend on that flag staying on, and it
      // matches the idiom `equipment-slot.ts` uses for the same guarantee.
      const unreachable: never = effect;
      return unreachable;
    }
  }
}

function readEffect(properties: unknown): ImplementedEffect | null {
  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) {
    return null;
  }

  const raw = (properties as Record<string, unknown>).effect;
  if (typeof raw !== "string") return null;

  return IMPLEMENTED_EFFECTS.find((known) => known === raw) ?? null;
}

/**
 * Whether anything the character has equipped grants advantage on this check.
 *
 * A row counts only from the slot `slotFor` would choose for it. Being equipped
 * somewhere is not enough: `equippedSlot` is an unconstrained string, and the
 * route that predates `lib/rules/equipment-slot.ts` sent every armour-typed row
 * to ARMOR — so a row can be sitting in a slot the rule would never have picked,
 * and it must not start granting things retroactively. The call is a real call
 * here rather than the mirror `armorClassFor` had to settle for, because
 * `equipment-slot.ts` does not import this module and there is no cycle to
 * close.
 *
 * One qualifying row is enough. Advantage does not stack in 5e, and only one
 * ACCESSORY slot exists, so today this cannot arise — but the boolean says so
 * rather than leaving a count to be misread later.
 */
export function abilityCheckAdvantageFrom(input: {
  inventory: readonly EffectInventoryRow[];
  skill: Skill;
}): boolean {
  return input.inventory.some((row) => {
    if (!row.equippedSlot) return false;
    if (row.equippedSlot !== slotFor(row).slot) return false;

    const effect = readEffect(row.properties);
    return effect !== null && grantsAdvantageOn(effect, input.skill);
  });
}
