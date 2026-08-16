#!/usr/bin/env tsx
/**
 * scripts/diagnose-model-e-transition.ts
 *
 * READ-ONLY CLI that diagnoses which Character rows are compatible with,
 * convertible to, or blocking the Model E progression transition.
 *
 * Orchestration only — every classification decision comes from
 * classifyModelETransition (lib/rules/model-e-transition.ts), the single
 * mechanical authority for this contract. This file does not reimplement
 * classification, conversion rules, XP thresholds, or hit-dice rules.
 *
 * This tool cannot write. Its injectable DB surface exposes only
 * `character.findMany` — no update, updateMany, create, delete,
 * $executeRaw, $queryRaw, or $transaction. Nothing in this module can
 * mutate a Character row even by mistake.
 *
 * Usage:
 *   pnpm diagnose:model-e                        (all characters)
 *   pnpm diagnose:model-e --character-id <id>     (single character)
 */

import { pathToFileURL } from "node:url";
import {
  classifyModelETransition,
  type ModelETransitionCategory,
  type ModelETransitionPatch,
  type ModelETransitionReasonCode,
} from "../lib/rules/model-e-transition";

// ---------------------------------------------------------------------------
// Injectable DB surface — read-only by construction. Mirrors the minimal-
// select convention used across lib/rules/*-service.ts and
// scripts/repair-character-hit-dice.ts, so tests never need a real
// PostgreSQL connection and this module can never issue a write.
// ---------------------------------------------------------------------------

export interface ModelETransitionCharacterRow {
  id: string;
  xp: number;
  level: number;
  hitDiceTotal: number;
  hitDiceRemaining: number;
}

export interface ModelEDiagnosisDb {
  character: {
    findMany(args: {
      where?: { id?: string };
      select: Record<string, boolean>;
    }): Promise<ModelETransitionCharacterRow[]>;
  };
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

export interface ModelETransitionConvertibleRow {
  characterId: string;
  category: "CONVERTIBLE";
  reason: ModelETransitionReasonCode;
  level: number;
  targetLevel: number;
  hitDiceTotal: number;
  pendingLevels: number;
  /** Conceptual only — never executed by this tool. */
  patch: ModelETransitionPatch;
}

export interface ModelETransitionBlockingRow {
  characterId: string;
  category: Extract<
    ModelETransitionCategory,
    "AMBIGUOUS" | "INVALID_PROGRESSION" | "INVALID_HIT_DICE"
  >;
  reason: ModelETransitionReasonCode;
  xp: number;
  level: number;
  hitDiceTotal: number;
  hitDiceRemaining: number;
}

export type ModelETransitionCounts = Record<ModelETransitionCategory, number>;

export interface ModelETransitionReport {
  counts: ModelETransitionCounts;
  totals: {
    inspected: number;
    /** E_SETTLED + E_PENDING — already compatible, nothing to write. */
    compatibleNoWrite: number;
    convertible: number;
    blocking: number;
  };
  /**
   * E_PENDING is a valid Model E state, but no authorized backend sequence
   * under the OLD contract produces it (see model-e-transition.ts). A
   * non-zero count here is not a blocker and not a write, but it is a
   * historically unexpected signal that deserves human review before the
   * cut, so it is surfaced explicitly rather than folded into the totals.
   */
  pendingReview: {
    ePendingCount: number;
  };
  convertibleRows: ModelETransitionConvertibleRow[];
  blockingRows: ModelETransitionBlockingRow[];
  /**
   * 0 = nothing blocking and nothing convertible;
   * 1 = at least one AMBIGUOUS / INVALID_PROGRESSION / INVALID_HIT_DICE row;
   * 2 = no blockers, but at least one CONVERTIBLE row.
   * Precedence: 1 > 2 > 0. E_PENDING never changes this code.
   */
  resultCode: 0 | 1 | 2;
}

function emptyCounts(): ModelETransitionCounts {
  return {
    E_SETTLED: 0,
    E_PENDING: 0,
    CONVERTIBLE: 0,
    AMBIGUOUS: 0,
    INVALID_PROGRESSION: 0,
    INVALID_HIT_DICE: 0,
  };
}

const BLOCKING_CATEGORIES = new Set<ModelETransitionCategory>([
  "AMBIGUOUS",
  "INVALID_PROGRESSION",
  "INVALID_HIT_DICE",
]);

function isBlockingCategory(
  category: ModelETransitionCategory
): category is ModelETransitionBlockingRow["category"] {
  return BLOCKING_CATEGORIES.has(category);
}

// ---------------------------------------------------------------------------
// Testable core — no CLI parsing, no process.exit, no real Prisma import.
// ---------------------------------------------------------------------------

export interface RunModelETransitionDiagnosisInput {
  db: ModelEDiagnosisDb;
  characterId?: string;
}

export async function runModelETransitionDiagnosis(
  input: RunModelETransitionDiagnosisInput
): Promise<ModelETransitionReport> {
  const { db, characterId } = input;

  const rows = await db.character.findMany({
    where: characterId ? { id: characterId } : undefined,
    select: SELECT,
  });

  const counts = emptyCounts();
  const convertibleRows: ModelETransitionConvertibleRow[] = [];
  const blockingRows: ModelETransitionBlockingRow[] = [];

  for (const row of rows) {
    const result = classifyModelETransition(row);
    counts[result.category] += 1;

    if (result.category === "CONVERTIBLE") {
      // classifyModelETransition guarantees patch/targetLevel/pendingLevels
      // are present for CONVERTIBLE — asserted here only to satisfy the
      // compiler, never to alter the classification.
      convertibleRows.push({
        characterId: row.id,
        category: "CONVERTIBLE",
        reason: result.reason,
        level: row.level,
        targetLevel: result.targetLevel!,
        hitDiceTotal: row.hitDiceTotal,
        pendingLevels: result.pendingLevels!,
        patch: result.patch!,
      });
    } else if (isBlockingCategory(result.category)) {
      blockingRows.push({
        characterId: row.id,
        category: result.category,
        reason: result.reason,
        xp: row.xp,
        level: row.level,
        hitDiceTotal: row.hitDiceTotal,
        hitDiceRemaining: row.hitDiceRemaining,
      });
    }
  }

  const compatibleNoWrite = counts.E_SETTLED + counts.E_PENDING;
  const convertible = counts.CONVERTIBLE;
  const blocking = blockingRows.length;

  const resultCode: 0 | 1 | 2 = blocking > 0 ? 1 : convertible > 0 ? 2 : 0;

  return {
    counts,
    totals: {
      inspected: rows.length,
      compatibleNoWrite,
      convertible,
      blocking,
    },
    pendingReview: {
      ePendingCount: counts.E_PENDING,
    },
    convertibleRows,
    blockingRows,
    resultCode,
  };
}

// ---------------------------------------------------------------------------
// CLI argument parsing — pure, no I/O.
// ---------------------------------------------------------------------------

const KNOWN_WRITE_FLAGS = new Set(["--apply", "--write", "--repair", "--force"]);

export interface ParsedArgs {
  characterId?: string;
}

export type ParseArgsResult =
  | { ok: true; args: ParsedArgs }
  | { ok: false; error: string };

export function parseArgs(argv: string[]): ParseArgsResult {
  let characterId: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--character-id") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        return { ok: false, error: "--character-id requires a value." };
      }
      characterId = value;
      i += 1;
      continue;
    }

    if (KNOWN_WRITE_FLAGS.has(arg)) {
      return {
        ok: false,
        error: `${arg} is not supported: this tool is read-only and cannot write or repair data.`,
      };
    }

    return { ok: false, error: `Unknown argument: ${arg}` };
  }

  return { ok: true, args: { characterId } };
}

