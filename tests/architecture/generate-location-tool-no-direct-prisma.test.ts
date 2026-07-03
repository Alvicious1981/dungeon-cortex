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

describe("AI tools architecture: generateLocation must not own exploration persistence", () => {
  const generateLocationSource = extractToolSource(explorationToolSource, "generateLocation");
  const moveToNodeSource = extractToolSource(explorationToolSource, "moveToNode");
  const executeExplorationTurnSource = extractToolSource(
    explorationToolSource,
    "executeExplorationTurn"
  );

  it("isolates only the generateLocation tool under test", () => {
    expect(generateLocationSource).toContain("generateLocation");
    expect(moveToNodeSource).toContain("moveToNode");
    expect(executeExplorationTurnSource).toContain("executeExplorationTurn");
    expect(generateLocationSource).not.toContain("moveToNode: tool");
    expect(generateLocationSource).not.toContain("executeExplorationTurn: tool");
  });

  it("delegates generateLocation to the authoritative exploration service", () => {
    expect(explorationToolSource).toMatch(
      /from\s*["']@\/lib\/rules\/exploration-service["']/
    );
    expect(generateLocationSource).toMatch(/\bgenerateExplorationLocation\s*\(/);
  });

  it("does not create Location directly from the AI tool", () => {
    expect(generateLocationSource).not.toMatch(
      /\b(?:prisma|tx)\.location\.create\s*\(/
    );
  });

  it("does not create LocationNode directly from the AI tool", () => {
    expect(generateLocationSource).not.toMatch(
      /\b(?:prisma|tx)\.locationNode\.create\s*\(/
    );
  });

  it("does not create LocationEdge directly from the AI tool", () => {
    expect(generateLocationSource).not.toMatch(
      /\b(?:prisma|tx)\.locationEdge\.create\s*\(/
    );
  });

  it("does not update campaign position directly from the AI tool", () => {
    expect(generateLocationSource).not.toMatch(
      /\b(?:prisma|tx)\.campaign\.update\s*\([\s\S]*?\bcurrentLocationId\s*:/
    );
    expect(generateLocationSource).not.toMatch(
      /\b(?:prisma|tx)\.campaign\.update\s*\([\s\S]*?\bcurrentNodeId\s*:/
    );
  });

  it("does not open a Prisma transaction directly to create the location graph", () => {
    expect(generateLocationSource).not.toMatch(/\bprisma\.\$transaction\s*\(/);
  });

  it("does not assemble node or edge persistence maps in the AI tool", () => {
    expect(generateLocationSource).not.toMatch(/\bnodeIdByIndex\s*=\s*new Map/);
    expect(generateLocationSource).not.toMatch(/\bcreatedNodes\s*=/);
    expect(generateLocationSource).not.toMatch(/\bvalidated\.nodes\.map\s*\(/);
    expect(generateLocationSource).not.toMatch(/\bvalidated\.edges\.map\s*\(/);
  });

  it("does not mix mechanical persistence with generated location payload ownership", () => {
    expect(generateLocationSource).not.toMatch(
      /\bgenerateLocationPayload\s*\([\s\S]*?\b(?:prisma|tx)\.(?:location|locationNode|locationEdge|campaign)\.(?:create|update)\s*\(/
    );
    expect(generateLocationSource).not.toMatch(
      /\bLocationPayloadSchema\.parse\s*\([\s\S]*?\b(?:prisma|tx)\.(?:location|locationNode|locationEdge|campaign)\.(?:create|update)\s*\(/
    );
  });

  it("does not keep ownership of graph persistence through legacy generation helpers", () => {
    expect(generateLocationSource).not.toMatch(/\bgenerateNodeContent\s*\(/);
    expect(explorationToolSource).not.toMatch(
      /from\s*["']@\/lib\/rules\/generator["']/
    );
  });

  it("does not generate narrative prose as part of location persistence", () => {
    expect(generateLocationSource).not.toMatch(
      /\b(?:prisma|tx)\.(?:location|locationNode|locationEdge|campaign|gameLog)\.(?:create|update)\s*\([\s\S]*?\b(flavorText|narrative|narration|prose|boxedText)\b/i
    );
  });

  it("does not introduce forbidden retro exploration rules or jargon", () => {
    for (const fragments of forbiddenRuleFragments) {
      expect(generateLocationSource).not.toContain(fragments.join(""));
      expect(generateLocationSource).not.toContain(fragments.join(" "));
    }
  });
});
