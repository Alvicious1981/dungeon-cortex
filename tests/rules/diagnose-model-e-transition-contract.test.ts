import { describe, expect, it, vi } from "vitest";
import {
  runModelETransitionDiagnosis,
  parseArgs,
  type ModelEDiagnosisDb,
  type ModelETransitionCharacterRow,
} from "@/scripts/diagnose-model-e-transition";

function createFakeDb(rows: ModelETransitionCharacterRow[]) {
  const findMany = vi.fn(async (args: { where?: { id?: string } }) => {
    return rows
      .filter((row) => !args.where?.id || row.id === args.where.id)
      .map((row) => ({ ...row }));
  });

  const db = { character: { findMany } } as ModelEDiagnosisDb;
  return { db, findMany };
}

// XP thresholds mirrored only as opaque fixtures (not re-derived rules) —
// level 5 requires 6500 xp per lib/rules/progression.ts.
const XP_L5 = 6500;
const XP_L4 = 2700;
const XP_L2 = 300;
const XP_L1 = 0;

const eSettled: ModelETransitionCharacterRow = {
  id: "settled-1",
  xp: XP_L5,
  level: 5,
  hitDiceTotal: 5,
  hitDiceRemaining: 5,
};

const ePending: ModelETransitionCharacterRow = {
  id: "pending-1",
  xp: XP_L5,
  level: 4,
  hitDiceTotal: 4,
  hitDiceRemaining: 4,
};

const convertibleA: ModelETransitionCharacterRow = {
  id: "convertible-a",
  xp: XP_L5,
  level: 5,
  hitDiceTotal: 4,
  hitDiceRemaining: 4,
};

const convertibleB: ModelETransitionCharacterRow = {
  id: "convertible-b",
  xp: XP_L5,
  level: 5,
  hitDiceTotal: 3,
  hitDiceRemaining: 2,
};

const ambiguous: ModelETransitionCharacterRow = {
  id: "ambiguous-1",
  xp: XP_L2,
  level: 2,
  hitDiceTotal: 1,
  hitDiceRemaining: 1,
};

const invalidProgression: ModelETransitionCharacterRow = {
  id: "invalid-progression-1",
  xp: XP_L1,
  level: 5,
  hitDiceTotal: 5,
  hitDiceRemaining: 5,
};

const invalidHitDice: ModelETransitionCharacterRow = {
  id: "invalid-hit-dice-1",
  xp: XP_L5,
  level: 5,
  hitDiceTotal: 6,
  hitDiceRemaining: 5,
};

