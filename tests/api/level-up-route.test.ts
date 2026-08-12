import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";

import { POST } from "@/app/api/campaign/[id]/level-up/route";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { applyLevelUp } from "@/lib/rules/level-up-service";

vi.mock("@/lib/db/prisma", () => ({
  prisma: { campaign: { findFirst: vi.fn() } },
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

vi.mock("@/lib/rules/level-up-service", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/rules/level-up-service")>();
  return { ...actual, applyLevelUp: vi.fn() };
});

const CAMPAIGN_ID = "camp_1";
const USER = { id: "user_1" };
const CAMPAIGN = { id: CAMPAIGN_ID, characterId: "char_1" };

// Model E: newLevel === previousLevel + 1, newHitDiceTotal === newLevel.
const APPLIED = {
  ok: true,
  campaignId: CAMPAIGN_ID,
  source: "level_up_route",
  characterId: "char_1",
  previousLevel: 1,
  newLevel: 2,
  hitDie: "1d10",
  hpRoll: 6,
  conModifier: 2,
  hpGained: 8,
  previousMaxHp: 10,
  newMaxHp: 18,
  newHitDiceTotal: 2,
  className: "fighter",
  // Service-only bookkeeping that must not reach the wire.
  previousXP: 300,
  newXP: 300,
  previousHp: 4,
  newHp: 18,
  previousHitDiceTotal: 1,
  newHitDiceRemaining: 2,
  previousHitDiceRemaining: 0,
  facts: { type: "level_up_applied" },
};

function post(body: unknown, opts: { raw?: string } = {}): Promise<Response> {
  const req = new NextRequest(`http://localhost/api/campaign/${CAMPAIGN_ID}/level-up`, {
    method: "POST",
    body: opts.raw ?? JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id: CAMPAIGN_ID }) });
}

async function levelUpError(code: string) {
  const { LevelUpServiceError } = await import("@/lib/rules/level-up-service");
  return new LevelUpServiceError(
    code as never,
    `internal detail: character char_1 at prisma://db mentions ${code}`
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (getAuthUser as any).mockResolvedValue(USER);
  (prisma.campaign.findFirst as any).mockResolvedValue(CAMPAIGN);
  (applyLevelUp as any).mockResolvedValue(APPLIED);
});

describe("POST /api/campaign/[id]/level-up — authentication and authorisation", () => {
  it("returns 401 when the session lookup raises AuthError", async () => {
    const { AuthError } = await import("@/lib/auth/session");
    (getAuthUser as any).mockRejectedValue(new AuthError("Not authenticated."));

    const res = await post({ useAverage: true });

    expect(res.status).toBe(401);
    expect(applyLevelUp).not.toHaveBeenCalled();
  });

  it("returns 404 for a campaign that does not exist", async () => {
    (prisma.campaign.findFirst as any).mockResolvedValue(null);

    const res = await post({ useAverage: true });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "Campaign not found." });
    expect(applyLevelUp).not.toHaveBeenCalled();
  });

  it("returns the same 404 for a campaign that belongs to someone else", async () => {
    // findFirst is scoped by { id, userId } — a campaign owned by another
    // user never matches the query, so this indistinguishable from "not found".
    (prisma.campaign.findFirst as any).mockResolvedValue(null);

    const res = await post({ useAverage: true });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "Campaign not found." });
    expect(applyLevelUp).not.toHaveBeenCalled();
  });

  it("scopes the campaign lookup to the authenticated user", async () => {
    await post({ useAverage: true });

    expect(prisma.campaign.findFirst).toHaveBeenCalledWith({
      where: { id: CAMPAIGN_ID, userId: USER.id },
      select: { id: true, characterId: true },
    });
  });
});

describe("POST /api/campaign/[id]/level-up — input contract", () => {
  it("rejects a malformed body with 400", async () => {
    const res = await post(undefined, { raw: "{not json" });
    expect(res.status).toBe(400);
    expect(applyLevelUp).not.toHaveBeenCalled();
  });

  it.each([
    ["missing useAverage", {}],
    ["wrong type", { useAverage: "yes" }],
    ["null", null],
    ["array", []],
  ])("rejects an invalid body (%s) with 400", async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(applyLevelUp).not.toHaveBeenCalled();
  });

  it.each([
    ["characterId", { useAverage: true, characterId: "someone-else" }],
    ["targetLevel", { useAverage: true, targetLevel: 20 }],
    ["source", { useAverage: true, source: "triggerLevelUp" }],
    ["hpRoll", { useAverage: true, hpRoll: 10 }],
    ["hpGained", { useAverage: true, hpGained: 99 }],
    ["newMaxHp", { useAverage: true, newMaxHp: 999 }],
    ["hitDie", { useAverage: true, hitDie: "1d20" }],
    ["conModifier", { useAverage: true, conModifier: 10 }],
    ["level", { useAverage: true, level: 5 }],
    ["xp", { useAverage: true, xp: 999999 }],
    ["className", { useAverage: true, className: "wizard" }],
    ["campaignId", { useAverage: true, campaignId: "other-campaign" }],
  ])("rejects an extra client-controlled field (%s) with 400", async (_label, body) => {
    const res = await post(body);

    expect(res.status).toBe(400);
    // Rejected, never silently dropped.
    expect(applyLevelUp).not.toHaveBeenCalled();
  });
});

