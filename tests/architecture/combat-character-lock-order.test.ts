import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const actionRoute = readFileSync(
  join(process.cwd(), "app", "api", "campaign", "[id]", "action", "route.ts"),
  "utf8"
);

describe("combat transaction Character → Combatant lock order", () => {
  it("locks Character before both attack paths enter executeCombatAction", () => {
    const executeCallIndexes = Array.from(
      actionRoute.matchAll(/\bexecuteCombatAction\s*\(/g),
      (match) => match.index
    );

    expect(executeCallIndexes).toHaveLength(4);

    for (const executeCallIndex of [executeCallIndexes[0]!, executeCallIndexes[3]!]) {
      const transactionStart = actionRoute.lastIndexOf(
        "await prisma.$transaction(async (tx) => {",
        executeCallIndex
      );
      const characterLock = actionRoute.lastIndexOf(
        "await lockCharacterForCombatAction(",
        executeCallIndex
      );

      expect(transactionStart).toBeGreaterThanOrEqual(0);
      expect(characterLock).toBeGreaterThan(transactionStart);
      expect(characterLock).toBeLessThan(executeCallIndex);
    }
  });

  it("locks Character before a targeted spell only when slot/concentration has not already done so", () => {
    const spellCallIndex = actionRoute.indexOf(
      "const spellOutcome = await executeCombatAction("
    );
    const transactionStart = actionRoute.lastIndexOf(
      "await prisma.$transaction(async (tx) => {",
      spellCallIndex
    );
    const transactionPrefix = actionRoute.slice(transactionStart, spellCallIndex);

    expect(transactionPrefix).toContain(
      "if (!usesSpellSlot && !effect.concentration && targets.length > 0)"
    );
    expect(transactionPrefix).toContain("await lockCharacterForCombatAction(");
  });

  it("keeps use_item off the Combatant write surface", () => {
    const itemCallIndex = actionRoute.indexOf(
      "const itemOutcome = await executeCombatAction("
    );
    const itemCallEnd = actionRoute.indexOf(
      "}, tx as Prisma.TransactionClient);",
      itemCallIndex
    );

    expect(actionRoute.slice(itemCallIndex, itemCallEnd)).toContain(
      "targetCombatants: []"
    );
  });

  it("takes a PostgreSQL row lock on Character", () => {
    const helperStart = actionRoute.indexOf(
      "async function lockCharacterForCombatAction("
    );
    const routeHandlerStart = actionRoute.indexOf("// ─── Route handler");
    const helperSource = actionRoute.slice(helperStart, routeHandlerStart);

    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(helperSource).toContain('FROM "Character"');
    expect(helperSource).toContain("FOR UPDATE");
  });
});
