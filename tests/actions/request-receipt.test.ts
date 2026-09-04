/**
 * Deterministic half of the idempotency protocol (DC-AUD-003).
 *
 * The `Verify` lane has no PostgreSQL, so what can be proven here is exactly
 * the logic that does not need one: how a submission is fingerprinted, and what
 * an already-existing receipt means for the request that collided with it.
 *
 * What this file CANNOT prove, and does not pretend to: that Postgres enforces
 * the unique index, that a losing insert really raises P2002, or that two
 * concurrent requests are serialised by it. Those live in
 * tests/e2e/action-idempotency.spec.ts, against a real database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionRequestStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  ActionReceiptSettlementError,
  classifyExistingReceipt,
  completeActionReceipt,
  completeActionReceiptWithResponse,
  fingerprintActionRequest,
  rejectActionReceipt,
} from "@/lib/actions/request-receipt";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    actionRequestReceipt: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

describe("fingerprintActionRequest", () => {
  it("is stable for the same mechanically relevant fields", () => {
    const a = fingerprintActionRequest({ action: "Attack", targetIds: ["t1"] });
    const b = fingerprintActionRequest({ action: "Attack", targetIds: ["t1"] });

    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores the order of targetIds", () => {
    // Order carries no mechanical meaning in any gate that reads the array, so
    // a retry that re-sends the same creatures in a different order must be
    // recognised as the same action rather than refused as a payload change.
    const forward = fingerprintActionRequest({
      action: "Cast Fireball",
      targetIds: ["t1", "t2", "t3"],
    });
    const shuffled = fingerprintActionRequest({
      action: "Cast Fireball",
      targetIds: ["t3", "t1", "t2"],
    });

    expect(forward).toBe(shuffled);
  });

  it("treats an absent targetIds and an empty one as the same action", () => {
    // The route already collapses them: `body.targetIds ?? []` then a length
    // check. The fingerprint must not disagree with the code it describes.
    expect(fingerprintActionRequest({ action: "Attack" })).toBe(
      fingerprintActionRequest({ action: "Attack", targetIds: [] })
    );
  });

  it("treats non-integer coordinates as no coordinates", () => {
    // Mirrors the route's own Number.isInteger gate: a fractional or absent
    // square is equally "not aiming anywhere".
    const absent = fingerprintActionRequest({ action: "Move" });
    const fractional = fingerprintActionRequest({
      action: "Move",
      targetX: 1.5,
      targetY: 2.5,
    });

    expect(fractional).toBe(absent);
  });

  it("distinguishes a different action, target set, or square", () => {
    const base = fingerprintActionRequest({ action: "Attack", targetIds: ["t1"] });

    expect(fingerprintActionRequest({ action: "End Turn", targetIds: ["t1"] })).not.toBe(base);
    expect(fingerprintActionRequest({ action: "Attack", targetIds: ["t2"] })).not.toBe(base);
    expect(
      fingerprintActionRequest({ action: "Attack", targetIds: ["t1"], targetX: 1, targetY: 1 })
    ).not.toBe(base);
  });

  it("survives a malformed targetIds instead of turning it into a 500", () => {
    // `targetIds` is client JSON: the TypeScript type is a claim, not a
    // guarantee. The route itself never asserts it is an array — it does
    // `body.targetIds ?? []` and then a length check — so a number or an
    // object reaches a gate today and produces a controlled outcome. The
    // fingerprint runs BEFORE those gates, so if it threw on such input it
    // would convert a controlled 4xx into a brand-new 500.
    const baseline = fingerprintActionRequest({ action: "Attack" });

    for (const malformed of [5, {}, true, null, "abc"]) {
      expect(() =>
        fingerprintActionRequest({
          action: "Attack",
          targetIds: malformed as never,
        })
      ).not.toThrow();
    }

    // Anything that is not an array means "no targets selected", which is what
    // the route's own `?? []` plus length check already amounts to.
    expect(
      fingerprintActionRequest({ action: "Attack", targetIds: 5 as never })
    ).toBe(baseline);
    expect(
      fingerprintActionRequest({ action: "Attack", targetIds: {} as never })
    ).toBe(baseline);
  });

  it("separates a coordinate pair from its transposition", () => {
    // Cheap to get wrong with a sloppy canonical form, and (4,7) is not (7,4).
    expect(fingerprintActionRequest({ action: "Move", targetX: 4, targetY: 7 })).not.toBe(
      fingerprintActionRequest({ action: "Move", targetX: 7, targetY: 4 })
    );
  });
});

describe("classifyExistingReceipt", () => {
  const expected = { campaignId: "camp_1", requestHash: "hash_a" };
  const base = {
    campaignId: "camp_1",
    requestHash: "hash_a",
    responseStatus: null,
    responseBody: null,
  };

  it("refuses an id whose payload changed", () => {
    const verdict = classifyExistingReceipt(
      { ...base, requestHash: "hash_b", status: ActionRequestStatus.COMPLETED },
      expected
    );

    expect(verdict).toEqual({ outcome: "reused" });
  });

  it("refuses an id that already belongs to another campaign", () => {
    const verdict = classifyExistingReceipt(
      { ...base, campaignId: "camp_2", status: ActionRequestStatus.COMPLETED },
      expected
    );

    expect(verdict).toEqual({ outcome: "reused" });
  });

  it("checks identity before status, so a reused id is never answered with the other action's result", () => {
    // A stored 202 belonging to a different payload must not be replayed just
    // because the row happens to be COMPLETED.
    const verdict = classifyExistingReceipt(
      {
        ...base,
        requestHash: "hash_b",
        status: ActionRequestStatus.COMPLETED,
        responseStatus: 202,
        responseBody: { ok: true },
      },
      expected
    );

    expect(verdict).toEqual({ outcome: "reused" });
  });

  it("reports an unsettled receipt as in flight", () => {
    const verdict = classifyExistingReceipt(
      { ...base, status: ActionRequestStatus.PROCESSING },
      expected
    );

    expect(verdict).toEqual({ outcome: "in_flight" });
  });

  it("replays a stored JSON response when one was recorded", () => {
    const verdict = classifyExistingReceipt(
      {
        ...base,
        status: ActionRequestStatus.COMPLETED,
        responseStatus: 202,
        responseBody: { ok: true },
      },
      expected
    );

    expect(verdict).toEqual({
      outcome: "completed_replay",
      responseStatus: 202,
      responseBody: { ok: true },
    });
  });

  it("asks for a duplicate frame when the original was a stream", () => {
    // No stored status is precisely what marks the ordinary SSE action; the
    // absence is the discriminator, so no extra column is needed.
    const verdict = classifyExistingReceipt(
      { ...base, status: ActionRequestStatus.COMPLETED },
      expected
    );

    expect(verdict).toEqual({ outcome: "completed_stream" });
  });

  it("replays a stored mechanical refusal", () => {
    const verdict = classifyExistingReceipt(
      {
        ...base,
        status: ActionRequestStatus.REJECTED,
        responseStatus: 400,
        responseBody: { error: "No active encounter." },
      },
      expected
    );

    expect(verdict).toEqual({
      outcome: "rejected",
      responseStatus: 400,
      responseBody: { error: "No active encounter." },
    });
  });
});

describe("terminal settlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const settlers = [
    ["completion", () => completeActionReceipt("receipt_1")],
    ["JSON completion", () => completeActionReceiptWithResponse("receipt_1", 202, { ok: true })],
    ["rejection", () => rejectActionReceipt("receipt_1", 400, { error: "No." })],
  ] as const;

  it.each(settlers)("%s only transitions a row that is still PROCESSING", async (_label, run) => {
    (prisma.actionRequestReceipt.updateMany as never as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ count: 1 });

    await run();

    // The PROCESSING predicate is what makes a terminal state terminal: a late
    // or duplicate writer matches nothing instead of overwriting a settled row.
    expect(prisma.actionRequestReceipt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "receipt_1", status: ActionRequestStatus.PROCESSING },
      })
    );
  });

  it.each(settlers)("%s fails closed when no PROCESSING row matched", async (_label, run) => {
    // count === 0 means the row is gone or already terminal. Swallowing it
    // would let the caller return an apparently durable response while the
    // receipt still said PROCESSING — so the player's retry would be refused
    // forever for a turn they were told had settled.
    (prisma.actionRequestReceipt.updateMany as never as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ count: 0 });

    await expect(run()).rejects.toBeInstanceOf(ActionReceiptSettlementError);
  });

  it("a receipt that is already terminal cannot be transitioned again", async () => {
    // Simulates the database's own answer for a COMPLETED row: the conditional
    // update matches nothing, and the attempt is refused rather than silently
    // rewriting a settled outcome.
    (prisma.actionRequestReceipt.updateMany as never as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ count: 0 });

    await expect(rejectActionReceipt("receipt_1", 400, { error: "late" })).rejects.toBeInstanceOf(
      ActionReceiptSettlementError
    );
  });
});
