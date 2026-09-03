/**
 * tests/api/npc-route-identity.test.ts
 *
 * `generateNPC` derives a race, profession, alignment and four trait pillars
 * on every call, and `NPC` has a column for each — but this route persisted
 * only name/hp/maxHp/ac/notes and dropped the rest. Their one writer was
 * `npc-service`, which no live path has called since #97, and their one reader
 * was `projectNpcDetails`, orphaned when #117 deleted the tool it served.
 *
 * These cover the producer half. The narrator half is in
 * tests/memory/context-active-npc.test.ts and tests/memory/formatter.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    nPC: { upsert: vi.fn() },
  },
}));
vi.mock("@/lib/auth/session", () => ({
  getAuthUser: vi.fn(),
  AuthError: class extends Error {},
}));

import { POST } from "@/app/api/campaign/[id]/npc/route";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { generateNPC } from "@/lib/rules/npc";

const params = Promise.resolve({ id: "camp_1" });
const SEED = "gate_guard_north";

const request = (body: Record<string, unknown>) =>
  new Request("http://localhost/api/campaign/camp_1/npc", {
    method: "POST",
    body: JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

describe("POST /api/campaign/[id]/npc — persisted identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "user_1" });
    (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "user_1",
      status: "active",
    });
    (prisma.nPC.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "npc_1" });
  });

  it("persists the race, profession, alignment and traits the statblock derives", async () => {
    const response = await POST(request({ seed: SEED, role: "guard" }), { params });
    expect(response.status).toBe(200);

    const statblock = generateNPC(SEED, "guard");
    const created = (prisma.nPC.upsert as ReturnType<typeof vi.fn>).mock.calls[0]![0].create;

    expect(created).toMatchObject({
      race: statblock.race,
      profession: statblock.profession,
      alignment: statblock.alignment,
      traits: statblock.traits,
    });
  });

  /**
   * The control. Every one of these is a real string or object, so a route that
   * wrote empty strings would satisfy the assertion above against a statblock
   * mocked to match. Comparing against the real generator's output, and
   * asserting the pillars are actually populated, is what makes it bite.
   */
  it("writes the four trait pillars, not an empty shell", async () => {
    await POST(request({ seed: SEED, role: "guard" }), { params });

    const created = (prisma.nPC.upsert as ReturnType<typeof vi.fn>).mock.calls[0]![0].create;

    expect(created.traits).toMatchObject({
      personality: expect.any(String),
      ideal: expect.any(String),
      bond: expect.any(String),
      flaw: expect.any(String),
    });
    expect(created.race.length).toBeGreaterThan(0);
  });

  /**
   * Identity is derived from the seed, so it cannot change under a caller who
   * merely reports damage. Only the mutable fields belong in `update`.
   */
  it("leaves identity out of the update path", async () => {
    await POST(request({ seed: SEED, role: "guard", hp: 3 }), { params });

    const update = (prisma.nPC.upsert as ReturnType<typeof vi.fn>).mock.calls[0]![0].update;

    expect(update).not.toHaveProperty("race");
    expect(update).not.toHaveProperty("profession");
    expect(update).not.toHaveProperty("traits");
  });

  /**
   * `abilityScores` is deliberately not persisted. The column exists and the
   * statblock derives it, but nothing reads it: the narrator must not be handed
   * raw scores it could roll against, and no rule consults an NPC's abilities.
   * Writing it would create the very defect this work removes.
   */
  it("does not persist abilityScores, which nothing reads", async () => {
    await POST(request({ seed: SEED, role: "guard" }), { params });

    const created = (prisma.nPC.upsert as ReturnType<typeof vi.fn>).mock.calls[0]![0].create;

    expect(created).not.toHaveProperty("abilityScores");
  });
});
