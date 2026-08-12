import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const routePath = join(
  process.cwd(),
  "app",
  "api",
  "campaign",
  "[id]",
  "level-up",
  "route.ts"
);
const routeSource = readFileSync(routePath, "utf8");

function extractPostSource(source: string): string {
  const start = source.indexOf("export async function POST");
  if (start === -1) return "";
  return source.slice(start);
}

const postSource = extractPostSource(routeSource);

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

describe("level-up route architecture: route must delegate progression persistence", () => {
  it("scopes this migration guard to the POST handler", () => {
    expect(postSource).toContain("POST");
    expect(routeSource).toContain("level-up");
  });

  it("does not use prisma.character writes directly from POST", () => {
    expect(postSource).not.toMatch(/\bprisma\.character\.(update|updateMany|upsert)\s*\(/);
  });

  it("does not persist character.level directly from POST", () => {
    expect(postSource).not.toMatch(/\bdata\s*:\s*{[\s\S]*?\blevel\s*:/);
  });

  it("does not persist character.hp or hit dice directly from POST", () => {
    expect(postSource).not.toMatch(/\bdata\s*:\s*{[\s\S]*?\bhp\s*:/);
    expect(postSource).not.toMatch(/\bdata\s*:\s*{[\s\S]*?\bhitDice(Total|Remaining)\s*:/);
  });

  it("does not roll dice or compute hit points directly inside the route", () => {
    expect(postSource).not.toMatch(/\broll\s*\(/);
    expect(postSource).not.toMatch(/\brollHitPointGain\s*\(/);
    expect(postSource).not.toMatch(/\b1d\$\{hitDie\}/);
  });

  it("does not duplicate the XP/level/hit-die mechanics that belong behind level-up-service", () => {
    expect(postSource).not.toMatch(
      /\b(?:getLevelFromXP|xpForLevel|canLevelUp|computeXPAward|buildLevelUpPayload|HIT_DIE_MAP)\s*[(:]/
    );
    expect(postSource).not.toMatch(/\bXP_THRESHOLDS\b/);
  });

  it("does not decide and persist mechanical progression in the same handler", () => {
    expect(postSource).not.toMatch(
      /\buseAverage\b[\s\S]*?\bprisma\.character\.(update|updateMany)\s*\(/
    );
    expect(postSource).not.toMatch(
      /\bMath\.(?:min|max|floor|ceil|random)\s*\([\s\S]*?\bprisma\.character\.(update|updateMany)\s*\(/
    );
  });

  it("delegates level-up resolution to the backend level-up service", () => {
    expect(routeSource).toMatch(/from\s*["']@\/lib\/rules\/level-up-service["']/);
    expect(postSource).toMatch(/\bapplyLevelUp\s*\(/);
  });

  it("does not generate narrative prose as part of persistence", () => {
    expect(postSource).not.toMatch(
      /\b(?:narration|narrative|prose|flavorText|boxed text)\b/i
    );
    expect(postSource).not.toMatch(/\b(?:prisma|tx|db)\.gameLog\.create\s*\(/);
  });

  it("does not introduce forbidden retro rules or jargon", () => {
    for (const fragments of forbiddenRuleFragments) {
      expect(postSource).not.toContain(fragments.join(""));
      expect(postSource).not.toContain(fragments.join(" "));
    }
  });
});
