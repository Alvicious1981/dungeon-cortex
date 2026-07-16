import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const narratorSource = readFileSync(resolve("lib/ai/narrator.ts"), "utf8");

describe("narrator legacy downtime containment", () => {
  it("does not import the quarantined legacy downtime tool module", () => {
    expect(narratorSource).not.toMatch(
      /["'][^"']*\/tools\/downtime["']/,
    );
  });

  it("does not register the legacy downtime tool builder or tool name", () => {
    expect(narratorSource).not.toContain("buildDowntimeTools");
    expect(narratorSource).not.toContain("resolveDowntime");
  });
});
