import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Combatant.attackProfile has exactly one writer and one reader
 * (docs/superpowers/specs/2026-09-15-enemy-turns-design.md §9.4): the
 * encounter route snapshots it at creation, and the enemy-turn transition reads
 * it at turn time. A column only one side touches is the dormant-defect shape
 * AGENTS.md describes, so both ends are bound here.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith(".ts") || name.endsWith(".tsx") ? [path] : [];
  });
}

/** Read once at module load: a busy machine must not push this past a test timeout. */
const SOURCES: ReadonlyArray<readonly [string, string]> = ["lib", "app"]
  .flatMap((dir) => sourceFiles(join(process.cwd(), dir)))
  .map((path) => [path.replace(process.cwd(), "").replace(/\\/g, "/"), readFileSync(path, "utf8")] as const);

describe("Combatant.attackProfile has both ends", () => {
  it("is written only by the encounter route", () => {
    // Case-sensitive on purpose: the route's local `srdAttackProfile` is not a
    // write of the column, and must not read as one.
    const writers = SOURCES.filter(([, s]) => /\battackProfile\s*:/.test(s)).map(([p]) => p);

    expect(writers).toEqual(["/app/api/campaign/[id]/encounter/route.ts"]);
  });

  it("is read only by the enemy-turn transition", () => {
    const readers = SOURCES.filter(([, s]) => /\.attackProfile\b/.test(s)).map(([p]) => p);

    expect(readers).toEqual(["/lib/db/enemy-turn-transition.ts"]);
  });
});
