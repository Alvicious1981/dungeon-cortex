import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const routePath = join(
  process.cwd(),
  "app",
  "api",
  "campaign",
  "[id]",
  "magic",
  "cast",
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

describe("magic cast route architecture: route must delegate spell-slot persistence", () => {
  it("scopes this migration guard to the POST handler", () => {
    expect(postSource).toContain("POST");
    expect(routeSource).toContain("magic");
    expect(routeSource).toContain("cast");
  });

  it("does not use prisma.character.update directly from POST", () => {
    expect(postSource).not.toMatch(/\bprisma\.character\.update\s*\(/);
  });

  it("does not persist character.spellSlots directly from POST", () => {
    expect(postSource).not.toMatch(
      /\bdata\s*:\s*{[\s\S]*?\bspellSlots\s*:/
    );
  });

  it("does not decrement spell slots directly inside the route", () => {
    expect(postSource).not.toMatch(/\bconsumeSlot\s*\(/);
    expect(postSource).not.toMatch(/\bcurrent\s*-\s*1\b/);
    expect(postSource).not.toMatch(/\bcurrent\s*--/);
  });

  it("does not decide and persist mechanical slot spending in the same handler", () => {
    expect(postSource).not.toMatch(
      /\bhasAvailableSlot\s*\([\s\S]*?\bprisma\.character\.update\s*\(/
    );
    expect(postSource).not.toMatch(
      /\bconsumeSlot\s*\([\s\S]*?\bprisma\.character\.update\s*\(/
    );
  });

  it("does not duplicate pure magic slot logic that belongs behind magic-service", () => {
    expect(postSource).not.toMatch(
      /\b(?:isSpellSlots|hasAvailableSlot|consumeSlot)\s*\(/
    );
  });

  it("delegates spell casting to the backend magic service", () => {
    expect(routeSource).toMatch(/from\s*["']@\/lib\/rules\/magic-service["']/);
    expect(postSource).toMatch(/\bcastSpell\s*\(/);
  });

  it("does not generate narrative prose as part of persistence", () => {
    expect(postSource).not.toMatch(
      /\b(?:narration|narrative|prose|flavorText|boxed text)\b/i
    );
    expect(postSource).not.toMatch(
      /\b(?:prisma|tx|db)\.gameLog\.create\s*\(/
    );
  });

  it("does not introduce forbidden retro magic rules or jargon", () => {
    for (const fragments of forbiddenRuleFragments) {
      expect(postSource).not.toContain(fragments.join(""));
      expect(postSource).not.toContain(fragments.join(" "));
    }
  });
});
