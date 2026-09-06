/**
 * tests/api/action-rest-gate.test.ts
 *
 * The `rest` gate of `/api/campaign/[id]/action`, now delegating to
 * `resolveRest` (lib/rules/rest-service.ts) — the same domain the dedicated
 * POST /api/campaign/[id]/rest route uses.
 *
 * This file began as characterisation: it pinned a second, parallel rest
 * implementation (`applyShortRest` / `applyLongRest`, since deleted) that
 * disagreed with the canonical service on six points, catalogued in #130. Five
 * of those are gone with the delegation, so the assertions that recorded them
 * are replaced by assertions that the rule now applies. Each says which
 * divergence it closes, so the diff against the previous revision reads as the
 * intended change.
 *
 * `lib/rules/rest-service.ts` is deliberately NOT mocked: it is the thing under
 * test. `Math.random` is pinned where an exact number is needed, because the
 * service now genuinely rolls.
 *
 * ── closed by the delegation ────────────────────────────────────────────────
 *
 * 1. Constitution is applied — `stats.CON`, the key the character carries.
 * 2. The Hit Die comes from the character's class, case-normalised.
 * 4. A rest during an active encounter is refused, not resolved.
 * 5. One Hit Die is spent per command, not every one the character owns.
 * 6. Each spent die is rolled instead of averaged.
 *
 * (3 was the inflated `hpRecovered` — a short rest reaching full health
 * reporting the whole die roll instead of the points granted. The delegation
 * closes it too, by construction rather than by patch: the service reports
 * `hpAfter - hpBefore`, so the figure cannot exceed what was restored.)
 *
 * 7. The long-rest phrase no longer overrides the classifier. `restType`
 *    decides, and a sentence naming both rests is refused upstream by
 *    `parseIntent` instead of being guessed — see tests/ai/intent.test.ts.
 *
 * ── new consequences, pinned deliberately ───────────────────────────────────
 *
 * Adopting the canonical service changed two edge cases that the old gate
 * handled differently. Neither is a bug in the service — the dedicated rest
 * route has behaved this way all along — but both are new on this path:
 *
 *   - With no Hit Dice left, a short rest is now REFUSED (`INVALID_HIT_DICE`,
 *     400) rather than resolving to a no-op 200.
 *   - At full health a short rest still spends a die, healing nothing. The old
 *     gate checked `hp < maxHp` before spending; the service does not.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaTx = vi.hoisted(() => ({
  campaign: { findUnique: vi.fn() },
  character: { findUnique: vi.fn(), update: vi.fn() },
  encounter: { findFirst: vi.fn() },
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

import { POST } from "@/app/api/campaign/[id]/action/route";
import { prisma } from "@/lib/db/prisma";
import { buildCampaignContext } from "@/lib/memory/context";
import { parseIntent } from "@/lib/ai/intent";

const campaignId = "camp_1";

interface CharOverrides {
  hp?: number;
  maxHp?: number;
  class?: string;
  stats?: Record<string, number>;
  spellSlots?: Record<string, { current: number; max: number }> | null;
  hitDiceTotal?: number;
  hitDiceRemaining?: number;
  exhaustionLevel?: number;
}

/** The authoritative row the service reads inside the transaction. */
const characterRow = (o: CharOverrides = {}) => ({
  id: "char_1",
  campaignId,
  hp: o.hp ?? 10,
  maxHp: o.maxHp ?? 30,
  level: 3,
  class: o.class ?? "fighter",
  stats: o.stats ?? { STR: 14, CON: 16 },
  spellSlots: o.spellSlots ?? null,
  hitDiceTotal: o.hitDiceTotal ?? 3,
  hitDiceRemaining: o.hitDiceRemaining ?? 3,
  exhaustionLevel: o.exhaustionLevel ?? 0,
});

/** The pre-gate snapshot. Only `character.id` is read by the gate now. */
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

function givenCharacter(o: CharOverrides = {}) {
  const row = characterRow(o);
  prismaTx.character.findUnique.mockResolvedValue(row);

  // The service computes `hpRecovered` from the row `update` RETURNS, not from
  // what it sent — so a mock answering `{}` yields NaN, which reaches the
  // stream as `null`. Echo the written fields back over the row, the way the
  // database would.
  prismaTx.character.update.mockImplementation(
    async (args: { where: { id: string }; data: Record<string, unknown> }) => ({
      ...row,
      ...args.data,
      id: args.where.id,
    })
  );
}

/**
 * Re-primes every mock this file depends on. Used by `beforeEach` and by the
 * comparison tests, which run the gate twice and must not carry the first
 * run's recorded calls into the second.
 */
