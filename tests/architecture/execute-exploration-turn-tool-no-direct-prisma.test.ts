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
      if (depth === 0) return source.slice(start, index + 1);
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

describe("AI tools architecture: executeExplorationTurn must not own turn persistence", () => {
  const generateLocationSource = extractToolSource(explorationToolSource, "generateLocation");
  const moveToNodeSource = extractToolSource(explorationToolSource, "moveToNode");
  const executeExplorationTurnSource = extractToolSource(
    explorationToolSource,
    "executeExplorationTurn"
  );

  it("isolates only the executeExplorationTurn tool under test", () => {
    expect(generateLocationSource).toContain("generateLocation");
    expect(moveToNodeSource).toContain("moveToNode");
    expect(executeExplorationTurnSource).toContain("executeExplorationTurn");
    expect(executeExplorationTurnSource).not.toContain("generateLocation: tool");
    expect(executeExplorationTurnSource).not.toContain("moveToNode: tool");
  });

  it("delegates executeExplorationTurn to the future authoritative turn service", () => {
    expect(explorationToolSource).toMatch(
      /from\s*["']@\/lib\/rules\/exploration-turn-service["']/
    );
    expect(executeExplorationTurnSource).toMatch(/\bresolveExplorationTurn\s*\(/);
  });

  it("does not use prisma directly for exploration-turn persistence", () => {
    expect(executeExplorationTurnSource).not.toMatch(/\bprisma\./);
  });

  it("does not open prisma.$transaction directly from the AI tool", () => {
    expect(executeExplorationTurnSource).not.toMatch(/\bprisma\.\$transaction\s*\(/);
  });

  it("does not use tx directly to mutate mechanical state", () => {
    expect(executeExplorationTurnSource).not.toMatch(
      /\btx\.(?:campaignTime|partyInventory|character|encounter|gameLog|inventoryItem|campaign)\.(?:create|update|updateMany|upsert|delete)\s*\(/
    );
  });

  it("does not update campaignTime directly from the AI tool", () => {
    expect(executeExplorationTurnSource).not.toMatch(
      /\b(?:prisma|tx)\.campaignTime\.(?:create|update|upsert|delete)\s*\(/
    );
    expect(executeExplorationTurnSource).not.toMatch(/\bcampaignTime\.upsert\s*\(/);
    expect(executeExplorationTurnSource).not.toMatch(/\bcampaignTime\.update\s*\(/);
  });

  it("does not update inventory or resources directly from the AI tool", () => {
    expect(executeExplorationTurnSource).not.toMatch(
      /\b(?:prisma|tx)\.partyInventory\.(?:create|update|upsert|delete)\s*\(/
    );
    expect(executeExplorationTurnSource).not.toMatch(
      /\b(?:prisma|tx)\.inventoryItem\.(?:create|update|updateMany|delete)\s*\(/
    );
    expect(executeExplorationTurnSource).not.toMatch(/\bpartyInventory\.upsert\s*\(/);
    expect(executeExplorationTurnSource).not.toMatch(/\bconsumeResources\s*\(/);
  });

  it("does not update exhaustion directly from the AI tool", () => {
    expect(executeExplorationTurnSource).not.toMatch(
      /\b(?:prisma|tx)\.character\.update\s*\([\s\S]*?\bexhaustionLevel\s*:/
    );
  });

  it("does not create or update encounters directly from the AI tool", () => {
    expect(executeExplorationTurnSource).not.toMatch(
      /\b(?:prisma|tx)\.encounter\.(?:create|update|upsert|delete)\s*\(/
    );
  });

  it("does not create gameLog directly from the AI tool", () => {
    expect(executeExplorationTurnSource).not.toMatch(
      /\b(?:prisma|tx)\.gameLog\.create\s*\(/
    );
  });

  it("does not duplicate rest-service logic inside the AI tool", () => {
    expect(executeExplorationTurnSource).not.toMatch(/\bapplyRest\s*\(/);
    expect(executeExplorationTurnSource).not.toMatch(/\bREST_INTERVAL_TURNS\b/);
    expect(executeExplorationTurnSource).not.toMatch(/\bturnsSinceRest\s*>=/);
  });

  it("does not mix mechanical persistence with narrative response assembly", () => {
    expect(executeExplorationTurnSource).not.toMatch(
      /\b(?:prisma|tx)\.(?:campaignTime|partyInventory|character|encounter|gameLog)\.(?:create|update|upsert)\s*\([\s\S]*?\bJSON\.stringify\s*\(/
    );
    expect(executeExplorationTurnSource).not.toMatch(
      /\bJSON\.stringify\s*\([\s\S]*?\b(?:prisma|tx)\.(?:campaignTime|partyInventory|character|encounter|gameLog)\.(?:create|update|upsert)\s*\(/
    );
  });

  it("keeps allowed AI-tool responsibilities only", () => {
    expect(executeExplorationTurnSource).toMatch(/\binputSchema:\s*ExplorationTurnInputSchema\b/);
    expect(executeExplorationTurnSource).not.toMatch(/\badvanceTurn\s*\(/);
    expect(executeExplorationTurnSource).not.toMatch(/\bcheckRandomEncounter\s*\(/);
    expect(executeExplorationTurnSource).not.toMatch(/\bapplyRest\s*\(/);
  });

  it("does not introduce forbidden retro exploration rules or jargon", () => {
    for (const fragments of forbiddenRuleFragments) {
      expect(executeExplorationTurnSource).not.toContain(fragments.join(""));
      expect(executeExplorationTurnSource).not.toContain(fragments.join(" "));
    }
  });
});
