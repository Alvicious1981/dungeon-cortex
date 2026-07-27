import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  campaignFindUnique: vi.fn(),
  sessionFindFirst: vi.fn(),
  pauseSession: vi.fn(),
  resumeSession: vi.fn(),
  completeSession: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: mocks.getAuthUser,
  AuthError: class AuthError extends Error {},
}));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    campaign: { findUnique: mocks.campaignFindUnique },
    gameSession: { findFirst: mocks.sessionFindFirst },
  },
}));
vi.mock("@/lib/db/session-lifecycle", () => ({
  pauseSession: mocks.pauseSession,
  resumeSession: mocks.resumeSession,
  completeSession: mocks.completeSession,
  SessionLifecycleError: class SessionLifecycleError extends Error {},
}));

import { GET, POST } from "@/app/api/campaign/[id]/session/route";

const context = { params: Promise.resolve({ id: "campaign-1" }) };

describe("session lifecycle route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUser.mockResolvedValue({ id: "user-1" });
    mocks.campaignFindUnique.mockResolvedValue({ id: "campaign-1", userId: "user-1" });
  });

  it("returns the latest durable session state", async () => {
    mocks.sessionFindFirst.mockResolvedValue({
      id: "session-1",
      sessionNumber: 2,
      status: "PAUSED",
      mode: "PAUSED",
    });
    const response = await GET(new NextRequest("http://localhost/api/campaign/campaign-1/session"), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      session: { sessionNumber: 2, status: "PAUSED", mode: "PAUSED" },
    });
  });

  it("does not expose another user's session", async () => {
    mocks.campaignFindUnique.mockResolvedValue({ id: "campaign-1", userId: "other-user" });
    const response = await GET(new NextRequest("http://localhost/api/campaign/campaign-1/session"), context);
    expect(response.status).toBe(403);
    expect(mocks.sessionFindFirst).not.toHaveBeenCalled();
  });

  it("delegates completion to the authoritative lifecycle service", async () => {
    mocks.completeSession.mockResolvedValue({
      id: "session-1",
      sessionNumber: 2,
      status: "COMPLETED",
      mode: "COMPLETED",
      summary: "Session summary",
    });
    const response = await POST(new NextRequest("http://localhost/api/campaign/campaign-1/session", {
      method: "POST",
      body: JSON.stringify({ action: "complete" }),
    }), context);
    expect(response.status).toBe(200);
    expect(mocks.completeSession).toHaveBeenCalledWith("campaign-1");
    await expect(response.json()).resolves.toMatchObject({
      session: { status: "COMPLETED", summary: "Session summary" },
    });
  });
});
