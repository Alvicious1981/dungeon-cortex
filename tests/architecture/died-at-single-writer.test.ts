import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function gitGrep(pattern: string): string[] {
  return execSync(`git grep --untracked -l -E "${pattern}" -- lib app`, { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();
}

describe("Character.diedAt has one writer (death-saves spec §9)", () => {
  it("is written only by markCharacterDead", () => {
    expect(gitGrep("diedAt:\\s*(new Date|now)")).toEqual(["lib/db/character-death.ts"]);
  });

  // The other end: every cause of death is a caller named here, so a new one
  // is a line somebody changes on purpose.
  it("is reached only from a combat death and a death by exhaustion", () => {
    expect(gitGrep("markCharacterDead\\(")).toEqual([
      "lib/actions/travel-command.ts",
      "lib/db/character-death.ts",
      "lib/rules/combat-pipeline.ts",
    ]);
  });
});
