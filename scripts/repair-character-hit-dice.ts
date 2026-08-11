#!/usr/bin/env tsx
/**
 * scripts/repair-character-hit-dice.ts
 *
 * CLI that diagnoses and repairs unambiguous Character hit-dice states.
 * Orchestration only — every classification decision comes from
 * classifyHitDiceIntegrity (lib/rules/hit-dice-integrity.ts), the single
 * mechanical authority for this contract. This file does not reimplement
 * XP thresholds, level rules, or hit-dice rules.
 *
 * Dry-run by default. Nothing is ever written without an explicit --apply.
 *
 * Usage:
 *   pnpm repair:hit-dice                        (dry-run, all characters)
 *   pnpm repair:hit-dice --dry-run               (explicit dry-run)
 *   pnpm repair:hit-dice --apply                 (write, all characters)
 *   pnpm repair:hit-dice --character-id <id>      (scope, dry-run)
 *   pnpm repair:hit-dice --character-id <id> --apply
 *
 * Atomicity: --apply rereads and reclassifies its whole scope inside a
 * single prisma.$transaction. If any row is AMBIGUOUS or
 * INVALID_PROGRESSION, the transaction commits with zero writes — the
 * classification itself never mutates anything, only the loop below
 * conditionally calls update. Only REPAIRABLE rows are ever updated, and
 * only with the patch classifyHitDiceIntegrity produced for that row.
 */

import { pathToFileURL } from "node:url";
import {
  classifyHitDiceIntegrity,
  type HitDiceIntegrityPatch,
  type HitDiceIntegrityReasonCode,
  type HitDiceIntegrityStatus,
} from "../lib/rules/hit-dice-integrity";

// ---------------------------------------------------------------------------
// Injectable DB surface — mirrors the minimal-select convention used across
// lib/rules/*-service.ts, so tests never need a real PostgreSQL connection.
// ---------------------------------------------------------------------------

export interface HitDiceCharacterRow {
  id: string;
  xp: number;
  level: number;
  hitDiceTotal: number;
  hitDiceRemaining: number;
}

export interface HitDiceRepairTx {
  character: {
    findMany(args: {
      where?: { id?: string };
      select: Record<string, boolean>;
    }): Promise<HitDiceCharacterRow[]>;
    update(args: {
      where: { id: string };
      data: HitDiceIntegrityPatch;
    }): Promise<unknown>;
  };
}

export interface HitDiceRepairDb extends HitDiceRepairTx {
  $transaction<T>(fn: (tx: HitDiceRepairTx) => Promise<T>): Promise<T>;
}

const SELECT = {
  id: true,
  xp: true,
  level: true,
  hitDiceTotal: true,
  hitDiceRemaining: true,
} as const;

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

export interface HitDiceRepairRowReport {
  characterId: string;
  status: HitDiceIntegrityStatus;
  reason: HitDiceIntegrityReasonCode;
  /** Only present for REPAIRABLE rows; the fields that would (or did) change. */
  patch?: HitDiceIntegrityPatch;
}

export type HitDiceRepairCounts = Record<HitDiceIntegrityStatus, number>;

export interface HitDiceRepairReport {
  rows: HitDiceRepairRowReport[];
  counts: HitDiceRepairCounts;
  /** true when any row is AMBIGUOUS or INVALID_PROGRESSION — write is refused. */
  blocked: boolean;
  /** true when this run actually issued updates. */
  applied: boolean;
  updatedCount: number;
  /**
   * 0 = nothing to repair; 1 = blocked by AMBIGUOUS/INVALID_PROGRESSION;
   * 2 = REPAIRABLE rows exist but this was a dry-run.
   */
  resultCode: 0 | 1 | 2;
}

function emptyCounts(): HitDiceRepairCounts {
  return {
    VALID_SETTLED: 0,
    VALID_PENDING: 0,
    REPAIRABLE: 0,
    AMBIGUOUS: 0,
    INVALID_PROGRESSION: 0,
  };
}

async function classifyScope(
  tx: HitDiceRepairTx,
  characterId: string | undefined
): Promise<HitDiceRepairRowReport[]> {
  const rows = await tx.character.findMany({
    where: characterId ? { id: characterId } : undefined,
    select: SELECT,
  });

  return rows.map((row) => {
    const result = classifyHitDiceIntegrity(row);
    return {
      characterId: row.id,
      status: result.status,
      reason: result.reason,
      patch: result.patch,
    };
  });
}

function summarize(rows: HitDiceRepairRowReport[]): {
  counts: HitDiceRepairCounts;
  blocked: boolean;
} {
  const counts = emptyCounts();
  for (const row of rows) {
    counts[row.status] += 1;
  }
  const blocked = counts.AMBIGUOUS > 0 || counts.INVALID_PROGRESSION > 0;
  return { counts, blocked };
}

