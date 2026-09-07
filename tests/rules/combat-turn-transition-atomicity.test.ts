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
  it("claims the observed persisted turn before emitting its advance", async () => {
    const tx = buildCasTx();
    (tx.encounter.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });

    const result = await finalizeEncounterTurn({
      tx,
      encounterId: "enc-1",
      currentTurnIndex: 0,
      round: 1,
      collectEvents: true,
    });

    expect(tx.encounter.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.encounter.updateMany).toHaveBeenCalledWith({
      where: {
        id: "enc-1",
        status: "active",
        currentTurnIndex: 0,
        round: 1,
      },
      data: { currentTurnIndex: 1, round: 1 },
    });
    expect(tx.encounter.update).not.toHaveBeenCalled();
    expect(tx.encounter.findUnique).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      encounterResolved: false,
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

  it("rebases a stale accepted turn onto the state committed by the winning request", async () => {
    const tx = buildCasTx();
    (tx.encounter.updateMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    (tx.encounter.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "active",
      currentTurnIndex: 1,
      round: 1,
    });

    const result = await finalizeEncounterTurn({
      tx,
      encounterId: "enc-1",
      currentTurnIndex: 0,
      round: 1,
      collectEvents: true,
    });

    expect(tx.encounter.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: "enc-1",
        status: "active",
        currentTurnIndex: 0,
        round: 1,
      },
      data: { currentTurnIndex: 1, round: 1 },
    });
    expect(tx.encounter.findUnique).toHaveBeenCalledWith({
      where: { id: "enc-1" },
      select: { status: true, currentTurnIndex: true, round: true },
    });
    expect(tx.encounter.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: "enc-1",
        status: "active",
        currentTurnIndex: 1,
        round: 1,
      },
      data: { currentTurnIndex: 2, round: 1 },
    });
    expect(tx.encounter.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      encounterResolved: false,
      nextTurnIndex: 2,
      nextRound: 1,
    });
    expect(result.events).toEqual([
      {
        type: "TURN_ADVANCE",
        payload: { nextTurnIndex: 2, nextRound: 1 },
      },
    ]);
  });
});
