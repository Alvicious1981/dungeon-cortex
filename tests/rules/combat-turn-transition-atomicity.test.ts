import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

import { finalizeEncounterTurn } from "@/lib/rules/combat-pipeline";

// The enemy-turn chain is covered here only for its orchestration; what one
// enemy turn does is pinned in tests/db/enemy-turn-transition.test.ts.
vi.mock("@/lib/db/enemy-turn-transition", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/db/enemy-turn-transition")>()),
  resolveEnemyTurn: vi.fn(),
}));
import { resolveEnemyTurn } from "@/lib/db/enemy-turn-transition";
import { TurnStateConflictError } from "@/lib/db/turn-state-conflict";

function ongoingCombatants() {
  return [
    { id: "player-1", isPlayer: true, hp: 20 },
    { id: "enemy-1", isPlayer: false, hp: 10 },
    { id: "enemy-2", isPlayer: false, hp: 10 },
  ];
}

/**
 * `encounter.findUnique` answers two questions. The finalizer asks for the
 * encounter's owning character (a `campaign` select) before any write, to take
 * the Character lock; the legacy rebase path asks for a fresh status/index. The
 * double answers the first from the select and the second from `fresh`.
 */
function buildCasTx(fresh: Record<string, unknown> | null = null) {
  return {
    $queryRaw: vi.fn(),
    gameLog: { create: vi.fn() },
    combatant: {
      findMany: vi.fn().mockResolvedValue(ongoingCombatants()),
    },
    encounter: {
      update: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn().mockImplementation((args?: { select?: Record<string, unknown> }) => {
        if (args?.select?.campaign) {
          return Promise.resolve({ campaignId: "camp-1", campaign: { characterId: "char-1" } });
        }
        return Promise.resolve(fresh);
      }),
    },
  } as unknown as Prisma.TransactionClient;
}

/** The legacy rebase read — the one fail-closed callers must never make. */
const REBASE_READ = expect.objectContaining({
  select: expect.objectContaining({ status: true }),
});

beforeEach(() => {
  vi.mocked(resolveEnemyTurn).mockReset();
  vi.mocked(resolveEnemyTurn).mockResolvedValue({ events: [], playerDowned: false, playerDied: false });
});

describe("finalizeEncounterTurn atomic turn claims", () => {
  it("binds a fail-closed resolved-encounter claim to the observed turn", async () => {
    const tx = buildCasTx();
    (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "player-1", isPlayer: true, hp: 20 },
      { id: "enemy-1", isPlayer: false, hp: 0, xpValue: 0 },
    ]);
    (tx.encounter.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });

    const result = await finalizeEncounterTurn({
      tx,
      encounterId: "enc-1",
      currentTurnIndex: 0,
      round: 3,
      failOnStaleTurn: true,
    });

    expect(tx.encounter.updateMany).toHaveBeenCalledWith({
      where: {
        id: "enc-1",
        status: "active",
        currentTurnIndex: 0,
        round: 3,
      },
      data: { status: "resolved" },
    });
    expect(result).toMatchObject({
      encounterResolved: true,
      turnAdvanceConflict: false,
    });
  });

  it("reports a conflict when a fail-closed resolved claim loses", async () => {
    const tx = buildCasTx();
    (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "player-1", isPlayer: true, hp: 20 },
      { id: "enemy-1", isPlayer: false, hp: 0, xpValue: 50 },
    ]);
    (tx.encounter.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

    const result = await finalizeEncounterTurn({
      tx,
      encounterId: "enc-1",
      currentTurnIndex: 0,
      round: 3,
      failOnStaleTurn: true,
    });

    expect(result).toEqual({
      events: [],
      encounterResolved: true,
      turnAdvanceConflict: true,
    });
    expect(tx.encounter.findUnique).not.toHaveBeenCalledWith(REBASE_READ);
  });

  it("claims the observed persisted turn before emitting its advance", async () => {
    const tx = buildCasTx();
    (tx.encounter.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });

    const result = await finalizeEncounterTurn({
      tx,
      encounterId: "enc-1",
      currentTurnIndex: 0,
      round: 1,
      collectEvents: true,
      failOnStaleTurn: true,
    });

    // The player's own claim is the first edge; the enemy chain follows it.
    expect(tx.encounter.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: "enc-1",
        status: "active",
        currentTurnIndex: 0,
        round: 1,
      },
      data: {
        currentTurnIndex: 1,
        round: 1,
        currentTurnMovementSpentFt: 0,
        currentTurnObjectInteractionUsed: false,
      },
    });
    expect(tx.encounter.update).not.toHaveBeenCalled();
    expect(tx.encounter.findUnique).not.toHaveBeenCalledWith(REBASE_READ);
    expect(result).toMatchObject({ encounterResolved: false, turnAdvanceConflict: false });
    expect(result.events[0]).toEqual({
      type: "TURN_ADVANCE",
      payload: { nextTurnIndex: 1, nextRound: 1 },
    });
  });

  it("fails closed when the observed turn snapshot is already stale", async () => {
    const tx = buildCasTx();
    (tx.encounter.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

    const result = await finalizeEncounterTurn({
      tx,
      encounterId: "enc-1",
      currentTurnIndex: 0,
      round: 1,
      collectEvents: true,
      failOnStaleTurn: true,
    });

    expect(tx.encounter.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.encounter.updateMany).toHaveBeenCalledWith({
      where: {
        id: "enc-1",
        status: "active",
        currentTurnIndex: 0,
        round: 1,
      },
      data: {
        currentTurnIndex: 1,
        round: 1,
        currentTurnMovementSpentFt: 0,
        currentTurnObjectInteractionUsed: false,
      },
    });
    expect(tx.encounter.findUnique).not.toHaveBeenCalledWith(REBASE_READ);
    expect(tx.encounter.update).not.toHaveBeenCalled();
    expect(resolveEnemyTurn).not.toHaveBeenCalled();
    expect(result).toEqual({
      events: [],
      encounterResolved: false,
      turnAdvanceConflict: true,
    });
  });
});

