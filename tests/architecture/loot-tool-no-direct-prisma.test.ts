import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const combatToolPath = join(process.cwd(), "lib", "ai", "tools", "combat.ts");
const combatToolSource = readFileSync(combatToolPath, "utf8");

function extractToolSource(source: string, toolName: string): string {
  const start = source.indexOf(`${toolName}: tool({`);
  if (start === -1) return "";

  const nextTool = source.indexOf("\n    }),\n\n    ", start);
  const returnClose = source.indexOf("\n    }),\n  };", start);
  const endCandidates = [nextTool, returnClose].filter((index) => index !== -1);
  const end = endCandidates.length > 0 ? Math.min(...endCandidates) : -1;

  return end === -1 ? source.slice(start) : source.slice(start, end);
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

describe("AI tools architecture: generateLoot must not own loot persistence", () => {
  const generateLootSource = extractToolSource(combatToolSource, "generateLoot");
  const spawnEncounterSource = extractToolSource(combatToolSource, "spawnEncounter");
  const resolveAttackSource = extractToolSource(combatToolSource, "resolveAttack");

  it("contains only the generateLoot tool under test", () => {
    expect(generateLootSource).toContain("generateLoot");
    expect(spawnEncounterSource).toContain("spawnEncounter");
    expect(resolveAttackSource).toContain("resolveAttack");
    expect(generateLootSource).not.toContain("spawnEncounter");
    expect(generateLootSource).not.toContain("resolveAttack");
  });

  it("delegates generateLoot to the authoritative loot service", () => {
    expect(combatToolSource).toMatch(
      /import\s*{\s*(?:generateEncounterLoot|applyEncounterLoot|grantLoot)\s*}\s*from\s*["']@\/lib\/rules\/loot-service["']/
    );
    expect(generateLootSource).toMatch(
      /\b(?:generateEncounterLoot|applyEncounterLoot|grantLoot)\s*\(/
    );
  });

  it("does not use prisma directly for loot persistence from generateLoot", () => {
    expect(generateLootSource).not.toMatch(/\bprisma\./);
  });

  it("does not open prisma.$transaction directly from generateLoot", () => {
    expect(generateLootSource).not.toMatch(/\bprisma\.\$transaction\s*\(/);
  });

  it("does not update campaign gold directly from generateLoot", () => {
    expect(generateLootSource).not.toMatch(/\b(?:prisma|tx)\.campaign\.update\s*\(/);
    expect(generateLootSource).not.toMatch(
      /\bcampaign\.update\s*\([\s\S]*?\bdata\s*:\s*{[\s\S]*?\bgold\s*:/
    );
  });

  it("does not create inventory items directly from generateLoot", () => {
    expect(generateLootSource).not.toMatch(/\b(?:prisma|tx)\.inventoryItem\.create\s*\(/);
  });

  it("does not update inventory items directly from generateLoot", () => {
    expect(generateLootSource).not.toMatch(/\b(?:prisma|tx)\.inventoryItem\.update\s*\(/);
    expect(generateLootSource).not.toMatch(
      /\binventoryItem\.update\s*\([\s\S]*?\bdata\s*:\s*{[\s\S]*?\bquantity\s*:/
    );
  });

  it("does not decide and persist mechanical loot from the AI tool", () => {
    expect(generateLootSource).not.toMatch(
      /\bgenerateLootPayload\s*\([\s\S]*?\b(?:prisma|tx)\.\$?/
    );
    expect(generateLootSource).not.toMatch(
      /\bgenerateLootPayload\s*\([\s\S]*?\binventoryItem\.(?:create|update)\s*\(/
    );
  });

  it("does not generate narrative prose as part of loot persistence", () => {
    expect(generateLootSource).not.toMatch(
      /\b(?:prisma|tx)\.(?:campaign|inventoryItem|gameLog)\.(?:update|create)\s*\([\s\S]*?\b(flavorText|narrative|narration|prose)\b/i
    );
  });

  it("does not introduce forbidden retro loot or progression rules", () => {
    for (const fragments of forbiddenRuleFragments) {
      expect(generateLootSource).not.toContain(fragments.join(""));
      expect(generateLootSource).not.toContain(fragments.join(" "));
    }
  });
});
