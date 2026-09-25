import type { Prisma } from "@prisma/client";
import { extractConditions } from "@/lib/rules/combat";
import {
  endSpellConditionRecords,
  readSpellConditionRecords,
  type SpellConditionRecord,
} from "@/lib/rules/spell-conditions";

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
    shouldEnd: (record: SpellConditionRecord) => boolean;
    /** Why they end, for the log: "concentration ended", "duration expired". */
    reason: string;
  }
): Promise<EndedSpellConditions[]> {
  const rows = (await tx.combatant.findMany({
    where: { encounterId: input.encounterId },
    select: { id: true, name: true, conditions: true, spellConditions: true },
  })) as Array<{ id: string; name: string; conditions: unknown; spellConditions: unknown }>;

  const out: EndedSpellConditions[] = [];
  for (const row of rows ?? []) {
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
