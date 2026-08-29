import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The monster query existed twice, exactly as the equipment lookup once did:
 * `lib/rules/srd-monster-lookup.ts` projects the four damage and condition
 * modifier columns, and the copy in the AI tool module selected all four and
 * dropped every one. Nothing imported the copy, so it was inert — which is how
 * it survived the increment that fixed the projection in the other file.
 *
 * The first assertion is what stops it coming back as a third copy. The second
 * is why the file it lived in cannot quietly accumulate another: the AI tool
 * module's exported surface is written down, so adding to it is a line somebody
 * changes on purpose.
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

const SRD_LOOKUP = join(process.cwd(), "lib", "ai", "tools", "srd-lookup.ts");

/**
 * Every name the module exports: declarations first, then the re-export lists.
 * Deliberately textual — the point is to notice a symbol appearing in the file,
 * which is a property of the source, not of what the bundler resolves.
 */
function exportedNames(source: string): string[] {
  const declared = [
    ...source.matchAll(
      /export\s+(?:async\s+)?(?:function|interface|type|const|class)\s+(\w+)/g,
    ),
  ].map((match) => match[1]);

  const reExported = [...source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)]
    .flatMap((match) => match[1].split(","))
    .map((name) => name.trim().split(/\s+as\s+/).pop()!.trim())
    .filter((name) => name.length > 0);

  return [...new Set([...declared, ...reExported])].sort();
}

describe("SRD monster lookup architecture", () => {
  it("defines the monster query in exactly one module", () => {
    const definers = SOURCES.filter((path) =>
      /export\s+async\s+function\s+queryMonsters\s*\(/.test(
        readFileSync(path, "utf8"),
      ),
    ).map((path) => path.replace(process.cwd(), "").replace(/\\/g, "/"));

    expect(definers).toEqual(["/lib/rules/srd-monster-lookup.ts"]);
  });

  it("defines the monster raw-data helper in exactly one module", () => {
    const definers = SOURCES.filter((path) =>
      /export\s+function\s+buildMonsterRawData\s*\(/.test(
        readFileSync(path, "utf8"),
      ),
    ).map((path) => path.replace(process.cwd(), "").replace(/\\/g, "/"));

    expect(definers).toEqual(["/lib/rules/srd-monster-lookup.ts"]);
  });

  it("exports from the AI tool module only what the narrator's lookups need", () => {
    expect(exportedNames(readFileSync(SRD_LOOKUP, "utf8"))).toEqual([
      "EquipmentInfo",
      "SpellEffect",
      "buildSrdTools",
      "getEquipmentInfo",
      "getItemInfo",
      "getMonsterInfo",
      "getSpellInfo",
    ]);
  });
});
