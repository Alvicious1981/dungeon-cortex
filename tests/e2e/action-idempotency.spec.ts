import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test, type APIRequestContext } from "@playwright/test";

import { advanceTurn } from "../../lib/rules/combat";
import {
  assertSafeE2EDatabase,
  cleanupE2ERecords,
  type E2ECreatedRecords,
} from "./support/database";

/**
 * The only proof of DC-AUD-003 that a real database can give.
 *
 * The unit lane mocks Prisma with a `$transaction` that never rolls back and a
 * `create` that only throws P2002 because a test told it to, so it can prove
 * our branch logic and nothing about the constraint underneath. What has to be
 * shown here instead: PostgreSQL genuinely enforces the unique index, and two
 * concurrent requests carrying the same `requestId` resolve the action exactly
 * once.
 *
 * `End Turn` is the subject because it is the one deterministic mutation
 * available — no dice, no damage, no model. But the naive assertion
 * `currentTurnIndex === T + 1` is WRONG and is deliberately not used:
 *
 *   - `advanceTurn` (lib/rules/combat.ts) wraps when `currentTurnIndex + 1`
 *     reaches the combatant count, resetting the index to 0 and incrementing
 *     the round.
 *   - `finalizeEncounterTurn` evaluates `resolveEncounterEnd` first; if the
 *     encounter should end it claims active → resolved and never touches the
 *     turn index at all.
 *
 * So the expected state is computed by calling the real `advanceTurn` once,
 * and the fixture is asserted to be in the branch where advancement actually
 * happens. Three assertions carry the proof together — see the note at the
 * turn-state check for why the turn index alone is not sufficient under true
 * concurrency, and why the canonical user-log count is what closes it.
 */
