import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const rulesDir = join(process.cwd(), "lib", "rules");

function listTypescriptFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) return listTypescriptFiles(fullPath);
    return /\.tsx?$/.test(entry) ? [fullPath] : [];
  });
}

const forbiddenImportPattern =
  /(?:from\s*["']|import\s*\(\s*["'])(?:@\/lib\/ai\/tools|(?:\.\.\/)+ai\/tools)\b/;

describe("rules architecture: rules layer must not import AI tools", () => {
  it("has no imports from lib/ai/tools inside lib/rules", () => {
    const offenders = listTypescriptFiles(rulesDir).flatMap((filePath) => {
      const source = readFileSync(filePath, "utf8");
      return forbiddenImportPattern.test(source)
        ? [relative(process.cwd(), filePath)]
        : [];
    });

    expect(offenders).toEqual([]);
  });
});
