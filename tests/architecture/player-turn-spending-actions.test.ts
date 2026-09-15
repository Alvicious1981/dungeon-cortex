import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ACTION_ROUTE = readFileSync(
  join(process.cwd(), "app", "api", "campaign", "[id]", "action", "route.ts"),
  "utf8"
);

interface RouteBranch {
  label: string;
  start: string;
  end: string;
  abortsTransaction: boolean;
}

const TURN_ENDING_BRANCHES: readonly RouteBranch[] = [
  {
    label: "End Turn",
    start: 'if (trimmedAction === "End Turn")',
    end: 'if (trimmedAction === "Attack")',
    abortsTransaction: false,
  },
  {
    label: "macro attack",
    start: 'if (trimmedAction === "Attack")',
    end: 'if (trimmedAction === "Move")',
    abortsTransaction: true,
  },
  {
    label: "ability check",
    start: "// ── Gate: improvised action → ability check",
    end: "// ── Gate: unclassifiable mechanical intent",
    abortsTransaction: true,
  },
  {
    label: "combat spell",
    start: "// ── Gate: cast_spell",
    end: 'if (intent.actionType === "use_item"',
    abortsTransaction: true,
  },
  {
    label: "combat item",
    start: 'if (intent.actionType === "use_item"',
    end: "// ── Gate: equip",
    abortsTransaction: true,
  },
  {
    label: "parsed attack",
    start: "// ── Gate: attack",
    end: "// ── Gate: rest",
    abortsTransaction: true,
  },
];

function branchSource(branch: RouteBranch): string {
  const start = ACTION_ROUTE.indexOf(branch.start);
  const end = ACTION_ROUTE.indexOf(branch.end, start + branch.start.length);

  expect(start, `${branch.label} start marker must exist`).toBeGreaterThanOrEqual(0);
  expect(end, `${branch.label} end marker must follow its start`).toBeGreaterThan(start);

  return ACTION_ROUTE.slice(start, end);
}

function finalizerCall(branch: RouteBranch): string {
  const source = branchSource(branch);
  const start = source.indexOf("finalizeEncounterTurn({");
  const end = source.indexOf("});", start);

  expect(start, `${branch.label} must call the canonical finalizer`).toBeGreaterThanOrEqual(0);
  expect(end, `${branch.label} finalizer call must be complete`).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe("player turn-spending action architecture", () => {
  it("puts every natural-language turn-spending action behind player-turn authority", () => {
    const gateStart = ACTION_ROUTE.indexOf("context.activeEncounter &&");
    const gateEnd = ACTION_ROUTE.indexOf(
      "// ── Gate: improvised action → ability check",
      gateStart
    );
    expect(gateStart).toBeGreaterThanOrEqual(0);
    expect(gateEnd).toBeGreaterThan(gateStart);

    const gate = ACTION_ROUTE.slice(gateStart, gateEnd);
    const gatedTypes = [
      ...gate.matchAll(/intent\.actionType === "([a-z_]+)"/g),
    ].map((match) => match[1]);

    expect(gatedTypes).toEqual([
      "attack",
      "cast_spell",
      "use_item",
      "ability_check",
    ]);
    expect(gate).toContain("playerTurnRefusal(context.activeEncounter)");
  });

  it.each(TURN_ENDING_BRANCHES)(
    "$label finalizes only against the observed turn",
    (branch) => {
      const call = finalizerCall(branch);

      expect(call).toContain("currentTurnIndex:");
      expect(call).toContain("round:");
      expect(call).toContain("failOnStaleTurn: true");
    }
  );

  it.each(TURN_ENDING_BRANCHES.filter((branch) => branch.abortsTransaction))(
    "$label aborts a stale effect before canonical logging",
    (branch) => {
      const source = branchSource(branch);
      const transactionStart = source.indexOf("await prisma.$transaction(async (tx) => {");
      const finalizer = source.indexOf("finalizeEncounterTurn({", transactionStart);
      const conflictCheck = source.indexOf(
        "if (finalizeOutcome.turnAdvanceConflict)",
        finalizer
      );
      const abort = source.indexOf("throw new TurnStateConflictError()", conflictCheck);
      const canonicalLog = source.indexOf("gameLog.create", abort);
      const committedFlag = source.indexOf("playerActionLogged = true", canonicalLog);

      expect(transactionStart).toBeGreaterThanOrEqual(0);
      expect(finalizer).toBeGreaterThan(transactionStart);
      expect(conflictCheck).toBeGreaterThan(finalizer);
      expect(abort).toBeGreaterThan(conflictCheck);
      expect(canonicalLog).toBeGreaterThan(abort);
      expect(committedFlag).toBeGreaterThan(canonicalLog);
    }
  );

  it("has no unnamed fail-closed player finalizer outside the reviewed branches", () => {
    const reviewedCalls = TURN_ENDING_BRANCHES.filter((branch) =>
      finalizerCall(branch).includes("failOnStaleTurn: true")
    );
    const allFailClosedCalls = ACTION_ROUTE.match(/failOnStaleTurn: true/g) ?? [];

    expect(reviewedCalls).toHaveLength(TURN_ENDING_BRANCHES.length);
    expect(allFailClosedCalls).toHaveLength(TURN_ENDING_BRANCHES.length);
  });
});
