import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const progressionToolPath = join(process.cwd(), "lib", "ai", "tools", "progression.ts");
const progressionToolSource = readFileSync(progressionToolPath, "utf8");

function extractToolSource(source: string, toolName: string): string {
  const start = source.indexOf(`${toolName}: tool({`);
  if (start === -1) return "";

  const end = source.indexOf("\n    }),", start);
  return end === -1 ? source.slice(start) : source.slice(start, end);
}

const forbiddenRuleFragments = [
  ["TH", "AC", "0"],
  ["descending", "AC"],
  ["AC", "descendente"],
  ["saving", "throw", "vs"],
  ["save", "vs", "death"],
  ["save", "vs", "wands"],
  ["gold", "for", "XP"],
  ["XP", "por", "oro"],
  ["AD", "&", "D"],
  ["OS", "R"],
];

describe("AI tools architecture: awardXP must not own character progression persistence", () => {
  const awardXPSource = extractToolSource(progressionToolSource, "awardXP");
  const triggerLevelUpSource = extractToolSource(progressionToolSource, "triggerLevelUp");

  it("contains the progression tools under test", () => {
    expect(awardXPSource).toContain("awardXP");
    expect(triggerLevelUpSource).toContain("triggerLevelUp");
  });

  it("keeps triggerLevelUp explicitly outside this awardXP migration scope", () => {
    expect(triggerLevelUpSource).toContain("triggerLevelUp");
  });

  it("delegates XP awards to the authoritative progression service", () => {
    expect(progressionToolSource).toMatch(
      /import\s*{\s*applyExperienceAward\s*}\s*from\s*["']@\/lib\/rules\/progression-service["']/
    );
    expect(awardXPSource).toMatch(/\bapplyExperienceAward\s*\(/);
  });

  it("does not call prisma directly from awardXP", () => {
    expect(awardXPSource).not.toMatch(/\bprisma\./);
  });

  it("does not open database transactions directly from awardXP", () => {
    expect(awardXPSource).not.toMatch(/\bprisma\.\$transaction\s*\(/);
  });

  it("does not call tx.character.update directly from awardXP", () => {
    expect(awardXPSource).not.toMatch(/\btx\.character\.update\s*\(/);
  });

  it("does not persist character XP directly from awardXP", () => {
    expect(awardXPSource).not.toMatch(
      /\bcharacter\.update\s*\([\s\S]*?\bdata\s*:\s*{[\s\S]*?\bxp\s*:/
    );
  });

  it("does not persist character level directly from awardXP", () => {
    expect(awardXPSource).not.toMatch(
      /\bcharacter\.update\s*\([\s\S]*?\bdata\s*:\s*{[\s\S]*?\blevel\s*:/
    );
  });

  it("does not persist hp or maxHp directly from awardXP", () => {
    expect(awardXPSource).not.toMatch(
      /\bcharacter\.update\s*\([\s\S]*?\bdata\s*:\s*{[\s\S]*?\b(maxHp|hp)\s*:/
    );
  });

  it("does not persist hit dice directly from awardXP", () => {
    expect(awardXPSource).not.toMatch(
      /\bcharacter\.update\s*\([\s\S]*?\bdata\s*:\s*{[\s\S]*?\bhitDice(?:Total|Remaining)\s*:/
    );
  });

  it("does not create progression GameLog rows directly from awardXP", () => {
    expect(awardXPSource).not.toMatch(/\b(?:prisma|tx)\.gameLog\.create\s*\(/);
  });

  it("does not instruct awardXP to own XP or level-up narration during persistence", () => {
    expect(awardXPSource).not.toMatch(/\bYOU HAVE AUTHORITY\b/);
    expect(awardXPSource).not.toMatch(/\bnarrate\b/i);
  });

  it("does not introduce forbidden retro progression rules or jargon", () => {
    for (const fragments of forbiddenRuleFragments) {
      expect(awardXPSource).not.toContain(fragments.join(""));
      expect(awardXPSource).not.toContain(fragments.join(" "));
    }
  });
});