// ---------------------------------------------------------------------------
// Reporting (console only — no side effects on data).
// ---------------------------------------------------------------------------

function printReport(report: ModelETransitionReport): void {
  console.log(`Rows inspected: ${report.totals.inspected}`);
  console.log(
    `  E_SETTLED=${report.counts.E_SETTLED} ` +
      `E_PENDING=${report.counts.E_PENDING} ` +
      `CONVERTIBLE=${report.counts.CONVERTIBLE} ` +
      `AMBIGUOUS=${report.counts.AMBIGUOUS} ` +
      `INVALID_PROGRESSION=${report.counts.INVALID_PROGRESSION} ` +
      `INVALID_HIT_DICE=${report.counts.INVALID_HIT_DICE}`
  );
  console.log(
    `  compatible (no write)=${report.totals.compatibleNoWrite} ` +
      `convertible=${report.totals.convertible} ` +
      `blocking=${report.totals.blocking}`
  );

  if (report.pendingReview.ePendingCount > 0) {
    console.log(
      `\nE_PENDING: ${report.pendingReview.ePendingCount} row(s) are valid under Model E ` +
        `(XP ahead of applied level) but no authorized sequence under the OLD contract ` +
        `produces this state. Not a blocker, not a write — flagged for human review before the cut.`
    );
  }

  if (report.convertibleRows.length > 0) {
    console.log(`\nCONVERTIBLE (diagnosis only — no patch is executed):`);
    for (const row of report.convertibleRows) {
      console.log(
        `  ${row.characterId}: ${row.category}/${row.reason} ` +
          `level=${row.level} targetLevel=${row.targetLevel} hitDiceTotal=${row.hitDiceTotal} ` +
          `pendingLevels=${row.pendingLevels} patch=${JSON.stringify(row.patch)}`
      );
    }
  }

  if (report.blockingRows.length > 0) {
    console.log(`\nBlocking rows:`);
    for (const row of report.blockingRows) {
      console.log(
        `  ${row.characterId}: ${row.category}/${row.reason} ` +
          `xp=${row.xp} level=${row.level} hitDiceTotal=${row.hitDiceTotal} ` +
          `hitDiceRemaining=${row.hitDiceRemaining}`
      );
    }
  }

  console.log(`\nresultCode=${report.resultCode}`);
}

// ---------------------------------------------------------------------------
// CLI entrypoint — only runs when this file is executed directly, never on
// import (tests import runModelETransitionDiagnosis/parseArgs without
// touching Prisma).
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exitCode = 1;
    return;
  }

  const { prisma } = await import("../lib/db/prisma");
  const report = await runModelETransitionDiagnosis({
    db: prisma as unknown as ModelEDiagnosisDb,
    characterId: parsed.args.characterId,
  });

  printReport(report);
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