function primeAll() {
  (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: campaignId,
    userId: "user_1",
    status: "active",
  });
  (prisma.gameLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({ actionType: "rest" });
  (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(context());
  prismaTx.campaign.findUnique.mockResolvedValue({ id: campaignId, characterId: "char_1" });
  prismaTx.encounter.findFirst.mockResolvedValue(null);
  givenCharacter();
}

const post = (action: string) =>
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

async function restPayload(res: Response) {
  const f = (await frames(res)).find(
    (x) => x.t === "evt" && x.e?.type === "REST_COMPLETED"
  );
  return f?.e?.payload;
}

const characterUpdate = () => prismaTx.character.update.mock.calls[0]?.[0];

/**
 * One short rest, from a clean slate, at a fixed die roll. Returns the
 * REST_COMPLETED payload. Lets a test compare two characters without the first
 * run's state leaking into the second.
 */
async function shortRestPayload(o: CharOverrides, random: number) {
  prismaTx.character.update.mockClear();
  (prisma.gameLog.create as ReturnType<typeof vi.fn>).mockClear();
  primeAll();
  givenCharacter(o);
  vi.spyOn(Math, "random").mockReturnValue(random);
  return restPayload(await post("short rest"));
}

const userLogWrites = () =>
  (prisma.gameLog.create as ReturnType<typeof vi.fn>).mock.calls.filter(
    (args) => args[0]?.data?.role === "user"
  );

/** Every die reads its maximum, so class Hit Die sizes are distinguishable. */
const MAX_ROLL = 0.99;

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  primeAll();
});

describe("rest gate: the rules the delegation restored", () => {
  it("spends exactly one Hit Die, not every one the character owns", async () => {
    // DIVERGENCE 5 closed. The SRD makes each die a separate choice, and the
    // service defaults an unspecified request to one. The old gate looped
    // until the character was full or the dice were gone.
    vi.spyOn(Math, "random").mockReturnValue(MAX_ROLL);
    givenCharacter({ hp: 1, maxHp: 30, hitDiceRemaining: 3 });

    const res = await post("short rest");

    expect(await restPayload(res)).toMatchObject({
      type: "SHORT_REST",
      hitDiceSpent: 1,
    });
    expect(characterUpdate().data.hitDiceRemaining).toBe(2);
  });

  it("rolls the Hit Die instead of taking a fixed average", async () => {
    // DIVERGENCE 6 closed. Two different rolls must produce two different
    // recoveries; the old gate returned the same number every time.
    const high = await shortRestPayload({ hp: 1, maxHp: 40 }, MAX_ROLL);
    const low = await shortRestPayload({ hp: 1, maxHp: 40 }, 0);

    expect(high.hpRecovered).toBeGreaterThan(low.hpRecovered);
  });

  it("applies the Constitution modifier the character actually has", async () => {
    // DIVERGENCE 1 closed. `stats.CON` is the key the character carries; the
    // old path read `stats.constitution` and always got 0.
    const withCon = await shortRestPayload(
      { hp: 1, maxHp: 40, stats: { CON: 16 } },
      MAX_ROLL
    );
    const withoutCon = await shortRestPayload(
      { hp: 1, maxHp: 40, stats: { CON: 10 } },
      MAX_ROLL
    );

    // +3 versus +0, on the same maximum roll.
    expect(withCon.hpRecovered - withoutCon.hpRecovered).toBe(3);
  });

  it("uses each class's own Hit Die", async () => {
    // DIVERGENCE 2 closed. The service normalises the stored lowercase slug
    // before the lookup, so a fighter's d10 and a wizard's d6 differ. The old
    // table was keyed "Fighter"/"Wizard" and fell back to d8 for everyone.
    const fighter = await shortRestPayload(
      { hp: 1, maxHp: 40, class: "fighter", stats: { CON: 10 } },
      MAX_ROLL
    );
    const wizard = await shortRestPayload(
      { hp: 1, maxHp: 40, class: "wizard", stats: { CON: 10 } },
      MAX_ROLL
    );

    expect(fighter.hpRecovered).toBe(10); // d10 at maximum
    expect(wizard.hpRecovered).toBe(6);   // d6 at maximum
  });

  it("refuses a rest during an active encounter, and logs nothing", async () => {
    // DIVERGENCE 4 closed, and DC-AUD-001 with it: the refusal now happens
    // before the player's line is written, so a refused rest leaves no
    // canonical history for the narrator to read back.
    prismaTx.encounter.findFirst.mockResolvedValue({ id: "enc_1" });
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      actionType: "rest", restType: "long",
    });

    const res = await post("we take a long rest");

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: "ACTIVE_ENCOUNTER" });
    expect(prismaTx.character.update).not.toHaveBeenCalled();
    expect(userLogWrites()).toHaveLength(0);
  });

  it("reads the authoritative character row inside the transaction", async () => {
    // The pre-gate snapshot is no longer what the rest is computed from. Two
    // concurrent rests reading the same stale hit points was a real window
    // before; the service reads the row itself, within the transaction.
    vi.spyOn(Math, "random").mockReturnValue(MAX_ROLL);
    // The snapshot says 10 hp; the row says 25. The recovery must be the row's.
    givenCharacter({ hp: 25, maxHp: 30, stats: { CON: 10 } });

    const res = await post("short rest");

    expect(prismaTx.character.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "char_1" } })
    );
    // 25 + d10(max) capped at 30 → 5 gained, not the 10 the snapshot implies.
    expect((await restPayload(res)).hpRecovered).toBe(5);
    expect(characterUpdate().data.hp).toBe(30);
  });
});

