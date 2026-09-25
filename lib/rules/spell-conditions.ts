/**
 * lib/rules/spell-conditions.ts
 *
 * Which SRD spells put a condition on their targets, transcribed by hand from
 * the SRD 5.1 rules text (docs/DECISION_SPELL_CONDITIONS.md).
 *
 * @pure — no database, no I/O, no randomness.
 *
 * Neither the SRD cache nor dnd5eapi.co carries a spell's condition as data:
 * `data/srd-es/spells.json` has no condition key and no `/api/conditions`
 * reference, and the word appears only inside `desc`. Reading it out of that
 * prose would be deriving mechanics from wording, which this project does not
 * do. So the condition is written down here instead, one spell at a time, and
 * `tests/rules/spell-conditions.test.ts` binds every row to the data: the
 * spell must exist, its condition must be a registry key, and where the cache
 * does carry a field — the save, concentration — the row must agree with it.
 *
 * The table only adds what the data lacks. It never overrides a structured
 * field the data holds; a disagreement fails the test instead.
 */

import type { Ability } from "@/lib/rules/ability-check";

export interface SpellConditionEntry {
  /** The conditions, as keys of CONDITION_REGISTRY (Tasha's imposes two). */
  conditions: readonly string[];
  /**
   * The saving throw that resists it. Given here only because the cache omits
   * it for some spells (Web has no `dc`); where the cache has one, the test
   * requires the two to match.
   */
  save: Ability | null;
  /** The condition ends when the caster's concentration does. */
  concentration: boolean;
  /**
   * The spell's duration in rounds (1 minute = 10). The condition ends at the
   * start of the caster's turn once that many rounds have passed.
   */
  durationRounds: number;
  /**
   * The target repeats the save at the end of each of its turns, ending the
   * spell on itself on a success. `onDamage`: also each time it takes damage,
   * with advantage (Tasha's Hideous Laughter).
   */
  repeatSave?: { onDamage: boolean };
  /**
   * The only creature types the spell may target — Hold Person's "choose a
   * humanoid". Aiming it at anything else is an illegal cast, refused before a
   * slot is spent, and so is a target whose type is unknown.
   */
  onlyTypes?: readonly string[];
  /**
   * Creature types the spell has no effect on — Hold Monster's "no effect on
   * undead". A legal target: the spell is cast and does nothing to it. A
   * target whose type is unknown is refused, since whether it is affected
   * cannot be decided.
   */
  unaffectedTypes?: readonly string[];
  /**
   * A target with this Intelligence or less is unaffected (Tasha's: "a
   * creature with an Intelligence score of 4 or less isn't affected").
   */
  unaffectedAtIntelligence?: number;
}

/**
 * The spells whose condition the engine applies. Each row is the SRD's
 * "must succeed on a saving throw or be <condition>", nothing more.
 *
 * What the rows deliberately leave out is recorded in the decision: a
 * restrained creature cannot use its action to break free, and a creature that
 * enters the area after the cast is not affected. The condition lasts until
 * concentration or the duration ends.
 */
export const SPELL_CONDITIONS: Readonly<Record<string, SpellConditionEntry>> = {
  // Entangle — 1st level. Restrained, STR save, concentration up to 1 minute.
  entangle: { conditions: ["restrained"], save: "STR", concentration: true, durationRounds: 10 },
  // Web — 2nd level. Restrained, DEX save, concentration up to 1 hour.
  web: { conditions: ["restrained"], save: "DEX", concentration: true, durationRounds: 600 },
  // Evard's Black Tentacles — 4th level. 3d6 bludgeoning and restrained, DEX
  // save, concentration up to 1 minute.
  "black-tentacles": {
    conditions: ["restrained"],
    save: "DEX",
    concentration: true,
    durationRounds: 10,
  },
  // Tasha's Hideous Laughter — 1st level. Prone and incapacitated, WIS save,
  // concentration up to 1 minute. Repeats the save at the end of each of its
  // turns and when it takes damage (with advantage). INT 4 or less: unaffected.
  "hideous-laughter": {
    conditions: ["prone", "incapacitated"],
    save: "WIS",
    concentration: true,
    durationRounds: 10,
    repeatSave: { onDamage: true },
    unaffectedAtIntelligence: 4,
  },
  // Hold Person — 2nd level. A humanoid; paralyzed, WIS save, concentration up
  // to 1 minute. Repeats the save at the end of each of its turns.
  "hold-person": {
    conditions: ["paralyzed"],
    save: "WIS",
    concentration: true,
    durationRounds: 10,
    repeatSave: { onDamage: false },
    onlyTypes: ["humanoid"],
  },
  // Hold Monster — 5th level. Any creature but undead; paralyzed, WIS save,
  // concentration up to 1 minute. Repeats the save at the end of each of its turns.
  "hold-monster": {
    conditions: ["paralyzed"],
    save: "WIS",
    concentration: true,
    durationRounds: 10,
    repeatSave: { onDamage: false },
    unaffectedTypes: ["undead"],
  },
};

