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
const SOURCES = ROOTS.flatMap(sourceFiles);

describe("one banding rule", () => {
  it("defines attitudeFor in exactly one module", () => {
    const definers = SOURCES.filter((path) =>
      /function\s+attitudeFor\s*\(/.test(readFileSync(path, "utf8")),
    ).map((path) => path.replace(process.cwd(), "").replace(/\\/g, "/"));

    expect(definers).toEqual(["/lib/rules/social-logic.ts"]);
  });

  it("leaves no second copy of the old banding thresholds in the UI", () => {
    const components = sourceFiles(join(process.cwd(), "components"));
    for (const file of components) {
      expect(readFileSync(file, "utf8")).not.toMatch(
        /function\s+getDispositionBand/,
      );
    }
  });
});
