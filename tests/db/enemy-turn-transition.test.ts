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
      where: { encounterId: "enc-1", characterId: "char-1" },
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

  it("selects inventory quantity before resolving the player's armour class", async () => {
    const tx = buildTx();
    mockRandom([0.75, 0.5, 0.3]);

    await resolveEnemyTurn(tx, CTX);

    expect(tx.character.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          inventory: expect.objectContaining({
            select: expect.objectContaining({ quantity: true }),
          }),
        }),
      }),
    );
  });

  it("does not give a depleted shield AC during an enemy attack", async () => {
    const tx = buildTx();
    (tx.character.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      hp: 20,
      maxHp: 20,
      stats: { DEX: 10 },
      inventory: [
        {
          type: "armor",
          quantity: 0,
          equippedSlot: "OFF_HAND",
          properties: {
            baseAC: 2,
            armorClass: "shield",
            addDexModifier: false,
            maxDexBonus: null,
          },
        },
      ],
    });
    // d20 = 6 (0.25) + 4 = 10: hits AC 10 but misses AC 12.
    mockRandom([0.25, 0.5, 0.3]);

    await resolveEnemyTurn(tx, CTX);

    expect(tx.character.update).toHaveBeenCalledWith({ where: { id: "char-1" }, data: { hp: 14 } });
    expect(tx.gameLog.create).toHaveBeenCalledWith({
      data: {
        campaignId: "camp-1",
        role: "system",
        content: "Goblin — Scimitar: 10 vs AC 10, hit, 6 slashing damage.",
      },
    });
  });

  it("keeps a usable shield's AC during an enemy attack", async () => {
    const tx = buildTx();
    (tx.character.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      hp: 20,
      maxHp: 20,
      stats: { DEX: 10 },
      inventory: [
        {
          type: "armor",
          quantity: 1,
          equippedSlot: "OFF_HAND",
          properties: {
            baseAC: 2,
            armorClass: "shield",
            addDexModifier: false,
            maxDexBonus: null,
          },
        },
      ],
    });
    // d20 = 6 (0.25) + 4 = 10: misses AC 12 from the usable shield.
    mockRandom([0.25]);

    await resolveEnemyTurn(tx, CTX);

    expect(tx.character.update).not.toHaveBeenCalled();
    expect(tx.gameLog.create).toHaveBeenCalledWith({
      data: {
        campaignId: "camp-1",
        role: "system",
        content: "Goblin — Scimitar: 10 vs AC 12, miss.",
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
    // The fall is a line of its own, after the blow that caused it.
    expect(tx.gameLog.create).toHaveBeenLastCalledWith({
      data: { campaignId: "camp-1", role: "system", content: "Aldric falls unconscious and is dying." },
    });
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
    expect(tx.gameLog.create).toHaveBeenLastCalledWith({
      data: { campaignId: "camp-1", role: "system", content: "Aldric dies from massive damage." },
    });
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

const DRAGON_PROFILE = {
  version: 1, walkSpeedFt: 40, multiattack: null,
  attacks: [{
    name: "Bite", attackBonus: 10, melee: { reachFt: 10 }, ranged: null,
    damage: [{ dice: "2d10+6", type: "piercing" }],
  }],
  areaSaveAttack: {
    name: "Fire Breath", reachFt: 60, saveAbility: "DEX", saveDC: 21,
    damage: [{ dice: "18d6", type: "fire" }], rechargeMin: 5,
  },
};

function dragonRows(overrides: Partial<Record<string, unknown>> = {}) {
  return [
    {
      id: "p1", name: "Aldric", isPlayer: true, hp: 200, maxHp: 200, x: 5, y: 5,
      size: "Medium", conditions: [], initiativeOrder: 0, attackProfile: null,
    },
    {
      id: "d1", name: "Adult Red Dragon", isPlayer: false, hp: 256, maxHp: 256,
      x: 5, y: 5, size: "Huge", conditions: [], initiativeOrder: 1,
      attackProfile: DRAGON_PROFILE, breathAvailable: true,
      ...overrides,
    },
  ];
}

function buildDragonTx(combatants = dragonRows()) {
  return {
    combatant: {
      findMany: vi.fn().mockResolvedValue(combatants),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    encounter: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    character: {
      findUnique: vi.fn().mockResolvedValue({
        // Rogue: proficient in DEX and INT — Fire Breath's save is DEX, so the
        // default fixture exercises the proficiency bonus everywhere it isn't
        // deliberately turned off (the "no proficiency" test below overrides
        // this with a class NOT proficient in DEX).
        hp: 200, maxHp: 200, stats: { DEX: 14, CON: 12 }, class: "rogue", level: 5, inventory: [],
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    gameLog: { create: vi.fn().mockResolvedValue({}) },
  } as unknown as Prisma.TransactionClient;
}

const DRAGON_CTX = {
  campaignId: "camp-1", encounterId: "enc-1", characterId: "char-1",
  round: 1, turnIndex: 1, collectEvents: true,
};

describe("resolveEnemyTurn — area-save attacks (area-save-actions spec §6)", () => {
  it("breathes when charged and in range: a failed save takes full damage", async () => {
    const tx = buildDragonTx();
    // Rogue DEX 14 (+2) + proficiency (level 5 = +3) = +5. d20 = 15 (0.7) + 5 = 20 vs DC 21: fails.
    // 18d6 damage: each die 0.5 -> 4, total 72.
    mockRandom([0.7, ...Array(18).fill(0.5)]);
    const outcome = await resolveEnemyTurn(tx, DRAGON_CTX);

    expect(tx.character.update).toHaveBeenCalledWith({ where: { id: "char-1" }, data: { hp: 128 } });
    expect(tx.combatant.updateMany).toHaveBeenCalledWith({
      where: { id: "d1" }, data: { breathAvailable: false },
    });
    expect(outcome.playerDowned).toBe(false);
    expect(tx.gameLog.create).toHaveBeenCalledWith({
      data: {
        campaignId: "camp-1", role: "system",
        content: "Adult Red Dragon — Fire Breath: DC 21 Dexterity save, Aldric rolls 20 — fails, 72 fire damage.",
      },
    });
  });

  it("halves and rounds down on a successful save", async () => {
    const tx = buildDragonTx();
    // d20 = 20 (0.95) + 5 = 25 vs DC 21: succeeds. 18d6 average roll -> 72 raw, halved to 36.
    mockRandom([0.95, ...Array(18).fill(0.5)]);
    await resolveEnemyTurn(tx, DRAGON_CTX);

    expect(tx.character.update).toHaveBeenCalledWith({ where: { id: "char-1" }, data: { hp: 164 } });
    expect(tx.gameLog.create).toHaveBeenCalledWith({
      data: {
        campaignId: "camp-1", role: "system",
        content: "Adult Red Dragon — Fire Breath: DC 21 Dexterity save, Aldric rolls 25 — succeeds, 36 fire damage.",
      },
    });
  });

  it("prefers breath over melee when both are usable", async () => {
    const tx = buildDragonTx();
    mockRandom([0.7, ...Array(18).fill(0.5)]);
    await resolveEnemyTurn(tx, DRAGON_CTX);

    // Bite's attack roll (resolveAttackRoll) is never reached: no "vs AC" log line.
    const calls = (tx.gameLog.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some(([{ data }]) => data.content.includes("vs AC"))).toBe(false);
  });

  it("falls back to melee when breathAvailable is false and stays spent", async () => {
    const tx = buildDragonTx(dragonRows({ breathAvailable: false }));
    // A spent breath still rolls to recharge first (1d6 = 4, 0.5 -> fails,
    // stays false), then the melee attack-roll/damage/hit-location sequence.
    mockRandom([0.5, 0.75, 0.5, 0.3]);
    await resolveEnemyTurn(tx, DRAGON_CTX);

    const calls = (tx.gameLog.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some(([{ data }]) => data.content.includes("Bite:"))).toBe(true);
    expect(calls.some(([{ data }]) => data.content.includes("Fire Breath:"))).toBe(false);
  });

  it("kills outright when a failed save's damage reaches max HP", async () => {
    const tx = buildDragonTx();
    (tx.character.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      hp: 10, maxHp: 10, stats: { DEX: 14, CON: 12 }, class: "rogue", level: 5, inventory: [],
    });
    mockRandom([0.05, ...Array(18).fill(0.9)]); // a low roll fails; high damage dice
    const outcome = await resolveEnemyTurn(tx, DRAGON_CTX);

    expect(outcome.playerDied).toBe(true);
    expect(tx.gameLog.create).toHaveBeenLastCalledWith({
      data: { campaignId: "camp-1", role: "system", content: "Aldric dies from massive damage." },
    });
  });

  it("recharges and immediately breathes that same turn on success", async () => {
    // A recharge roll that succeeds makes the breath available for THIS
    // turn's planning, not only from the next turn on — the same real 5e
    // rule a dragon plays by: roll recharge at the start of your turn, then
    // take your action, breath included, same turn.
    const tx = buildDragonTx(dragonRows({ breathAvailable: false }));
    // Recharge: 1d6 = 5 (0.7), succeeds. Then the save (d20 = 15, 0.7) and
    // 18 damage dice (all 0.5 -> 4 each = 72), the same sequence as the
    // "breathes when charged" test above.
    mockRandom([0.7, 0.7, ...Array(18).fill(0.5)]);
    await resolveEnemyTurn(tx, DRAGON_CTX);

    expect(tx.combatant.updateMany).toHaveBeenCalledWith({
      where: { id: "d1" }, data: { breathAvailable: true },
    });
    expect(tx.gameLog.create).toHaveBeenCalledWith({
      data: { campaignId: "camp-1", role: "system", content: "Adult Red Dragon recharges its Fire Breath (5)." },
    });
    const calls = (tx.gameLog.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some(([{ data }]) => data.content.includes("Fire Breath:"))).toBe(true);
    expect(calls.some(([{ data }]) => data.content.includes("Bite:"))).toBe(false);
    // Used this turn, so it is spent again by the time the turn ends.
    expect(tx.combatant.updateMany).toHaveBeenCalledWith({
      where: { id: "d1" }, data: { breathAvailable: false },
    });
  });

  it("logs a failed recharge and does not touch breathAvailable", async () => {
    const tx = buildDragonTx(dragonRows({ breathAvailable: false }));
    mockRandom([0.2, 0.75, 0.5, 0.3]); // 1d6 = 2 (0.2 -> 2): fails
    await resolveEnemyTurn(tx, DRAGON_CTX);

    expect(tx.combatant.updateMany).not.toHaveBeenCalledWith({
      where: { id: "d1" }, data: { breathAvailable: true },
    });
    expect(tx.gameLog.create).toHaveBeenCalledWith({
      data: { campaignId: "camp-1", role: "system", content: "Adult Red Dragon fails to recharge its Fire Breath (2)." },
    });
  });

  it("does not roll to recharge an already-available breath", async () => {
    const tx = buildDragonTx(dragonRows({ breathAvailable: true }));
    mockRandom([0.7, ...Array(18).fill(0.5)]);
    await resolveEnemyTurn(tx, DRAGON_CTX);

    const calls = (tx.gameLog.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some(([{ data }]) => data.content.includes("recharge"))).toBe(false);
  });

  it("applies no proficiency bonus for a class not proficient in the save", async () => {
    const tx = buildDragonTx();
    (tx.character.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      hp: 200, maxHp: 200, stats: { DEX: 14, CON: 12 }, class: "wizard", level: 5, inventory: [],
    });
    // Wizard: DEX +2 only, no proficiency (wizard saves are INT/WIS). d20 = 18 (0.85) + 2 = 20 vs DC 21: fails.
    mockRandom([0.85, ...Array(18).fill(0.5)]);
    await resolveEnemyTurn(tx, DRAGON_CTX);

    expect(tx.gameLog.create).toHaveBeenCalledWith({
      data: {
        campaignId: "camp-1", role: "system",
        content: "Adult Red Dragon — Fire Breath: DC 21 Dexterity save, Aldric rolls 20 — fails, 72 fire damage.",
      },
    });
  });

  it("holds the breath against a downed player", async () => {
    const tx = buildDragonTx(
      dragonRows().map((r) => (r.isPlayer ? { ...r, hp: 0 } : r)),
    );
    const outcome = await resolveEnemyTurn(tx, DRAGON_CTX);
    expect(outcome).toEqual({ events: [], playerDowned: false, playerDied: false });
  });
});
