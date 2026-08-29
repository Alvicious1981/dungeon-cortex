/**
 * lib/rules/condition-immunity.ts
 *
 * Which conditions actually take hold on a creature that resists some of them.
 *
 * @pure — no database, no I/O, no randomness, and never throws.
 *
 * `SrdMonster.conditionImmunities` has been written by both seeders and indexed
 * in the schema since it existed, and no rule read it. It is the fourth column
 * of the group the damage-modifier increment repaired, left behind because it
 * is a different rule against a different registry.
 *
 * The vocabulary needs no interpretation, which is what makes this smaller than
 * its damage-modifier sibling. `toStringArray` in `prisma/seed-srd.ts` reduces
 * each `{index, name, url}` object from the SRD to its `index`, and every index
 * the data contains is a key of `CONDITION_REGISTRY` — verified against the
 * real file in this module's tests. There is no free-text half here, so nothing
 * is ever reported unresolved.
 *
 * Matching is exact after trimming and lower-casing. The registry stores
 * "Poisoned" capitalised while the SRD index is lowercase, and the two reach
 * this function from opposite directions.
 *
 * Not live yet, and that is deliberate. No spell in this codebase currently
 * produces a condition: `resolveSpellEffect` in `magic.ts` returns
 * `condition: null` on all three of its exit paths, with an acknowledged TODO
 * at `magic.ts:396` — "To be extracted from SRD description or specialized
 * fields." `resolveCachedSpell` spreads that effect unchanged, so the only
 * live source of `effect.condition` is null, and `combat-pipeline.ts`'s
 * `if (!saved && effect.condition)` cannot be entered by any request today.
 * The rule in this module is correct and reachable in the code sense — it is
 * simply unreachable in practice until spell condition extraction is built,
 * which is a separate increment. The column and the rule are repaired now so
 * both are already in place on the day conditions become extractable,
 * exactly as `equipItem`'s slot validation shipped before the AI tool that
 * reaches it was re-enabled.
 */

export interface ConditionGrant {
  /** The conditions that take hold, in the order they were attempted. */
  granted: readonly string[];
  /**
   * The conditions the target is immune to, spelled as the caller attempted
   * them rather than as the immunity spelled them — the log describes what the
   * spell tried to do, not how the monster's data is written.
   */
  blocked: readonly string[];
}

/**
 * Reduces a `Monster.condition_immunities` value to bare condition ids.
 *
 * That field is declared `z.array(z.any())`, and it genuinely arrives in two
 * shapes. A `Monster` built from the database carries bare strings, because
 * `toStringArray` in `prisma/seed-srd.ts` already reduced the SRD objects
 * before storing them. A `Monster` built from the in-memory SRD JSON via
 * `filterMonsters` still carries the raw `{index, name, url}` objects. Spawn
 * must not have to know which it is holding.
 *
 * The `index ?? name` fallback and the empty-string filter mirror
 * `toStringArray` deliberately: the same value must reduce the same way on
 * both sides of the database, or a monster's immunities would depend on which
 * path happened to load it.
 */
export function conditionImmunityIndexes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (typeof entry !== "object" || entry === null) return "";
      const record = entry as Record<string, unknown>;
      const index = typeof record.index === "string" ? record.index : null;
      const name = typeof record.name === "string" ? record.name : null;
      return index ?? name ?? "";
    })
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function asStrings(value: readonly string[] | undefined): readonly string[] {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

function normalise(entry: string): string {
  return entry.trim().toLowerCase();
}

/**
 * Splits an attempted condition list into what lands and what the target
 * shrugs off.
 *
 * Returns both halves rather than filtering in place, because the caller needs
 * each for a different purpose: `granted` decides the persisted state, and
 * `blocked` is what the player is told. Deriving one from the other at the call
 * site is how the two come to disagree.
 */
export function grantConditions(input: {
  conditions: readonly string[];
  immunities: readonly string[];
}): ConditionGrant {
  const attempted = asStrings(input.conditions);
  const immune = new Set(asStrings(input.immunities).map(normalise));

  const granted: string[] = [];
  const blocked: string[] = [];

  for (const condition of attempted) {
    (immune.has(normalise(condition)) ? blocked : granted).push(condition);
  }

  return { granted, blocked };
}

/**
 * A system-log line naming the conditions a creature was immune to.
 *
 * Declared rather than silent, following `unresolvedCategoryLog` and
 * `unresolvedModifierLog`. This one differs from both in an important way: they
 * report what the engine could *not* resolve, while this reports a resolution
 * it made. So the sentence is affirmative and has no way to become false — it
 * is written only from `blocked`, which by construction holds exactly the
 * conditions that did not take hold.
 *
 * Why the player is owed it: with the facts corrected, the narrator can see the
 * condition did not land, but not why. "The poison fails to take hold" and "its
 * undead nature shrugs the poison off" read differently, and only one of them
 * is true.
 */
export function immuneConditionLog(input: {
  defenderName: string;
  blocked: readonly string[];
}): string | null {
  if (input.blocked.length === 0) return null;

  return (
    `⚠️ ${input.defenderName} is immune to ` +
    `"${input.blocked.join('", "')}" — the condition was not applied.`
  );
}
