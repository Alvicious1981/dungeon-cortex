import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

import { POST } from "@/app/api/campaign/route";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { buildMainPartyMemberData } from "@/lib/party/roster";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    character: { findUnique: vi.fn() },
    $transaction: vi.fn(),
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

const USER = { id: "user_1" };
const CHARACTER = { id: "char_1", userId: "user_1", diedAt: null };
const CREATED_CAMPAIGN = { id: "camp_new" };

function post(body: unknown): Promise<Response> {
  const req = new NextRequest("http://localhost/api/campaign", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return POST(req);
}

/** Records the calls made to the transaction client, mirroring a real $transaction(async tx => ...). */
function mockTransaction() {
  const campaignCreate = vi.fn().mockResolvedValue(CREATED_CAMPAIGN);
  const partyMemberCreate = vi.fn().mockResolvedValue({});
  (prisma.$transaction as any).mockImplementation(async (fn: any) =>
    fn({ campaign: { create: campaignCreate }, partyMember: { create: partyMemberCreate } })
  );
  return { campaignCreate, partyMemberCreate };
}

beforeEach(() => {
  vi.clearAllMocks();
  (getAuthUser as any).mockResolvedValue(USER);
  (prisma.character.findUnique as any).mockResolvedValue(CHARACTER);
});

describe("POST /api/campaign — DC-PARTY-001 transaction wiring", () => {
  it("creates the Campaign and its MAIN PartyMember atomically, and returns the unchanged response shape", async () => {
    const { campaignCreate, partyMemberCreate } = mockTransaction();

    const res = await post({ characterId: CHARACTER.id, title: "My Chronicle" });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual({ id: CREATED_CAMPAIGN.id });

    expect(campaignCreate).toHaveBeenCalledWith({
      data: { userId: USER.id, characterId: CHARACTER.id, title: "My Chronicle", status: "active" },
    });
    expect(partyMemberCreate).toHaveBeenCalledWith({
      data: buildMainPartyMemberData(CREATED_CAMPAIGN.id, CHARACTER.id),
    });

    // The PartyMember insert must reference the campaign the transaction
    // just created, not some id computed ahead of time.
    const partyMemberCallOrder = partyMemberCreate.mock.invocationCallOrder[0];
    const campaignCallOrder = campaignCreate.mock.invocationCallOrder[0];
    expect(campaignCallOrder).toBeLessThan(partyMemberCallOrder);
  });

  it("both writes go through the same $transaction call, not two separate ones", async () => {
    mockTransaction();
    await post({ characterId: CHARACTER.id, title: "My Chronicle" });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["missing characterId", {}],
    ["missing title", { characterId: CHARACTER.id }],
  ])("returns 400 and never opens a transaction (%s)", async (_label, body) => {
    const { campaignCreate } = mockTransaction();
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(campaignCreate).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown character and never opens a transaction", async () => {
    mockTransaction();
    (prisma.character.findUnique as any).mockResolvedValue(null);

    const res = await post({ characterId: "ghost", title: "My Chronicle" });

    expect(res.status).toBe(404);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns 403 for a character owned by someone else and never opens a transaction", async () => {
    mockTransaction();
    (prisma.character.findUnique as any).mockResolvedValue({ ...CHARACTER, userId: "someone_else" });

    const res = await post({ characterId: CHARACTER.id, title: "My Chronicle" });

    expect(res.status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns 409 for a dead character and never opens a transaction", async () => {
    mockTransaction();
    (prisma.character.findUnique as any).mockResolvedValue({ ...CHARACTER, diedAt: new Date() });

    const res = await post({ characterId: CHARACTER.id, title: "My Chronicle" });

    expect(res.status).toBe(409);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
