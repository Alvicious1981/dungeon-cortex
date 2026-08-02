import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const socialToolPath = join(process.cwd(), "lib", "ai", "tools", "social.ts");
const socialToolSource = readFileSync(socialToolPath, "utf8");

function extractToolSource(source: string, toolName: string): string {
  const start = source.indexOf(`${toolName}: tool({`);
  if (start === -1) return "";

  const nextTool = source.indexOf("\n    }),", start);
  return nextTool === -1 ? source.slice(start) : source.slice(start, nextTool);
}

function stripToolDescriptions(source: string): string {
  return source.replace(/description:\s*[\s\S]*?inputSchema:/g, "inputSchema:");
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

describe("generateAndTrackNPC architecture: AI tool must delegate generated NPC persistence", () => {
  const generateAndTrackNPCSource = extractToolSource(
    socialToolSource,
    "generateAndTrackNPC"
  );
  const executableGenerateAndTrackNPCSource = stripToolDescriptions(
    generateAndTrackNPCSource
  );

  it("scopes this migration guard to generateAndTrackNPC only", () => {
    expect(generateAndTrackNPCSource).toContain("generateAndTrackNPC");
    expect(extractToolSource(socialToolSource, "trackNPC")).toContain("trackNPC");
    expect(extractToolSource(socialToolSource, "establishInitialDisposition")).toContain(
      "establishInitialDisposition"
    );
    expect(extractToolSource(socialToolSource, "socialCheck")).toContain("socialCheck");
  });

  it("delegates generated NPC persistence to npc-service", () => {
    expect(socialToolSource).toMatch(
      /from\s*["']@\/lib\/rules\/npc-service["']/
    );
    expect(generateAndTrackNPCSource).toMatch(/\bupsertGeneratedNpc\s*\(/);
  });

  it("does not use Prisma directly for generated NPC persistence", () => {
    expect(generateAndTrackNPCSource).not.toMatch(
      /\bprisma\.nPC\.(?:create|update|upsert|delete)\s*\(/
    );
    expect(generateAndTrackNPCSource).not.toMatch(
      /\bprisma\.npc\.(?:create|update|upsert|delete)\s*\(/
    );
    expect(generateAndTrackNPCSource).not.toMatch(
      /\b(?:tx|db)\.(?:nPC|npc)\.(?:create|update|upsert|delete)\s*\(/
    );
  });

  it("does not upsert NPC rows directly from the AI tool", () => {
    expect(generateAndTrackNPCSource).not.toMatch(/\bprisma\.nPC\.upsert\s*\(/);
    expect(generateAndTrackNPCSource).not.toMatch(/\bprisma\.npc\.upsert\s*\(/);
    expect(generateAndTrackNPCSource).not.toMatch(/\btx\.nPC\.upsert\s*\(/);
    expect(generateAndTrackNPCSource).not.toMatch(/\btx\.npc\.upsert\s*\(/);
    expect(generateAndTrackNPCSource).not.toMatch(/\bdb\.nPC\.upsert\s*\(/);
    expect(generateAndTrackNPCSource).not.toMatch(/\bdb\.npc\.upsert\s*\(/);
  });

  it("can generate or receive NPC data but must not own generated NPC write shape", () => {
    expect(generateAndTrackNPCSource).toMatch(/\bgenerateNPC\s*\(/);
    expect(generateAndTrackNPCSource).not.toMatch(
      /\b(?:create|update)\s*:\s*{[\s\S]*?\b(?:race|profession|alignment|abilityScores|traits)\s*:/
    );
    expect(generateAndTrackNPCSource).not.toMatch(
      /\bdata\s*:\s*{[\s\S]*?\b(?:race|profession|alignment|abilityScores|traits|disposition|relationship)\s*:/
    );
  });

  it("does not duplicate npc-service validation or persistence logic", () => {
    expect(executableGenerateAndTrackNPCSource).not.toMatch(/\bcampaignId_seed\b/);
    expect(executableGenerateAndTrackNPCSource).not.toMatch(/\bassert[A-Z]\w*\s*\(/);
    expect(executableGenerateAndTrackNPCSource).not.toMatch(
      /\b(?:findUnique|findFirst)\s*\([\s\S]*?\bcampaignId\b/
    );
  });

  it("does not mix persistence mechanics with narrative prose generation", () => {
    expect(executableGenerateAndTrackNPCSource).not.toMatch(
      /\b(?:narration|narrative|prose|flavorText|boxed text)\b/i
    );
    expect(generateAndTrackNPCSource).not.toMatch(
      /\b(?:prisma|tx|db)\.gameLog\.create\s*\(/
    );
  });

  it("returns structured facts through the common tool-result contract", () => {
    // SEC-AI-001 PR2: results are objects validated by lib/ai/tool-result.ts,
    // never hand-serialised JSON.
    expect(generateAndTrackNPCSource).not.toMatch(/\bJSON\.stringify\s*\(/);
    expect(generateAndTrackNPCSource).toMatch(/\brunTool\s*\(/);
    expect(generateAndTrackNPCSource).toMatch(/\bname\b/);
    expect(generateAndTrackNPCSource).toMatch(/\brace\b/);
    expect(generateAndTrackNPCSource).toMatch(/\bprofession\b/);
    expect(generateAndTrackNPCSource).toMatch(/\balignment\b/);
    expect(generateAndTrackNPCSource).toMatch(/\btraits\b/);
  });

  it("does not introduce forbidden retro NPC rules or jargon", () => {
    for (const fragments of forbiddenRuleFragments) {
      expect(generateAndTrackNPCSource).not.toContain(fragments.join(""));
      expect(generateAndTrackNPCSource).not.toContain(fragments.join(" "));
    }
  });
});
