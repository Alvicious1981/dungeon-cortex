import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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

describe("AI tools architecture: triggerLevelUp must not own level-up persistence", () => {
  const triggerLevelUpSource = extractToolSource(progressionToolSource, "triggerLevelUp");

  it("contains the triggerLevelUp tool under test", () => {
    expect(triggerLevelUpSource).toContain("triggerLevelUp");
  });

  it("delegates level-up resolution to the authoritative level-up service", () => {
    expect(progressionToolSource).toMatch(
      /import\s*{\s*applyLevelUp\s*}\s*from\s*["']@\/lib\/rules\/level-up-service["']/
    );
    expect(triggerLevelUpSource).toMatch(/\bapplyLevelUp\s*\(/);
  });

  it("passes structured level-up intent to the service instead of owning mechanics", () => {
    expect(triggerLevelUpSource).toMatch(/\bcampaignId\b/);
    expect(triggerLevelUpSource).toMatch(/\bcharacterId\b/);
    expect(triggerLevelUpSource).toMatch(/\bsource\s*:\s*["']triggerLevelUp["']/);
  });

  it("does not use prisma directly from triggerLevelUp", () => {
    expect(triggerLevelUpSource).not.toMatch(/\bprisma\./);
  });

  it("does not open database transactions directly from triggerLevelUp", () => {
    expect(triggerLevelUpSource).not.toMatch(/\bprisma\.\$transaction\s*\(/);
  });

  it("does not call character update directly from triggerLevelUp", () => {
    expect(triggerLevelUpSource).not.toMatch(/\bprisma\.character\.update\s*\(/);
    expect(triggerLevelUpSource).not.toMatch(/\btx\.character\.update\s*\(/);
    expect(triggerLevelUpSource).not.toMatch(/\bcharacter\.update\s*\(/);
  });

  it("does not persist character level directly from triggerLevelUp", () => {
    expect(triggerLevelUpSource).not.toMatch(
      /\bcharacter\.update\s*\([\s\S]*?\bdata\s*:\s*{[\s\S]*?\blevel\s*:/
    );
  });

  it("does not persist hp or maxHp directly from triggerLevelUp", () => {
    expect(triggerLevelUpSource).not.toMatch(
      /\bcharacter\.update\s*\([\s\S]*?\bdata\s*:\s*{[\s\S]*?\b(maxHp|hp)\s*:/
    );
  });

  it("does not persist hit dice directly from triggerLevelUp", () => {
    expect(triggerLevelUpSource).not.toMatch(
      /\bcharacter\.update\s*\([\s\S]*?\bdata\s*:\s*{[\s\S]*?\bhitDice(?:Total|Remaining)\s*:/
    );
  });

  it("does not calculate physical level-up changes inside the AI tool", () => {
    expect(triggerLevelUpSource).not.toMatch(/\bbuildLevelUpPayload\s*\(/);
    expect(triggerLevelUpSource).not.toMatch(/\brollHitPointGain\s*\(/);
    expect(triggerLevelUpSource).not.toMatch(/\bHIT_DIE_MAP\b/);
    expect(triggerLevelUpSource).not.toMatch(/\bconModifier\b/);
    expect(triggerLevelUpSource).not.toMatch(/\bstats\?\.CON\b/);
  });

  it("does not generate narrative prose as part of level-up persistence", () => {
    expect(triggerLevelUpSource).not.toMatch(/\b(?:prisma|tx)\.gameLog\.create\s*\(/);
    expect(triggerLevelUpSource).not.toMatch(
      /\bcharacter\.update\s*\([\s\S]*?\bdata\s*:\s*{[\s\S]*?\b(?:content|narrative|text)\s*:/
    );
  });

  it("may emit or forward structured level-up facts for UI and stream callbacks only", () => {
    expect(triggerLevelUpSource).not.toMatch(/\bonLevelUp\s*\([\s\S]*?["'`]/);
  });

  it("does not introduce forbidden retro progression rules or jargon", () => {
    for (const fragments of forbiddenRuleFragments) {
      expect(triggerLevelUpSource).not.toContain(fragments.join(""));
      expect(triggerLevelUpSource).not.toContain(fragments.join(" "));
    }
  });
});
