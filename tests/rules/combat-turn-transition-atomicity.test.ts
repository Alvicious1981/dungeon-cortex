import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

import { finalizeEncounterTurn } from "@/lib/rules/combat-pipeline";

function ongoingCombatants() {
  return [
    { id: "player-1", isPlayer: true, hp: 20 },
    { id: "enemy-1", isPlayer: false, hp: 10 },
    { id: "enemy-2", isPlayer: false, hp: 10 },
  ];
}

function buildCasTx() {
  return {
    $queryRaw: vi.fn(),
    combatant: {
      findMany: vi.fn().mockResolvedValue(ongoingCombatants()),
    },
    encounter: {
      update: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
  } as unknown as Prisma.TransactionClient;
}

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
    expect(tx.encounter.findUnique).not.toHaveBeenCalled();
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

    expect(tx.encounter.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.encounter.updateMany).toHaveBeenCalledWith({
      where: {
        id: "enc-1",
        status: "active",
        currentTurnIndex: 0,
        round: 1,
      },
      data: { currentTurnIndex: 1, round: 1, currentTurnMovementSpentFt: 0 },
    });
    expect(tx.encounter.update).not.toHaveBeenCalled();
    expect(tx.encounter.findUnique).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      encounterResolved: false,
      turnAdvanceConflict: false,
      nextTurnIndex: 1,
      nextRound: 1,
    });
    expect(result.events).toEqual([
      {
        type: "TURN_ADVANCE",
        payload: { nextTurnIndex: 1, nextRound: 1 },
      },
    ]);
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
      data: { currentTurnIndex: 1, round: 1, currentTurnMovementSpentFt: 0 },
    });
    expect(tx.encounter.findUnique).not.toHaveBeenCalled();
    expect(tx.encounter.update).not.toHaveBeenCalled();
    expect(result).toEqual({
      events: [],
      encounterResolved: false,
      turnAdvanceConflict: true,
    });
  });
});
