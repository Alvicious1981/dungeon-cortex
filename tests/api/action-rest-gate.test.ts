/**
 * tests/api/action-rest-gate.test.ts
 *
 * The `rest` gate of `/api/campaign/[id]/action` (route.ts, "Gate: rest").
 *
 * Why this file exists: the gate resolves a whole rest — hit dice spent, hit
 * points recovered, hit dice regained, exhaustion stepped down and spell slots
 * restored — and then persists all of it, and until now **one** assertion in
 * the entire suite touched it: `action-intent-contract.test.ts:731` checks that
 * a frame of type `REST_COMPLETED` comes back. Nothing checked the payload,
 * nothing checked the character update, and neither long rest nor spell-slot
 * restoration was exercised through the route at all.
 *
 * These are characterisation tests: they pin the behaviour the route has
 * today. Two of them pin a divergence rather than a rule — see
 * "known divergences" below. They are marked, so that a future fix reads as an
 * intended change and not as a regression.
 *
 * `lib/rules/exploration-logic.ts` is deliberately NOT mocked. The rest maths
 * is what is under test; fixtures would leave this file asserting against its
 * own arithmetic.
 *
 * ── known divergences, pinned deliberately ──────────────────────────────────
 *
 * 1. `applyShortRest` reads `character.stats.constitution`, but the character's
 *    stats are `{ STR, DEX, CON, ... }` (lib/memory/context.ts:36; the travel
 *    gate reads `stats.CON`). The lookup is always undefined, so the
 *    Constitution modifier never reaches short-rest healing.
 *
 * 2. `HIT_DICE_BY_CLASS` (exploration-logic.ts:474) is keyed "Fighter",
 *    "Wizard"…, while `character.class` holds the SRD index slug — lowercase,
 *    stored verbatim by app/api/character/route.ts:81 — and the project's own
 *    canonical `HIT_DIE_MAP` (lib/rules/progression.ts:158) is keyed lowercase
 *    too. The lookup misses and falls back to `|| 8`, so every class recovers
 *    on a d8: a fighter and a wizard short-rest identically.
 *
 * 3. A short rest that reaches full health reports the whole die roll rather
 *    than the points it actually granted. `applyShortRest` clamps `hp` with
 *    `Math.min` inside the loop and then adds the unclamped `healing` to
 *    `hpRecovered`; its own "Ensure we didn't overheal" correction tests
 *    `next.hp > next.maxHp`, which that clamp has already made impossible, so
 *    it never runs. Persistence is right; the announced figure is not, and it
 *    is the figure the narrator is given.
 *
 * None is fixed here. Fixing them changes recovered hit points, or what the
 * player is told about them, on a live save — a rules decision, not a
 * coverage one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const prismaTx = vi.hoisted(() => ({
  character: { update: vi.fn() },
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
  level?: number;
  class?: string;
  stats?: Record<string, number>;
  spellSlots?: Record<string, { current: number; max: number }> | null;
  hitDiceTotal?: number;
  hitDiceRemaining?: number;
  exhaustionLevel?: number;
}

const contextWith = (o: CharOverrides = {}) => ({
  character: {
    id: "char_1",
    name: "Hero",
    class: o.class ?? "fighter",
    level: o.level ?? 3,
    hp: o.hp ?? 10,
    maxHp: o.maxHp ?? 30,
    stats: o.stats ?? { STR: 14, CON: 16 },
    spellSlots: o.spellSlots ?? null,
    hitDiceTotal: o.hitDiceTotal ?? 3,
    hitDiceRemaining: o.hitDiceRemaining ?? 3,
    exhaustionLevel: o.exhaustionLevel ?? 0,
    skillProficiencies: [],
    inventory: [],
  },
  relevantMemories: [],
  recentLogs: [],
  quests: [],
  currentExploration: null,
  activeEncounter: null,
});

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

const characterUpdate = () =>
  (prismaTx.character.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];

const userLogWrites = () =>
  (prisma.gameLog.create as ReturnType<typeof vi.fn>).mock.calls.filter(
    (args) => args[0]?.data?.role === "user"
  );

/** Points healed per hit die at the values these fixtures use. */
const HEAL_PER_DIE = 5; // floor(8 / 2) + 1 + conMod(0) — see divergences 1 and 2

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: campaignId,
    userId: "user_1",
    status: "active",
  });
  (prisma.gameLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (prismaTx.character.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({ actionType: "rest" });
});

