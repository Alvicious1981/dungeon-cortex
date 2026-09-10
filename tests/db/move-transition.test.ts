import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { persistMoveTransition } from "@/lib/db/move-transition";

function transactionWithClaimCount(count: number) {
  return {
    combatant: {
      updateMany: vi.fn(async () => ({ count })),
    },
    encounter: {
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    gameLog: {
      create: vi.fn(async () => ({ id: "log_1" })),
    },
  };
}

const input = {
  campaignId: "camp_1",
  encounterId: "encounter_1",
  combatantId: "combatant_1",
  expectedFromX: 1,
  expectedFromY: 2,
  expectedRound: 1,
  expectedTurnIndex: 0,
  expectedMovementSpentFt: 10,
  requestedDistanceFt: 15,
  speedFt: 30,
  targetX: 4,
  targetY: 2,
  playerAction: "Move",
};

describe("persistMoveTransition", () => {
  it("claims the exact expected origin before persisting canonical history", async () => {
    const tx = transactionWithClaimCount(1);

    const result = await persistMoveTransition(tx as unknown as Prisma.TransactionClient, input);

    expect(result).toBe("claimed");
    expect(tx.combatant.updateMany).toHaveBeenCalledWith({
      where: {
        id: "combatant_1",
        x: 1,
        y: 2,
      },
      data: { x: 4, y: 2 },
    });
    expect(tx.encounter.updateMany).toHaveBeenCalledWith({
      where: {
        id: "encounter_1",
        status: "active",
        round: 1,
        currentTurnIndex: 0,
        currentTurnMovementSpentFt: { equals: 10, lte: 15 },
      },
      data: { currentTurnMovementSpentFt: { increment: 15 } },
    });
    expect(tx.gameLog.create).toHaveBeenCalledWith({
      data: {
        campaignId: "camp_1",
        role: "user",
        content: "Move",
      },
    });
    expect(tx.combatant.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.encounter.updateMany.mock.invocationCallOrder[0]
    );
    expect(tx.encounter.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.gameLog.create.mock.invocationCallOrder[0]
    );
  });

  it("returns stale without creating history after a zero-row origin claim", async () => {
    const tx = transactionWithClaimCount(0);

    const result = await persistMoveTransition(tx as unknown as Prisma.TransactionClient, input);

    expect(result).toBe("stale");
    expect(tx.encounter.updateMany).not.toHaveBeenCalled();
    expect(tx.gameLog.create).not.toHaveBeenCalled();
  });

  it("refuses an observed exhausted budget before any canonical mutation", async () => {
    const tx = transactionWithClaimCount(1);

    const result = await persistMoveTransition(
      tx as unknown as Prisma.TransactionClient,
      { ...input, expectedMovementSpentFt: 20, requestedDistanceFt: 15 }
    );

    expect(result).toBe("budget-exceeded");
    expect(tx.combatant.updateMany).not.toHaveBeenCalled();
    expect(tx.encounter.updateMany).not.toHaveBeenCalled();
    expect(tx.gameLog.create).not.toHaveBeenCalled();
  });

  it("throws after a lost Encounter claim so the origin claim cannot commit", async () => {
    const tx = transactionWithClaimCount(1);
    tx.encounter.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      persistMoveTransition(tx as unknown as Prisma.TransactionClient, input)
    ).rejects.toMatchObject({ name: "MoveStateConflictError" });
    expect(tx.gameLog.create).not.toHaveBeenCalled();
  });

  it("propagates history failure so the owning database transaction can roll back", async () => {
    const tx = transactionWithClaimCount(1);
    tx.gameLog.create.mockRejectedValueOnce(new Error("history unavailable"));

    await expect(
      persistMoveTransition(tx as unknown as Prisma.TransactionClient, input)
    ).rejects.toThrow("history unavailable");
  });

  it("allows only one concurrent claim to spend the same remaining movement", async () => {
    let persistedSpentFt = 20;
    let canonicalLogs = 0;

    const transaction = (combatantId: string) => ({
      combatant: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      encounter: {
        updateMany: vi.fn(async ({ where, data }) => {
          const expected = where.currentTurnMovementSpentFt.equals;
          const maximumBeforeClaim = where.currentTurnMovementSpentFt.lte;
          if (persistedSpentFt !== expected || persistedSpentFt > maximumBeforeClaim) {
            return { count: 0 };
          }
          persistedSpentFt += data.currentTurnMovementSpentFt.increment;
          return { count: 1 };
        }),
      },
      gameLog: {
        create: vi.fn(async () => {
          canonicalLogs += 1;
          return { id: `log_${combatantId}` };
        }),
      },
    });

    const firstTx = transaction("combatant_1");
    const secondTx = transaction("combatant_2");
    const sharedBudgetInput = {
      ...input,
      expectedMovementSpentFt: 20,
      requestedDistanceFt: 10,
    };

    const results = await Promise.allSettled([
      persistMoveTransition(
        firstTx as unknown as Prisma.TransactionClient,
        { ...sharedBudgetInput, combatantId: "combatant_1" }
      ),
      persistMoveTransition(
        secondTx as unknown as Prisma.TransactionClient,
        { ...sharedBudgetInput, combatantId: "combatant_2" }
      ),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(persistedSpentFt).toBe(30);
    expect(canonicalLogs).toBe(1);
  });
});
