import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const combatToolPath = join(process.cwd(), "lib", "ai", "tools", "combat.ts");
const combatToolSource = readFileSync(combatToolPath, "utf8");

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

describe("combat AI tools architecture: combat tools must delegate mechanical persistence", () => {
  const spawnEncounterSource = extractToolSource(combatToolSource, "spawnEncounter");
  const resolveAttackSource = extractToolSource(combatToolSource, "resolveAttack");
  const scopedCombatToolSource = `${spawnEncounterSource}\n${resolveAttackSource}`;

  it("isolates spawnEncounter and resolveAttack under test", () => {
    expect(spawnEncounterSource).toContain("spawnEncounter");
    expect(resolveAttackSource).toContain("resolveAttack");
  });

  it("does not import Prisma directly into the combat AI tool module", () => {
    expect(combatToolSource).not.toMatch(
      /import\s*{\s*prisma\s*}\s*from\s*["']@\/lib\/db\/prisma["']/
    );
  });

  it("does not use Prisma directly from spawnEncounter or resolveAttack", () => {
    expect(scopedCombatToolSource).not.toMatch(/\bprisma\./);
  });

  it("does not create or update encounters directly from spawnEncounter or resolveAttack", () => {
    expect(scopedCombatToolSource).not.toMatch(
      /\b(?:prisma|tx|db)\.encounter\.(?:create|update|upsert|delete)\s*\(/
    );
  });

  it("does not create or update combatants directly from spawnEncounter or resolveAttack", () => {
    expect(scopedCombatToolSource).not.toMatch(
      /\b(?:prisma|tx|db)\.combatant\.(?:create|update|upsert|delete|createMany|updateMany|deleteMany)\s*\(/
    );
  });

  it("does not pass Prisma as the combat pipeline transaction boundary", () => {
    expect(resolveAttackSource).not.toMatch(
      /\bexecuteCombatAction\s*\([\s\S]*?\bprisma\s+as\s+any\b[\s\S]*?\)/
    );
  });

  it("does not increment encounter totalDamageDealt outside the combat pipeline", () => {
    expect(scopedCombatToolSource).not.toMatch(
      /\btotalDamageDealt\s*:\s*{\s*increment\s*:/
    );
  });
});
