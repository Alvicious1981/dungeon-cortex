/**
 * tests/api/action-move-gate.test.ts
 *
 * The exploration `move` gate of `/api/campaign/[id]/action` (DC-AUD-023).
 *
 * The move and the player's canonical line must commit together. The line used
 * to be written through the top-level client after the move's transaction had
 * committed, so a failed write left the party moved with no record of the
 * action. These tests pin which client writes the line, and when; the real
 * rollback against PostgreSQL lives in tests/e2e/move-real-db.spec.ts.
 *
 * `moveToNode` is mocked: adjacency and passage rules are not under test here.
 * `parseIntent` is mocked with the value the real classifier returns for
 * "move to <name>" — the move branch of lib/ai/intent.ts captures the text
 * after "to" as `destination`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/** The order the gate's writes happen in, across the mocked clients. */
const writes = vi.hoisted(() => [] as string[]);

const prismaTx = vi.hoisted(() => ({
  gameLog: { create: vi.fn() },
}));

vi.mock("next/server", async (importActual) => {
  const actual = await importActual<typeof import("next/server")>();
  return { ...actual, after: vi.fn((fn: () => void) => fn()) };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    gameLog: {
      create: vi.fn(),
      count: vi.fn(async () => 1),
      findMany: vi.fn(async () => []),
    },
    character: { findUnique: vi.fn(async () => null) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaTx)),
  },
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: vi.fn(async () => ({ id: "user_1" })),
  AuthError: class extends Error {},
}));
vi.mock("@/lib/memory/context", () => ({ buildCampaignContext: vi.fn() }));
vi.mock("@/lib/ai/intent", () => ({ parseIntent: vi.fn() }));
vi.mock("@/lib/ai/narrator", () => ({
  streamNarrative: vi.fn(async () => ({
    textStream: (async function* () { yield "ok"; })(),
    textPromise: Promise.resolve("ok"),
    levelUpPayload: Promise.resolve(null),
    merchantPayload: Promise.resolve(null),
  })),
}));
vi.mock("@/lib/rules/navigation", () => ({ moveToNode: vi.fn() }));

import { POST } from "@/app/api/campaign/[id]/action/route";
import { prisma } from "@/lib/db/prisma";
import { buildCampaignContext } from "@/lib/memory/context";
import { parseIntent } from "@/lib/ai/intent";
import { moveToNode } from "@/lib/rules/navigation";

const campaignId = "camp_1";
const action = "move to Left Branch";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

/** The pre-gate snapshot. The move gate reads none of it. */
const context = () => ({
  character: {
    id: "char_1",
    name: "Hero",
    class: "fighter",
    level: 3,
    hp: 10,
    maxHp: 30,
    stats: { STR: 14, CON: 16 },
    spellSlots: null,
    hitDiceTotal: 3,
    hitDiceRemaining: 3,
    exhaustionLevel: 0,
    skillProficiencies: [],
    inventory: [],
  },
  relevantMemories: [],
  recentLogs: [],
  quests: [],
  currentExploration: null,
  activeEncounter: null,
});

const post = () =>
  POST(
    new Request(`http://localhost/api/campaign/${campaignId}/action`, {
      method: "POST",
      body: JSON.stringify({ action }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
    { params: Promise.resolve({ id: campaignId }) }
  );

async function frames(res: Response): Promise<Record<string, any>[]> {
  const body = await res.text();
  return body
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice("data: ".length)));
}

/** Every player line the route wrote, through either client. */
const userLines = () =>
  [...mocked(prisma.gameLog.create).mock.calls, ...prismaTx.gameLog.create.mock.calls].filter(
    (args) => args[0]?.data?.role === "user"
  );

beforeEach(() => {
  vi.clearAllMocks();
  writes.length = 0;

  mocked(prisma.campaign.findUnique).mockResolvedValue({
    id: campaignId,
    userId: "user_1",
    status: "active",
  });
  mocked(prisma.gameLog.create).mockResolvedValue({});
  prismaTx.gameLog.create.mockImplementation(async () => {
    writes.push("player line");
    return {};
  });
  mocked(parseIntent).mockResolvedValue({ actionType: "move", destination: "Left Branch" });
  mocked(buildCampaignContext).mockResolvedValue(context());
  mocked(moveToNode).mockImplementation(async () => {
    writes.push("move");
    return { success: true, targetNodeId: "node_2", passageType: "open" };
  });
});

describe("move gate: the player's line commits with the move", () => {
  it("writes the player's line through the move's transaction, after the move", async () => {
    const res = await post();

    expect(res.status).toBe(200);
    const moved = (await frames(res)).find(
      (frame) => frame.t === "evt" && frame.e?.type === "PLAYER_MOVE"
    );
    expect(moved?.e?.payload).toEqual({ targetNodeId: "node_2", passageType: "open" });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(moveToNode).toHaveBeenCalledWith(prismaTx, campaignId, "Left Branch");
    expect(writes).toEqual(["move", "player line"]);
    expect(prismaTx.gameLog.create).toHaveBeenCalledWith({
      data: { campaignId, role: "user", content: action },
    });
    // Written once: the trailing catch-all must not add a second line.
    expect(userLines()).toHaveLength(1);
  });

  it("writes no player line for a refused move", async () => {
    mocked(moveToNode).mockResolvedValue({
      success: false,
      error: "There is no direct path to that area from your current location.",
    });

    const res = await post();

    expect(res.status).toBe(400);
    expect(userLines()).toHaveLength(0);
  });

  it("fails the request when the player's line cannot be written", async () => {
    // Inside the transaction, a failed write aborts the move with it. Written
    // after the commit instead, it would go through the top-level client, this
    // rejection would never fire, and the move would stream as a success.
    prismaTx.gameLog.create.mockRejectedValue(new Error("GameLog insert failed"));

    await expect(post()).rejects.toThrow("GameLog insert failed");
    expect(
      mocked(prisma.gameLog.create).mock.calls.filter((args) => args[0]?.data?.role === "user")
    ).toHaveLength(0);
  });
});
