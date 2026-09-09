import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { persistMoveTransition } from "@/lib/db/move-transition";

function transactionWithClaimCount(count: number) {
  return {
    combatant: {
      updateMany: vi.fn(async () => ({ count })),
    },
    gameLog: {
      create: vi.fn(async () => ({ id: "log_1" })),
    },
  };
}

const input = {
  campaignId: "camp_1",
  combatantId: "combatant_1",
  expectedFromX: 1,
  expectedFromY: 2,
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
    expect(tx.gameLog.create).toHaveBeenCalledWith({
      data: {
        campaignId: "camp_1",
        role: "user",
        content: "Move",
      },
    });
    expect(tx.combatant.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.gameLog.create.mock.invocationCallOrder[0]
    );
  });

  it("returns stale without creating history after a zero-row origin claim", async () => {
    const tx = transactionWithClaimCount(0);

    const result = await persistMoveTransition(tx as unknown as Prisma.TransactionClient, input);

    expect(result).toBe("stale");
    expect(tx.gameLog.create).not.toHaveBeenCalled();
  });

  it("propagates history failure so the owning database transaction can roll back", async () => {
    const tx = transactionWithClaimCount(1);
    tx.gameLog.create.mockRejectedValueOnce(new Error("history unavailable"));

    await expect(
      persistMoveTransition(tx as unknown as Prisma.TransactionClient, input)
    ).rejects.toThrow("history unavailable");
  });
});
