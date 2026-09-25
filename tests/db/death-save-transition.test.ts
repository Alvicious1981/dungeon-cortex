import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { rollPlayerDeathSave } from "@/lib/db/death-save-transition";
import { TurnStateConflictError } from "@/lib/db/turn-state-conflict";
import { DeathSaveInvariantError } from "@/lib/rules/death-save";

const CTX = {
  campaignId: "camp-1", encounterId: "enc-1", characterId: "char-1",
  round: 4, turnIndex: 0, collectEvents: true,
};

function buildTx(player: Record<string, unknown>, touched = 1) {
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
    character: { update: vi.fn(async () => { order.push("Character"); return {}; }) },
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
    expect(tx.combatant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { encounterId: "enc-1", characterId: "char-1" } })
    );
    expect(tx.combatant.updateMany).toHaveBeenCalledWith({
      where: { encounterId: "enc-1", characterId: "char-1" },
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
      where: { encounterId: "enc-1", characterId: "char-1" },
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
      where: { encounterId: "enc-1", characterId: "char-1" },
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

  it("names the encounter and the character when no Combatant carries that link", async () => {
    // The lookup is by (encounterId, characterId), so a miss means no Combatant
    // in this encounter is linked to this character — not necessarily that
    // the encounter has no player at all.
    const { tx } = buildTx({});
    (tx.combatant.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const attempt = rollPlayerDeathSave(tx, CTX, dice(14));
    await expect(attempt).rejects.toBeInstanceOf(DeathSaveInvariantError);
    await expect(attempt).rejects.toThrow("Encounter enc-1 has no Combatant linked to character char-1.");
    expect(tx.combatant.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a stale turn", async () => {
    const { tx } = buildTx({}, 0);
    await expect(rollPlayerDeathSave(tx, CTX, dice(14))).rejects.toBeInstanceOf(TurnStateConflictError);
  });
});
