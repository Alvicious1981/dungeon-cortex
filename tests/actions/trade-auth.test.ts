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

async function callTrade() {
  return executeTradeAction(CAMPAIGN_ID, "buy", 0, undefined, 1, "seed-1", "blacksmith");
}

describe("executeTradeAction auth handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves an Unauthorized TradeResult when getAuthUser rejects with AuthError, without starting a transaction", async () => {
    const { AuthError } = await import("@/lib/auth/session");
    (getAuthUser as any).mockRejectedValue(new AuthError("Not authenticated: private mode is not enabled."));

    const result = await callTrade();

    expect(result).toEqual({
      success: false,
      action: "buy",
      itemName: "Unknown",
      quantity: 0,
      goldDelta: 0,
      newGoldBalance: 0,
      error: "Unauthorized",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("propagates a non-AuthError failure from getAuthUser instead of transforming it into Unauthorized", async () => {
    const boom = new Error("database connection lost");
    (getAuthUser as any).mockRejectedValue(boom);

    await expect(callTrade()).rejects.toThrow("database connection lost");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
