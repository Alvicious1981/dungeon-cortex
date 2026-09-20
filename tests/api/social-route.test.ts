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

const prismaTx = vi.hoisted(() => ({
  $queryRaw: vi.fn(async () => [{ id: "camp_1" }]),
  gameLog: {
    create: vi.fn(async (args: unknown) => ({ id: "log_1", ...(args as object) })),
  },
  campaign: {
    findUnique: vi.fn(),
  },
  campaignSceneParticipant: {
    findUnique: vi.fn(),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    nPC: { findUnique: vi.fn(), update: vi.fn() },
    campaignSceneParticipant: { findUnique: vi.fn() },
    gameLog: {
      create: vi.fn(async (args: unknown) => ({ id: "log_global", ...(args as object) })),
    },
    $transaction: vi.fn(async (fn: (tx: typeof prismaTx) => Promise<unknown>) => fn(prismaTx)),
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
  (prismaTx.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "camp_1" }]);
  (prismaTx.campaign.findUnique as ReturnType<typeof vi.fn>).mockImplementation(
    (args: any) => prisma.campaign.findUnique(args)
  );
  (prismaTx.campaignSceneParticipant.findUnique as ReturnType<typeof vi.fn>).mockImplementation(
    (args: any) => prisma.campaignSceneParticipant.findUnique(args)
  );
  (getAuthUser as never as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "user_1" });
  (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: "user_1",
    status: "active",
    scenePresenceVersion: 0,
  });
  (prisma.nPC.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "npc_1", campaignId: "camp_1", seed: "innkeeper_1", role: "commoner", hasMetPlayer: true,
  });
  (prisma.campaignSceneParticipant.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
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
      tx: prismaTx,
    });
    await expect(response.json()).resolves.toMatchObject({ attitudeAfter: "Hostile" });
  });

  it("writes exactly one canonical system GameLog on successful social check (RED regression)", async () => {
    const response = await POST(request({ npcId: "npc_1", approach: "persuade", intent: "a room" }), { params });

    expect(response.status).toBe(200);
    expect(prismaTx.gameLog.create).toHaveBeenCalledTimes(1);
    expect(prismaTx.gameLog.create).toHaveBeenCalledWith({
      data: {
        campaignId: "camp_1",
        role: "system",
        content: expect.any(String),
      },
    });
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
      tx: prismaTx,
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

  describe("DC-NARR-002B scene presence guard", () => {
    it("TEST A — Legacy compatibility: version 0 allows social check without presence row", async () => {
      (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        userId: "user_1",
        status: "active",
        scenePresenceVersion: 0,
      });
      (prisma.campaignSceneParticipant.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const response = await POST(request({ npcId: "npc_1", approach: "persuade", intent: "hello" }), { params });

      expect(response.status).toBe(200);
      expect(prisma.campaignSceneParticipant.findUnique).not.toHaveBeenCalled();
      expect(resolveSocialCheck).toHaveBeenCalledTimes(1);
    });

    it("TEST B — Canonical present target: version 1 proceeds when participant exists", async () => {
      (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        userId: "user_1",
        status: "active",
        scenePresenceVersion: 1,
      });
      (prisma.campaignSceneParticipant.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        campaignId: "camp_1",
        npcId: "npc_1",
      });

      const response = await POST(request({ npcId: "npc_1", approach: "persuade", intent: "hello" }), { params });

      expect(response.status).toBe(200);
      expect(prisma.campaignSceneParticipant.findUnique).toHaveBeenCalledWith({
        where: { campaignId_npcId: { campaignId: "camp_1", npcId: "npc_1" } },
        select: { npcId: true },
      });
      expect(resolveSocialCheck).toHaveBeenCalledTimes(1);
    });

    it("TEST C — Canonical absent target: version 1 returns 400 NPC_NOT_PRESENT when participant absent", async () => {
      (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        userId: "user_1",
        status: "active",
        scenePresenceVersion: 1,
      });
      (prisma.campaignSceneParticipant.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const response = await POST(request({ npcId: "npc_1", approach: "persuade", intent: "hello" }), { params });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "NPC is not present in the current scene.",
        code: "NPC_NOT_PRESENT",
      });
      expect(resolveSocialCheck).not.toHaveBeenCalled();
    });

    it("TEST D — Future canonical version: version 2 enforces the same presence requirement", async () => {
      (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        userId: "user_1",
        status: "active",
        scenePresenceVersion: 2,
      });
      (prisma.campaignSceneParticipant.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const response = await POST(request({ npcId: "npc_1", approach: "persuade", intent: "hello" }), { params });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "NPC is not present in the current scene.",
        code: "NPC_NOT_PRESENT",
      });
      expect(resolveSocialCheck).not.toHaveBeenCalled();
    });

    it("TEST E — Canonical empty scene: zero participants rejects even if NPC exists persistently", async () => {
      (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        userId: "user_1",
        status: "active",
        scenePresenceVersion: 1,
      });
      (prisma.nPC.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "npc_1", campaignId: "camp_1", seed: "innkeeper_1", role: "commoner", hasMetPlayer: true,
      });
      (prisma.campaignSceneParticipant.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const response = await POST(request({ npcId: "npc_1", approach: "persuade", intent: "talk" }), { params });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "NPC is not present in the current scene.",
        code: "NPC_NOT_PRESENT",
      });
      expect(resolveSocialCheck).not.toHaveBeenCalled();
    });

    it("TEST F — Cross-campaign isolation: NPC belonging to another campaign returns 404 and does not query presence", async () => {
      (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        userId: "user_1",
        status: "active",
        scenePresenceVersion: 1,
      });
      (prisma.nPC.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "npc_1", campaignId: "camp_OTHER", seed: "innkeeper_1", role: "commoner", hasMetPlayer: true,
      });

      const response = await POST(request({ npcId: "npc_1", approach: "persuade", intent: "talk" }), { params });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "NPC not found." });
      expect(prisma.campaignSceneParticipant.findUnique).not.toHaveBeenCalled();
      expect(resolveSocialCheck).not.toHaveBeenCalled();
    });

    it("TEST G — Completed replay after NPC leaves scene: replays cached response, does NOT return NPC_NOT_PRESENT", async () => {
      const cachedResult = {
        ok: true, approach: "persuade", skill: "Persuasion", roll: 18, dc: 15,
        success: true, attitudeBefore: "Indifferent", attitudeAfter: "Friendly",
        dispositionBefore: 0, dispositionAfter: 5,
      };
      (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        userId: "user_1",
        status: "active",
        scenePresenceVersion: 1,
      });
      // Participant is now absent
      (prisma.campaignSceneParticipant.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (acquireActionReceipt as ReturnType<typeof vi.fn>).mockResolvedValue({
        outcome: "completed_replay",
        responseStatus: 200,
        responseBody: cachedResult,
      });

      const response = await POST(
        request({ npcId: "npc_1", approach: "persuade", intent: "talk", requestId: "req_completed" }),
        { params }
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(cachedResult);
      expect(prisma.campaignSceneParticipant.findUnique).not.toHaveBeenCalled();
      expect(resolveSocialCheck).not.toHaveBeenCalled();
    });

    it("TEST H — Previously rejected replay: returns cached rejection without reinterpreting presence", async () => {
      const cachedRejection = { error: "The NPC cannot be convinced.", code: "SOCIAL_REFUSED" };
      (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        userId: "user_1",
        status: "active",
        scenePresenceVersion: 1,
      });
      (acquireActionReceipt as ReturnType<typeof vi.fn>).mockResolvedValue({
        outcome: "rejected",
        responseStatus: 400,
        responseBody: cachedRejection,
      });

      const response = await POST(
        request({ npcId: "npc_1", approach: "persuade", intent: "talk", requestId: "req_rejected" }),
        { params }
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual(cachedRejection);
      expect(prisma.campaignSceneParticipant.findUnique).not.toHaveBeenCalled();
      expect(resolveSocialCheck).not.toHaveBeenCalled();
    });

    it("TEST I — Newly acquired request + NPC absent: settles terminal rejection on receipt", async () => {
      (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        userId: "user_1",
        status: "active",
        scenePresenceVersion: 1,
      });
      (prisma.campaignSceneParticipant.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (acquireActionReceipt as ReturnType<typeof vi.fn>).mockResolvedValue({
        outcome: "acquired",
        receiptId: "receipt_new_absent",
      });

      const response = await POST(
        request({ npcId: "npc_1", approach: "persuade", intent: "talk", requestId: "req_new_absent" }),
        { params }
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "NPC is not present in the current scene.",
        code: "NPC_NOT_PRESENT",
      });
      expect(rejectActionReceipt).toHaveBeenCalledWith("receipt_new_absent", 400, {
        error: "NPC is not present in the current scene.",
        code: "NPC_NOT_PRESENT",
      });
      expect(resolveSocialCheck).not.toHaveBeenCalled();
    });

    it("TEST J — Retry canonical absence rejection: replays cached NPC_NOT_PRESENT rejection", async () => {
      const cachedRejection = {
        error: "NPC is not present in the current scene.",
        code: "NPC_NOT_PRESENT",
      };
      (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        userId: "user_1",
        status: "active",
        scenePresenceVersion: 1,
      });
      (acquireActionReceipt as ReturnType<typeof vi.fn>).mockResolvedValue({
        outcome: "rejected",
        responseStatus: 400,
        responseBody: cachedRejection,
      });

      const response = await POST(
        request({ npcId: "npc_1", approach: "persuade", intent: "talk", requestId: "req_absent_retry" }),
        { params }
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual(cachedRejection);
      expect(prisma.campaignSceneParticipant.findUnique).not.toHaveBeenCalled();
      expect(resolveSocialCheck).not.toHaveBeenCalled();
    });

    it("TEST K — Existing in-flight behavior: preserves SOCIAL_ACTION_IN_FLIGHT", async () => {
      (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        userId: "user_1",
        status: "active",
        scenePresenceVersion: 1,
      });
      (acquireActionReceipt as ReturnType<typeof vi.fn>).mockResolvedValue({
        outcome: "in_flight",
      });

      const response = await POST(
        request({ npcId: "npc_1", approach: "persuade", intent: "talk", requestId: "req_inflight" }),
        { params }
      );

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: "Social action outcome is not confirmed yet.",
        code: "SOCIAL_ACTION_IN_FLIGHT",
      });
      expect(resolveSocialCheck).not.toHaveBeenCalled();
    });

    it("TEST L — Existing requestId reuse behavior: preserves REQUEST_ID_REUSED", async () => {
      (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        userId: "user_1",
        status: "active",
        scenePresenceVersion: 1,
      });
      (acquireActionReceipt as ReturnType<typeof vi.fn>).mockResolvedValue({
        outcome: "reused",
      });

      const response = await POST(
        request({ npcId: "npc_1", approach: "persuade", intent: "talk", requestId: "req_reused" }),
        { params }
      );

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: "This request id already belongs to another social action.",
        code: "REQUEST_ID_REUSED",
      });
      expect(resolveSocialCheck).not.toHaveBeenCalled();
    });

    it("First-contact regression: canonical present NPC with hasMetPlayer=false delegates to resolveSocialCheck", async () => {
      (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        userId: "user_1",
        status: "active",
        scenePresenceVersion: 1,
      });
      (prisma.nPC.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "npc_1", campaignId: "camp_1", seed: "guard_1", role: "guard", hasMetPlayer: false,
      });
      (prisma.campaignSceneParticipant.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        campaignId: "camp_1",
        npcId: "npc_1",
      });

      const response = await POST(
        request({ npcId: "npc_1", approach: "persuade", intent: "pass gate" }),
        { params }
      );

      expect(response.status).toBe(200);
      expect(prisma.nPC.update).not.toHaveBeenCalled();
      expect(resolveSocialCheck).toHaveBeenCalledWith({
        campaignId: "camp_1",
        npcId: "npc_1",
        approach: "persuade",
        intent: "pass gate",
        tx: prismaTx,
      });
    });
  });

  describe("Canonical campaign history persistence (NARR-FIND-02)", () => {
    it("writes exactly one canonical system GameLog with complete deterministic facts", async () => {
      (prisma.nPC.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "npc_1", campaignId: "camp_1", seed: "guard_captain", name: "Captain Valerie", role: "guard", hasMetPlayer: true,
      });
      (resolveSocialCheck as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        approach: "intimidate",
        skill: "Intimidation",
        roll: 17,
        abilityModifier: 3,
        proficiencyApplied: 2,
        total: 22,
        dc: 20,
        success: true,
        attitudeBefore: "Hostile",
        attitudeAfter: "Indifferent",
        dispositionBefore: -4,
        dispositionAfter: 0,
      });

      const response = await POST(
        request({ npcId: "npc_1", approach: "intimidate", intent: "stand down" }),
        { params }
      );

      expect(response.status).toBe(200);
      expect(prismaTx.gameLog.create).toHaveBeenCalledTimes(1);
      expect(prismaTx.gameLog.create).toHaveBeenCalledWith({
        data: {
          campaignId: "camp_1",
          role: "system",
          content:
            '🎲 Social check: Intimidation (intimidate) targeting Captain Valerie with intent "stand down": rolled 17+3 +2 prof = 22 vs DC 20 → SUCCESS. Attitude: Hostile → Indifferent (disposition: -4 → 0).',
        },
      });
    });

    it("falls back to NPC seed when name is null, undefined, or whitespace", async () => {
      (prisma.nPC.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "npc_1", campaignId: "camp_1", seed: "innkeeper_seed", name: "   ", role: "commoner", hasMetPlayer: true,
      });
      (resolveSocialCheck as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        approach: "persuade",
        skill: "Persuasion",
        roll: 10,
        abilityModifier: 0,
        proficiencyApplied: 0,
        total: 10,
        dc: 15,
        success: false,
        attitudeBefore: "Indifferent",
        attitudeAfter: "Hostile",
        dispositionBefore: 0,
        dispositionAfter: -4,
      });

      const response = await POST(
        request({ npcId: "npc_1", approach: "persuade", intent: "ask for discount" }),
        { params }
      );

      expect(response.status).toBe(200);
      expect(prismaTx.gameLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            content: expect.stringContaining("targeting innkeeper_seed"),
          }),
        })
      );
    });

    it("omits the intent clause when player intent is empty or whitespace", async () => {
      (prisma.nPC.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "npc_1", campaignId: "camp_1", seed: "merchant_seed", name: "Merchant", role: "commoner", hasMetPlayer: true,
      });

      const response = await POST(
        request({ npcId: "npc_1", approach: "persuade", intent: "   " }),
        { params }
      );

      expect(response.status).toBe(200);
      expect(prismaTx.gameLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            content: expect.not.stringContaining("with intent"),
          }),
        })
      );
    });

    it("formats negative ability modifier without a double sign", async () => {
      (prisma.nPC.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "npc_1", campaignId: "camp_1", seed: "innkeeper_1", role: "commoner", hasMetPlayer: true,
      });
      (resolveSocialCheck as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        approach: "deceive",
        skill: "Deception",
        roll: 8,
        abilityModifier: -2,
        proficiencyApplied: 0,
        total: 6,
        dc: 15,
        success: false,
        attitudeBefore: "Indifferent",
        attitudeAfter: "Hostile",
        dispositionBefore: 0,
        dispositionAfter: -4,
      });

      const response = await POST(
        request({ npcId: "npc_1", approach: "deceive", intent: "lie about gold" }),
        { params }
      );

      expect(response.status).toBe(200);
      expect(prismaTx.gameLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            content: expect.stringContaining("rolled 8-2 = 6 vs DC 15 → FAILURE"),
          }),
        })
      );
    });

    it("completed replay writes zero new GameLogs", async () => {
      const cached = {
        ok: true, approach: "persuade", skill: "Persuasion", roll: 15, dc: 15,
        success: true, attitudeBefore: "Indifferent", attitudeAfter: "Friendly",
        dispositionBefore: 0, dispositionAfter: 4,
      };
      (acquireActionReceipt as ReturnType<typeof vi.fn>).mockResolvedValue({
        outcome: "completed_replay",
        responseStatus: 200,
        responseBody: cached,
      });

      const response = await POST(
        request({ npcId: "npc_1", approach: "persuade", intent: "hello", requestId: "req_replay" }),
        { params }
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(cached);
      expect(resolveSocialCheck).not.toHaveBeenCalled();
      expect(prismaTx.gameLog.create).not.toHaveBeenCalled();
    });

    it("in-flight request produces no social resolution and writes zero GameLogs", async () => {
      (acquireActionReceipt as ReturnType<typeof vi.fn>).mockResolvedValue({
        outcome: "in_flight",
      });

      const response = await POST(
        request({ npcId: "npc_1", approach: "persuade", intent: "hello", requestId: "req_inflight" }),
        { params }
      );

      expect(response.status).toBe(409);
      expect(resolveSocialCheck).not.toHaveBeenCalled();
      expect(prismaTx.gameLog.create).not.toHaveBeenCalled();
    });

    it("reused requestId produces no social resolution and writes zero GameLogs", async () => {
      (acquireActionReceipt as ReturnType<typeof vi.fn>).mockResolvedValue({
        outcome: "reused",
      });

      const response = await POST(
        request({ npcId: "npc_1", approach: "persuade", intent: "hello", requestId: "req_reused" }),
        { params }
      );

      expect(response.status).toBe(409);
      expect(resolveSocialCheck).not.toHaveBeenCalled();
      expect(prismaTx.gameLog.create).not.toHaveBeenCalled();
    });

    it("absent canonical NPC produces NPC_NOT_PRESENT and writes zero GameLogs", async () => {
      (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        userId: "user_1",
        status: "active",
        scenePresenceVersion: 1,
      });
      (prisma.campaignSceneParticipant.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const response = await POST(
        request({ npcId: "npc_1", approach: "persuade", intent: "hello" }),
        { params }
      );

      expect(response.status).toBe(400);
      expect(resolveSocialCheck).not.toHaveBeenCalled();
      expect(prismaTx.gameLog.create).not.toHaveBeenCalled();
    });

    it("service rejection (SocialServiceError) rolls back and leaves no success GameLog", async () => {
      (resolveSocialCheck as ReturnType<typeof vi.fn>).mockRejectedValue(
        new SocialServiceError("SOCIAL_STATE_CONFLICT", "Conflict detected.")
      );

      const response = await POST(
        request({ npcId: "npc_1", approach: "persuade", intent: "hello", requestId: "req_err" }),
        { params }
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ code: "SOCIAL_STATE_CONFLICT" });
      expect(rejectActionReceipt).toHaveBeenCalledWith("receipt_1", 400, {
        error: "Conflict detected.",
        code: "SOCIAL_STATE_CONFLICT",
      });
      expect(prismaTx.gameLog.create).not.toHaveBeenCalled();
    });

    it("atomic transaction contract: resolveSocialCheck and tx.gameLog.create use the same transaction client", async () => {
      let txSeenBySocialCheck: unknown;
      let txSeenByGameLog: unknown;

      const customTx = {
        gameLog: {
          create: vi.fn(async () => {
            txSeenByGameLog = customTx;
            return { id: "log_custom" };
          }),
        },
      };
      (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
        async (cb: (tx: unknown) => Promise<unknown>) => cb(customTx)
      );

      (resolveSocialCheck as ReturnType<typeof vi.fn>).mockImplementationOnce(
        async (input: { tx?: unknown }) => {
          txSeenBySocialCheck = input.tx;
          return {
            ok: true,
            approach: "persuade",
            skill: "Persuasion",
            roll: 15,
            dc: 15,
            success: true,
            attitudeBefore: "Indifferent",
            attitudeAfter: "Friendly",
            dispositionBefore: 0,
            dispositionAfter: 4,
          };
        }
      );

      const response = await POST(
        request({ npcId: "npc_1", approach: "persuade", intent: "a room" }),
        { params }
      );

      expect(response.status).toBe(200);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(txSeenBySocialCheck).toBe(customTx);
      expect(txSeenByGameLog).toBe(customTx);
      expect(customTx.gameLog.create).toHaveBeenCalledTimes(1);
    });

    it("atomic transaction contract: failure in log creation rolls back transaction and fails request", async () => {
      const customTx = {
        gameLog: {
          create: vi.fn(async () => {
            throw new Error("DB write failure for GameLog");
          }),
        },
      };
      (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
        async (cb: (tx: unknown) => Promise<unknown>) => cb(customTx)
      );

      await expect(
        POST(request({ npcId: "npc_1", approach: "persuade", intent: "a room" }), { params })
      ).rejects.toThrow("DB write failure for GameLog");
      expect(completeActionReceiptWithResponse).not.toHaveBeenCalled();
    });

    it("locks the campaign row for update to serialize against node transitions", async () => {
      const response = await POST(
        request({ npcId: "npc_1", approach: "persuade", intent: "a room" }),
        { params }
      );
      expect(response.status).toBe(200);
      expect(prismaTx.$queryRaw).toHaveBeenCalled();
    });

    it("refuses social intent exceeding MAX_SOCIAL_INTENT_LENGTH (200 chars)", async () => {
      const longIntent = "a".repeat(201);
      const response = await POST(
        request({ npcId: "npc_1", approach: "persuade", intent: longIntent }),
        { params }
      );
      expect(response.status).toBe(400);
      expect(resolveSocialCheck).not.toHaveBeenCalled();
      expect(prismaTx.gameLog.create).not.toHaveBeenCalled();
    });
  });
});