describe("runModelETransitionDiagnosis", () => {
  it("1. only E_SETTLED -> resultCode 0", async () => {
    const { db } = createFakeDb([eSettled]);
    const report = await runModelETransitionDiagnosis({ db });

    expect(report.resultCode).toBe(0);
    expect(report.counts.E_SETTLED).toBe(1);
    expect(report.totals.compatibleNoWrite).toBe(1);
    expect(report.totals.convertible).toBe(0);
    expect(report.totals.blocking).toBe(0);
  });

  it("2. E_SETTLED + E_PENDING -> resultCode 0, E_PENDING highlighted", async () => {
    const { db } = createFakeDb([eSettled, ePending]);
    const report = await runModelETransitionDiagnosis({ db });

    expect(report.resultCode).toBe(0);
    expect(report.counts.E_PENDING).toBe(1);
    expect(report.pendingReview.ePendingCount).toBe(1);
    expect(report.totals.compatibleNoWrite).toBe(2);
  });

  it("3. only CONVERTIBLE -> resultCode 2", async () => {
    const { db } = createFakeDb([convertibleA]);
    const report = await runModelETransitionDiagnosis({ db });

    expect(report.resultCode).toBe(2);
    expect(report.totals.convertible).toBe(1);
    expect(report.totals.blocking).toBe(0);
  });

  it("4. multiple CONVERTIBLE -> all appear in convertibleRows", async () => {
    const { db } = createFakeDb([convertibleA, convertibleB]);
    const report = await runModelETransitionDiagnosis({ db });

    expect(report.resultCode).toBe(2);
    expect(report.convertibleRows.map((r) => r.characterId).sort()).toEqual(
      ["convertible-a", "convertible-b"].sort()
    );
    expect(report.convertibleRows.find((r) => r.characterId === "convertible-a")?.patch).toEqual(
      { level: 4 }
    );
    expect(report.convertibleRows.find((r) => r.characterId === "convertible-b")?.patch).toEqual(
      { level: 3 }
    );
  });

  it("5. AMBIGUOUS -> resultCode 1", async () => {
    const { db } = createFakeDb([ambiguous]);
    const report = await runModelETransitionDiagnosis({ db });

    expect(report.resultCode).toBe(1);
    expect(report.totals.blocking).toBe(1);
    expect(report.blockingRows[0].category).toBe("AMBIGUOUS");
  });

  it("6. INVALID_PROGRESSION -> resultCode 1", async () => {
    const { db } = createFakeDb([invalidProgression]);
    const report = await runModelETransitionDiagnosis({ db });

    expect(report.resultCode).toBe(1);
    expect(report.blockingRows[0].category).toBe("INVALID_PROGRESSION");
  });

  it("7. INVALID_HIT_DICE -> resultCode 1", async () => {
    const { db } = createFakeDb([invalidHitDice]);
    const report = await runModelETransitionDiagnosis({ db });

    expect(report.resultCode).toBe(1);
    expect(report.blockingRows[0].category).toBe("INVALID_HIT_DICE");
  });

  it("8. blocking + CONVERTIBLE together -> resultCode 1 (1 beats 2)", async () => {
    const { db } = createFakeDb([convertibleA, ambiguous]);
    const report = await runModelETransitionDiagnosis({ db });

    expect(report.resultCode).toBe(1);
    expect(report.totals.convertible).toBe(1);
    expect(report.totals.blocking).toBe(1);
  });

  it("9. report counts all six categories correctly", async () => {
    const { db } = createFakeDb([
      eSettled,
      ePending,
      convertibleA,
      ambiguous,
      invalidProgression,
      invalidHitDice,
    ]);
    const report = await runModelETransitionDiagnosis({ db });

    expect(report.counts).toEqual({
      E_SETTLED: 1,
      E_PENDING: 1,
      CONVERTIBLE: 1,
      AMBIGUOUS: 1,
      INVALID_PROGRESSION: 1,
      INVALID_HIT_DICE: 1,
    });
    expect(report.totals.inspected).toBe(6);
  });

  it("10. CONVERTIBLE patch is shown but never executed (no write method exists)", async () => {
    const { db } = createFakeDb([convertibleA]);
    const report = await runModelETransitionDiagnosis({ db });

    expect(report.convertibleRows[0].patch).toEqual({ level: 4 });
    expect((db.character as unknown as Record<string, unknown>).update).toBeUndefined();
    expect((db as unknown as Record<string, unknown>).$transaction).toBeUndefined();
  });

  it("11. E_PENDING rows never produce a patch or appear as convertible/blocking", async () => {
    const { db } = createFakeDb([ePending]);
    const report = await runModelETransitionDiagnosis({ db });

    expect(report.convertibleRows).toHaveLength(0);
    expect(report.blockingRows).toHaveLength(0);
    expect(report.counts.E_PENDING).toBe(1);
  });

  it("12. --character-id scopes the where clause to a single row", async () => {
    const { db, findMany } = createFakeDb([eSettled, convertibleA]);
    await runModelETransitionDiagnosis({ db, characterId: "convertible-a" });

    expect(findMany).toHaveBeenCalledWith({
      where: { id: "convertible-a" },
      select: {
        id: true,
        xp: true,
        level: true,
        hitDiceTotal: true,
        hitDiceRemaining: true,
      },
    });
  });

  it("13. without character-id, queries the full scope (where undefined)", async () => {
    const { db, findMany } = createFakeDb([eSettled, convertibleA]);
    const report = await runModelETransitionDiagnosis({ db });

    expect(findMany).toHaveBeenCalledWith({
      where: undefined,
      select: expect.any(Object),
    });
    expect(report.totals.inspected).toBe(2);
  });

  it("19. empty input -> zero rows, resultCode 0", async () => {
    const { db } = createFakeDb([]);
    const report = await runModelETransitionDiagnosis({ db });

    expect(report.totals.inspected).toBe(0);
    expect(report.resultCode).toBe(0);
    expect(report.convertibleRows).toHaveLength(0);
    expect(report.blockingRows).toHaveLength(0);
  });

  it("20. the tool never exposes fields beyond the authorized mechanical set", async () => {
    const { db } = createFakeDb([convertibleA, ambiguous]);
    const report = await runModelETransitionDiagnosis({ db });

    const authorizedConvertibleKeys = [
      "characterId",
      "category",
      "reason",
      "level",
      "targetLevel",
      "hitDiceTotal",
      "pendingLevels",
      "patch",
    ].sort();
    const authorizedBlockingKeys = [
      "characterId",
      "category",
      "reason",
      "xp",
      "level",
      "hitDiceTotal",
      "hitDiceRemaining",
    ].sort();

    expect(Object.keys(report.convertibleRows[0]).sort()).toEqual(authorizedConvertibleKeys);
    expect(Object.keys(report.blockingRows[0]).sort()).toEqual(authorizedBlockingKeys);
    expect(Object.keys(report.convertibleRows[0].patch).sort()).toEqual(["level"]);
  });
});

describe("runModelETransitionDiagnosis — read-only construction", () => {
  it("17. importing the module does not open a real Prisma connection", async () => {
    expect((globalThis as unknown as { prisma?: unknown }).prisma).toBeUndefined();
    await import("@/scripts/diagnose-model-e-transition");
    expect((globalThis as unknown as { prisma?: unknown }).prisma).toBeUndefined();
  });

  it("18. a fake DB exposing only findMany is sufficient — no write method is ever called", async () => {
    const findMany = vi.fn(async () => [convertibleA]);
    const db = { character: { findMany } } as ModelEDiagnosisDb;

    const report = await runModelETransitionDiagnosis({ db });

    expect(report.resultCode).toBe(2);
    expect(Object.keys(db.character)).toEqual(["findMany"]);
    expect(Object.keys(db)).toEqual(["character"]);
  });
});

describe("parseArgs", () => {
  it("14. unknown argument is rejected", () => {
    const result = parseArgs(["--bogus"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Unknown argument");
  });

  it("15. --character-id without a value is rejected", () => {
    const result = parseArgs(["--character-id"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("--character-id requires a value");
  });

  it("--character-id followed by another flag is rejected", () => {
    const result = parseArgs(["--character-id", "--apply"]);
    expect(result.ok).toBe(false);
  });

  it("16. --apply is rejected as a write flag, not as an unknown argument", () => {
    const result = parseArgs(["--apply"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("read-only");
  });

  it("--write, --repair, --force are all rejected as write flags", () => {
    for (const flag of ["--write", "--repair", "--force"]) {
      const result = parseArgs([flag]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("read-only");
    }
  });

  it("no arguments parses to an empty scope", () => {
    const result = parseArgs([]);
    expect(result).toEqual({ ok: true, args: { characterId: undefined } });
  });

  it("--character-id with a valid value parses successfully", () => {
    const result = parseArgs(["--character-id", "char-123"]);
    expect(result).toEqual({ ok: true, args: { characterId: "char-123" } });
  });
});
