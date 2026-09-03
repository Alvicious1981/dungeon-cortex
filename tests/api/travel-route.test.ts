/**
 * tests/api/travel-route.test.ts
 *
 * The travel gate. See
 * docs/superpowers/specs/2026-09-03-wilderness-travel-srd-design.md.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaTx = vi.hoisted(() => ({
  campaign: { update: vi.fn() },
  character: { update: vi.fn() },
  gameLog: { create: vi.fn() },
}));

vi.mock("next/server", async (importActual) => {
  const actual = await importActual<any>();
  return {
    ...actual,
    after: vi.fn((fn) => fn()),
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    campaign: { findUnique: vi.fn(), update: vi.fn() },
    location: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(() => []) },
    locationNode: { findFirst: vi.fn() },
    character: { update: vi.fn(), findUnique: vi.fn() },
    gameLog: { create: vi.fn(), count: vi.fn(() => 1), findMany: vi.fn(() => []) },
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

import { POST } from "@/app/api/campaign/[id]/action/route";
import { prisma } from "@/lib/db/prisma";
import { buildCampaignContext } from "@/lib/memory/context";
import { parseIntent } from "@/lib/ai/intent";
import { streamNarrative } from "@/lib/ai/narrator";
import { travelDistanceMiles, resolveJourney } from "@/lib/rules/travel";
import { abilityModifier } from "@/lib/rules/dice";

const params = Promise.resolve({ id: "camp_1" });

const request = (action: string) =>
  new Request("http://localhost/api/campaign/camp_1/action", {
    method: "POST",
    body: JSON.stringify({ action }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

const CHARACTER = {
  id: "char_1",
  name: "Thalindra",
  race: "Elf",
  class: "fighter",
  level: 3,
  hp: 20,
  maxHp: 20,
  xp: 0,
  stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
  spellSlots: null,
  skillProficiencies: null,
  concentrationSpellId: null,
  hitDiceTotal: 3,
  hitDiceRemaining: 3,
  exhaustionLevel: 0,
  inventory: [],
};

function primeContext(): void {
  (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue({
    character: CHARACTER,
    activeEncounter: null,
    recentLogs: [],
    relevantMemories: [],
    quests: [],
    currentExploration: {
      location: { id: "loc_origin", name: "The Sable Crypt", type: "dungeon", description: "" },
      currentNode: null,
      adjacentNodes: [],
      visitedNodeIndices: [],
      allNodes: [],
      allEdges: [],
    },
    gold: 0,
    activeNPC: null,
  });
  (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: "user_1",
    status: "active",
    currentLocationId: "loc_origin",
  });
  (prisma.location.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    name: "The Sable Crypt",
    seed: "seed_origin",
  });
  (prisma.location.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "loc_dest",
    name: "The Gilded Boar",
    seed: "seed_dest",
  });
  (prisma.locationNode.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "node_entry",
  });
}

describe("travel gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeContext();
    prismaTx.campaign.update.mockResolvedValue({});
    prismaTx.character.update.mockResolvedValue({});
    prismaTx.gameLog.create.mockResolvedValue({});
  });

  it("moves the party to the destination's entry node", async () => {
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      actionType: "travel",
      destination: "Gilded Boar",
      forceMarch: false,
    });

    const res = await POST(request("travel to the Gilded Boar"), { params });

    expect(res.status).toBe(200);
    expect(prismaTx.campaign.update).toHaveBeenCalledWith({
      where: { id: "camp_1" },
      data: { currentLocationId: "loc_dest", currentNodeId: "node_entry" },
    });
  });

  /**
   * Normal travel costs days, never health. A gate that wrote exhaustion
   * regardless would still pass the movement test above.
   */
  it("writes no exhaustion for an ordinary journey", async () => {
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      actionType: "travel",
      destination: "Gilded Boar",
      forceMarch: false,
    });

    await POST(request("travel to the Gilded Boar"), { params });

    expect(prismaTx.character.update).not.toHaveBeenCalled();
  });

  it("persists the exhaustion a failed forced march resolved", async () => {
    // A natural 1 fails every DC at +0, so every forced hour costs a level.
    vi.spyOn(Math, "random").mockReturnValue(0);
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      actionType: "travel",
      destination: "Gilded Boar",
      forceMarch: true,
    });

    const miles = travelDistanceMiles("seed_origin", "seed_dest");
    const forcedHours = Math.max(0, Math.ceil(miles / 3) - 8);

    // These fixture seeds are relied on to produce a forced march. If a
    // future distance retune ever lands this at or under the 8-hour
    // threshold, this must fail loudly rather than degrade to a trivial
    // "update not called" assertion that a broken exhaustionGained wiring
    // could pass by accident.
    expect(forcedHours).toBeGreaterThan(0);

    await POST(request("travel to the Gilded Boar, forced march"), { params });

    expect(prismaTx.character.update).toHaveBeenCalledWith({
      where: { id: "char_1" },
      data: { exhaustionLevel: Math.min(6, forcedHours) },
    });
    vi.restoreAllMocks();
  });

  it("refuses an unknown destination without writing anything", async () => {
    (prisma.location.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      actionType: "travel",
      destination: "Atlantis",
      forceMarch: false,
    });

    const res = await POST(request("travel to Atlantis"), { params });

    expect(res.status).toBe(400);
    expect(prismaTx.campaign.update).not.toHaveBeenCalled();
    expect(prismaTx.character.update).not.toHaveBeenCalled();
  });

  it("refuses a journey to where the party already stands", async () => {
    (prisma.location.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "loc_origin",
      name: "The Sable Crypt",
      seed: "seed_origin",
    });
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      actionType: "travel",
      destination: "Sable Crypt",
      forceMarch: false,
    });

    const res = await POST(request("travel to the Sable Crypt"), { params });

    expect(res.status).toBe(400);
    expect(prismaTx.campaign.update).not.toHaveBeenCalled();
  });

  it("writes a system log line carrying the resolved figures", async () => {
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      actionType: "travel",
      destination: "Gilded Boar",
      forceMarch: false,
    });

    await POST(request("travel to the Gilded Boar"), { params });

    const miles = travelDistanceMiles("seed_origin", "seed_dest");
    expect(prismaTx.gameLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: "system",
          content: expect.stringContaining(`${miles} mi`),
        }),
      })
    );
    // The origin half of the line comes from the mocked location.findUnique
    // row, not a fallback — assert its name actually reaches the log rather
    // than letting a mismatched mock shape hide behind "Unknown".
    expect(prismaTx.gameLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.stringContaining("The Sable Crypt →"),
        }),
      })
    );
  });

  /**
   * The forced-march branch is where a fabricated or mis-derived number could
   * hide: it is the only branch that reports the forced-hour count, the DC
   * list and the exhaustion transition. Every expected figure below is
   * derived from travelDistanceMiles + resolveJourney — the same functions
   * and the same mocked Math.random the route itself uses — rather than
   * hardcoded, so this stays correct if the distance function is retuned.
   */
  it("writes a system log line carrying the forced-march figures", async () => {
    // A natural 1 fails every DC at +0, matching the mock used by the
    // exhaustion-persistence test above so both derive the same journey.
    vi.spyOn(Math, "random").mockReturnValue(0);
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      actionType: "travel",
      destination: "Gilded Boar",
      forceMarch: true,
    });

    await POST(request("travel to the Gilded Boar, forced march"), { params });

    const miles = travelDistanceMiles("seed_origin", "seed_dest");
    const journey = resolveJourney({
      distanceMiles: miles,
      forceMarch: true,
      conModifier: abilityModifier(CHARACTER.stats.CON),
      currentExhaustion: CHARACTER.exhaustionLevel,
    });

    // These fixture seeds are relied on to produce a forced march (verified:
    // 33 mi -> 3 forced hours). A future distance retune that lands this at
    // or under the 8-hour boundary must turn this test red, not silently
    // skip the only assertions that cover the forced-march log format.
    expect(journey.forcedHours).toBeGreaterThan(0);

    const dcList = journey.saves.map((s) => s.dc).join("/");
    const failedCount = journey.saves.filter((s) => !s.success).length;
    const expectedExhaustion =
      CHARACTER.exhaustionLevel + journey.exhaustionGained;

    expect(prismaTx.gameLog.create).toHaveBeenCalledTimes(1);
    const content = (prismaTx.gameLog.create as ReturnType<typeof vi.fn>).mock
      .calls[0][0].data.content as string;

    expect(content).toContain(`Forced march: ${journey.forcedHours} h`);
    expect(content).toContain(`DC ${dcList}`);
    expect(content).toContain(`${failedCount} failed`);
    expect(content).toContain(
      `exhaustion ${CHARACTER.exhaustionLevel} → ${expectedExhaustion}.`
    );

    vi.restoreAllMocks();
  });

  /**
   * `parseIntent` classifies a bare "travel to" as actionType "travel" with
   * no destination extracted. Nothing else in the gate fires on that shape,
   * so without an explicit refusal the request falls through to the
   * narrator, which would describe a journey the backend never resolved —
   * a direct violation of "backend code owns mechanical truth".
   */
  it("refuses a travel intent with no destination, before the narrator runs", async () => {
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      actionType: "travel",
      forceMarch: false,
    });

    const res = await POST(request("travel to"), { params });

    expect(res.status).toBe(400);
    expect(prismaTx.campaign.update).not.toHaveBeenCalled();
    expect(prismaTx.character.update).not.toHaveBeenCalled();
    expect(prismaTx.gameLog.create).not.toHaveBeenCalled();
    expect(streamNarrative).not.toHaveBeenCalled();
  });

  /**
   * Encounter is campaign-scoped with no location column, and
   * buildCampaignContext selects it by { campaignId, status: "active" }
   * alone. Travelling while one is active would leave it running at a place
   * the party no longer occupies, handing the narrator a new location and a
   * stale initiative order on the next turn.
   */
  it("refuses travel while an encounter is active", async () => {
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue({
      character: CHARACTER,
      activeEncounter: {
        id: "enc_1",
        round: 1,
        currentTurnIndex: 0,
        combatants: [],
        totalDamageDealt: 0,
      },
      recentLogs: [],
      relevantMemories: [],
      quests: [],
      currentExploration: {
        location: { id: "loc_origin", name: "The Sable Crypt", type: "dungeon", description: "" },
        currentNode: null,
        adjacentNodes: [],
        visitedNodeIndices: [],
        allNodes: [],
        allEdges: [],
      },
      gold: 0,
      activeNPC: null,
    });
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      actionType: "travel",
      destination: "Gilded Boar",
      forceMarch: false,
    });

    const res = await POST(request("travel to the Gilded Boar"), { params });

    expect(res.status).toBe(409);
    expect(prismaTx.campaign.update).not.toHaveBeenCalled();
    expect(prismaTx.character.update).not.toHaveBeenCalled();
    expect(prismaTx.gameLog.create).not.toHaveBeenCalled();
  });
});
