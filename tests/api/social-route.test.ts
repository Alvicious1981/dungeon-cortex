import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/campaign/[id]/social/route";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser, AuthError } from "@/lib/auth/session";
import { resolveSocialCheck } from "@/lib/rules/social-service";
import { generateNPCPersonality } from "@/lib/rules/social-logic";

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

  it("establishes first contact before resolving, for an NPC never met", async () => {
    (prisma.nPC.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "npc_1", campaignId: "camp_1", seed: "gate_guard_north", role: "guard", hasMetPlayer: false,
    });

    const response = await POST(request({ npcId: "npc_1", approach: "persuade", intent: "x" }), { params });

    expect(response.status).toBe(200);
    expect(prisma.nPC.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "npc_1" },
        data: expect.objectContaining({ hasMetPlayer: true }),
      })
    );
  });

  /**
   * `NPC.personalityTags` had no producer at all: the column exists, the
   * formatter reads it, and the secret disclosure gated at disposition 8 hangs
   * off it — but the only code that ever wrote it was the AI tool that left
   * the narrator boundary in #97. Without this the secret path can never fire,
   * because the field is always null.
   *
   * First contact is the right moment: it is where the backend already decides
   * who this NPC is to the party, in the same write.
   */
  it("persists the NPC's personality on first contact, deterministically", async () => {
    (prisma.nPC.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "npc_1", campaignId: "camp_1", seed: "gate_guard_north", role: "guard", hasMetPlayer: false,
    });

    await POST(request({ npcId: "npc_1", approach: "persuade", intent: "x" }), { params });

    const call = (prisma.nPC.update as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.data.personalityTags).toEqual(generateNPCPersonality("gate_guard_north"));
    expect(call.data.personalityTags).toMatchObject({
      motivation: expect.any(String),
      secret: expect.any(String),
      distinctiveTrait: expect.any(String),
    });
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
});
