import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthUser, AuthError } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/db/prisma", () => ({
  prisma: { user: { upsert: vi.fn() } },
}));

const PRIVATE_USER_ID = "00000000-0000-0000-0000-000000000000";

describe("getAuthUser", () => {
  const originalFlag = process.env.PRIVATE_MODE_ENABLED;

  beforeEach(() => {
    (prisma.user.upsert as any).mockReset();
  });

  afterEach(() => {
    process.env.PRIVATE_MODE_ENABLED = originalFlag;
  });

  it("rejects with AuthError and never touches Prisma when private mode is not enabled", async () => {
    delete process.env.PRIVATE_MODE_ENABLED;

    await expect(getAuthUser()).rejects.toThrow(AuthError);
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it('rejects with AuthError for any value other than the literal string "true"', async () => {
    process.env.PRIVATE_MODE_ENABLED = "1";

    await expect(getAuthUser()).rejects.toThrow(AuthError);
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it("resolves the same private user when private mode is explicitly enabled", async () => {
    process.env.PRIVATE_MODE_ENABLED = "true";
    (prisma.user.upsert as any).mockResolvedValue({
      id: PRIVATE_USER_ID,
      email: "user@private.local",
      name: "Private User",
    });

    const user = await getAuthUser();

    expect(user.id).toBe(PRIVATE_USER_ID);
    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { id: PRIVATE_USER_ID },
      update: {},
      create: {
        id: PRIVATE_USER_ID,
        email: "user@private.local",
        name: "Private User",
      },
    });
  });
});