describe("finalizeEncounterTurn enemy chain", () => {
  it("locks the owning Character before claiming the turn", async () => {
    const tx = buildCasTx();
    (tx.encounter.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });

    await finalizeEncounterTurn({
      tx,
      encounterId: "enc-1",
      currentTurnIndex: 0,
      round: 1,
      failOnStaleTurn: true,
    });

    const lockOrder = (tx.$queryRaw as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const claimOrder = (tx.encounter.updateMany as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    expect(lockOrder).toBeDefined();
    expect(lockOrder!).toBeLessThan(claimOrder!);
  });

  it("runs every enemy turn and returns the pointer to the player", async () => {
    const tx = buildCasTx();
    (tx.encounter.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });

    const result = await finalizeEncounterTurn({
      tx,
      encounterId: "enc-1",
      currentTurnIndex: 0,
      round: 1,
      failOnStaleTurn: true,
    });

    expect(resolveEnemyTurn).toHaveBeenCalledTimes(2);
    expect(vi.mocked(resolveEnemyTurn).mock.calls[0]![1]).toMatchObject({
      campaignId: "camp-1",
      characterId: "char-1",
      encounterId: "enc-1",
      turnIndex: 1,
      round: 1,
    });
    expect(result).toMatchObject({
      encounterResolved: false,
      turnAdvanceConflict: false,
      nextTurnIndex: 0,
      nextRound: 2,
    });
    expect(result.events.map((e) => e.type)).toEqual([
      "TURN_ADVANCE",
      "TURN_ADVANCE",
      "ROUND_ADVANCE",
    ]);
  });

  it("keeps the chain going when an enemy downs the player", async () => {
    const tx = buildCasTx();
    (tx.encounter.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
    vi.mocked(resolveEnemyTurn).mockResolvedValueOnce({
      events: [{ type: "PLAYER_DOWNED", payload: {} }],
      playerDowned: true,
      playerDied: false,
    });

    const result = await finalizeEncounterTurn({
      tx, encounterId: "enc-1", currentTurnIndex: 0, round: 1, failOnStaleTurn: true,
    });

    expect(result).toMatchObject({ encounterResolved: false, nextTurnIndex: 0, nextRound: 2 });
    expect(result.events.map((e) => e.type)).toContain("PLAYER_DOWNED");
    expect(resolveEnemyTurn).toHaveBeenCalledTimes(2);
    expect(tx.encounter.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "resolved" } }),
    );
  });

  it("resolves player_dead when an enemy kills the player outright", async () => {
    const tx = buildCasTx();
    const characterUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    (tx as unknown as { character: unknown }).character = { updateMany: characterUpdateMany };
    (tx.encounter.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
    vi.mocked(resolveEnemyTurn).mockResolvedValueOnce({
      events: [{ type: "PLAYER_DIED", payload: { cause: "massive_damage" } }],
      playerDowned: true,
      playerDied: true,
    });
    (tx.combatant.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(ongoingCombatants()) // finalizer entry
      .mockResolvedValueOnce(ongoingCombatants()) // chain: slot ownership
      .mockResolvedValue([
        // after the killing blow
        { id: "player-1", isPlayer: true, hp: 0, deathSaveFailures: 3 },
        { id: "enemy-1", isPlayer: false, hp: 10 },
        { id: "enemy-2", isPlayer: false, hp: 10 },
      ]);

    const result = await finalizeEncounterTurn({
      tx, encounterId: "enc-1", currentTurnIndex: 0, round: 1, failOnStaleTurn: true,
    });

    expect(result.encounterResolved).toBe(true);
    expect(result.events.map((e) => e.type)).toContain("PLAYER_DIED");
    // Permanent death: written once, by the claim winner (death-saves spec §9).
    expect(characterUpdateMany).toHaveBeenCalledWith({
      where: { id: "char-1", diedAt: null },
      data: { diedAt: expect.any(Date) },
    });
    expect(tx.encounter.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { status: "resolved" } }),
    );
    expect(resolveEnemyTurn).toHaveBeenCalledTimes(1);
  });

  it("wakes a stable player when the chain returns on the wake round", async () => {
    const tx = buildCasTx();
    (tx.encounter.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
    const characterUpdate = vi.fn();
    (tx as unknown as { character: unknown }).character = { update: characterUpdate };
    (tx.combatant as unknown as { updateMany: unknown }).updateMany = vi.fn();
    (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "player-1", isPlayer: true, hp: 0, stableWakeRound: 2 },
      { id: "enemy-1", isPlayer: false, hp: 10 },
      { id: "enemy-2", isPlayer: false, hp: 10 },
    ]);

    const result = await finalizeEncounterTurn({
      tx, encounterId: "enc-1", currentTurnIndex: 0, round: 1, failOnStaleTurn: true,
    });

    expect(result).toMatchObject({ nextTurnIndex: 0, nextRound: 2 });
    expect(result.events.map((e) => e.type)).toContain("PLAYER_WOKE");
    expect(characterUpdate).toHaveBeenCalledWith({ where: { id: "char-1" }, data: { hp: 1 } });
  });

  it("does not wake a stable player a round early", async () => {
    const tx = buildCasTx();
    (tx.encounter.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
    (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "player-1", isPlayer: true, hp: 0, stableWakeRound: 3 },
      { id: "enemy-1", isPlayer: false, hp: 10 },
      { id: "enemy-2", isPlayer: false, hp: 10 },
    ]);

    const result = await finalizeEncounterTurn({
      tx, encounterId: "enc-1", currentTurnIndex: 0, round: 1, failOnStaleTurn: true,
    });

    expect(result.events.map((e) => e.type)).not.toContain("PLAYER_WOKE");
  });

  it("resume starts the chain at the enemy slot without a player claim", async () => {
    const tx = buildCasTx();
    (tx.encounter.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });

    const result = await finalizeEncounterTurn({
      tx,
      encounterId: "enc-1",
      currentTurnIndex: 1,
      round: 1,
      failOnStaleTurn: true,
      mode: "resume",
    });

    expect(tx.encounter.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "enc-1", status: "active", currentTurnIndex: 1, round: 1 },
      data: { currentTurnMovementSpentFt: 0, currentTurnObjectInteractionUsed: false },
    });
    expect(resolveEnemyTurn).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ nextTurnIndex: 0, nextRound: 2 });
  });

  it("reports a stale resume as a conflict without resolving any enemy", async () => {
    const tx = buildCasTx();
    (tx.encounter.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

    const result = await finalizeEncounterTurn({
      tx,
      encounterId: "enc-1",
      currentTurnIndex: 1,
      round: 1,
      failOnStaleTurn: true,
      mode: "resume",
    });

    expect(result).toMatchObject({ turnAdvanceConflict: true });
    expect(resolveEnemyTurn).not.toHaveBeenCalled();
  });

  it("throws a turn-state conflict when an enemy turn claim loses", async () => {
    // The player's claim wins; the first enemy-turn edge then finds the row
    // changed. Writes have already happened in this transaction, so there is no
    // stale result to report — only a throw rolls them back.
    const tx = buildCasTx();
    (tx.encounter.updateMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await expect(
      finalizeEncounterTurn({
        tx,
        encounterId: "enc-1",
        currentTurnIndex: 0,
        round: 1,
        failOnStaleTurn: true,
      }),
    ).rejects.toBeInstanceOf(TurnStateConflictError);
    expect(resolveEnemyTurn).toHaveBeenCalledTimes(1);
  });

  it("throws the invariant error when the chain cannot return to the player", async () => {
    const tx = buildCasTx();
    (tx.encounter.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
    (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "ghost-1", isPlayer: false, hp: 20 },
      { id: "enemy-1", isPlayer: false, hp: 10 },
    ]);

    await expect(
      finalizeEncounterTurn({
        tx,
        encounterId: "enc-1",
        currentTurnIndex: 0,
        round: 1,
        failOnStaleTurn: true,
      }),
    ).rejects.toThrow(/did not return to the player/);
  });
});
