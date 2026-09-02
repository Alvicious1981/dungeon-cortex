import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Read from the directory rather than a hand-written list.
 *
 * The list used to be literal, which meant a tool file added later was not
 * covered until someone remembered to add it here — and a tool file deleted
 * broke the guard for a reason that had nothing to do with what it guards.
 * Reading the directory makes it cover the surface as it actually is.
 */
const aiToolFiles = readdirSync(join(process.cwd(), "lib", "ai", "tools"))
  .filter((file) => file.endsWith(".ts"))
  .sort();

describe("AI layer state-mutation boundary", () => {
  for (const file of aiToolFiles) {
    it(`${file} does not mutate state through prisma or a transaction client`, () => {
      const source = readFileSync(
        join(process.cwd(), "lib", "ai", "tools", file),
        "utf8"
      );

      expect(source).not.toMatch(/\bprisma\.\$transaction\s*\(/);
      expect(source).not.toMatch(
        /\b(?:prisma|tx)\.[A-Za-z0-9_]+\.(?:create|update|upsert|delete|deleteMany|updateMany)\s*\(/
      );
    });
  }
});
