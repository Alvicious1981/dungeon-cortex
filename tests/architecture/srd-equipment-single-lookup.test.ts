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
const SOURCES = ROOTS.flatMap(sourceFiles);

describe("SRD equipment lookup architecture", () => {
  it("defines the equipment query in exactly one module", () => {
    const definers = SOURCES.filter((path) =>
      /export\s+async\s+function\s+getEquipmentInfo\s*\(/.test(
        readFileSync(path, "utf8"),
      ),
    ).map((path) => path.replace(process.cwd(), "").replace(/\\/g, "/"));

    expect(definers).toEqual(["/lib/rules/srd-equipment-lookup.ts"]);
  });

  it("has no source that reads or writes the empty SrdEquipment table", () => {
    const users = SOURCES.filter((path) =>
      /\bprisma\.srdEquipment\b/.test(readFileSync(path, "utf8")),
    ).map((path) => path.replace(process.cwd(), "").replace(/\\/g, "/"));

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
