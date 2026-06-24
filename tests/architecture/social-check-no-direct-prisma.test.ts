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

describe("socialCheck architecture: AI tool must delegate social persistence", () => {
  const socialCheckSource = extractToolSource(socialToolSource, "socialCheck");
  const executableSocialCheckSource = stripToolDescriptions(socialCheckSource);

  it("scopes this migration guard to socialCheck only", () => {
    expect(socialCheckSource).toContain("socialCheck");
    expect(extractToolSource(socialToolSource, "trackNPC")).toContain("trackNPC");
    expect(extractToolSource(socialToolSource, "establishInitialDisposition")).toContain(
      "establishInitialDisposition"
    );
    expect(extractToolSource(socialToolSource, "generateMerchant")).toContain(
      "generateMerchant"
    );
  });

  it("does not open a direct Prisma transaction from socialCheck", () => {
    expect(socialCheckSource).not.toMatch(/\bprisma\.\$transaction\s*\(/);
  });

  it("does not use Prisma directly for social persistence from socialCheck", () => {
    expect(socialCheckSource).not.toMatch(
      /\bprisma\.(?:nPC|campaign|character)\.(?:findUnique|findFirst|create|update|upsert|delete)\s*\(/
    );
    expect(socialCheckSource).not.toMatch(
      /\b(?:tx|db)\.(?:nPC|campaign|character)\.(?:create|update|upsert|delete)\s*\(/
    );
  });

  it("does not update or upsert NPC rows directly from socialCheck", () => {
    expect(socialCheckSource).not.toMatch(/\b(?:tx|db)\.nPC\.update\s*\(/);
    expect(socialCheckSource).not.toMatch(/\b(?:tx|db)\.nPC\.upsert\s*\(/);
    expect(socialCheckSource).not.toMatch(/\bprisma\.nPC\.(?:update|upsert)\s*\(/);
  });

  it("does not modify NPC disposition or social state directly from socialCheck", () => {
    expect(socialCheckSource).not.toMatch(
      /\bdata\s*:\s*{[\s\S]*?\b(?:disposition|hasMetPlayer|personalityTags|traits|attitude|relationship)\s*:/
    );
    expect(socialCheckSource).not.toMatch(
      /\b(?:dispositionAfter|currentDisposition)\b[\s\S]*?\b(?:tx|db|prisma)\.nPC\.(?:update|upsert)\s*\(/
    );
  });

  it("does not decide and persist a mechanical outcome inside socialCheck", () => {
    expect(socialCheckSource).not.toMatch(/\babilityModifier\s*\(/);
    expect(socialCheckSource).not.toMatch(/\bcharacter\.stats\b/);
    expect(socialCheckSource).not.toMatch(/\bstats\?\.(?:CHA|Charisma)\b/);
  });

  it("delegates social resolution to the backend social service", () => {
    expect(socialToolSource).toMatch(
      /from\s*["']@\/lib\/rules\/social-service["']/
    );
    expect(socialCheckSource).toMatch(/\bresolveSocialCheck\s*\(/);
  });

  it("does not generate narrative prose as part of social persistence", () => {
    expect(executableSocialCheckSource).not.toMatch(
      /\b(?:narration|narrative|prose|flavorText|boxed text)\b/i
    );
    expect(socialCheckSource).not.toMatch(
      /\b(?:prisma|tx|db)\.gameLog\.create\s*\(/
    );
  });

  it("does not introduce forbidden retro social rules or jargon", () => {
    for (const fragments of forbiddenRuleFragments) {
      expect(socialCheckSource).not.toContain(fragments.join(""));
      expect(socialCheckSource).not.toContain(fragments.join(" "));
    }
  });
});