describe("rest gate: which rest the route resolves", () => {
  it("resolves a short rest by default", async () => {
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(contextWith());

    const res = await post("I take a short rest");

    expect(res.status).toBe(200);
    expect((await restPayload(res)).type).toBe("SHORT_REST");
  });

  it("resolves a long rest when the classifier says so", async () => {
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      actionType: "rest",
      restType: "long",
    });
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(contextWith());

    const res = await post("I make camp");

    expect((await restPayload(res)).type).toBe("LONG_REST");
  });

  it("resolves a long rest when the words are in the action, whatever the classifier said", async () => {
    // The gate ORs the two, so the phrase wins even against restType "short".
    // Pinned because it is the branch that rescues a misclassified rest.
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      actionType: "rest",
      restType: "short",
    });
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(contextWith());

    const res = await post("We settle in for a LONG REST by the fire");

    expect((await restPayload(res)).type).toBe("LONG_REST");
  });
});

describe("rest gate: a short rest spends hit dice to heal", () => {
  it("spends dice until healed and reports both figures", async () => {
    // 10/30 hp, 3 hit dice. Each die restores 5, so all three are spent and
    // 15 points come back — still short of full.
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      contextWith({ hp: 10, maxHp: 30, hitDiceRemaining: 3, hitDiceTotal: 3 })
    );

    const res = await post("short rest");

    expect(await restPayload(res)).toEqual({
      type: "SHORT_REST",
      hpRecovered: 3 * HEAL_PER_DIE,
      hitDiceSpent: 3,
    });
    expect(characterUpdate()).toEqual({
      where: { id: "char_1" },
      data: {
        hp: 25,
        hitDiceRemaining: 0,
        exhaustionLevel: 0,
        spellSlots: Prisma.JsonNull,
      },
    });
  });

  it("caps hit points at the maximum, but reports the uncapped roll", async () => {
    // DIVERGENCE 3. 28/30 with dice to spare: one die is spent and the
    // character correctly ends at 30, having gained 2 points — but the event
    // announces 5.
    //
    // `applyShortRest` clamps with `Math.min` inside the loop and *then* adds
    // the full `healing` to `hpRecovered`, so the tally counts points that
    // were never granted. Its own "Ensure we didn't overheal" correction is
    // dead code: it tests `next.hp > next.maxHp`, which the clamp above has
    // already made impossible.
    //
    // Persistence is right and only the report is inflated, which is why this
    // has gone unnoticed — but the narrator is handed these facts, so the
    // player is told about healing the rules did not grant.
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      contextWith({ hp: 28, maxHp: 30, hitDiceRemaining: 3, hitDiceTotal: 3 })
    );

    const res = await post("short rest");

    const payload = await restPayload(res);
    expect(payload.hitDiceSpent).toBe(1);
    expect(payload.hpRecovered).toBe(HEAL_PER_DIE); // 5 reported, 2 actually gained
    // What is persisted is correct.
    expect(characterUpdate().data.hp).toBe(30);
    expect(characterUpdate().data.hitDiceRemaining).toBe(2);
  });

  it("heals nothing when no hit dice remain", async () => {
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      contextWith({ hp: 5, maxHp: 30, hitDiceRemaining: 0, hitDiceTotal: 3 })
    );

    const res = await post("short rest");

    expect(await restPayload(res)).toEqual({
      type: "SHORT_REST",
      hpRecovered: 0,
      hitDiceSpent: 0,
    });
    expect(characterUpdate().data.hp).toBe(5);
  });

  it("spends nothing when already at full health", async () => {
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      contextWith({ hp: 30, maxHp: 30, hitDiceRemaining: 3, hitDiceTotal: 3 })
    );

    const res = await post("short rest");

    const payload = await restPayload(res);
    expect(payload.hitDiceSpent).toBe(0);
    expect(characterUpdate().data.hitDiceRemaining).toBe(3);
  });

  it("a short rest never touches exhaustion", async () => {
    // Only a long rest steps exhaustion down, per the SRD.
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      contextWith({ exhaustionLevel: 3 })
    );

    await post("short rest");

    expect(characterUpdate().data.exhaustionLevel).toBe(3);
  });
});

