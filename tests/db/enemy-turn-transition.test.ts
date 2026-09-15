import { afterEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { EnemyTurnInvariantError, resolveEnemyTurn } from "@/lib/db/enemy-turn-transition";
import { TurnStateConflictError } from "@/lib/db/turn-state-conflict";

const GOBLIN_PROFILE = {
  version: 1,
  walkSpeedFt: 30,
  multiattack: null,
  attacks: [
    {
      name: "Scimitar",
      attackBonus: 4,
      melee: { reachFt: 5 },
      ranged: null,
      damage: [{ dice: "1d6+2", type: "slashing" }],
    },
  ],
};

function rows(goblin: Partial<Record<string, unknown>> = {}) {
  return [
    {
      id: "p1", name: "Aldric", isPlayer: true, hp: 20, maxHp: 20, x: 5, y: 5,
      size: "Medium", conditions: [], initiativeOrder: 0, attackProfile: null,
    },
    {
      id: "g1", name: "Goblin", isPlayer: false, hp: 7, maxHp: 7, x: 5, y: 6,
      size: "Small", conditions: [], initiativeOrder: 1, attackProfile: GOBLIN_PROFILE,
      ...goblin,
    },
  ];
}

function buildTx(combatants = rows()) {
  return {
    combatant: {
      findMany: vi.fn().mockResolvedValue(combatants),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    encounter: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    character: {
      findUnique: vi.fn().mockResolvedValue({
        hp: 20, maxHp: 20, stats: { DEX: 10 }, inventory: [],
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    gameLog: { create: vi.fn().mockResolvedValue({}) },
  } as unknown as Prisma.TransactionClient;
}

const CTX = {
  campaignId: "camp-1",
  encounterId: "enc-1",
  characterId: "char-1",
  round: 1,
  turnIndex: 1,
  collectEvents: true,
};

function mockRandom(values: number[]): void {
  let i = 0;
  vi.spyOn(Math, "random").mockImplementation(() => values[i++] ?? 0.5);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveEnemyTurn", () => {
  it("hits the unarmoured player and writes both HP rows through setPlayerHp", async () => {
    const tx = buildTx();
    // d20 = 16 (0.75) + 4 = 20 vs AC 10: hit. 1d6 = 4 (0.5) + 2 = 6. Hit location index 3 (0.3).
    mockRandom([0.75, 0.5, 0.3]);
    const outcome = await resolveEnemyTurn(tx, CTX);

    expect(tx.character.update).toHaveBeenCalledWith({ where: { id: "char-1" }, data: { hp: 14 } });
    expect(tx.combatant.updateMany).toHaveBeenCalledWith({
      where: { encounterId: "enc-1", isPlayer: true },
      data: { hp: 14, deathSaveSuccesses: 0, deathSaveFailures: 0, stableWakeRound: null },
    });
    expect(outcome.playerDowned).toBe(false);
    expect(outcome.events.find((e) => e.type === "COMBAT_CONSEQUENCE")).toMatchObject({
      type: "COMBAT_CONSEQUENCE",
      payload: {
        attackerName: "Goblin",
        targets: [{ targetId: "p1", damage: 6, hpAfter: 14, isKill: false }],
      },
    });
    expect(tx.gameLog.create).toHaveBeenCalledWith({
      data: {
        campaignId: "camp-1",
        role: "system",
        content: "Goblin — Scimitar: 20 vs AC 10, hit, 6 slashing damage.",
      },
    });
  });

  it("reports the player downed and alive at 0 HP", async () => {
    const tx = buildTx();
    (tx.character.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      hp: 3, maxHp: 20, stats: { DEX: 10 }, inventory: [],
    });
    mockRandom([0.75, 0.5, 0.3]);
    const outcome = await resolveEnemyTurn(tx, CTX);

    expect(outcome.playerDowned).toBe(true);
    expect(outcome.playerDied).toBe(false);
    expect(outcome.events.map((e) => e.type)).toContain("PLAYER_DOWNED");
    expect(tx.character.update).toHaveBeenCalledWith({ where: { id: "char-1" }, data: { hp: 0 } });
  });

  it("kills outright when the blow's leftover damage reaches max HP", async () => {
    const tx = buildTx();
    (tx.character.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      hp: 1, maxHp: 5, stats: { DEX: 10 }, inventory: [],
    });
    mockRandom([0.75, 0.5, 0.3]); // 6 damage: leftover 5 = max HP
    const outcome = await resolveEnemyTurn(tx, CTX);

    expect(outcome).toMatchObject({ playerDowned: true, playerDied: true });
    expect(outcome.events.map((e) => e.type)).toContain("PLAYER_DIED");
  });

  it("holds against a player already at 0 HP", async () => {
    const tx = buildTx(rows().map((r) => (r.isPlayer ? { ...r, hp: 0 } : r)));
    const outcome = await resolveEnemyTurn(tx, CTX);

    expect(outcome).toEqual({ events: [], playerDowned: false, playerDied: false });
    expect(tx.character.update).not.toHaveBeenCalled();
    expect(tx.gameLog.create).not.toHaveBeenCalled();
  });

  it("moves a distant goblin with the movement CAS before attacking", async () => {
    const tx = buildTx(rows({ x: 5, y: 9 }));
    mockRandom([0.0]); // natural 1: a miss, so the move is the only state write
    await resolveEnemyTurn(tx, CTX);

    expect(tx.combatant.updateMany).toHaveBeenCalledWith({
      where: { id: "g1", x: 5, y: 9 },
      data: { x: 4, y: 6 },
    });
    expect(tx.gameLog.create).toHaveBeenCalledWith({
      data: { campaignId: "camp-1", role: "system", content: "Goblin moves 15 ft." },
    });
  });

  it("turns a lost movement claim into a turn-state conflict", async () => {
    const tx = buildTx(rows({ x: 5, y: 9 }));
    (tx.combatant.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

    await expect(resolveEnemyTurn(tx, CTX)).rejects.toBeInstanceOf(TurnStateConflictError);
  });

  it("does nothing for an enemy with no profile", async () => {
    const tx = buildTx(rows({ attackProfile: null }));
    const outcome = await resolveEnemyTurn(tx, CTX);

    expect(outcome).toEqual({ events: [], playerDowned: false, playerDied: false });
    expect(tx.character.update).not.toHaveBeenCalled();
    expect(tx.gameLog.create).not.toHaveBeenCalled();
  });

  it("treats an omitted profile field like NULL rather than malformed", async () => {
    const withoutField = rows();
    delete (withoutField[1] as Record<string, unknown>).attackProfile;
    const tx = buildTx(withoutField);

    await expect(resolveEnemyTurn(tx, CTX)).resolves.toEqual({ events: [], playerDowned: false, playerDied: false });
  });

  it("fails closed on a malformed profile", async () => {
    const tx = buildTx(rows({ attackProfile: { version: 9 } }));

    await expect(resolveEnemyTurn(tx, CTX)).rejects.toBeInstanceOf(EnemyTurnInvariantError);
  });
});
