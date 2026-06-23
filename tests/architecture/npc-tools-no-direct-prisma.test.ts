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

describe("NPC persistence architecture: social AI tools must delegate NPC mutations", () => {
  const trackNPCSource = extractToolSource(socialToolSource, "trackNPC");
  const trackMerchantSource = extractToolSource(socialToolSource, "trackMerchant");
  const generateMerchantSource = extractToolSource(socialToolSource, "generateMerchant");
  const merchantPersistenceSource = trackMerchantSource || generateMerchantSource;
  const establishInitialDispositionSource = extractToolSource(
    socialToolSource,
    "establishInitialDisposition"
  );
  const socialCheckSource = extractToolSource(socialToolSource, "socialCheck");
  const scopedNpcPersistenceSource = [
    trackNPCSource,
    merchantPersistenceSource,
    establishInitialDispositionSource,
  ].join("\n");
  const scopedNpcPersistenceExecutableSource = stripToolDescriptions(
    scopedNpcPersistenceSource
  );

  it("contains the NPC tools under test and keeps socialCheck outside this migration scope", () => {
    expect(trackNPCSource).toContain("trackNPC");
    expect(establishInitialDispositionSource).toContain("establishInitialDisposition");
    expect(merchantPersistenceSource).toMatch(/(?:trackMerchant|generateMerchant)/);
    expect(socialCheckSource).toContain("socialCheck");
  });

  it("expects NPC persistence tools to delegate to the authoritative NPC service", () => {
    expect(socialToolSource).toMatch(
      /import\s*{[\s\S]*\b(trackNpcState|trackMerchantState|establishInitialNpcDisposition)\b[\s\S]*}\s*from\s*["']@\/lib\/rules\/npc-service["']/
    );
  });

  it("does not create, update, or upsert NPC rows directly from trackNPC", () => {
    expect(trackNPCSource).not.toMatch(/\bprisma\.nPC\.(?:create|update|upsert)\s*\(/);
    expect(trackNPCSource).not.toMatch(/\b(?:tx|db)\.nPC\.(?:create|update|upsert)\s*\(/);
  });

  it("does not create, update, or upsert NPC rows directly from merchant tracking", () => {
    expect(merchantPersistenceSource).not.toMatch(
      /\bprisma\.nPC\.(?:create|update|upsert)\s*\(/
    );
    expect(merchantPersistenceSource).not.toMatch(
      /\b(?:tx|db)\.nPC\.(?:create|update|upsert)\s*\(/
    );
  });

  it("does not update or upsert initial disposition directly from establishInitialDisposition", () => {
    expect(establishInitialDispositionSource).not.toMatch(
      /\bprisma\.nPC\.(?:update|upsert)\s*\(/
    );
    expect(establishInitialDispositionSource).not.toMatch(
      /\b(?:tx|db)\.nPC\.(?:update|upsert)\s*\(/
    );
  });

  it("does not persist disposition, met flags, or traits directly from AI tools", () => {
    expect(scopedNpcPersistenceSource).not.toMatch(
      /\b(?:nPC\.(?:create|update|upsert)|data\s*:\s*{)[\s\S]*?\b(disposition|hasMetPlayer|personalityTags|traits)\s*:/
    );
  });

  it("does not generate narrative prose as part of NPC persistence", () => {
    expect(scopedNpcPersistenceExecutableSource).not.toMatch(
      /\b(?:narration|narrative|prose|flavorText|boxed text)\b/i
    );
    expect(scopedNpcPersistenceSource).not.toMatch(
      /\b(?:prisma|tx|db)\.gameLog\.create\s*\(/
    );
  });

  it("does not introduce forbidden retro NPC rules or jargon in scoped tools", () => {
    for (const fragments of forbiddenRuleFragments) {
      expect(scopedNpcPersistenceSource).not.toContain(fragments.join(""));
      expect(scopedNpcPersistenceSource).not.toContain(fragments.join(" "));
    }
  });
});