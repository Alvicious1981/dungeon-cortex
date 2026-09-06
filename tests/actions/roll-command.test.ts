/**
 * tests/actions/roll-command.test.ts
 *
 * The `/roll` handler extracted from the action route in DC-AUD-008.
 *
 * Two things are pinned here, because the extraction could silently break
 * either one:
 *
 *   1. The handler's own contract — order of writes, status, body, receipt
 *      settlement, and the fact that bad notation is answered rather than
 *      refused.
 *   2. The boundary the route kept: the prefix carries a trailing space, so
 *      `/roll` on its own is NOT a roll command and must still fall through to
 *      the intent gates. That is the invariant most easily lost by "tidying"
 *      the constant, and nothing else in the suite covers it.
 *
 * `roll()` itself is deliberately NOT mocked: mocking the dice would leave this
 * file asserting against its own fixture instead of the rule. `Math.random` is
 * pinned instead where an exact string is needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", async (importActual) => {
  const actual = await importActual<typeof import("next/server")>();
  return { ...actual, after: vi.fn((fn: () => void) => fn()) };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    gameLog: {
      create: vi.fn(),
      count: vi.fn(async () => 1),
      findMany: vi.fn(async () => []),
    },
    character: { findUnique: vi.fn(async () => null) },
  },
}));

// Partial: only the settlement this handler performs is replaced. Everything
// else the route imports from this module stays real.
vi.mock("@/lib/actions/request-receipt", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/actions/request-receipt")>();
  return { ...actual, completeActionReceiptWithResponse: vi.fn(async () => {}) };
});

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: vi.fn(async () => ({ id: "user_1" })),
  AuthError: class extends Error {},
}));
vi.mock("@/lib/memory/context", () => ({ buildCampaignContext: vi.fn() }));
vi.mock("@/lib/ai/intent", () => ({ parseIntent: vi.fn() }));
vi.mock("@/lib/ai/narrator", () => ({
  streamNarrative: vi.fn(async () => ({
    textStream: (async function* () { yield "ok"; })(),
    textPromise: Promise.resolve("ok"),
    levelUpPayload: Promise.resolve(null),
    merchantPayload: Promise.resolve(null),
  })),
}));

import {
  ROLL_COMMAND_PREFIX,
  resolveRollCommand,
} from "@/lib/actions/roll-command";
import { prisma } from "@/lib/db/prisma";
import { completeActionReceiptWithResponse } from "@/lib/actions/request-receipt";

const campaignId = "camp_1";

/** Records the order of the handler's side effects as they happen. */
let sequence: string[];

/** Stands in for the route's single idempotent writer of the player's line. */
function makePersist() {
  return vi.fn(async () => {
    sequence.push("user");
  });
}

function systemContent(): string | undefined {
  const calls = (prisma.gameLog.create as ReturnType<typeof vi.fn>).mock.calls;
  const call = calls.find((args) => args[0]?.data?.role === "system");
  return call?.[0]?.data?.content;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  sequence = [];
  (prisma.gameLog.create as ReturnType<typeof vi.fn>).mockImplementation(
    async () => {
      sequence.push("system");
      return {};
    }
  );
  (completeActionReceiptWithResponse as ReturnType<typeof vi.fn>).mockImplementation(
    async () => {
      sequence.push("settle");
    }
  );
});

