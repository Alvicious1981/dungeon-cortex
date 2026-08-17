import { describe, it, expect, vi, beforeEach } from "vitest";

import CampaignPage, { generateMetadata } from "@/app/campaign/[id]/page";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { notFound } from "next/navigation";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    campaign: { findFirst: vi.fn() },
    memoryEntry: { findMany: vi.fn() },
    quest: { findMany: vi.fn() },
    nPC: { findMany: vi.fn() },
    location: { findFirst: vi.fn() },
  },
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

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

const params = Promise.resolve({ id: "camp_1" });

describe("campaign page auth handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("CampaignPage", () => {
    it("calls notFound() when getAuthUser rejects with AuthError, without querying the campaign", async () => {
      const { AuthError } = await import("@/lib/auth/session");
      (getAuthUser as any).mockRejectedValue(new AuthError("Not authenticated: private mode is not enabled."));

      await expect(CampaignPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");

      expect(notFound).toHaveBeenCalledTimes(1);
      expect(prisma.campaign.findFirst).not.toHaveBeenCalled();
    });

    it("propagates a non-AuthError failure from getAuthUser instead of calling notFound()", async () => {
      const boom = new Error("database connection lost");
      (getAuthUser as any).mockRejectedValue(boom);

      await expect(CampaignPage({ params })).rejects.toThrow("database connection lost");

      expect(notFound).not.toHaveBeenCalled();
      expect(prisma.campaign.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("generateMetadata", () => {
    it("calls notFound() when getAuthUser rejects with AuthError, without querying the campaign", async () => {
      const { AuthError } = await import("@/lib/auth/session");
      (getAuthUser as any).mockRejectedValue(new AuthError("Not authenticated: private mode is not enabled."));

      await expect(generateMetadata({ params })).rejects.toThrow("NEXT_NOT_FOUND");

      expect(notFound).toHaveBeenCalledTimes(1);
      expect(prisma.campaign.findFirst).not.toHaveBeenCalled();
    });

    it("propagates a non-AuthError failure from getAuthUser instead of calling notFound()", async () => {
      const boom = new Error("database connection lost");
      (getAuthUser as any).mockRejectedValue(boom);

      await expect(generateMetadata({ params })).rejects.toThrow("database connection lost");

      expect(notFound).not.toHaveBeenCalled();
      expect(prisma.campaign.findFirst).not.toHaveBeenCalled();
    });
  });
});
