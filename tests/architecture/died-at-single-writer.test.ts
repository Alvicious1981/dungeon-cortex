import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("Character.diedAt has one writer (death-saves spec §9)", () => {
  it("is written only by resolveEncounterIfEnded", () => {
    const hits = execSync('git grep -l -E "diedAt:\\s*(new Date|now)" -- lib app', {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(hits).toEqual(["lib/rules/combat-pipeline.ts"]);
  });
});
