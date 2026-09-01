import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * `NPCRoster.tsx` carried its own copy of the disposition-banding rule
 * (`getDispositionBand`), duplicated from `lib/rules/social-logic.ts`'s
 * `attitudeFor`. The UI is supposed to render mechanical truth, not
 * recompute it — a second copy is how the two come to disagree silently.
 *
 * The first assertion is what stops `attitudeFor` itself from spreading to a
 * second module. The second is what stops the old five-band function
 * (`getDispositionBand`) from being pasted back into a component now that
 * the UI has been moved onto `attitudeFor`.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".next") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith(".ts") || name.endsWith(".tsx") ? [path] : [];
  });
}

const ROOTS = ["app", "lib", "components"].map((dir) =>
  join(process.cwd(), dir),
);

/**
 * Every source file, read once at module load rather than inside each test.
 *
 * Reading two hundred files is fast on an idle machine and slow on a busy
 * one, and inside a test that difference is the gap between passing and
 * exceeding the five-second budget — this file failed that way three times
 * in one session while guarding code that had not changed. Module-level work
 * happens during import, which no per-test timeout bounds, so the flake goes
 * away instead of merely becoming less likely.
 */
const SOURCES: ReadonlyArray<readonly [string, string]> = ROOTS.flatMap(
  sourceFiles,
).map((path) => [path, readFileSync(path, "utf8")] as const);

/** Repo-relative and forward-slashed, so the assertion reads the same on Windows. */
function relative(path: string): string {
  return path.replace(process.cwd(), "").replace(/\\/g, "/");
}

describe("one banding rule", () => {
  it("defines attitudeFor in exactly one module", () => {
    const definers = SOURCES.filter(([, text]) =>
      /function\s+attitudeFor\s*\(/.test(text),
    ).map(([path]) => relative(path));

    expect(definers).toEqual(["/lib/rules/social-logic.ts"]);
  });

  it("leaves no second copy of the old banding thresholds in the UI", () => {
    const copies = SOURCES.filter(
      ([path, text]) =>
        relative(path).startsWith("/components/") &&
        /function\s+getDispositionBand/.test(text),
    ).map(([path]) => relative(path));

    expect(copies).toEqual([]);
  });
});

describe("retired dialogue frames", () => {
  it("leaves no reference to a frame type nothing emits", () => {
    const survivors = SOURCES.filter(([, text]) =>
      /dialogue_open|dungeon-dialogue-open|dialogue_update|dungeon-dialogue-update/.test(text),
    ).map(([path]) => relative(path));

    expect(survivors).toEqual([]);
  });
});
