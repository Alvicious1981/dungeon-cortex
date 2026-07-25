import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const aiToolFiles = [
  "combat.ts",
  "exploration.ts",
  "inventory.ts",
  "progression.ts",
  "social.ts",
  "srd-lookup.ts",
  "wilderness.ts",
  "world.ts",
];

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
