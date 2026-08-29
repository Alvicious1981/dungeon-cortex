/**
 * lib/rules/damage-modifiers.ts
 *
 * How much of a damage roll actually lands, given what the target resists.
 *
 * @pure — no database, no I/O, no randomness, and never throws.
 *
 * This module exists because the answer was never asked for. `SrdMonster` has
 * carried `damageImmunities`, `damageResistances` and `damageVulnerabilities`
 * since it was written — two seeders populate them and the schema indexes all
 * three — and no rule read any of them. Every fire elemental took full fire
 * damage.
 *
 * ─── Why the vocabulary lives here ───────────────────────────────────────────
 * `DamageType` and `DAMAGE_TYPES` were declared in `lib/rules/combat.ts`. They
 * moved here because this module needs the list as a *value* to tell a bare
 * damage type from a conditional clause, while `combat.ts` needs
 * `applyDamageModifiers` as a value too — and importing both ways closes a
 * runtime cycle. `combat.ts` re-exports both, so every existing importer is
 * untouched. Duplicating the thirteen members would have been the other way
 * out, and duplication is the defect this codebase has spent four increments
 * removing.
 */

import { clauseFor } from "@/lib/rules/damage-clauses";
import type { WeaponQuality } from "@/lib/rules/weapon-quality";

export type DamageType =
  | "slashing" | "piercing" | "bludgeoning"
  | "fire" | "cold" | "lightning" | "acid" | "poison"
  | "necrotic" | "radiant" | "psychic" | "thunder" | "force";

export const DAMAGE_TYPES: readonly DamageType[] = Object.freeze([
  "slashing", "piercing", "bludgeoning",
  "fire", "cold", "lightning", "acid", "poison",
  "necrotic", "radiant", "psychic", "thunder", "force",
] as const);

/** A creature's damage modifiers, exactly as the three columns store them. */
export interface DamageModifiers {
  immunities: readonly string[];
  resistances: readonly string[];
  vulnerabilities: readonly string[];
}

/**
 * What struck, for the clauses that ask.
 *
 * Optional at every call site on purpose: absent means the engine does not know
 * what hit, so a clause it can read still goes unevaluated rather than being
 * resolved on an assumption. That is what lets a caller stay untouched without
 * silently changing what it computes.
 */
export interface DamageAttack {
  kind: "weapon" | "spell";
  qualities: readonly WeaponQuality[];
}

export interface ModifiedDamage {
  damage: number;
  /**
   * Which rule produced the number.
   *
   * Reported rather than derived from a before/after comparison, because
   * "halved from 1 to 0" and "immune" both end at 0 and mean different things
   * to whatever narrates the hit.
   */
  applied: "immune" | "resistant" | "vulnerable" | "cancelled" | "none";
  /**
   * Clauses this module could not evaluate, verbatim and de-duplicated, in the
   * order first seen. For the system log — never for a decision.
   */
  unresolved: readonly string[];
}

const EMPTY: readonly string[] = Object.freeze([]);

function asStrings(value: readonly string[] | undefined): readonly string[] {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : EMPTY;
}

function normalise(entry: string): string {
  return entry.trim().toLowerCase();
}

function isBareType(entry: string): boolean {
  return (DAMAGE_TYPES as readonly string[]).includes(normalise(entry));
}

/**
 * Whether any string in `entries` names exactly this damage type.
 *
 * Exact match after trimming and lower-casing, never a substring test. The
 * clause "bludgeoning, piercing, and slashing from nonmagical weapons"
 * contains the word "slashing", and a substring test would halve a sword blow
 * on that basis — a mechanical outcome inferred from prose, which is the one
 * thing this project does not do.
 */
function names(entries: readonly string[], damageType: DamageType): boolean {
  return entries.some((entry) => normalise(entry) === damageType);
}

/**
 * Whether a recognised clause covers this attack, given what struck.
 *
 * A silvered weapon is not a magic weapon, so it lifts `that aren't silvered`
 * and leaves the plain `nonmagical weapons` wording standing. The two questions
 * are asked separately here for that reason.
 */
function clauseApplies(
  entry: string,
  damageType: DamageType,
  attack: DamageAttack,
): boolean {
  const clause = clauseFor(entry);
  if (clause === null) return false;
  if (attack.kind !== "weapon") return false;
  if (!clause.types.includes(damageType)) return false;
  if (attack.qualities.includes("magical")) return false;
  if (clause.unless !== null && attack.qualities.includes(clause.unless)) return false;
  return true;
}

