import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const wildernessToolPath = join(process.cwd(), "lib", "ai", "tools", "wilderness.ts");
const wildernessToolSource = readFileSync(wildernessToolPath, "utf8");

function extractFunctionSource(source: string, functionName: string): string {
  const start = source.indexOf(`function ${functionName}`);
  if (start === -1) return "";

  let depth = 0;
  let bodyStarted = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      bodyStarted = true;
      depth += 1;
    }
    if (char === "}") {
      depth -= 1;
      if (bodyStarted && depth === 0) return source.slice(start, index + 1);
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

describe("AI tools architecture: executeTravelWatch must not own wilderness persistence", () => {
  const buildWildernessToolSource = extractFunctionSource(
    wildernessToolSource,
    "buildWildernessTool"
  );

  it("isolates the wilderness tool factory under test", () => {
    expect(buildWildernessToolSource).toContain("buildWildernessTool");
    expect(buildWildernessToolSource).toContain("execute:");
    expect(wildernessToolSource).toContain("executeTravelWatch");
  });

  it("delegates executeTravelWatch to the future authoritative wilderness service", () => {
    expect(wildernessToolSource).toMatch(
      /from\s*["']@\/lib\/rules\/wilderness-service["']/
    );
    expect(buildWildernessToolSource).toMatch(/\bresolveTravelWatch\s*\(/);
  });

  it("does not use Prisma directly for wilderness mechanical persistence", () => {
    expect(buildWildernessToolSource).not.toMatch(/\bprisma\./);
  });

  it("does not open prisma.$transaction directly from the AI tool", () => {
    expect(buildWildernessToolSource).not.toMatch(/\bprisma\.\$transaction\s*\(/);
  });

  it("does not use tx directly to mutate mechanical state", () => {
    expect(buildWildernessToolSource).not.toMatch(
      /\btx\.(?:travelState|wildernessMap|partyInventory|inventoryItem|character|campaign|encounter|combatant|gameLog)\.(?:create|update|updateMany|upsert|delete)\s*\(/
    );
  });

  it("does not update travelState directly from the AI tool", () => {
    expect(buildWildernessToolSource).not.toMatch(
      /\b(?:prisma|tx)\.travelState\.(?:create|update|upsert|delete)\s*\(/
    );
  });

  it("does not update wildernessMap directly from the AI tool", () => {
    expect(buildWildernessToolSource).not.toMatch(
      /\b(?:prisma|tx)\.wildernessMap\.(?:create|update|upsert|delete)\s*\(/
    );
  });

  it("does not update inventory or rations directly from the AI tool", () => {
    expect(buildWildernessToolSource).not.toMatch(
      /\b(?:prisma|tx)\.partyInventory\.(?:create|update|upsert|delete)\s*\(/
    );
    expect(buildWildernessToolSource).not.toMatch(
      /\b(?:prisma|tx)\.inventoryItem\.(?:create|update|updateMany|delete)\s*\(/
    );
    expect(buildWildernessToolSource).not.toMatch(/\brations\s*:\s*newRations\b/);
  });

  it("does not modify weather, hex position, or travel progress directly", () => {
    expect(buildWildernessToolSource).not.toMatch(/\bcurrentQ\s*:\s*newQ\b/);
    expect(buildWildernessToolSource).not.toMatch(/\bcurrentR\s*:\s*newR\b/);
    expect(buildWildernessToolSource).not.toMatch(/\bpartialHexProgress\s*:\s*newPartialHexProgress\b/);
    expect(buildWildernessToolSource).not.toMatch(/\bweatherCondition\s*:\s*newWeatherCondition\b/);
    expect(buildWildernessToolSource).not.toMatch(/\bweatherIntensity\s*:\s*newWeatherIntensity\b/);
  });

  it("does not resolve scouting or foraging persistence directly", () => {
    expect(buildWildernessToolSource).not.toMatch(/\bresolveForaging\s*\(/);
    expect(buildWildernessToolSource).not.toMatch(/\bscouted\s*:\s*true\b/);
    expect(buildWildernessToolSource).not.toMatch(/\bdiscovered\s*:/);
  });

  it("does not create or modify encounters directly from the AI tool", () => {
    expect(buildWildernessToolSource).not.toMatch(
      /\b(?:prisma|tx)\.encounter\.(?:create|update|upsert|delete)\s*\(/
    );
    expect(buildWildernessToolSource).not.toMatch(
      /\brandom\s+encounter\s+is\s+triggered\b/i
    );
  });

  it("does not create gameLog directly from the AI tool", () => {
    expect(buildWildernessToolSource).not.toMatch(
      /\b(?:prisma|tx)\.gameLog\.create\s*\(/
    );
  });

  it("does not mix mechanical persistence with narrative response assembly", () => {
    expect(buildWildernessToolSource).not.toMatch(
      /\b(?:prisma|tx)\.(?:travelState|wildernessMap|partyInventory|inventoryItem|encounter|gameLog)\.(?:create|update|upsert)\s*\([\s\S]*?\bJSON\.stringify\s*\(/
    );
    expect(buildWildernessToolSource).not.toMatch(
      /\bJSON\.stringify\s*\([\s\S]*?\b(?:prisma|tx)\.(?:travelState|wildernessMap|partyInventory|inventoryItem|encounter|gameLog)\.(?:create|update|upsert)\s*\(/
    );
  });

  it("keeps allowed AI-tool responsibilities only", () => {
    expect(buildWildernessToolSource).toMatch(/\binputSchema:\s*TravelWatchInputSchema\b/);
    expect(buildWildernessToolSource).not.toMatch(/\bcalculateTravelProgress\s*\(/);
    expect(buildWildernessToolSource).not.toMatch(/\bgenerateWeatherCheck\s*\(/);
    expect(buildWildernessToolSource).not.toMatch(/\brollDie\s*\(/);
    expect(buildWildernessToolSource).not.toMatch(/\bgenerateHexTerrain\s*\(/);
  });

  it("does not introduce forbidden retro wilderness rules or jargon", () => {
    for (const fragments of forbiddenRuleFragments) {
      expect(buildWildernessToolSource).not.toContain(fragments.join(""));
      expect(buildWildernessToolSource).not.toContain(fragments.join(" "));
    }
  });
});
