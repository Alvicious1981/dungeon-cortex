/**
 * lib/rules/damage-clauses.ts
 *
 * The conditional damage clauses this engine can read, and what each one means.
 *
 * @pure — no database, no I/O, no randomness, and never throws.
 *
 * ─── Why a table and not a parser ────────────────────────────────────────────
 * Measured over the 334 monsters in `data/srd-es/monsters.json`: seven distinct
 * non-bare clause strings, 72 occurrences, and four of those strings carry 69 of
 * them. Those four are one family — physical damage from weapons that are not
 * magical, sometimes further excluding silvered or adamantine ones — and they
 * are the four entries below.
 *
 * A regex grammar over the wording would generalise to strings nobody has seen,
 * at the price of deriving a mechanical outcome from prose. This table
 * recognises text verbatim or not at all, so an unseen wording keeps the
 * behaviour it has today: reported unresolved, full damage, and a log saying so.
 *
 * The import of `DamageType` is type-only and erased at compile time, so
 * `damage-modifiers.ts` importing `clauseFor` as a value closes no runtime cycle.
 */

import type { DamageType } from "@/lib/rules/damage-modifiers";
import type { WeaponQuality } from "@/lib/rules/weapon-quality";

export interface DamageClause {
  /** The damage types the clause covers. */
  types: readonly DamageType[];
  /**
   * The quality that lifts the clause beyond simply being magical, or null when
   * only magic lifts it. A silvered weapon is not a magic weapon: it lifts
   * "that aren't silvered" and leaves the plain wording standing.
   */
  unless: WeaponQuality | null;
}

const PHYSICAL: readonly DamageType[] = Object.freeze([
  "bludgeoning",
  "piercing",
  "slashing",
]);

const TABLE: ReadonlyMap<string, DamageClause> = new Map<string, DamageClause>([
  [
    "bludgeoning, piercing, and slashing from nonmagical weapons",
    { types: PHYSICAL, unless: null },
  ],
  [
    "bludgeoning, piercing, and slashing from nonmagical weapons that aren't silvered",
    { types: PHYSICAL, unless: "silvered" },
  ],
  [
    "bludgeoning, piercing, and slashing from nonmagical weapons that aren't adamantine",
    { types: PHYSICAL, unless: "adamantine" },
  ],
  [
    "piercing and slashing from nonmagical weapons that aren't adamantine",
    { types: Object.freeze(["piercing", "slashing"] as const), unless: "adamantine" },
  ],
]);

/**
 * The wordings in the data this table deliberately does not read.
 *
 * Exported so a test can assert it against the real file in both directions:
 * one occurrence each, and each needs a concept the engine does not carry — the
 * damage's own source, the wielder's alignment, the provenance of a temporary
 * resistance. The count is a number somebody has to change on purpose.
 */
export const UNRECOGNISED_SRD_CLAUSES: readonly string[] = Object.freeze([
  "damage from spells",
  "bludgeoning, piercing, and slashing from nonmagical attacks (from stoneskin)",
  "piercing from magic weapons wielded by good creatures",
]);

/**
 * Every key in the table, normalised, so a test can assert the other direction:
 * an entry no monster carries is dead weight and should not be here.
 */
export const RECOGNISED_SRD_CLAUSES: readonly string[] = Object.freeze([...TABLE.keys()]);

/** The clause this entry names, or null when the table has never seen it. */
export function clauseFor(entry: string): DamageClause | null {
  return TABLE.get(entry.trim().toLowerCase()) ?? null;
}