// ---------------------------------------------------------------------------
// Testable core — no CLI parsing, no process.exit, no real Prisma import.
// ---------------------------------------------------------------------------

export interface RunHitDiceRepairInput {
  db: HitDiceRepairDb;
  apply: boolean;
  characterId?: string;
}

export async function runHitDiceRepair(
  input: RunHitDiceRepairInput
): Promise<HitDiceRepairReport> {
  const { db, apply, characterId } = input;

  if (!apply) {
    const rows = await classifyScope(db, characterId);
    const { counts, blocked } = summarize(rows);
    const resultCode = blocked ? 1 : counts.REPAIRABLE > 0 ? 2 : 0;
    return { rows, counts, blocked, applied: false, updatedCount: 0, resultCode };
  }

  return db.$transaction(async (tx) => {
    // Reread and reclassify inside the transaction — never trust a
    // classification made outside it.
    const rows = await classifyScope(tx, characterId);
    const { counts, blocked } = summarize(rows);

    if (blocked) {
      // Abort before any write. Nothing has been mutated, so there is
      // nothing to roll back — the transaction commits an empty no-op.
      return { rows, counts, blocked: true, applied: false, updatedCount: 0, resultCode: 1 };
    }

    const repairable = rows.filter((row) => row.status === "REPAIRABLE");
    for (const row of repairable) {
      await tx.character.update({ where: { id: row.characterId }, data: row.patch! });
    }

    return {
      rows,
      counts,
      blocked: false,
      applied: repairable.length > 0,
      updatedCount: repairable.length,
      resultCode: 0,
    };
  });
}

// ---------------------------------------------------------------------------
// CLI argument parsing — pure, no I/O.
// ---------------------------------------------------------------------------

export interface ParsedArgs {
  apply: boolean;
  characterId?: string;
}

export type ParseArgsResult =
  | { ok: true; args: ParsedArgs }
  | { ok: false; error: string };

export function parseArgs(argv: string[]): ParseArgsResult {
  let dryRun = false;
  let apply = false;
  let characterId: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--apply") {
      apply = true;
    } else if (arg === "--character-id") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        return { ok: false, error: "--character-id requires a value." };
      }
      characterId = value;
      i += 1;
    } else {
      return { ok: false, error: `Unknown argument: ${arg}` };
    }
  }

  if (dryRun && apply) {
    return { ok: false, error: "--dry-run and --apply are mutually exclusive." };
  }

  return { ok: true, args: { apply, characterId } };
}

// ---------------------------------------------------------------------------
// Reporting (console only — no side effects on data).
// ---------------------------------------------------------------------------

function printReport(report: HitDiceRepairReport, apply: boolean): void {
  console.log(`Rows scanned: ${report.rows.length}`);
  console.log(
    `  VALID_SETTLED=${report.counts.VALID_SETTLED} ` +
      `VALID_PENDING=${report.counts.VALID_PENDING} ` +
      `REPAIRABLE=${report.counts.REPAIRABLE} ` +
      `AMBIGUOUS=${report.counts.AMBIGUOUS} ` +
      `INVALID_PROGRESSION=${report.counts.INVALID_PROGRESSION}`
  );

  for (const row of report.rows) {
    if (row.status === "REPAIRABLE") {
      console.log(`  [REPAIRABLE] ${row.characterId}: ${JSON.stringify(row.patch)}`);
    } else if (row.status === "AMBIGUOUS" || row.status === "INVALID_PROGRESSION") {
      console.log(`  [${row.status}] ${row.characterId}: ${row.reason}`);
    }
  }

  if (report.blocked) {
    console.error(
      "\nBlocked: AMBIGUOUS or INVALID_PROGRESSION rows present. No writes performed."
    );
    return;
  }

  if (!apply) {
    if (report.counts.REPAIRABLE > 0) {
      console.log(`\nDry-run: ${report.counts.REPAIRABLE} row(s) would be repaired. Re-run with --apply to write.`);
    } else {
      console.log("\nDry-run: nothing to repair.");
    }
    return;
  }

  console.log(`\nApplied: ${report.updatedCount} row(s) updated.`);
}

// ---------------------------------------------------------------------------
// CLI entrypoint — only runs when this file is executed directly, never on
// import (tests import runHitDiceRepair/parseArgs without touching Prisma).
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exitCode = 1;
    return;
  }

  const { prisma } = await import("../lib/db/prisma");
  const report = await runHitDiceRepair({
    db: prisma as unknown as HitDiceRepairDb,
    apply: parsed.args.apply,
    characterId: parsed.args.characterId,
  });

  printReport(report, parsed.args.apply);
  process.exitCode = report.resultCode;
}

const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
