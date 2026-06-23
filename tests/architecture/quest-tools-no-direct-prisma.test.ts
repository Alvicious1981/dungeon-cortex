import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const progressionToolPath = join(process.cwd(), "lib", "ai", "tools", "progression.ts");
const progressionToolSource = readFileSync(progressionToolPath, "utf8");

const questIndexRoutePath = join(
  process.cwd(),
  "app",
  "api",
  "campaign",
  "[id]",
  "quest",
  "route.ts"
);
const questDetailRoutePath = join(
  process.cwd(),
  "app",
  "api",
  "campaign",
  "[id]",
  "quest",
  "[questId]",
  "route.ts"
);
const questIndexRouteSource = readFileSync(questIndexRoutePath, "utf8");
const questDetailRouteSource = readFileSync(questDetailRoutePath, "utf8");

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

describe("Quest persistence architecture: AI tools and API routes must delegate quest mutations", () => {
  const updateQuestStatusSource = extractToolSource(progressionToolSource, "updateQuestStatus");
  const generateAndTrackQuestSource = extractToolSource(progressionToolSource, "generateAndTrackQuest");

  it("contains the quest tools under test", () => {
    expect(updateQuestStatusSource).toContain("updateQuestStatus");
    expect(generateAndTrackQuestSource).toContain("generateAndTrackQuest");
  });

  it("expects quest tools to delegate to the authoritative quest service", () => {
    expect(progressionToolSource).toMatch(
      /import\s*{[\s\S]*\b(createTrackedQuest|updateQuestStatus)\b[\s\S]*}\s*from\s*["']@\/lib\/rules\/quest-service["']/
    );
  });

  it("does not update quest status directly from updateQuestStatus", () => {
    expect(updateQuestStatusSource).not.toMatch(/\bprisma\.quest\.update\s*\(/);
    expect(updateQuestStatusSource).not.toMatch(/\b(?:tx|db)\.quest\.update\s*\(/);
  });

  it("does not persist quest.status directly from updateQuestStatus", () => {
    expect(updateQuestStatusSource).not.toMatch(
      /\bquest\.update\s*\([\s\S]*?\bdata\s*:\s*{[\s\S]*?\bstatus\s*:/
    );
  });

  it("does not create quests directly from generateAndTrackQuest", () => {
    expect(generateAndTrackQuestSource).not.toMatch(/\bprisma\.quest\.create\s*\(/);
    expect(generateAndTrackQuestSource).not.toMatch(/\b(?:tx|db)\.quest\.create\s*\(/);
  });

  it("does not persist generated quest fields directly from generateAndTrackQuest", () => {
    expect(generateAndTrackQuestSource).not.toMatch(
      /\bquest\.create\s*\([\s\S]*?\bdata\s*:\s*{[\s\S]*?\b(campaignId|title|description|status|hook|objective|reward)\s*:/
    );
  });

  it("does not generate narrative prose as part of quest persistence", () => {
    expect(updateQuestStatusSource).not.toMatch(/\b(?:narrate|narrative|prose|flavorText)\b/i);
    expect(generateAndTrackQuestSource).not.toMatch(
      /\b(?:MUST use verbatim|narrator|narrate|narrative|prose|flavorText)\b/i
    );
    expect(generateAndTrackQuestSource).not.toMatch(/\b(?:prisma|tx|db)\.gameLog\.create\s*\(/);
  });

  it("does not introduce forbidden retro quest rules or jargon in quest tools", () => {
    for (const fragments of forbiddenRuleFragments) {
      expect(updateQuestStatusSource).not.toContain(fragments.join(""));
      expect(updateQuestStatusSource).not.toContain(fragments.join(" "));
      expect(generateAndTrackQuestSource).not.toContain(fragments.join(""));
      expect(generateAndTrackQuestSource).not.toContain(fragments.join(" "));
    }
  });

  it("expects quest API routes to delegate quest creation and updates to the quest service", () => {
    const combinedRouteSource = `${questIndexRouteSource}\n${questDetailRouteSource}`;

    expect(combinedRouteSource).toMatch(
      /from\s*["']@\/lib\/rules\/quest-service["']/
    );
  });

  it("does not create quests directly in the quest collection route", () => {
    expect(questIndexRouteSource).not.toMatch(/\bprisma\.quest\.create\s*\(/);
  });

  it("does not update quests directly in the quest detail route", () => {
    expect(questDetailRouteSource).not.toMatch(/\bprisma\.quest\.update\s*\(/);
  });

  it("does not duplicate status mutation mechanics in the quest API routes", () => {
    expect(questDetailRouteSource).not.toMatch(
      /\bquest\.update\s*\([\s\S]*?\bdata\s*:\s*{[\s\S]*?\bstatus\s*:/
    );
  });
});
