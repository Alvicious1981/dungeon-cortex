import { describe, it, expect, vi, beforeEach } from "vitest";

import { executeTradeAction } from "@/app/actions/trade";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";

vi.mock("@/lib/db/prisma", () => ({
  prisma: { $transaction: vi.fn() },
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: vi.fn(),
  AuthError: class extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "AuthError";
    }
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const CAMPAIGN_ID = "camp_1";

function buy(quantity: number) {
  return executeTradeAction(CAMPAIGN_ID, "buy", 0, undefined, quantity, "seed-1", "blacksmith");
}

function sell(quantity: number) {
  return executeTradeAction(CAMPAIGN_ID, "sell", undefined, "inv_1", quantity, "seed-1", "blacksmith");
}

describe("executeTradeAction quantity validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getAuthUser as any).mockResolvedValue({ id: "user_1" });
  });

  /**
   * The exploit this guard exists for. With a negative quantity, `totalCost`
   * is negative, so `campaign.gold < totalCost` is false and the insufficient
   * funds check passes. The update then reaches `gold: { decrement: -50 }`,
   * and decrementing by a negative raises the balance.
   */
  it("rejects a negative buy quantity before opening a transaction", async () => {
    const result = await buy(-5);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.goldDelta).toBe(0);
  });

  it("rejects a negative sell quantity before opening a transaction", async () => {
    const result = await sell(-5);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.goldDelta).toBe(0);
  });

  it("rejects a zero quantity before opening a transaction", async () => {
    const result = await buy(0);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  it("rejects a fractional quantity before opening a transaction", async () => {
    const result = await buy(1.5);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  it("rejects a non-finite quantity before opening a transaction", async () => {
    const result = await buy(Number.POSITIVE_INFINITY);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  /**
   * The falsification guard. Without this, a validator that rejected every
   * quantity would satisfy every assertion above.
   */
  it("lets a valid quantity through to the transaction", async () => {
    (prisma.$transaction as any).mockResolvedValue({
      success: true,
      action: "buy",
      itemName: "Rope",
      quantity: 2,
      goldDelta: -20,
      newGoldBalance: 80,
    });

    const result = await buy(2);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });
});