/** Why a spell that imposes a condition is not in SPELL_CONDITIONS yet. */
export type DeferralReason =
  /** Deals damage to the target at the end of each of its turns as well. */
  | "damage_each_turn"
  /** No initial save; decided by the target's hit points. */
  | "hit_point_threshold"
  /** The condition ends on an event the engine does not track (damage, a shake, line of sight). */
  | "ends_on_event"
  /** Charmed has no mechanical reader in the engine yet. */
  | "charmed_unread"
  /** Affects creatures by a hit-point pool, not a saving throw. */
  | "hit_point_pool"
  /** Prone ends when the creature stands up, which is not modelled. */
  | "prone_stand_up"
  /** The caster chooses the effect (a command word, blind or deaf). */
  | "caster_choice"
  /** Applied to the caster or an ally, and ends when they attack. */
  | "self_or_ally"
  /** Several stages or several possible conditions. */
  | "multi_stage"
  /** Removes the target from the encounter. */
  | "removes_target";

/**
 * Spells in the cache that impose a condition and are not applied yet, with
 * the reason. Written down so the gap is a list somebody shortens on purpose,
 * not an absence nobody can see.
 */
export const DEFERRED_SPELL_CONDITIONS: Readonly<Record<string, DeferralReason>> = {
  "phantasmal-killer": "damage_each_turn",
  "power-word-stun": "hit_point_threshold",
  "blindness-deafness": "caster_choice",
  command: "caster_choice",
  fear: "ends_on_event",
  "hypnotic-pattern": "ends_on_event",
  "charm-person": "charmed_unread",
  "animal-friendship": "charmed_unread",
  "dominate-beast": "charmed_unread",
  "dominate-person": "charmed_unread",
  "dominate-monster": "charmed_unread",
  geas: "charmed_unread",
  "modify-memory": "charmed_unread",
  sleep: "hit_point_pool",
  "color-spray": "hit_point_pool",
  grease: "prone_stand_up",
  earthquake: "prone_stand_up",
  invisibility: "self_or_ally",
  "greater-invisibility": "self_or_ally",
  banishment: "removes_target",
  "flesh-to-stone": "multi_stage",
  contagion: "multi_stage",
  eyebite: "multi_stage",
  "divine-word": "multi_stage",
  symbol: "multi_stage",
  "prismatic-spray": "multi_stage",
  "prismatic-wall": "multi_stage",
  weird: "multi_stage",
  "storm-of-vengeance": "multi_stage",
};

/** The table row for an SRD spell index, or null when the spell applies none. */
export function spellConditionFor(spellIndex: unknown): SpellConditionEntry | null {
  if (typeof spellIndex !== "string") return null;
  return SPELL_CONDITIONS[spellIndex.trim().toLowerCase()] ?? null;
}

// ---------------------------------------------------------------------------
// Where a condition came from, and when it ends
// ---------------------------------------------------------------------------

/**
 * One condition a spell put on a creature, persisted in
 * `Combatant.spellConditions` beside the plain `conditions` list every rule
 * reads. The list says what holds; these records say why, so the engine can
 * take it off again.
 */
export interface SpellConditionRecord {
  condition: string;
  /** SRD index of the spell that applied it. */
  spellIndex: string;
  /** `Combatant.id` of the caster. */
  casterId: string;
  /** Ends when the caster's concentration ends. */
  concentration: boolean;
  /** Ends at the start of the caster's turn in this round. */
  endsAtRound: number;
  /**
   * The save the creature repeats to end it: at the end of each of its turns,
   * and on damage (with advantage) when `onDamage`. The DC is the caster's
   * spell save DC at the time of the cast. Absent when the spell allows none.
   */
  repeatSave?: { ability: Ability; dc: number; onDamage: boolean };
}

const ABILITIES: readonly string[] = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];

function isRepeatSave(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.ability === "string" &&
    ABILITIES.includes(r.ability) &&
    typeof r.dc === "number" &&
    Number.isFinite(r.dc) &&
    typeof r.onDamage === "boolean"
  );
}

function isRecord(value: unknown): value is SpellConditionRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    isRepeatSave(r.repeatSave) &&
    typeof r.condition === "string" &&
    typeof r.spellIndex === "string" &&
    typeof r.casterId === "string" &&
    typeof r.concentration === "boolean" &&
    typeof r.endsAtRound === "number" &&
    Number.isFinite(r.endsAtRound)
  );
}

/**
 * Reads `Combatant.spellConditions`. Only this module writes the column, so a
 * malformed entry is not expected; it is dropped rather than trusted, and the
 * test for this function says so.
 */
export function readSpellConditionRecords(value: unknown): SpellConditionRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/**
 * The records a successful cast adds for a creature: one per condition that
 * actually took hold (after immunities), never one per condition attempted.
 */
