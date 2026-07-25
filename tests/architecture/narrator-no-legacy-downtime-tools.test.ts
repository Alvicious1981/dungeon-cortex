import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const narratorPath = fileURLToPath(new URL("../../lib/ai/narrator.ts", import.meta.url));
const narratorSource = readFileSync(narratorPath, "utf8");
const legacyAiToolPath = fileURLToPath(
  new URL("../../lib/ai/tools/downtime.ts", import.meta.url)
);
const legacyRulesPath = fileURLToPath(
  new URL("../../lib/rules/downtime.ts", import.meta.url)
);

describe("legacy downtime removal", () => {
  it("removes the incompatible AI tool and rules module", () => {
    expect(existsSync(legacyAiToolPath)).toBe(false);
    expect(existsSync(legacyRulesPath)).toBe(false);
  });

  it("does not register the legacy downtime tool builder or tool name", () => {
    expect(narratorSource).not.toContain("buildDowntimeTools");
    expect(narratorSource).not.toContain("resolveDowntime");
  });
});