describe("POST /api/campaign/[id]/level-up — applying", () => {
  it("applies with the average and returns the resolved payload", async () => {
    const res = await post({ useAverage: true });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(applyLevelUp).toHaveBeenCalledTimes(1);
    expect(applyLevelUp).toHaveBeenCalledWith({
      campaignId: CAMPAIGN_ID,
      characterId: "char_1",
      useAverage: true,
      source: "level_up_route",
    });
    expect(body.payload).toMatchObject({ newLevel: 2, hpRoll: 6, hpGained: 8, newMaxHp: 18 });
  });

  it("applies with a roll", async () => {
    const res = await post({ useAverage: false });

    expect(res.status).toBe(200);
    expect(applyLevelUp).toHaveBeenCalledWith(
      expect.objectContaining({ useAverage: false, source: "level_up_route" })
    );
  });

  it("derives the character from the campaign, never from the request", async () => {
    await post({ useAverage: true });
    const call = (applyLevelUp as any).mock.calls[0][0];

    expect(call.characterId).toBe(CAMPAIGN.characterId);
    expect(call.campaignId).toBe(CAMPAIGN_ID);
    expect(call).not.toHaveProperty("targetLevel");
  });

  it("fixes `source` in code rather than taking it from the body", async () => {
    await post({ useAverage: true });
    expect((applyLevelUp as any).mock.calls[0][0].source).toBe("level_up_route");
  });

  it("strips service-only bookkeeping from the response", async () => {
    const body = await (await post({ useAverage: true })).json();

    for (const leaked of [
      "previousXP", "newXP", "facts", "ok", "campaignId", "source",
      "previousHp", "newHp", "previousHitDiceTotal", "newHitDiceRemaining",
      "previousHitDiceRemaining",
    ]) {
      expect(body.payload).not.toHaveProperty(leaked);
    }
  });

  it("satisfies the Model E level-up invariant on success", async () => {
    const body = await (await post({ useAverage: true })).json();

    expect(body.payload.newLevel).toBe(APPLIED.previousLevel + 1);
    expect(body.payload.newHitDiceTotal).toBe(body.payload.newLevel);
  });
});

describe("POST /api/campaign/[id]/level-up — failure mapping", () => {
  it.each([
    ["CAMPAIGN_NOT_FOUND", 404],
    ["CHARACTER_NOT_FOUND", 404],
    ["INVALID_CHARACTER_XP", 422],
    ["INVALID_CHARACTER_LEVEL", 422],
    ["INVALID_CHARACTER_CLASS", 422],
    ["INVALID_LEVEL_UP_STATE", 409],
    ["INVALID_LEVEL_JUMP", 409],
    ["LEVEL_UP_ALREADY_APPLIED", 409],
  ])("maps %s to %i", async (code, status) => {
    (applyLevelUp as any).mockRejectedValue(await levelUpError(code));

    const res = await post({ useAverage: true });
    const body = await res.json();

    expect(res.status).toBe(status);
    expect(body.code).toBe(code);
    // Stable message, no internal detail.
    expect(body.error).not.toContain("prisma://");
    expect(body.error).not.toContain("char_1");
  });

  it("returns 409 when there is no pending level-up", async () => {
    (applyLevelUp as any).mockRejectedValue(await levelUpError("INVALID_LEVEL_UP_STATE"));

    const res = await post({ useAverage: true });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("There is no pending level-up to apply.");
  });

  it("treats INVALID_LEVEL_JUMP defensively even though this route never sends targetLevel", async () => {
    (applyLevelUp as any).mockRejectedValue(await levelUpError("INVALID_LEVEL_JUMP"));

    const res = await post({ useAverage: true });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("This level-up cannot be applied in a single step.");
  });

  it("hides unexpected internal failures behind a generic 500", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    (applyLevelUp as any).mockRejectedValue(
      new Error("PrismaClientKnownRequestError: P2002 at db.public.Character")
    );

    const res = await post({ useAverage: true });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: "Could not apply the level-up." });
    expect(JSON.stringify(body)).not.toContain("Prisma");
    consoleError.mockRestore();
  });
});

describe("POST /api/campaign/[id]/level-up — authority", () => {
  const source = readFileSync(
    join(__dirname, "..", "..", "app", "api", "campaign", "[id]", "level-up", "route.ts"),
    "utf8"
  );

  it("contains no XP or hit-point arithmetic of its own", () => {
    expect(source).not.toMatch(/XP_THRESHOLDS|getLevelFromXP|xpForLevel|canLevelUp/);
    expect(source).not.toMatch(/rollHitPointGain|buildLevelUpPayload|HIT_DIE_MAP/);
    expect(source).not.toMatch(/Math\.(floor|ceil|max|min|random)/);
  });

  it("imports only the schema and the service it delegates to", () => {
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(imports).toEqual([
      "next/server",
      "zod",
      "@/lib/db/prisma",
      "@/lib/auth/session",
      "@/lib/rules/level-up-service",
      "@/lib/rules/progression",
    ]);
  });

  it("uses a strict schema so extra keys fail rather than being ignored", () => {
    expect(source).toMatch(/\.strict\(\)/);
  });

  it("offers no alternative application path through the narrative route", () => {
    const actionRoute = readFileSync(
      join(__dirname, "..", "..", "app", "api", "campaign", "[id]", "action", "route.ts"),
      "utf8"
    );
    expect(actionRoute).not.toContain("applyLevelUp(");
    expect(actionRoute).not.toContain("level-up-service");
  });
});
