/**
 * tests/api/logs-route.test.ts
 *
 * Gating for GET /api/campaign/[id]/logs (DC-AUD-006): incremental
 * "load older history" pages, strictly older than a keyset cursor
 * `(before, beforeId)`. Mirrors the auth/ownership shape already proven in
 * memories/route.ts, then adds the keyset contract this route owns.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/campaign/[id]/logs/route";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    gameLog: { findMany: vi.fn() },
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

const params = Promise.resolve({ id: "camp_1" });
const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function request(query: Record<string, string>) {
  const url = new URL("http://localhost/api/campaign/camp_1/logs");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

const VALID_CURSOR = { before: "2026-01-01T00:02:00.000Z", beforeId: "log-50" };

beforeEach(() => {
  vi.clearAllMocks();
  asMock(getAuthUser).mockResolvedValue({ id: "user-1" });
  asMock(prisma.campaign.findUnique).mockResolvedValue({ userId: "user-1" });
  asMock(prisma.gameLog.findMany).mockResolvedValue([]);
});

describe("GET /api/campaign/[id]/logs — ownership", () => {
  it("returns 401 when unauthenticated, without querying GameLog", async () => {
    const { AuthError } = await import("@/lib/auth/session");
    asMock(getAuthUser).mockRejectedValue(new AuthError("Not authenticated."));

    const res = await GET(request(VALID_CURSOR), { params });

    expect(res.status).toBe(401);
    expect(prisma.gameLog.findMany).not.toHaveBeenCalled();
  });

  it("returns 404 when the campaign does not exist, without querying GameLog", async () => {
    asMock(prisma.campaign.findUnique).mockResolvedValue(null);

    const res = await GET(request(VALID_CURSOR), { params });

    expect(res.status).toBe(404);
    expect(prisma.gameLog.findMany).not.toHaveBeenCalled();
  });

  it("returns 403 when the campaign belongs to another user, without querying GameLog", async () => {
    asMock(prisma.campaign.findUnique).mockResolvedValue({ userId: "someone-else" });

    const res = await GET(request(VALID_CURSOR), { params });

    expect(res.status).toBe(403);
    expect(prisma.gameLog.findMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/campaign/[id]/logs — cursor validation", () => {
  it("returns 400 when beforeId is missing, without querying GameLog", async () => {
    const res = await GET(request({ before: VALID_CURSOR.before }), { params });

    expect(res.status).toBe(400);
    expect(prisma.gameLog.findMany).not.toHaveBeenCalled();
  });

  it("returns 400 when before is missing, without querying GameLog", async () => {
    const res = await GET(request({ beforeId: VALID_CURSOR.beforeId }), { params });

    expect(res.status).toBe(400);
    expect(prisma.gameLog.findMany).not.toHaveBeenCalled();
  });

  it("returns 400 when before is not a valid date, without querying GameLog", async () => {
    const res = await GET(
      request({ before: "not-a-date", beforeId: VALID_CURSOR.beforeId }),
      { params }
    );

    expect(res.status).toBe(400);
    expect(prisma.gameLog.findMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/campaign/[id]/logs — query shape", () => {
  it("queries with the exact keyset OR clause and total-order sort", async () => {
    await GET(request(VALID_CURSOR), { params });

    expect(prisma.gameLog.findMany).toHaveBeenCalledTimes(1);
    const callArgs = asMock(prisma.gameLog.findMany).mock.calls[0][0];
    expect(callArgs.where).toEqual({
      campaignId: "camp_1",
      OR: [
        { createdAt: { lt: new Date(VALID_CURSOR.before) } },
        { createdAt: new Date(VALID_CURSOR.before), id: { lt: VALID_CURSOR.beforeId } },
      ],
    });
    expect(callArgs.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(callArgs.select).toEqual({ id: true, role: true, content: true, createdAt: true });
  });

  it("uses the take:limit+1 sentinel instead of count()", async () => {
    await GET(request({ ...VALID_CURSOR, limit: "50" }), { params });

    const callArgs = asMock(prisma.gameLog.findMany).mock.calls[0][0];
    expect(callArgs.take).toBe(51);
    expect((prisma as any).gameLog.count).toBeUndefined();
  });

  it("defaults limit to 50 when absent", async () => {
    await GET(request(VALID_CURSOR), { params });

    const callArgs = asMock(prisma.gameLog.findMany).mock.calls[0][0];
    expect(callArgs.take).toBe(51);
  });

  it("clamps limit to a maximum of 50", async () => {
    await GET(request({ ...VALID_CURSOR, limit: "500" }), { params });

    const callArgs = asMock(prisma.gameLog.findMany).mock.calls[0][0];
    expect(callArgs.take).toBe(51);
  });

  it("clamps limit to a minimum of 1", async () => {
    await GET(request({ ...VALID_CURSOR, limit: "-5" }), { params });

    const callArgs = asMock(prisma.gameLog.findMany).mock.calls[0][0];
    expect(callArgs.take).toBe(2);
  });

  it("degrades a falsy/zero limit to the default of 50", async () => {
    await GET(request({ ...VALID_CURSOR, limit: "0" }), { params });

    const callArgs = asMock(prisma.gameLog.findMany).mock.calls[0][0];
    expect(callArgs.take).toBe(51);
  });

  it("never uses skip or a Prisma cursor", async () => {
    await GET(request(VALID_CURSOR), { params });

    const callArgs = asMock(prisma.gameLog.findMany).mock.calls[0][0];
    expect(callArgs.skip).toBeUndefined();
    expect(callArgs.cursor).toBeUndefined();
  });
});

describe("GET /api/campaign/[id]/logs — hasMore + response shape", () => {
  function log(id: string, createdAt: string, role = "assistant") {
    return { id, role, content: `content-${id}`, createdAt: new Date(createdAt) };
  }

  it("reports hasMore:true and returns exactly `limit` rows when 51 rows come back for limit=50", async () => {
    const rows = Array.from({ length: 51 }, (_, i) =>
      log(`log-${50 - i}`, `2026-01-01T00:00:${String(50 - i).padStart(2, "0")}.000Z`)
    );
    asMock(prisma.gameLog.findMany).mockResolvedValue(rows);

    const res = await GET(request({ ...VALID_CURSOR, limit: "50" }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.logs).toHaveLength(50);
    expect(body.hasMore).toBe(true);
    // The 51st (sentinel) row must not leak into the response.
    expect(body.logs.some((l: { id: string }) => l.id === "log-0")).toBe(false);
  });

  it("reports hasMore:false when fewer than or equal to `limit` rows come back", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => log(`log-${i}`, `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`));
    asMock(prisma.gameLog.findMany).mockResolvedValue(rows);

    const res = await GET(request({ ...VALID_CURSOR, limit: "50" }), { params });
    const body = await res.json();

    expect(body.logs).toHaveLength(50);
    expect(body.hasMore).toBe(false);
  });

  it("reports hasMore:false and an empty list at the true start of history", async () => {
    asMock(prisma.gameLog.findMany).mockResolvedValue([]);

    const res = await GET(request(VALID_CURSOR), { params });
    const body = await res.json();

    expect(body).toEqual({ logs: [], hasMore: false });
  });

  it("never calls prisma.gameLog.count", async () => {
    await GET(request(VALID_CURSOR), { params });
    expect((prisma.gameLog as any).count).toBeUndefined();
  });
});

describe("GET /api/campaign/[id]/logs — createdAt tie handling", () => {
  it("does not skip a tied-createdAt row with a smaller id than the cursor", async () => {
    // Real DB behaviour under the keyset WHERE: a row sharing `before`'s
    // timestamp but with a smaller id satisfies the second OR branch and is
    // returned. This test proves the route's WHERE actually admits it by
    // constructing the mock response as the real predicate would allow, then
    // asserting the route does not filter it back out before responding.
    const tiedRow = {
      id: "log-49",
      role: "user",
      content: "tied",
      createdAt: new Date(VALID_CURSOR.before), // exactly equal to `before`
    };
    asMock(prisma.gameLog.findMany).mockResolvedValue([tiedRow]);

    const res = await GET(request(VALID_CURSOR), { params });
    const body = await res.json();

    expect(body.logs).toHaveLength(1);
    expect(body.logs[0].id).toBe("log-49");
    expect(body.hasMore).toBe(false);

    // And the WHERE clause sent to Prisma is exactly the OR-tie-break form
    // (re-asserted here so this test is self-contained about *why* the tied
    // row was reachable, not just that it passed through).
    const callArgs = asMock(prisma.gameLog.findMany).mock.calls[0][0];
    expect(callArgs.where.OR[1]).toEqual({
      createdAt: new Date(VALID_CURSOR.before),
      id: { lt: VALID_CURSOR.beforeId },
    });
  });

  it("does not duplicate the cursor row itself (strict lt, not lte)", async () => {
    await GET(request(VALID_CURSOR), { params });

    const callArgs = asMock(prisma.gameLog.findMany).mock.calls[0][0];
    // Both OR branches must use strict `lt`, never `lte` or bare equality
    // without an id tiebreak — otherwise the cursor row reappears on the
    // next page.
    expect(callArgs.where.OR[0]).toEqual({ createdAt: { lt: new Date(VALID_CURSOR.before) } });
    expect(callArgs.where.OR[1].id).toEqual({ lt: VALID_CURSOR.beforeId });
  });
});