describe("rest gate: known divergences, pinned so a fix is visible", () => {
  it("recovers the same per die for every class — the hit-die table is missed", async () => {
    // DIVERGENCE 2. `HIT_DICE_BY_CLASS` is keyed "Fighter"/"Wizard"; the stored
    // class is the lowercase SRD slug, so the lookup falls back to d8 and a
    // fighter (d10) recovers exactly what a wizard (d6) does. If this ever
    // fails, the casing was fixed — that is an intended change, not a break.
    for (const characterClass of ["fighter", "wizard", "barbarian"]) {
      vi.clearAllMocks();
      (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: campaignId, userId: "user_1", status: "active",
      });
      (prisma.gameLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
      (prismaTx.character.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
      (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({ actionType: "rest" });
      (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
        contextWith({ class: characterClass, hp: 10, maxHp: 30, hitDiceRemaining: 1 })
      );

      const res = await post("short rest");

      expect(
        (await restPayload(res)).hpRecovered,
        `${characterClass} recovered a different amount`
      ).toBe(HEAL_PER_DIE);
    }
  });

  it("ignores Constitution because the stat is read under the wrong key", async () => {
    // DIVERGENCE 1. `applyShortRest` reads `stats.constitution`; the character
    // carries `CON`. A +3 Constitution changes nothing.
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      contextWith({ stats: { STR: 10, CON: 16 }, hp: 10, maxHp: 30, hitDiceRemaining: 1 })
    );

    const res = await post("short rest");

    expect((await restPayload(res)).hpRecovered).toBe(HEAL_PER_DIE);
  });
});

describe("rest gate: a long rest restores the day", () => {
  it("fills hit points and reports the gap it closed", async () => {
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      actionType: "rest", restType: "long",
    });
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      contextWith({ hp: 7, maxHp: 30 })
    );

    const res = await post("long rest");

    const payload = await restPayload(res);
    expect(payload.type).toBe("LONG_REST");
    expect(payload.hpRecovered).toBe(23);
    expect(characterUpdate().data.hp).toBe(30);
  });

  it("returns half the hit dice, never past the total", async () => {
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      actionType: "rest", restType: "long",
    });
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      contextWith({ hitDiceTotal: 6, hitDiceRemaining: 1 })
    );

    const res = await post("long rest");

    // floor(6 / 2) = 3 recovered, so 1 + 3 = 4 of 6.
    expect((await restPayload(res)).hitDiceRecovered).toBe(3);
    expect(characterUpdate().data.hitDiceRemaining).toBe(4);
  });

  it("caps recovered hit dice at the total when nearly full", async () => {
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      actionType: "rest", restType: "long",
    });
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      contextWith({ hitDiceTotal: 6, hitDiceRemaining: 5 })
    );

    const res = await post("long rest");

    expect(characterUpdate().data.hitDiceRemaining).toBe(6);
  });

  it("steps exhaustion down by exactly one level", async () => {
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      actionType: "rest", restType: "long",
    });
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      contextWith({ exhaustionLevel: 3 })
    );

    const res = await post("long rest");

    expect((await restPayload(res)).exhaustionReduced).toBe(1);
    expect(characterUpdate().data.exhaustionLevel).toBe(2);
  });

  it("does not drive exhaustion below zero", async () => {
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      actionType: "rest", restType: "long",
    });
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      contextWith({ exhaustionLevel: 0 })
    );

    const res = await post("long rest");

    expect((await restPayload(res)).exhaustionReduced).toBe(0);
    expect(characterUpdate().data.exhaustionLevel).toBe(0);
  });

  it("refills every spell slot and says it did", async () => {
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      actionType: "rest", restType: "long",
    });
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      contextWith({
        spellSlots: { "1": { current: 0, max: 4 }, "2": { current: 1, max: 3 } },
      })
    );

    const res = await post("long rest");

    expect((await restPayload(res)).spellSlotsRecovered).toBe(true);
    expect(characterUpdate().data.spellSlots).toEqual({
      "1": { current: 4, max: 4 },
      "2": { current: 3, max: 3 },
    });
  });

  it("reports no slot recovery when none were spent", async () => {
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      actionType: "rest", restType: "long",
    });
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      contextWith({ spellSlots: { "1": { current: 4, max: 4 } } })
    );

    const res = await post("long rest");

    expect((await restPayload(res)).spellSlotsRecovered).toBe(false);
  });

  it("persists JSON null for a character with no spellcasting", async () => {
    // Prisma.JsonNull, not JavaScript null: the column is cleared rather than
    // the write being skipped.
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      actionType: "rest", restType: "long",
    });
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      contextWith({ spellSlots: null })
    );

    await post("long rest");

    expect(characterUpdate().data.spellSlots).toBe(Prisma.JsonNull);
  });
});

describe("rest gate: the rest is canonical history", () => {
  it("writes the player's line exactly once", async () => {
    // A rest has no refusal path, so the line is written unconditionally —
    // and still only once, despite the convergence call further down.
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(contextWith());

    await post("short rest");

    const rows = userLogWrites();
    expect(rows).toHaveLength(1);
    expect(rows[0][0].data.content).toBe("short rest");
  });

  it("resolves the whole rest inside one transaction", async () => {
    // Recovery and persistence must not be separable: a crash between them
    // would credit hit points the character never keeps.
    (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue(contextWith());

    await post("short rest");

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaTx.character.update).toHaveBeenCalledTimes(1);
  });
});
