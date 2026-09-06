/**
 * tests/api/action-move-macro.test.ts
 *
 * The `Move` macro gate of `/api/campaign/[id]/action` (route.ts, "Gate: Move").
 *
 * Why this file exists: the gate is ~100 lines deciding whether a move is
 * legal — coordinate validation, distance against speed, and size-aware
 * collision — and until now **nothing exercised it through the route**. The
 * only occurrences of `action: "Move"` in the suite were in
 * `tests/actions/request-receipt.test.ts`, which hashes the body and never
 * posts it, and `MOVE_COMBATANT` — the event this gate emits — was asserted
 * nowhere at all. Movement legality is mechanical truth the backend owns, so
 * an untested gate here is exactly the shape of defect AGENTS.md warns about:
 * a rule that could stop applying without a single test turning red.
 *
 * These are characterisation tests. They pin the behaviour the route has
 * today, so a future refactor of this gate has something to be wrong against.
 *
 * `lib/rules/geometry.ts` is deliberately NOT mocked. Chebyshev distance,
 * footprint size and occupancy are the rules under test; replacing them with
 * fixtures would leave this file asserting against its own arithmetic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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
    combatant: { update: vi.fn() },
    character: { findUnique: vi.fn(async () => null) },
    actionRequestReceipt: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
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

import { POST } from "@/app/api/campaign/[id]/action/route";
import { prisma } from "@/lib/db/prisma";
import { buildCampaignContext } from "@/lib/memory/context";
import { parseIntent } from "@/lib/ai/intent";

const campaignId = "camp_1";

const NO_MODIFIERS = {
  damageImmunities: [] as string[],
  damageResistances: [] as string[],
  damageVulnerabilities: [] as string[],
  conditionImmunities: [] as string[],
};

interface CombatantOverrides {
  id?: string;
  name?: string;
  isPlayer?: boolean;
  x?: number;
  y?: number;
  size?: unknown;
  stats?: unknown;
  hp?: number;
}

function combatant(o: CombatantOverrides = {}) {
  return {
    id: o.id ?? "p1",
    name: o.name ?? "Hero",
    isPlayer: o.isPlayer ?? true,
    hp: o.hp ?? 20,
    maxHp: 20,
    ac: 12,
    initiativeTotal: 10,
    conditions: "[]",
    stats: o.stats ?? {},
    concentrationSpellId: null,
    x: o.x ?? 0,
    y: o.y ?? 0,
    size: o.size ?? "Medium",
    ...NO_MODIFIERS,
  };
}

const encounterWith = (combatants: unknown[]) => ({
  id: "enc_1",
  round: 1,
  currentTurnIndex: 0,
  totalDamageDealt: 0,
  combatants,
});

const contextWith = (activeEncounter: unknown) => ({
  character: {
    id: "char_1",
    name: "Hero",
    class: "fighter",
    level: 1,
    stats: { STR: 14 },
    skillProficiencies: [],
    exhaustionLevel: 0,
    inventory: [],
  },
  relevantMemories: [],
  recentLogs: [],
  quests: [],
  currentExploration: null,
  activeEncounter,
});

const post = (body: Record<string, unknown>) =>
  POST(
    new Request(`http://localhost/api/campaign/${campaignId}/action`, {
      method: "POST",
      body: JSON.stringify(body),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
    { params: Promise.resolve({ id: campaignId }) }
  );

/** Every canonical player row the route wrote during this request. */
const userLogWrites = () =>
  (prisma.gameLog.create as ReturnType<typeof vi.fn>).mock.calls.filter(
    (args) => args[0]?.data?.role === "user"
  );

/** Parses the SSE body into its frames. */
async function frames(res: Response): Promise<Record<string, any>[]> {
  const body = await res.text();
  return body
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice("data: ".length)));
}

async function moveEvent(res: Response) {
  return (await frames(res)).find((f) => f.t === "evt" && f.e?.type === "MOVE_COMBATANT")?.e;
}

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: campaignId,
    userId: "user_1",
    status: "active",
  });
  (prisma.gameLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (prisma.combatant.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
});

