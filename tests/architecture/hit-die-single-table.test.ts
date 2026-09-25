import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * The class → Hit Die table used to be written out three times: HIT_DIE_MAP in
 * lib/rules/progression.ts, a `switch` in rest-service.ts and CLASS_HIT_DICE in
 * lib/dnd-api/constants.ts. They agreed only by coincidence. This pins the
 * table to one module, so a second copy is a failing test rather than a quiet
 * disagreement between character creation, rests and level-up.
 */
function filesMatching(pattern: string): string[] {
  return execSync(`git grep --untracked -l -E "${pattern}" -- lib app components`, {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();
}

describe("the class → Hit Die table has one definition", () => {
  it("writes the barbarian's d12 in exactly one module", () => {
    expect(filesMatching("barbarian:\\s*12")).toEqual(["lib/rules/progression.ts"]);
  });

  it("has no switch over class names left anywhere", () => {
    // `.` stands for either quote; git grep exits 1 when nothing matches.
    expect(() => filesMatching("case .barbarian.:")).toThrow(/Command failed/);
  });
});
