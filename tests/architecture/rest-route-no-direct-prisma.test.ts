import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const routePath = join(
  process.cwd(),
  "app",
  "api",
  "campaign",
  "[id]",
  "rest",
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

describe("rest route architecture: route must delegate rest persistence", () => {
  it("scopes this migration guard to the POST handler", () => {
    expect(postSource).toContain("POST");
    expect(routeSource).toContain("rest");
  });

  it("does not use prisma.character.update directly from POST", () => {
    expect(postSource).not.toMatch(/\bprisma\.character\.update\s*\(/);
  });

  it("does not persist character.hp directly from POST", () => {
    expect(postSource).not.toMatch(
      /\bdata\s*:\s*{[\s\S]*?\bhp\s*:/
    );
  });

  it("does not persist character.spellSlots directly from POST", () => {
    expect(postSource).not.toMatch(
      /\bdata\s*:\s*{[\s\S]*?\bspellSlots\s*:/
    );
  });

  it("does not restore spell slots directly inside the route", () => {
    expect(postSource).not.toMatch(/\brestoreAllSlots\s*\(/);
    expect(postSource).not.toMatch(/\bisSpellSlots\s*\(/);
  });

  it("does not roll Hit Dice directly inside the route", () => {
    expect(postSource).not.toMatch(/\broll\s*\(/);
    expect(postSource).not.toMatch(/\bhitDieForClass\s*\(/);
    expect(postSource).not.toMatch(/\b1d\$\{hitDie\}/);
  });

  it("does not decide and persist mechanical rest in the same handler", () => {
    expect(postSource).not.toMatch(
      /\b(body\.type|restType)\b[\s\S]*?\bprisma\.character\.update\s*\(/
    );
    expect(postSource).not.toMatch(
      /\bMath\.(?:min|max)\s*\([\s\S]*?\bprisma\.character\.update\s*\(/
    );
  });

  it("does not duplicate pure magic or rest helpers that belong behind rest-service", () => {
    expect(postSource).not.toMatch(
      /\b(?:restoreAllSlots|isSpellSlots|abilityModifier|hitDieForClass)\s*\(/
    );
  });

  it("delegates rest resolution to the backend rest service", () => {
    expect(routeSource).toMatch(/from\s*["']@\/lib\/rules\/rest-service["']/);
    expect(postSource).toMatch(/\bresolveRest\s*\(/);
  });

  it("does not generate narrative prose as part of persistence", () => {
    expect(postSource).not.toMatch(
      /\b(?:narration|narrative|prose|flavorText|boxed text)\b/i
    );
    expect(postSource).not.toMatch(
      /\b(?:prisma|tx|db)\.gameLog\.create\s*\(/
    );
  });

  it("does not introduce forbidden retro rest rules or jargon", () => {
    for (const fragments of forbiddenRuleFragments) {
      expect(postSource).not.toContain(fragments.join(""));
      expect(postSource).not.toContain(fragments.join(" "));
    }
  });
});
