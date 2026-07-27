import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  actionRequest: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  gameSession: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  gameLog: { createMany: vi.fn() },
  gameEventRecord: { create: vi.fn(), createMany: vi.fn() },
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: { $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)) },
}));

import {
  checkpointAcceptedAction,
  rejectPendingActionRequest,
  reserveActionRequest,
} from "@/lib/db/session-journal";

describe("session action journal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.actionRequest.findUnique.mockResolvedValue(null);
    tx.gameSession.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    tx.gameSession.create.mockResolvedValue({ id: "session-1", sessionNumber: 1 });
    tx.actionRequest.create.mockResolvedValue({ id: "request-record-1" });
  });

  it("reserves a durable idempotency key before resolution", async () => {
    await expect(reserveActionRequest({
      campaignId: "campaign-1",
      requestId: "request-123",
      action: "Explore",
    })).resolves.toEqual({
      ok: true,
      duplicate: false,
      requestId: "request-123",
      requestRecordId: "request-record-1",
      sessionId: "session-1",
    });
    expect(tx.actionRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ requestId: "request-123" }),
    }));
  });

  it("rejects a duplicate without creating another request", async () => {
    tx.actionRequest.findUnique.mockResolvedValue({ status: "COMPLETED", sessionId: "session-1" });
    await expect(reserveActionRequest({
      campaignId: "campaign-1",
      requestId: "request-123",
      action: "Explore",
    })).resolves.toMatchObject({ duplicate: true, status: "COMPLETED" });
    expect(tx.actionRequest.create).not.toHaveBeenCalled();
  });

  it("checkpoints transcript, state, request, and ordered events together", async () => {
    tx.gameSession.findUnique.mockResolvedValue({
      status: "ACTIVE",
      mode: "EXPLORATION",
      eventSequence: 7,
    });
    await checkpointAcceptedAction({
      campaignId: "campaign-1",
      sessionId: "session-1",
      requestId: "request-123",
      action: "Search the altar",
      mode: "EXPLORATION",
      events: [{ type: "PLAYER_MOVE", payload: { targetNodeId: "node-2" } }],
    });
    expect(tx.gameSession.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { mode: "EXPLORATION", eventSequence: 9 },
    }));
    expect(tx.actionRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "COMPLETED" },
    }));
    expect(tx.gameLog.createMany).toHaveBeenCalledOnce();
    expect(tx.gameEventRecord.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ sequence: 8, type: "ACTION_ACCEPTED" }),
        expect.objectContaining({ sequence: 9, type: "PLAYER_MOVE" }),
      ]),
    });
  });

  it("uses a caller transaction so mechanics and checkpoint share one commit boundary", async () => {
    tx.gameSession.findUnique.mockResolvedValue({
      status: "ACTIVE",
      mode: "COMBAT",
      eventSequence: 2,
    });
    const transactionMock = (await import("@/lib/db/prisma")).prisma.$transaction as ReturnType<typeof vi.fn>;
    transactionMock.mockClear();

    await checkpointAcceptedAction({
      campaignId: "campaign-1",
      sessionId: "session-1",
      requestId: "request-123",
      action: "Attack",
      mode: "COMBAT",
      events: [],
    }, tx as never);

    expect(transactionMock).not.toHaveBeenCalled();
    expect(tx.actionRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "COMPLETED" },
    }));
  });

  it("turns an abandoned reservation into a durable rejection", async () => {
    tx.actionRequest.findUnique.mockResolvedValue({
      status: "PENDING",
      session: { id: "session-1", eventSequence: 4 },
    });
    await rejectPendingActionRequest({
      campaignId: "campaign-1",
      requestId: "request-123",
    });
    expect(tx.actionRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "REJECTED" },
    }));
    expect(tx.gameSession.update).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: { eventSequence: 5 },
    });
    expect(tx.gameEventRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sequence: 5,
        type: "ACTION_REJECTED",
      }),
    });
  });
});