describe("resolveRollCommand: the contract the route used to own", () => {
  it("answers a valid expression with 202 and { ok: true }", async () => {
    const res = await resolveRollCommand({
      campaignId,
      trimmedAction: "/roll 1d20+5",
      persistPlayerAction: makePersist(),
    });

    expect(res.status).toBe(202);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it("writes the resolved roll as a system line", async () => {
    // Pinned so the asserted string is the rule's output, not a guess: every
    // die reads 1 at the bottom of its range.
    vi.spyOn(Math, "random").mockReturnValue(0);

    await resolveRollCommand({
      campaignId,
      trimmedAction: "/roll 1d20+5",
      persistPlayerAction: makePersist(),
    });

    expect(prisma.gameLog.create).toHaveBeenCalledWith({
      data: {
        campaignId,
        role: "system",
        content: "🎲 Roll 1d20+5: [1] +5 = **6**",
      },
    });
  });

  it("omits the modifier from the line when there is none", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    await resolveRollCommand({
      campaignId,
      trimmedAction: "/roll 2d6",
      persistPlayerAction: makePersist(),
    });

    expect(systemContent()).toBe("🎲 Roll 2d6: [1, 1] = **2**");
  });

  it("writes the player's command before the result that answers it", async () => {
    const persistPlayerAction = makePersist();

    await resolveRollCommand({
      campaignId,
      trimmedAction: "/roll 1d20",
      persistPlayerAction,
    });

    expect(persistPlayerAction).toHaveBeenCalledTimes(1);
    expect(sequence.indexOf("user")).toBeLessThan(sequence.indexOf("system"));
  });

  it("settles the receipt with the exact body a duplicate must receive", async () => {
    const res = await resolveRollCommand({
      campaignId,
      trimmedAction: "/roll 1d20",
      receiptId: "receipt_1",
      persistPlayerAction: makePersist(),
    });

    expect(completeActionReceiptWithResponse).toHaveBeenCalledTimes(1);
    expect(completeActionReceiptWithResponse).toHaveBeenCalledWith(
      "receipt_1",
      202,
      { ok: true }
    );
    // The stored body and the returned body are the same object's contents:
    // a replay must be indistinguishable from the original answer.
    await expect(res.json()).resolves.toEqual({ ok: true });
    // Settled only once the mechanical writes are done.
    expect(sequence).toEqual(["user", "system", "settle"]);
  });

  it("settles nothing when the submission carried no receipt", async () => {
    const res = await resolveRollCommand({
      campaignId,
      trimmedAction: "/roll 1d20",
      persistPlayerAction: makePersist(),
    });

    expect(completeActionReceiptWithResponse).not.toHaveBeenCalled();
    expect(res.status).toBe(202);
  });

  it("propagates a failed settlement instead of answering 202", async () => {
    // No try/catch around the settlement: answering 202 while the receipt
    // stayed PROCESSING would claim a durable idempotency that does not exist.
    (completeActionReceiptWithResponse as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("receipt write failed"));

    await expect(
      resolveRollCommand({
        campaignId,
        trimmedAction: "/roll 1d20",
        receiptId: "receipt_1",
        persistPlayerAction: makePersist(),
      })
    ).rejects.toThrow("receipt write failed");
  });
});

describe("resolveRollCommand: bad notation is answered, not refused", () => {
  it("still returns 202 and still logs the player's command", async () => {
    const persistPlayerAction = makePersist();

    const res = await resolveRollCommand({
      campaignId,
      trimmedAction: "/roll not-dice",
      persistPlayerAction,
    });

    expect(res.status).toBe(202);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(persistPlayerAction).toHaveBeenCalledTimes(1);
  });

  it("names the rejected notation in the system line", async () => {
    await resolveRollCommand({
      campaignId,
      trimmedAction: "/roll not-dice",
      persistPlayerAction: makePersist(),
    });

    expect(systemContent()).toBe(
      '⚠️ Invalid dice notation: "not-dice". Use format like 1d20+5 or 2d6.'
    );
  });

  it("refuses a die count of zero the way the rule does, without a 4xx", async () => {
    // `roll` throws RangeError, not SyntaxError, for this one. Both are caught.
    const res = await resolveRollCommand({
      campaignId,
      trimmedAction: "/roll 0d6",
      persistPlayerAction: makePersist(),
    });

    expect(res.status).toBe(202);
    expect(systemContent()).toContain("Invalid dice notation");
  });
});

describe("resolveRollCommand: parsing of the command text", () => {
  it("strips only the prefix, then trims what is left", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    await resolveRollCommand({
      campaignId,
      trimmedAction: "/roll    2d6   ",
      persistPlayerAction: makePersist(),
    });

    expect(systemContent()).toBe("🎲 Roll 2d6: [1, 1] = **2**");
  });

  it("slices by length, so an upper-case command keeps its notation", async () => {
    // The route lower-cases only to decide; the text it hands over is the
    // player's own. Slicing by prefix LENGTH is what makes that safe.
    vi.spyOn(Math, "random").mockReturnValue(0);

    await resolveRollCommand({
      campaignId,
      trimmedAction: "/ROLL 2d6",
      persistPlayerAction: makePersist(),
    });

    expect(systemContent()).toBe("🎲 Roll 2d6: [1, 1] = **2**");
  });
});

describe("the prefix boundary the route still owns", () => {
  it("carries a trailing space, so a bare /roll cannot match it", () => {
    expect(ROLL_COMMAND_PREFIX).toBe("/roll ");
    expect("/roll".toLowerCase().startsWith(ROLL_COMMAND_PREFIX)).toBe(false);
    expect("/roll 1d20".toLowerCase().startsWith(ROLL_COMMAND_PREFIX)).toBe(true);
    expect("/ROLL 1d20".toLowerCase().startsWith(ROLL_COMMAND_PREFIX)).toBe(true);
  });

  it("leaves a bare /roll to the intent gates, unrolled", async () => {
    // The regression this guards: shortening the prefix to "/roll" would route
    // a bare `/roll` into the handler, where `slice(5).trim()` yields "" and
    // the player gets an invalid-notation line instead of narration.
    const { POST } = await import("@/app/api/campaign/[id]/action/route");
    const { parseIntent } = await import("@/lib/ai/intent");
    const { buildCampaignContext } = await import("@/lib/memory/context");

    (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: campaignId,
      userId: "user_1",
      status: "active",
    });
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue({
      character: { id: "char_1", stats: {}, inventory: [] },
      activeEncounter: null,
      currentExploration: null,
    });
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      actionType: "general",
    });

    const res = await POST(
      new Request("http://localhost/api/campaign/camp_1/action", {
        method: "POST",
        body: JSON.stringify({ action: "/roll" }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
      { params: Promise.resolve({ id: campaignId }) }
    );

    // It reached the intent branch rather than the roll handler...
    expect(parseIntent).toHaveBeenCalledWith("/roll");
    // ...and nothing rolled a die on its behalf.
    expect(systemContent()).toBeUndefined();
    expect(res.status).toBe(200);
  });
});
