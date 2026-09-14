import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/campaign/[id]/social/route";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser, AuthError } from "@/lib/auth/session";
import { resolveSocialCheck, SocialServiceError } from "@/lib/rules/social-service";
import {
  acquireActionReceipt,
  completeActionReceiptWithResponse,
  rejectActionReceipt,
} from "@/lib/actions/request-receipt";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    nPC: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: vi.fn(),
  AuthError: class extends Error {},
}));

vi.mock("@/lib/rules/social-service", () => ({
  resolveSocialCheck: vi.fn(),
  SocialServiceError: class extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
}));

vi.mock("@/lib/actions/request-receipt", () => ({
  acquireActionReceipt: vi.fn(),
  completeActionReceiptWithResponse: vi.fn(),
  rejectActionReceipt: vi.fn(),
}));

function request(body: unknown) {
  return new Request("http://test/api/campaign/camp_1/social", {
    method: "POST",
    body: JSON.stringify(body),
  }) as never;
}

const params = Promise.resolve({ id: "camp_1" });

beforeEach(() => {
  vi.clearAllMocks();
  (getAuthUser as never as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "user_1" });
  (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: "user_1",
    status: "active",
  });
  (prisma.nPC.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "npc_1", campaignId: "camp_1", seed: "innkeeper_1", role: "commoner", hasMetPlayer: true,
  });
  (resolveSocialCheck as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true, approach: "persuade", skill: "Persuasion", roll: 12, dc: 15,
    success: false, attitudeBefore: "Indifferent", attitudeAfter: "Hostile",
    dispositionBefore: 0, dispositionAfter: -4,
  });
  (acquireActionReceipt as ReturnType<typeof vi.fn>).mockResolvedValue({
    outcome: "acquired",
    receiptId: "receipt_1",
  });
});

