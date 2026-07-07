import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const combatToolPath = join(process.cwd(), "lib", "ai", "tools", "combat.ts");
const combatToolSource = readFileSync(combatToolPath, "utf8");

function extractBalancedBlock(source: string, openBraceIndex: number): string {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBraceIndex + 1, index);
      }
    }
  }

  return "";
}

function extractToolExecuteBody(source: string, toolName: string): string {
  const toolStart = source.indexOf(`${toolName}: tool({`);
  if (toolStart === -1) return "";

  const executeStart = source.indexOf("execute: async", toolStart);
  if (executeStart === -1) return "";

  const arrowStart = source.indexOf("=>", executeStart);
  if (arrowStart === -1) return "";

  const bodyStart = source.indexOf("{", arrowStart);
  if (bodyStart === -1) return "";

  return extractBalancedBlock(source, bodyStart);
}

describe("spawnEncounter architecture: AI tool must delegate encounter spawning", () => {
  const spawnEncounterBody = extractToolExecuteBody(combatToolSource, "spawnEncounter");

  it("extracts only the executable spawnEncounter body", () => {
    expect(combatToolSource).toContain("spawnEncounter: tool({");
    expect(combatToolSource).toContain("resolveAttack: tool({");
    expect(combatToolSource).toContain("generateLoot: tool({");
    expect(spawnEncounterBody).toContain("spawnCombatEncounter");
    expect(spawnEncounterBody).not.toContain("resolveCombatAttack");
    expect(spawnEncounterBody).not.toContain("grantLoot");
  });

  it("delegates to the backend encounter service", () => {
    expect(combatToolSource).toMatch(
      /from\s*["']@\/lib\/rules\/encounter-service["']/
    );
    expect(spawnEncounterBody).toMatch(/\bspawnCombatEncounter\s*\(/);
    expect(spawnEncounterBody).toMatch(/\bJSON\.stringify\s*\(\s*result\s*\)/);
  });

  it("does not use Prisma directly inside spawnEncounter", () => {
    expect(spawnEncounterBody).not.toMatch(/\bprisma\./);
    expect(spawnEncounterBody).not.toMatch(/\bprisma\s+as\s+any\b/);
  });

  it("does not own encounter mechanics inside spawnEncounter", () => {
    expect(spawnEncounterBody).not.toMatch(/\bqueryMonsters\s*\(/);
    expect(spawnEncounterBody).not.toMatch(/\bbuildEncounter\s*\(/);
    expect(spawnEncounterBody).not.toMatch(/\brollInitiative\s*\(/);
    expect(spawnEncounterBody).not.toMatch(/\bacFromInventory\s*\(/);
    expect(spawnEncounterBody).not.toMatch(/\bacFromMonsterData\s*\(/);
    expect(spawnEncounterBody).not.toMatch(/\bbuildMonsterRawData\s*\(/);
    expect(spawnEncounterBody).not.toMatch(/\bxpForCR\s*\(/);
    expect(spawnEncounterBody).not.toMatch(/\bencounterMultiplier\s*\(/);
    expect(spawnEncounterBody).not.toMatch(/\bencounter\.create\s*\(/);
  });
});

describe("resolveAttack architecture: AI tool must delegate combat resolution", () => {
  const resolveAttackBody = extractToolExecuteBody(combatToolSource, "resolveAttack");

  it("extracts only the executable resolveAttack body", () => {
    expect(combatToolSource).toContain("spawnEncounter: tool({");
    expect(combatToolSource).toContain("resolveAttack: tool({");
    expect(resolveAttackBody).toContain("resolveCombatAttack");
    expect(resolveAttackBody).not.toContain("spawnEncounter");
  });

  it("delegates to the backend combat service", () => {
    expect(combatToolSource).toMatch(
      /from\s*["']@\/lib\/rules\/combat-service["']/
    );
    expect(resolveAttackBody).toMatch(/\bresolveCombatAttack\s*\(/);
    expect(resolveAttackBody).toMatch(/\bJSON\.stringify\s*\(\s*result\s*\)/);
  });

  it("does not use Prisma directly inside resolveAttack", () => {
    expect(resolveAttackBody).not.toMatch(/\bprisma\./);
    expect(resolveAttackBody).not.toMatch(/\bprisma\s+as\s+any\b/);
  });

  it("does not call the combat pipeline directly inside resolveAttack", () => {
    expect(resolveAttackBody).not.toMatch(/\bexecuteCombatAction\s*\(/);
  });

  it("does not derive combat beats inside resolveAttack", () => {
    expect(resolveAttackBody).not.toMatch(/\bderiveCombatBeat\s*\(/);
  });

  it("does not update encounter damage totals inside resolveAttack", () => {
    expect(resolveAttackBody).not.toMatch(/\bencounter\.update\s*\(/);
    expect(resolveAttackBody).not.toMatch(
      /\btotalDamageDealt\b[\s\S]{0,120}\bincrement\b|\bincrement\b[\s\S]{0,120}\btotalDamageDealt\b/
    );
  });
});