describe("Move macro: refusals never mutate the grid or the log (DC-AUD-001)", () => {
  it("refuses Move with no active encounter", async () => {
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(contextWith(null));

    const res = await post({ action: "Move", targetX: 1, targetY: 1 });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "No active encounter." });
    expect(prisma.combatant.update).not.toHaveBeenCalled();
    expect(userLogWrites()).toHaveLength(0);
  });

  it("refuses Move without coordinates", async () => {
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      contextWith(encounterWith([combatant()]))
    );

    const res = await post({ action: "Move" });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Move requires integer targetX and targetY.",
    });
    expect(prisma.combatant.update).not.toHaveBeenCalled();
    expect(userLogWrites()).toHaveLength(0);
  });

  it("refuses fractional coordinates", async () => {
    // A grid square is an integer address; 1.5 is not a square the rules can
    // resolve occupancy for.
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      contextWith(encounterWith([combatant()]))
    );

    const res = await post({ action: "Move", targetX: 1.5, targetY: 1 });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Move requires integer targetX and targetY.",
    });
    expect(prisma.combatant.update).not.toHaveBeenCalled();
  });

  it("refuses when the encounter holds no player combatant", async () => {
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      contextWith(encounterWith([combatant({ id: "g1", isPlayer: false, x: 3, y: 3 })]))
    );

    const res = await post({ action: "Move", targetX: 1, targetY: 1 });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Player combatant not found in encounter.",
    });
    expect(prisma.combatant.update).not.toHaveBeenCalled();
    expect(userLogWrites()).toHaveLength(0);
  });

  it("refuses a move to the square already occupied by the mover", async () => {
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      contextWith(encounterWith([combatant({ x: 2, y: 2 })]))
    );

    const res = await post({ action: "Move", targetX: 2, targetY: 2 });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Already at that position." });
    expect(prisma.combatant.update).not.toHaveBeenCalled();
    expect(userLogWrites()).toHaveLength(0);
  });
});

describe("Move macro: speed bounds the distance", () => {
  it("allows exactly the default 30 ft — six squares", async () => {
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      contextWith(encounterWith([combatant({ x: 0, y: 0 })]))
    );

    const res = await post({ action: "Move", targetX: 6, targetY: 0 });

    expect(res.status).toBe(200);
    expect(prisma.combatant.update).toHaveBeenCalledTimes(1);
  });

  it("refuses the seventh square at the default speed, naming both figures", async () => {
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      contextWith(encounterWith([combatant({ x: 0, y: 0 })]))
    );

    const res = await post({ action: "Move", targetX: 7, targetY: 0 });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Movement exceeds speed. Distance: 35 ft, speed: 30 ft.",
    });
    expect(prisma.combatant.update).not.toHaveBeenCalled();
    expect(userLogWrites()).toHaveLength(0);
  });

  it("honours a speed recorded on the combatant", async () => {
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      contextWith(encounterWith([combatant({ x: 0, y: 0, stats: { speed: 40 } })]))
    );

    // Eight squares: legal at 40 ft, and refused at the 30 ft default.
    const res = await post({ action: "Move", targetX: 8, targetY: 0 });

    expect(res.status).toBe(200);
    expect(prisma.combatant.update).toHaveBeenCalledTimes(1);
  });

  it("falls back to 30 ft when the recorded speed is not a usable number", async () => {
    // A malformed row resolves as an ordinary creature rather than granting
    // unlimited movement — the same fail-safe posture as `toSizeCategory`.
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      contextWith(encounterWith([combatant({ x: 0, y: 0, stats: { speed: 0 } })]))
    );

    const res = await post({ action: "Move", targetX: 7, targetY: 0 });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Movement exceeds speed. Distance: 35 ft, speed: 30 ft.",
    });
  });

  it("counts a diagonal as one square, per the SRD grid rule", async () => {
    // The rule this gate exists to enforce: 5e counts diagonals as 1 square,
    // so (6,6) is six squares away, not eight and not ~8.49. Euclidean or
    // Manhattan arithmetic would refuse this legal move.
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      contextWith(encounterWith([combatant({ x: 0, y: 0 })]))
    );

    const res = await post({ action: "Move", targetX: 6, targetY: 6 });

    expect(res.status).toBe(200);
    const ev = await moveEvent(res);
    expect(ev.payload.distanceFt).toBe(30);
  });
});

