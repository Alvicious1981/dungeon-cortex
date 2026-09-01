import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The equipment lookup existed twice, so the defect existed twice. A test is
 * what stops it coming back as a third copy.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith(".ts") || name.endsWith(".tsx") ? [path] : [];
  });
}

const ROOTS = ["lib", "app", "components", "scripts", "prisma"].map((dir) =>
  join(process.cwd(), dir),
);
/**
 * Every source file, read once at module load rather than inside each test.
 *
 * Reading the tree is fast on an idle machine and slow on a busy one, and
 * inside a test that difference is the gap between passing and exceeding the
 * five-second budget — this file failed that way in a session while guarding
 * code that had not changed. Module-level work happens during import, which
 * no per-test timeout bounds, so the flake goes away instead of merely
 * becoming less likely.
 */
const SOURCES: ReadonlyArray<readonly [string, string]> = ROOTS.flatMap(
  sourceFiles,
).map((path) => [path, readFileSync(path, "utf8")] as const);

/** Repo-relative and forward-slashed, so the assertion reads the same on Windows. */
function relative(path: string): string {
  return path.replace(process.cwd(), "").replace(/\\/g, "/");
}

describe("SRD equipment lookup architecture", () => {
  it("defines the equipment query in exactly one module", () => {
    const definers = SOURCES.filter(([, text]) =>
      /export\s+async\s+function\s+getEquipmentInfo\s*\(/.test(text),
    ).map(([path]) => relative(path));

    expect(definers).toEqual(["/lib/rules/srd-equipment-lookup.ts"]);
  });

  it("has no source that reads or writes the empty SrdEquipment table", () => {
    const users = SOURCES.filter(([, text]) =>
      /\bprisma\.srdEquipment\b/.test(text),
    ).map(([path]) => relative(path));

    expect(users).toEqual([]);
  });

  it("keeps the AI tool module's equipment surface without redefining it", () => {
    const source = readFileSync(
      join(process.cwd(), "lib", "ai", "tools", "srd-lookup.ts"),
      "utf8",
    );

    expect(source).toContain("getEquipmentInfo");
    expect(source).toMatch(
      /from\s+["']@\/lib\/rules\/srd-equipment-lookup["']/,
    );
  });
});
