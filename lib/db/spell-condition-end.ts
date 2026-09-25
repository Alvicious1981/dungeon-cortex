import type { Prisma } from "@prisma/client";
import { extractConditions } from "@/lib/rules/combat";
import {
  endSpellConditionRecords,
  readSpellConditionRecords,
  recordsOf,
  repeatableHolds,
  type SpellConditionRecord,
} from "@/lib/rules/spell-conditions";
import { abilityModifier } from "@/lib/rules/dice";
import { resolveSavingThrow } from "@/lib/rules/combat";
import { autoFailsSave } from "@/lib/rules/conditions";
import type { Ability } from "@/lib/rules/ability-check";

const ABILITY_NAME: Record<Ability, string> = {
  STR: "Strength", DEX: "Dexterity", CON: "Constitution",
  INT: "Intelligence", WIS: "Wisdom", CHA: "Charisma",
};

/**
 * Takes spell-imposed conditions off every creature in an encounter when what
 * held them ends: the caster's concentration, or the spell's duration.
 *
 * Until this existed a condition, once written, stayed for the whole fight:
 * `removeCondition` had no caller. That was harmless only because no spell
 * applied one.
 *
 * Callers hold the Character row lock (every combat writer for an encounter
 * takes it first — see lockCharacterForCombatAction), so the read below and
 * the writes after it cannot interleave with another action's writes to the
 * same rows.
 *
 * Returns one entry per creature that lost a record: its conditions as now
 * written, and a system-log line for the caller to publish the way it
 * publishes its other system lines. Nothing is returned, and nothing written,
 * when no record matches.
 */
export async function endSpellConditions(
  tx: Prisma.TransactionClient,
  input: {
    encounterId: string;
    /** Only this creature's records; all of the encounter's when absent. */
    combatantId?: string;
    shouldEnd: (record: SpellConditionRecord) => boolean;
    /** Why they end, for the log: "concentration ended", "duration expired". */
    reason: string;
  }
): Promise<EndedSpellConditions[]> {
  const rows = (await tx.combatant.findMany({
    where: {
      encounterId: input.encounterId,
      ...(input.combatantId ? { id: input.combatantId } : {}),
    },
    select: { id: true, name: true, conditions: true, spellConditions: true },
  })) as Array<{ id: string; name: string; conditions: unknown; spellConditions: unknown }>;

  const out: EndedSpellConditions[] = [];
  for (const row of rows ?? []) {
    if (input.combatantId && row.id !== input.combatantId) continue;
    const records = readSpellConditionRecords(row.spellConditions);
    if (records.length === 0) continue;

    const before = extractConditions(row.conditions);
    const result = endSpellConditionRecords({
      conditions: before,
      records,
      shouldEnd: input.shouldEnd,
    });
    if (result.ended.length === 0) continue;

    await tx.combatant.update({
      where: { id: row.id },
      data: {
        conditions: result.conditions,
        spellConditions: result.records as unknown as Prisma.InputJsonValue,
      },
    });

    const lifted = before.filter((c) => !result.conditions.includes(c));
    const spells = [...new Set(result.ended.map((r) => r.spellIndex))].join(", ");
    out.push({
      combatantId: row.id,
      conditions: result.conditions,
      log:
        lifted.length > 0
          ? `${row.name} is no longer ${lifted.join(", ")}: ${spells} — ${input.reason}.`
          : `${spells} no longer holds ${row.name} (${input.reason}); another effect still does.`,
    });
  }
  return out;
}

export interface EndedSpellConditions {
  combatantId: string;
  /** The creature's `conditions` as written after the records ended. */
  conditions: string[];
  log: string;
}

/** The records that end with a caster's concentration. */
export function concentrationOf(casterId: string) {
  return (record: SpellConditionRecord) => record.concentration && record.casterId === casterId;
}

/** The records of a caster whose duration has run out by `round`. */
export function expiredFor(casterId: string, round: number) {
  return (record: SpellConditionRecord) => record.casterId === casterId && record.endsAtRound <= round;
}

/**
 * A held creature's repeat saves (SRD: "at the end of each of its turns, the
 * target can make another saving throw… On a success, the spell ends on the
 * target"; Tasha's adds "and each time it takes damage", with advantage).
 *
 * One roll per hold — per spell and caster — not per condition: a success on
 * Tasha's ends both its prone and its incapacitated. The DC is the one stored
 * on the record at the cast. A paralyzed creature still rolls a Wisdom save
 * normally; only Strength and Dexterity saves fail automatically.
 */
export async function rollRepeatSaves(
  tx: Prisma.TransactionClient,
  input: { encounterId: string; combatantId: string; trigger: "end_of_turn" | "damage" }
): Promise<{ logs: string[]; ended: EndedSpellConditions[] }> {
  const rows = (await tx.combatant.findMany({
    where: { encounterId: input.encounterId, id: input.combatantId },
    select: { id: true, name: true, stats: true, conditions: true, spellConditions: true },
  })) as Array<{ id: string; name: string; stats: unknown; conditions: unknown; spellConditions: unknown }>;
  const row = (rows ?? []).find((r) => r.id === input.combatantId);
  if (!row) return { logs: [], ended: [] };

  const holds = repeatableHolds(
    readSpellConditionRecords(row.spellConditions),
    (hold) => input.trigger === "end_of_turn" || hold.repeatSave.onDamage
  );
  const logs: string[] = [];
  const ended: EndedSpellConditions[] = [];
  const stats = (row.stats ?? {}) as Record<string, number>;
  const conditions = extractConditions(row.conditions);

  for (const hold of holds) {
    const { ability, dc } = hold.repeatSave;
    const withAdvantage = input.trigger === "damage";
    let total: number;
    let success: boolean;
    if (autoFailsSave(conditions, ability)) {
      total = 0;
      success = false;
    } else {
      const save = resolveSavingThrow(abilityModifier(stats[ability] ?? 10), dc, withAdvantage);
      total = save.total;
      success = save.success;
    }
    logs.push(
      `${row.name} repeats the ${ABILITY_NAME[ability]} save against ${hold.spellIndex}` +
        `${withAdvantage ? " (advantage, took damage)" : ""}: ${total} vs DC ${dc} — ` +
        `${success ? "the spell ends on it" : "still held"}.`
    );
    if (!success) continue;

    const result = await endSpellConditions(tx, {
      encounterId: input.encounterId,
      combatantId: row.id,
      shouldEnd: recordsOf(hold),
      reason: "saved",
    });
    ended.push(...result);
    logs.push(...result.map((e) => e.log));
  }
  return { logs, ended };
}
