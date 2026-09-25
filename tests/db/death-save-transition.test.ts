import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { rollPlayerDeathSave } from "@/lib/db/death-save-transition";
import { TurnStateConflictError } from "@/lib/db/turn-state-conflict";

const CTX = {
  campaignId: "camp-1", encounterId: "enc-1", characterId: "char-1",
  round: 4, turnIndex: 0, collectEvents: true,
};

function buildTx(player: Record<string, unknown>, touched = 1, exhaustionLevel = 0) {
  const order: string[] = [];
  const tx = {
    $queryRaw: vi.fn(async () => { order.push("Character"); return []; }),
    combatant: {
      findFirst: vi.fn().mockResolvedValue({
        id: "p1", name: "Aldric", hp: 0, deathSaveSuccesses: 0, deathSaveFailures: 0, stableWakeRound: null,
        ...player,
      }),
      updateMany: vi.fn(async () => { order.push("Combatant"); return { count: 1 }; }),
    },
    character: {
      findUnique: vi.fn().mockResolvedValue({ exhaustionLevel }),
      update: vi.fn(async () => { order.push("Character"); return {}; }),
    },
    encounter: { updateMany: vi.fn(async () => { order.push("Encounter"); return { count: touched }; }) },
    gameLog: { create: vi.fn() },
  } as unknown as Prisma.TransactionClient;
  return { tx, order };
}

const dice = (d20: number, d4 = 2) => ({ d20: () => d20, d4: () => d4 });

describe("rollPlayerDeathSave (death-saves spec §6.3)", () => {
  it("records a success and ends the turn", async () => {
    const { tx, order } = buildTx({});
    const out = await rollPlayerDeathSave(tx, CTX, dice(14));
    expect(out).toMatchObject({ outcome: "dying", endsTurn: true });
    expect(tx.combatant.updateMany).toHaveBeenCalledWith({
      where: { encounterId: "enc-1", isPlayer: true },
      data: { deathSaveSuccesses: 1, deathSaveFailures: 0 },
    });
    expect(order).toEqual(["Character", "Combatant", "Encounter"]);
    expect(out.events[0]).toEqual({
      type: "DEATH_SAVE_ROLLED",
      payload: { natural: 14, successes: 1, failures: 0, outcome: "dying" },
    });
  });

  it("revives on a natural 20 and keeps the turn", async () => {
    const { tx } = buildTx({ deathSaveFailures: 2 });
    const out = await rollPlayerDeathSave(tx, CTX, dice(20));
    expect(out).toMatchObject({ outcome: "revived", endsTurn: false });
    expect(tx.character.update).toHaveBeenCalledWith({ where: { id: "char-1" }, data: { hp: 1 } });
    expect(out.events.map((e) => e.type)).toEqual(["DEATH_SAVE_ROLLED", "PLAYER_REVIVED"]);
  });

  it("stabilises on the third success and schedules the wake", async () => {
    const { tx } = buildTx({ deathSaveSuccesses: 2 });
    const out = await rollPlayerDeathSave(tx, CTX, dice(11, 3));
    expect(out.outcome).toBe("stable");
    expect(tx.combatant.updateMany).toHaveBeenCalledWith({
      where: { encounterId: "enc-1", isPlayer: true },
      data: { deathSaveSuccesses: 3, deathSaveFailures: 0, stableWakeRound: 7 },
    });
    expect(out.events.map((e) => e.type)).toEqual(["DEATH_SAVE_ROLLED", "PLAYER_STABILIZED"]);
    // The log says what the counters mean, not only the counters.
    expect(tx.gameLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ content: expect.stringContaining("Aldric is stable.") }),
    });
  });

  it("logs the revival on a natural 20", async () => {
    const { tx } = buildTx({});
    await rollPlayerDeathSave(tx, CTX, dice(20));
    expect(tx.gameLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        content: expect.stringContaining("Aldric regains consciousness with 1 HP."),
      }),
    });
  });

  it("dies on the third failure", async () => {
    const { tx } = buildTx({ deathSaveFailures: 2 });
    const out = await rollPlayerDeathSave(tx, CTX, dice(3));
    expect(out).toMatchObject({ outcome: "dead", endsTurn: true });
    expect(tx.combatant.updateMany).toHaveBeenCalledWith({
      where: { encounterId: "enc-1", isPlayer: true },
      data: { deathSaveSuccesses: 0, deathSaveFailures: 3 },
    });
    expect(out.events).toContainEqual({ type: "PLAYER_DIED", payload: { cause: "death_saves" } });
    expect(tx.gameLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ content: expect.stringContaining("Aldric dies.") }),
    });
  });

  it("refuses a player who is no longer dying", async () => {
    const { tx } = buildTx({ hp: 1 });
    await expect(rollPlayerDeathSave(tx, CTX, dice(14))).rejects.toBeInstanceOf(TurnStateConflictError);
    expect(tx.combatant.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a stale turn", async () => {
    const { tx } = buildTx({}, 0);
    await expect(rollPlayerDeathSave(tx, CTX, dice(14))).rejects.toBeInstanceOf(TurnStateConflictError);
  });
  // A death saving throw is a saving throw: exhaustion level 3+ puts it at
  // disadvantage, so two d20s are rolled and the lower one counts.
  it("rolls at disadvantage from exhaustion level 3, keeping the lower die", async () => {
    const { tx } = buildTx({}, 1, 3);
    const rolls = [14, 4];
    const out = await rollPlayerDeathSave(tx, CTX, { d20: () => rolls.shift()!, d4: () => 2 });
    expect(out.events[0]).toEqual({
      type: "DEATH_SAVE_ROLLED",
      payload: { natural: 4, successes: 0, failures: 1, outcome: "dying" },
    });
    expect(tx.gameLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        content: expect.stringContaining("Death save (disadvantage — exhaustion): 4"),
      }),
    });
  });

  it("rolls a single die below exhaustion level 3", async () => {
    const { tx } = buildTx({}, 1, 2);
    const rolls = [14, 4];
    const out = await rollPlayerDeathSave(tx, CTX, { d20: () => rolls.shift()!, d4: () => 2 });
    expect(out.events[0]).toMatchObject({ payload: { natural: 14, successes: 1 } });
  });
});
