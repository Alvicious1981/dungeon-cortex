import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const explorationToolPath = join(process.cwd(), "lib", "ai", "tools", "exploration.ts");
const explorationToolSource = readFileSync(explorationToolPath, "utf8");

function extractToolSource(source: string, toolName: string): string {
  const start = source.indexOf(`${toolName}: tool({`);
  if (start === -1) return "";

  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  return source.slice(start);
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

describe("AI tools architecture: moveToNode must not own navigation persistence", () => {
  const generateLocationSource = extractToolSource(explorationToolSource, "generateLocation");
  const moveToNodeSource = extractToolSource(explorationToolSource, "moveToNode");
  const executeExplorationTurnSource = extractToolSource(explorationToolSource, "executeExplorationTurn");

  it("isolates only the moveToNode tool under test", () => {
    expect(generateLocationSource).toContain("generateLocation");
    expect(moveToNodeSource).toContain("moveToNode");
    expect(executeExplorationTurnSource).toContain("executeExplorationTurn");
    expect(moveToNodeSource).not.toContain("generateLocation: tool");
    expect(moveToNodeSource).not.toContain("executeExplorationTurn: tool");
  });

  it("delegates moveToNode to the authoritative navigation service", () => {
    expect(explorationToolSource).toMatch(
      /import\s*{[^}]*\bmoveCampaignToNode\b[^}]*}\s*from\s*["']@\/lib\/rules\/navigation-service["']/
    );
    expect(moveToNodeSource).toMatch(/\bmoveCampaignToNode\s*\(/);
  });

  it("does not use prisma directly for navigation persistence from moveToNode", () => {
    expect(moveToNodeSource).not.toMatch(/\bprisma\./);
  });

  it("does not open prisma.$transaction directly from moveToNode", () => {
    expect(moveToNodeSource).not.toMatch(/\bprisma\.\$transaction\s*\(/);
  });

  it("does not call tx.campaign.update directly from moveToNode", () => {
    expect(moveToNodeSource).not.toMatch(/\btx\.campaign\.update\s*\(/);
  });

  it("does not call campaign.update directly from moveToNode", () => {
    expect(moveToNodeSource).not.toMatch(/\bcampaign\.update\s*\(/);
  });

  it("does not modify campaign.currentNodeId directly from moveToNode", () => {
    expect(moveToNodeSource).not.toMatch(
      /\b(?:prisma|tx)\.campaign\.update\s*\([\s\S]*?\bdata\s*:\s*{[\s\S]*?\bcurrentNodeId\s*:/
    );
    expect(moveToNodeSource).not.toMatch(/\bcurrentNodeId\s*:/);
  });

  it("does not decide and persist mechanical navigation from the AI tool", () => {
    expect(moveToNodeSource).not.toMatch(/\bcanMoveToNode\s*\(/);
    expect(moveToNodeSource).not.toMatch(/\bnodeById\s*=\s*new Map/);
    expect(moveToNodeSource).not.toMatch(/\blocation\.edges\.map\s*\(/);
  });

  it("does not generate narrative prose as part of navigation persistence", () => {
    expect(moveToNodeSource).not.toMatch(
      /\b(?:prisma|tx)\.gameLog\.create\s*\([\s\S]*?\b(flavorText|narrative|narration|prose|description)\b/i
    );
  });

  it("does not introduce forbidden retro navigation rules or jargon", () => {
    for (const fragments of forbiddenRuleFragments) {
      expect(moveToNodeSource).not.toContain(fragments.join(""));
      expect(moveToNodeSource).not.toContain(fragments.join(" "));
    }
  });
});