describe("POST /api/campaign/[id]/social", () => {
  it("resolves a social check for the campaign's owner", async () => {
    const response = await POST(request({ npcId: "npc_1", approach: "persuade", intent: "a room" }), { params });

    expect(response.status).toBe(200);
    expect(resolveSocialCheck).toHaveBeenCalledTimes(1);
    expect(resolveSocialCheck).toHaveBeenCalledWith({
      campaignId: "camp_1",
      npcId: "npc_1",
      approach: "persuade",
      intent: "a room",
    });
    await expect(response.json()).resolves.toMatchObject({ attitudeAfter: "Hostile" });
  });

  it("refuses an unauthenticated request", async () => {
    (getAuthUser as never as ReturnType<typeof vi.fn>).mockRejectedValue(
      new AuthError("Not authenticated.")
    );

    const response = await POST(request({ npcId: "npc_1", approach: "persuade", intent: "x" }), { params });

    expect(response.status).toBe(401);
    expect(resolveSocialCheck).not.toHaveBeenCalled();
    expect(prisma.nPC.update).not.toHaveBeenCalled();
  });

  it("refuses a campaign belonging to another user", async () => {
    (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "someone_else", status: "active",
    });
    (prisma.nPC.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "npc_1", campaignId: "camp_1", seed: "innkeeper_1", role: "commoner", hasMetPlayer: false,
    });

    const response = await POST(request({ npcId: "npc_1", approach: "persuade", intent: "x" }), { params });

    expect(response.status).toBe(403);
    expect(resolveSocialCheck).not.toHaveBeenCalled();
    expect(prisma.nPC.update).not.toHaveBeenCalled();
  });

  it("refuses an inactive campaign", async () => {
    (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "user_1", status: "completed",
    });
    (prisma.nPC.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "npc_1", campaignId: "camp_1", seed: "innkeeper_1", role: "commoner", hasMetPlayer: false,
    });

    const response = await POST(request({ npcId: "npc_1", approach: "persuade", intent: "x" }), { params });

    expect(response.status).toBe(409);
    expect(resolveSocialCheck).not.toHaveBeenCalled();
    expect(prisma.nPC.update).not.toHaveBeenCalled();
  });

  it("refuses an unknown approach without resolving anything", async () => {
    const response = await POST(request({ npcId: "npc_1", approach: "seduce", intent: "x" }), { params });

    expect(response.status).toBe(400);
    expect(resolveSocialCheck).not.toHaveBeenCalled();
  });

  it("refuses a body with an extra, unrecognized field", async () => {
    const response = await POST(
      request({ npcId: "npc_1", approach: "persuade", intent: "x", roll: 20 }),
      { params }
    );

    expect(response.status).toBe(400);
    expect(resolveSocialCheck).not.toHaveBeenCalled();
  });

  it("delegates first-contact initialization to the transactional social service", async () => {
    (prisma.nPC.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "npc_1", campaignId: "camp_1", seed: "gate_guard_north", role: "guard", hasMetPlayer: false,
    });

    const response = await POST(request({ npcId: "npc_1", approach: "persuade", intent: "x" }), { params });

    expect(response.status).toBe(200);
    expect(prisma.nPC.update).not.toHaveBeenCalled();
    expect(resolveSocialCheck).toHaveBeenCalledWith({
      campaignId: "camp_1",
      npcId: "npc_1",
      approach: "persuade",
      intent: "x",
    });
  });

  it("does not seed first-contact personality in the route", async () => {
    (prisma.nPC.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "npc_1", campaignId: "camp_1", seed: "gate_guard_north", role: "guard", hasMetPlayer: false,
    });

    await POST(request({ npcId: "npc_1", approach: "persuade", intent: "x" }), { params });

    expect(prisma.nPC.update).not.toHaveBeenCalled();
    expect(resolveSocialCheck).toHaveBeenCalledTimes(1);
  });

  it("does not re-establish contact for an NPC already met", async () => {
    await POST(request({ npcId: "npc_1", approach: "persuade", intent: "x" }), { params });

    expect(prisma.nPC.update).not.toHaveBeenCalled();
  });

  it("forwards a non-persuade approach unchanged", async () => {
    const response = await POST(
      request({ npcId: "npc_1", approach: "intimidate", intent: "x" }),
      { params }
    );

    expect(response.status).toBe(200);
    expect(resolveSocialCheck).toHaveBeenCalledWith(
      expect.objectContaining({ approach: "intimidate" })
    );
  });

  it("refuses an NPC from another campaign", async () => {
    (prisma.nPC.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "npc_1", campaignId: "camp_OTHER", seed: "s", role: "guard", hasMetPlayer: true,
    });

    const response = await POST(request({ npcId: "npc_1", approach: "persuade", intent: "x" }), { params });

    expect(response.status).toBe(404);
    expect(resolveSocialCheck).not.toHaveBeenCalled();
  });

  it("replays a completed social submission without resolving a second check", async () => {
    const firstResult = {
      ok: true, approach: "persuade", skill: "Persuasion", roll: 12, dc: 15,
      success: false, attitudeBefore: "Indifferent", attitudeAfter: "Hostile",
      dispositionBefore: 0, dispositionAfter: -4,
    };
    const laterResult = { ...firstResult, roll: 19, total: 23, dispositionAfter: 4 };
    (resolveSocialCheck as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(firstResult)
      .mockResolvedValueOnce(laterResult);
    (acquireActionReceipt as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ outcome: "acquired", receiptId: "receipt_1" })
      .mockResolvedValueOnce({
        outcome: "completed_replay",
        responseStatus: 200,
        responseBody: firstResult,
      });

    const body = { npcId: "npc_1", approach: "persuade", intent: "a room", requestId: "social_1" };
    const first = await POST(request(body), { params });
    const retry = await POST(request(body), { params });

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toEqual(firstResult);
    expect(resolveSocialCheck).toHaveBeenCalledTimes(1);
    expect(completeActionReceiptWithResponse).toHaveBeenCalledWith("receipt_1", 200, firstResult);
  });

  it.each([
    ["intent", { npcId: "npc_1", approach: "persuade", intent: "different", requestId: "social_1" }],
    ["approach", { npcId: "npc_1", approach: "intimidate", intent: "a room", requestId: "social_1" }],
    ["npcId", { npcId: "npc_2", approach: "persuade", intent: "a room", requestId: "social_1" }],
  ])("refuses a reused requestId for a different %s without resolving", async (_field, body) => {
    (acquireActionReceipt as ReturnType<typeof vi.fn>).mockResolvedValue({ outcome: "reused" });

    const response = await POST(request(body), { params });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "REQUEST_ID_REUSED" });
    expect(resolveSocialCheck).not.toHaveBeenCalled();
  });

  it("allows two different requestIds to resolve independent social submissions", async () => {
    (acquireActionReceipt as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ outcome: "acquired", receiptId: "receipt_1" })
      .mockResolvedValueOnce({ outcome: "acquired", receiptId: "receipt_2" });

    const first = await POST(request({ npcId: "npc_1", approach: "persuade", intent: "a room", requestId: "social_1" }), { params });
    const second = await POST(request({ npcId: "npc_1", approach: "persuade", intent: "a room", requestId: "social_2" }), { params });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(resolveSocialCheck).toHaveBeenCalledTimes(2);
  });

  it("leaves a processing social receipt unknown instead of resolving it again", async () => {
    (acquireActionReceipt as ReturnType<typeof vi.fn>).mockResolvedValue({ outcome: "in_flight" });

    const response = await POST(request({ npcId: "npc_1", approach: "persuade", intent: "a room", requestId: "social_1" }), { params });

    expect(response.status).toBe(409);
    expect(resolveSocialCheck).not.toHaveBeenCalled();
  });

  it("replays a terminal social rejection without resolving again", async () => {
    (acquireActionReceipt as ReturnType<typeof vi.fn>).mockResolvedValue({
      outcome: "rejected",
      responseStatus: 400,
      responseBody: { error: "The NPC cannot be convinced.", code: "SOCIAL_REFUSED" },
    });

    const response = await POST(request({ npcId: "npc_1", approach: "persuade", intent: "a room", requestId: "social_1" }), { params });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "The NPC cannot be convinced.", code: "SOCIAL_REFUSED" });
    expect(resolveSocialCheck).not.toHaveBeenCalled();
  });

  it("settles a terminal social service rejection on the acquired receipt", async () => {
    (resolveSocialCheck as ReturnType<typeof vi.fn>).mockRejectedValue(
      new SocialServiceError("SOCIAL_STATE_CONFLICT", "The NPC cannot be convinced.")
    );

    const response = await POST(request({ npcId: "npc_1", approach: "persuade", intent: "a room", requestId: "social_1" }), { params });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "The NPC cannot be convinced.", code: "SOCIAL_STATE_CONFLICT" });
    expect(rejectActionReceipt).toHaveBeenCalledWith("receipt_1", 400, {
      error: "The NPC cannot be convinced.", code: "SOCIAL_STATE_CONFLICT",
    });
  });
});
