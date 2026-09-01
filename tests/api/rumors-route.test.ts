/**
 * tests/api/rumors-route.test.ts
 *
 * Gating for POST /api/campaign/[id]/social/rumors. `resolveRumors` is mocked,
 * so what these prove is what the route refuses and what it asks for — never
 * what the rules decide. The rule itself is covered in
 * tests/rules/social-logic.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/campaign/[id]/social/rumors/route";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { resolveRumors } from "@/lib/rules/social-service";

vi.mock("@/lib/db/prisma", () => ({
  prisma: { campaign: { findUnique: vi.fn() }, nPC: { findUnique: vi.fn() } },
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: vi.fn(),
  AuthError: class extends Error {},
}));

vi.mock("@/lib/rules/social-service", () => ({
  resolveRumors: vi.fn(),
  SocialServiceError: class extends Error {
    constructor(public code: string, message: string) {
      super(message);
    }
  },
}));

function request(body: unknown) {
  return new Request("http://test/api/campaign/camp_1/social/rumors", {
    method: "POST",
    body: JSON.stringify(body),
  }) as never;
}

const params = Promise.resolve({ id: "camp_1" });
const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  asMock(getAuthUser).mockResolvedValue({ id: "user_1" });
  asMock(prisma.campaign.findUnique).mockResolvedValue({
    userId: "user_1",
    status: "active",
  });
  asMock(prisma.nPC.findUnique).mockResolvedValue({
    id: "npc_1",
    campaignId: "camp_1",
  });
  asMock(resolveRumors).mockResolvedValue({
    npcName: "Greta",
    disposition: 7,
    attitude: "Friendly",
    rumors: [
      {
        nodeId: "n1",
        nodeName: "Cave",
        feature: "treasure",
        rumor: "Something worth finding.",
        source: "spatial",
      },
    ],
  });
});

describe("POST /api/campaign/[id]/social/rumors", () => {
  it("returns the rumours for the campaign's owner", async () => {
    const response = await POST(request({ npcId: "npc_1" }), { params });

    expect(response.status).toBe(200);
    expect(resolveRumors).toHaveBeenCalledWith({
      campaignId: "camp_1",
      npcId: "npc_1",
    });
    await expect(response.json()).resolves.toMatchObject({ attitude: "Friendly" });
  });

  it("refuses an unauthenticated request", async () => {
    const { AuthError } = await import("@/lib/auth/session");
    asMock(getAuthUser).mockRejectedValue(new AuthError("nope"));

    const response = await POST(request({ npcId: "npc_1" }), { params });

    expect(response.status).toBe(401);
    expect(resolveRumors).not.toHaveBeenCalled();
  });

  it("refuses a campaign belonging to another user", async () => {
    asMock(prisma.campaign.findUnique).mockResolvedValue({
      userId: "someone_else",
      status: "active",
    });

    const response = await POST(request({ npcId: "npc_1" }), { params });

    expect(response.status).toBe(403);
    expect(resolveRumors).not.toHaveBeenCalled();
  });

  it("refuses an inactive campaign", async () => {
    asMock(prisma.campaign.findUnique).mockResolvedValue({
      userId: "user_1",
      status: "completed",
    });

    const response = await POST(request({ npcId: "npc_1" }), { params });

    expect(response.status).toBe(409);
    expect(resolveRumors).not.toHaveBeenCalled();
  });

  it("refuses a body carrying an unexpected key", async () => {
    const response = await POST(
      request({ npcId: "npc_1", disposition: 10 }),
      { params }
    );

    expect(response.status).toBe(400);
    expect(resolveRumors).not.toHaveBeenCalled();
  });

  it("refuses an NPC from another campaign", async () => {
    asMock(prisma.nPC.findUnique).mockResolvedValue({
      id: "npc_1",
      campaignId: "camp_OTHER",
    });

    const response = await POST(request({ npcId: "npc_1" }), { params });

    expect(response.status).toBe(404);
    expect(resolveRumors).not.toHaveBeenCalled();
  });
});