describe("rest gate: a long rest restores the day", () => {
  beforeEach(() => {
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      actionType: "rest", restType: "long",
    });
  });

  it("fills hit points, returns dice, steps exhaustion down and refills slots", async () => {
    givenCharacter({
      hp: 4,
      maxHp: 30,
      hitDiceTotal: 6,
      hitDiceRemaining: 1,
      exhaustionLevel: 2,
      spellSlots: { "1": { current: 0, max: 4 } },
    });

    const res = await post("long rest");

    expect(await restPayload(res)).toMatchObject({
      type: "LONG_REST",
      hpRecovered: 26,
      exhaustionReduced: 1,
      spellSlotsRecovered: true,
    });
    const data = characterUpdate().data;
    expect(data.hp).toBe(30);
    expect(data.exhaustionLevel).toBe(1);
    expect(data.hitDiceRemaining).toBe(4); // 1 + floor(6 / 2)
  });

  it("does not drive exhaustion below zero", async () => {
    givenCharacter({ exhaustionLevel: 0 });

    const res = await post("long rest");

    expect((await restPayload(res)).exhaustionReduced).toBe(0);
    expect(characterUpdate().data.exhaustionLevel).toBe(0);
  });

  it("reports no slot recovery for a character with none to recover", async () => {
    givenCharacter({ spellSlots: null });

    const res = await post("long rest");

    expect((await restPayload(res)).spellSlotsRecovered).toBe(false);
  });
});

describe("rest gate: consequences of adopting the canonical service", () => {
  it("refuses a short rest with no Hit Dice left, where it used to no-op", async () => {
    // The old gate answered 200 with nothing recovered. The service treats a
    // request it cannot satisfy as invalid. Pinned because it is a behaviour
    // change on this path, not an accident.
    givenCharacter({ hp: 5, hitDiceRemaining: 0 });

    const res = await post("short rest");

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "INVALID_HIT_DICE" });
    expect(userLogWrites()).toHaveLength(0);
  });

  it("still spends a die at full health, healing nothing", async () => {
    // The old gate checked `hp < maxHp` before spending; the service does not,
    // and the dedicated rest route has always behaved this way. Recorded so
    // the asymmetry is visible rather than discovered in play.
    vi.spyOn(Math, "random").mockReturnValue(MAX_ROLL);
    givenCharacter({ hp: 30, maxHp: 30, hitDiceRemaining: 3 });

    const res = await post("short rest");

    const payload = await restPayload(res);
    expect(payload.hpRecovered).toBe(0);
    expect(payload.hitDiceSpent).toBe(1);
    expect(characterUpdate().data.hitDiceRemaining).toBe(2);
  });
});

describe("rest gate: what the route still owns", () => {
  it("resolves a short rest by default", async () => {
    const res = await post("I take a short rest");

    expect(res.status).toBe(200);
    expect((await restPayload(res)).type).toBe("SHORT_REST");
  });

  it("resolves a long rest when the classifier says so", async () => {
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      actionType: "rest", restType: "long",
    });

    const res = await post("I make camp");

    expect((await restPayload(res)).type).toBe("LONG_REST");
  });

  it("obeys the classifier even when the text names the other rest", async () => {
    // DIVERGENCE 7 closed. The gate used to OR `restType` with
    // `action.includes("long rest")`, so any sentence carrying those two words
    // was upgraded to a long rest whatever the classifier said — negations
    // included, in the direction that hands out resources.
    //
    // The OR is gone: `restType` decides. Its companion half, a parser that
    // read "not a long rest" as long, is fixed in lib/ai/intent.ts and covered
    // by tests/ai/intent.test.ts, which now refuses a sentence naming both
    // rests rather than guessing between them.
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      actionType: "rest", restType: "short",
    });
    givenCharacter({ hp: 4, maxHp: 30, exhaustionLevel: 2 });

    const res = await post("we bed down after the long rest we skipped");

    expect((await restPayload(res)).type).toBe("SHORT_REST");
    // The long-rest recovery does not land: a short rest writes hit points and
    // Hit Dice only, so exhaustion is not even part of the update.
    expect(characterUpdate().data).not.toHaveProperty("exhaustionLevel");
    expect(characterUpdate().data).not.toHaveProperty("spellSlots");
  });

  it("writes the player's line exactly once for a rest that resolves", async () => {
    await post("short rest");

    const rows = userLogWrites();
    expect(rows).toHaveLength(1);
    expect(rows[0][0].data.content).toBe("short rest");
  });

  it("resolves and persists the rest in a single transaction", async () => {
    await post("short rest");

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaTx.character.update).toHaveBeenCalledTimes(1);
  });
});