describe("Move macro: collision respects creature footprints", () => {
  it("refuses a destination another creature stands on", async () => {
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      contextWith(
        encounterWith([
          combatant({ x: 0, y: 0 }),
          combatant({ id: "g1", name: "Goblin", isPlayer: false, x: 2, y: 2 }),
        ])
      )
    );

    const res = await post({ action: "Move", targetX: 2, targetY: 2 });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Target square is occupied." });
    expect(prisma.combatant.update).not.toHaveBeenCalled();
    expect(userLogWrites()).toHaveLength(0);
  });

  it("refuses a square a Large creature covers but does not anchor", async () => {
    // An ogre anchored at (3,3) fills (3,3),(4,3),(3,4),(4,4). Anchor-only
    // collision would wave the mover straight into its flank.
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      contextWith(
        encounterWith([
          combatant({ x: 0, y: 0 }),
          combatant({ id: "o1", name: "Ogre", isPlayer: false, x: 3, y: 3, size: "Large" }),
        ])
      )
    );

    const res = await post({ action: "Move", targetX: 4, targetY: 4 });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Target square is occupied." });
  });

  it("does not let the mover's own footprint block its move", async () => {
    // A Large mover overlaps its own origin when it steps one square. It is
    // excluded from the occupancy set, so this must succeed.
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      contextWith(encounterWith([combatant({ x: 0, y: 0, size: "Large" })]))
    );

    const res = await post({ action: "Move", targetX: 1, targetY: 1 });

    expect(res.status).toBe(200);
    expect(prisma.combatant.update).toHaveBeenCalledTimes(1);
  });

  it("treats an unrecognised size as Medium rather than failing the turn", async () => {
    // `toSizeCategory` degrades a malformed column to Medium. A Medium mover
    // occupies one square, so only the destination itself is tested.
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      contextWith(
        encounterWith([
          combatant({ x: 0, y: 0, size: "Enormous" }),
          combatant({ id: "g1", isPlayer: false, x: 2, y: 1 }),
        ])
      )
    );

    const res = await post({ action: "Move", targetX: 1, targetY: 1 });

    expect(res.status).toBe(200);
    expect(prisma.combatant.update).toHaveBeenCalledTimes(1);
  });
});

describe("Move macro: a legal move persists and is announced", () => {
  it("writes the new coordinates and emits MOVE_COMBATANT with the journey", async () => {
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      contextWith(encounterWith([combatant({ x: 1, y: 2 })]))
    );

    const res = await post({ action: "Move", targetX: 4, targetY: 2 });

    expect(res.status).toBe(200);
    expect(prisma.combatant.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { x: 4, y: 2 },
    });

    const ev = await moveEvent(res);
    expect(ev).toEqual({
      type: "MOVE_COMBATANT",
      payload: {
        combatantId: "p1",
        fromX: 1,
        fromY: 2,
        toX: 4,
        toY: 2,
        distanceFt: 15,
      },
    });
  });

  it("logs the player's command exactly once, and only once the move is legal", async () => {
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      contextWith(encounterWith([combatant({ x: 0, y: 0 })]))
    );

    await post({ action: "Move", targetX: 1, targetY: 0 });

    const rows = userLogWrites();
    expect(rows).toHaveLength(1);
    expect(rows[0][0].data.content).toBe("Move");
  });

  it("never consults the intent parser: the macro is a fast path", async () => {
    // The macro exists so a UI button cannot be re-interpreted by the
    // classifier. If this ever fires, movement legality has become a
    // classification problem.
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      contextWith(encounterWith([combatant({ x: 0, y: 0 })]))
    );

    await post({ action: "Move", targetX: 1, targetY: 0 });

    expect(parseIntent).not.toHaveBeenCalled();
  });
});