/**
 * Whether this list stops the damage: by naming the type outright, or through a
 * clause the engine could both read and evaluate.
 */
function catches(
  entries: readonly string[],
  damageType: DamageType,
  attack: DamageAttack | undefined,
): boolean {
  if (names(entries, damageType)) return true;
  if (attack === undefined) return false;
  return entries.some((entry) => clauseApplies(entry, damageType, attack));
}

export function applyDamageModifiers(input: {
  damage: number;
  damageType: DamageType;
  modifiers: DamageModifiers;
  attack?: DamageAttack;
}): ModifiedDamage {
  const immunities = asStrings(input.modifiers?.immunities);
  const resistances = asStrings(input.modifiers?.resistances);
  const vulnerabilities = asStrings(input.modifiers?.vulnerabilities);

  // De-duplicated on the normalised form (case/whitespace-insensitive, same
  // as `names` matches), reporting the first raw spelling seen. Comparing raw
  // strings here let two casings of one clause both survive into the log.
  const unresolved: string[] = [];
  const seenClauses = new Set<string>();
  for (const entry of [...immunities, ...resistances, ...vulnerabilities]) {
    if (isBareType(entry)) continue;
    // A clause the table reads is only unresolved while nothing says what
    // struck. Once something does, the clause has an answer — applicable or not
    // — and reporting it as unreadable would hand the narrator a refusal that
    // no longer happened.
    if (input.attack !== undefined && clauseFor(entry) !== null) continue;
    const key = normalise(entry);
    if (seenClauses.has(key)) continue;
    seenClauses.add(key);
    unresolved.push(entry);
  }

  const damage = Math.max(0, Math.floor(input.damage));

  if (catches(immunities, input.damageType, input.attack)) {
    return { damage: 0, applied: "immune", unresolved };
  }

  const resistant = catches(resistances, input.damageType, input.attack);
  const vulnerable = catches(vulnerabilities, input.damageType, input.attack);

  // SRD: resistance and vulnerability to the same damage type cancel. Reported
  // as its own outcome rather than folded into "none", because the two differ
  // in what the narrator may say about the blow.
  if (resistant && vulnerable) return { damage, applied: "cancelled", unresolved };
  if (resistant) return { damage: Math.floor(damage / 2), applied: "resistant", unresolved };
  if (vulnerable) return { damage: damage * 2, applied: "vulnerable", unresolved };

  return { damage, applied: "none", unresolved };
}

/**
 * A system-log line for clauses the engine could not evaluate, or null when
 * there is nothing true to say.
 *
 * Declared rather than silent, exactly as `unresolvedCategoryLog` declares an
 * unresolved weapon category. A player whose sword is not bouncing off the
 * werewolf is owed the reason, and a resolution the engine did not make must
 * never look like one it did.
 *
 * Its reach narrowed when weapon qualities arrived. The line used to say the
 * clause "depends on whether the attack was magical, silvered or adamantine,
 * which this engine does not track" — true when every conditional clause was
 * beyond reading, and false now that `lib/rules/damage-clauses.ts` reads the
 * four wordings covering 69 of the data's 72 conditional entries. What survives
 * here is the remainder: wordings the table does not know, and clauses on a call
 * site that passed no attack, which is a different silence and reads the same
 * from the outside.
 *
 * Takes the whole `ModifiedDamage` result, not just the clause list, because
 * the sentence this produces claims "full damage was applied" — a claim that
 * is only true when the engine actually applied full damage. It is withheld
 * when:
 *   - there is no unresolved clause to report at all;
 *   - `applied !== "none"` — a bare immunity/resistance/vulnerability *did*
 *     resolve the same hit, so "full damage" would be false even though a
 *     sibling clause on the same creature went unresolved;
 *   - the damage that landed is not greater than zero — a miss or a heal
 *     never had "full damage" to speak of.
 */
export function unresolvedModifierLog(input: {
  defenderName: string;
  result: Pick<ModifiedDamage, "damage" | "applied" | "unresolved">;
}): string | null {
  const { damage, applied, unresolved } = input.result;

  if (unresolved.length === 0) return null;
  if (applied !== "none") return null;
  if (damage <= 0) return null;

  return (
    `⚠️ ${input.defenderName}: damage modifier not applied — ` +
    `"${unresolved.join('", "')}" is a condition this engine does not read. ` +
    `Full damage was applied.`
  );
}