export function recordsForGrant(input: {
  granted: readonly string[];
  spellIndex: string;
  casterId: string;
  entry: Pick<SpellConditionEntry, "concentration" | "durationRounds">;
  round: number;
  /** The save a repeat roll uses; omitted when the spell allows no repeat. */
  repeatSave?: SpellConditionRecord["repeatSave"];
}): SpellConditionRecord[] {
  return input.granted.map((condition) => ({
    condition,
    spellIndex: input.spellIndex,
    casterId: input.casterId,
    concentration: input.entry.concentration,
    endsAtRound: input.round + input.entry.durationRounds,
    ...(input.repeatSave ? { repeatSave: input.repeatSave } : {}),
  }));
}

/**
 * One cast's hold on a creature: the records of a single spell from a single
 * caster. A repeat save is rolled once per hold, not once per condition —
 * Tasha's puts two conditions on its target and one save ends both.
 */
export interface SpellHold {
  spellIndex: string;
  casterId: string;
  repeatSave: NonNullable<SpellConditionRecord["repeatSave"]>;
}

/** The distinct holds on a creature that allow a repeat save. */
export function repeatableHolds(
  records: readonly SpellConditionRecord[],
  filter: (hold: SpellHold) => boolean = () => true
): SpellHold[] {
  const seen = new Map<string, SpellHold>();
  for (const r of records) {
    if (!r.repeatSave) continue;
    const key = `${r.casterId}\u0000${r.spellIndex}`;
    if (!seen.has(key)) {
      seen.set(key, { spellIndex: r.spellIndex, casterId: r.casterId, repeatSave: r.repeatSave });
    }
  }
  return [...seen.values()].filter(filter);
}

/** Selects every record of one hold. */
export function recordsOf(hold: Pick<SpellHold, "spellIndex" | "casterId">) {
  return (record: SpellConditionRecord) =>
    record.spellIndex === hold.spellIndex && record.casterId === hold.casterId;
}

/**
 * Whether a creature is simply unaffected by a condition spell — a legal
 * target the spell does nothing to (Hold Monster on undead, Tasha's on INT 4
 * or less). Unknown type counts as affected here; the route refuses a cast
 * whose outcome depends on an unknown type before it gets this far.
 */
export function isUnaffected(
  entry: Pick<SpellConditionEntry, "unaffectedTypes" | "unaffectedAtIntelligence">,
  target: { creatureType?: string | null; intelligence: number }
): boolean {
  const type = target.creatureType?.trim().toLowerCase();
  if (type && entry.unaffectedTypes?.some((t) => t === type)) return true;
  if (
    entry.unaffectedAtIntelligence !== undefined &&
    target.intelligence <= entry.unaffectedAtIntelligence
  ) {
    return true;
  }
  return false;
}

/**
 * Why a creature may not be targeted by a condition spell at all, or null
 * when it may. Refused before anything is spent (see the cast route).
 */
export function targetRefusal(
  entry: Pick<SpellConditionEntry, "onlyTypes" | "unaffectedTypes">,
  target: { name: string; creatureType?: string | null }
): string | null {
  const dependsOnType = Boolean(entry.onlyTypes?.length || entry.unaffectedTypes?.length);
  if (!dependsOnType) return null;
  const type = target.creatureType?.trim().toLowerCase();
  if (!type) return `${target.name}'s creature type is unknown, so this spell cannot be aimed at it.`;
  if (entry.onlyTypes && !entry.onlyTypes.includes(type)) {
    return `${target.name} is a ${type}; this spell can only target a ${entry.onlyTypes.join(" or ")}.`;
  }
  return null;
}

/**
 * Takes the records `shouldEnd` selects off a creature, and with them each
 * condition no remaining record still holds.
 *
 * Two spells restraining the same creature leave it restrained until both
 * end, which is why a condition is removed only when its last record goes. A
 * condition with no record at all did not come from a spell, so nothing here
 * removes it.
 */
export function endSpellConditionRecords(input: {
  conditions: readonly string[];
  records: readonly SpellConditionRecord[];
  shouldEnd: (record: SpellConditionRecord) => boolean;
}): {
  conditions: string[];
  records: SpellConditionRecord[];
  ended: SpellConditionRecord[];
} {
  const ended = input.records.filter(input.shouldEnd);
  const records = input.records.filter((r) => !input.shouldEnd(r));
  if (ended.length === 0) {
    return { conditions: [...input.conditions], records, ended };
  }

  const stillHeld = new Set(records.map((r) => r.condition.toLowerCase()));
  const endedConditions = new Set(ended.map((r) => r.condition.toLowerCase()));
  const conditions = input.conditions.filter((c) => {
    const key = c.toLowerCase();
    return !endedConditions.has(key) || stillHeld.has(key);
  });

  return { conditions, records, ended };
}
