import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const narratorPath = fileURLToPath(new URL("../../lib/ai/narrator.ts", import.meta.url));
const narratorSource = readFileSync(narratorPath, "utf8");

describe("narrator legacy downtime containment", () => {

  it("does not register the legacy downtime tool builder or tool name", () => {
    expect(narratorSource).not.toContain("buildDowntimeTools");
    expect(narratorSource).not.toContain("resolveDowntime");
  });
});