test("@smoke una acción reenviada con el mismo requestId se ejecuta una sola vez", async ({
  request,
}) => {
  test.setTimeout(90_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();
  const requestId = `dungeon-action-${randomUUID()}`;

  const createdId = async (response: { status(): number; json(): Promise<unknown> }) => {
    expect(response.status()).toBe(201);
    const body = (await response.json()) as { id?: unknown };
    expect(typeof body.id).toBe("string");
    return body.id as string;
  };

  try {
    // ── Fixture, over HTTP: no UI flow is needed to prove a server property ──
    created.characterId = await createdId(
      await request.post("/api/character", {
        data: {
          name: `E2E ${randomUUID().slice(0, 8)}`,
          race: "human",
          class: "fighter",
          stats: { STR: 14, DEX: 12, CON: 14, INT: 10, WIS: 10, CHA: 10 },
        },
      })
    );

    created.campaignId = await createdId(
      await request.post("/api/campaign", {
        data: { characterId: created.characterId, title: `Idempotencia ${requestId.slice(-8)}` },
      })
    );

    const encounterResponse = await request.post(
      `/api/campaign/${created.campaignId}/encounter`,
      {
        data: {
          // Two live hostiles alongside the player: enough that the encounter
          // cannot resolve during this End Turn, and enough that a single
          // advancement does not wrap from the opening index.
          enemies: [
            { name: "Goblin Uno", hp: 7, maxHp: 7, dexModifier: 2 },
            { name: "Goblin Dos", hp: 7, maxHp: 7, dexModifier: 1 },
          ],
        },
      }
    );
    expect(encounterResponse.status()).toBe(201);
    const encounterId = ((await encounterResponse.json()) as { id: string }).id;

    // ── Baseline, read straight from PostgreSQL ──────────────────────────────
    const before = await prisma.encounter.findUniqueOrThrow({
      where: { id: encounterId },
      include: { combatants: true },
    });

    // Fixture guards. Without these the test could silently measure the
    // resolve branch, where the index never moves and nothing is proven.
    expect(before.status).toBe("active");
    expect(before.combatants.some((c) => c.isPlayer && c.hp > 0)).toBe(true);
    expect(before.combatants.some((c) => !c.isPlayer && c.hp > 0)).toBe(true);

    // The real rule, applied exactly once — wrap-around included.
    const expected = advanceTurn({
      currentTurnIndex: before.currentTurnIndex,
      round: before.round,
      combatantCount: before.combatants.length,
    });

    // ── Two genuinely concurrent requests, identical in every byte ───────────
    const body = { requestId, action: "End Turn" };
    const post = (client: APIRequestContext) =>
      client.post(`/api/campaign/${created.campaignId}/action`, { data: body });

    const [first, second] = await Promise.all([post(request), post(request)]);
    const statuses = [first.status(), second.status()].sort();

    // Either race outcome is correct. The loser may find the receipt still
    // PROCESSING (409) or already settled (a duplicate 200); what must never
    // happen is two executions.
    expect(statuses[0]).toBe(200);
    expect([200, 409]).toContain(statuses[1]);

    // ── The invariant: exactly one execution ────────────────────────────────
    const after = await prisma.encounter.findUniqueOrThrow({
      where: { id: encounterId },
    });

    // Two SEQUENTIAL advancements always land on a different (index, round)
    // pair than one — the pair is a bijection with round * C + index, and one
    // application moves that counter by 1, two by 2 — so this assertion
    // cannot be satisfied by a doubled execution that saw fresh state.
    //
    // It is deliberately not the only assertion, because it is not sufficient
    // on its own: two genuinely CONCURRENT executions could each read the same
    // pre-turn snapshot through `buildCampaignContext` and write the same
    // `nextTurnIndex`, landing on the one-advancement value. The user-log count
    // below is what closes that hole — two executions mean two canonical
    // `role:"user"` rows, whatever the turn index ends up saying.
    expect(after.currentTurnIndex).toBe(expected.nextTurnIndex);
    expect(after.round).toBe(expected.nextRound);
    expect(after.status).toBe("active");

    const receipts = await prisma.actionRequestReceipt.count({ where: { requestId } });
    expect(receipts).toBe(1);

    const playerLines = await prisma.gameLog.count({
      where: { campaignId: created.campaignId, role: "user", content: "End Turn" },
    });
    expect(playerLines).toBe(1);

    // ── DC-AUD-004: the duplicate replays the original events ───────────────
    // `End Turn` emits exactly one deterministic advancement event — no dice,
    // no damage — so both what was stored and what is replayed are exact.
    const receipt = await prisma.actionRequestReceipt.findFirstOrThrow({
      where: { requestId },
      select: { status: true, replayEvents: true },
    });
    expect(receipt.status).toBe("COMPLETED");
    const storedEvents = receipt.replayEvents as Array<{ type: string }>;
    expect(Array.isArray(storedEvents)).toBe(true);
    expect(storedEvents).toHaveLength(1);
    expect(storedEvents[0]!.type).toMatch(/^(TURN|ROUND)_ADVANCE$/);

    // A third request, sequential this time: the receipt is settled, so this
    // is unambiguously the duplicate path rather than either side of a race.
    const duplicate = await post(request);
    expect(duplicate.status()).toBe(200);

    const frames = (await duplicate.text())
      .split(/\n\n/)
      .filter((chunk) => chunk.startsWith("data: "))
      .map((chunk) => JSON.parse(chunk.slice(6)) as { t: string; e?: unknown });

    expect(frames.map((f) => f.t)).toEqual(["duplicate", "evt", "done"]);
    expect(frames[1]!.e).toEqual(storedEvents[0]);

    // And the replay changed nothing: still one advancement, one player row.
    const afterReplay = await prisma.encounter.findUniqueOrThrow({
      where: { id: encounterId },
    });
    expect(afterReplay.currentTurnIndex).toBe(expected.nextTurnIndex);
    expect(afterReplay.round).toBe(expected.nextRound);
    expect(
      await prisma.gameLog.count({
        where: { campaignId: created.campaignId, role: "user", content: "End Turn" },
      })
    ).toBe(1);
  } finally {
    // This spec is the first E2E journey to open an encounter, and the shared
    // cleanup helper only knows about game logs, campaigns, characters and
    // inventory. `Encounter_campaignId_fkey` and `Combatant_encounterId_fkey`
    // are both RESTRICT, so the campaign cannot be deleted while its encounter
    // and combatants exist — CI caught exactly that.
    //
    // Torn down here rather than by widening the shared helper: this journey
    // created the extra state, so it owns removing it. Combatants first, then
    // the encounter, whose Zones cascade with it.
    if (created.campaignId) {
      const encounters = await prisma.encounter.findMany({
        where: { campaignId: created.campaignId },
        select: { id: true },
      });
      const encounterIds = encounters.map((e) => e.id);

      if (encounterIds.length > 0) {
        await prisma.combatant.deleteMany({
          where: { encounterId: { in: encounterIds } },
        });
        await prisma.encounter.deleteMany({ where: { id: { in: encounterIds } } });
      }
    }

    await prisma.$disconnect();
    // Receipts need no explicit removal: their FK to Campaign is CASCADE, so
    // the helper's campaign delete takes them with it.
    await cleanupE2ERecords(created);
  }
});
