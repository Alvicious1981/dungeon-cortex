/**
 * tests/architecture/encounter-resolution-authority.test.ts
 *
 * docs/DECISION_XP_AWARD_AUTHORITY.md §10: every mechanical transition of an
 * Encounter to "resolved" must go through the authorized backend finalizer
 * (finalizeEncounterTurn, lib/rules/combat-pipeline.ts) — the single claim +
 * award producer. No other production code path may write
 * `status: "resolved"` directly; doing so would bypass the idempotent claim
 * and permanently consume the encounter's claimable state without ever
 * evaluating the XP award.
 *
 * This fence scans production source (app/, lib/) outside that module for
 * any direct `status: "resolved"` write, following the pattern of this
 * repository's `tests/architecture/*-no-direct-prisma.test.ts` suite.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "lib"];
const AUTHORIZED_FILE = join("lib", "rules", "combat-pipeline.ts");
const EXCLUDED_DIR_NAMES = new Set(["node_modules", ".next"]);
const SOURCE_EXTENSIONS = [".ts", ".tsx"];

function collectSourceFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIR_NAMES.has(entry)) continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      collectSourceFiles(fullPath, files);
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      files.push(fullPath);
    }
  }
  return files;
}

const RESOLVED_STATUS_WRITE = /status\s*:\s*["']resolved["']/;

describe("Encounter resolution authority (docs/DECISION_XP_AWARD_AUTHORITY.md §10)", () => {
  const productionFiles = SCAN_DIRS.flatMap((dir) => collectSourceFiles(join(ROOT, dir))).filter(
    (file) => relative(ROOT, file) !== AUTHORIZED_FILE
  );

  it("scans a non-trivial number of production files, so an empty scan can't pass silently", () => {
    expect(productionFiles.length).toBeGreaterThan(50);
  });

  it("sanity check: the authorized finalizer does contain the pattern this fence looks for", () => {
    const source = readFileSync(join(ROOT, AUTHORIZED_FILE), "utf8");
    expect(source).toMatch(RESOLVED_STATUS_WRITE);
  });

  it('no production file outside lib/rules/combat-pipeline.ts writes Encounter status: "resolved" directly', () => {
    const offenders = productionFiles
      .filter((file) => RESOLVED_STATUS_WRITE.test(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT, file));

    expect(offenders).toEqual([]);
  });
});
