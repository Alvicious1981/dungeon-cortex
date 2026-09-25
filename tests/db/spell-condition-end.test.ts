import { afterEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { resolveEnemyTurn } from "@/lib/db/enemy-turn-transition";
import { finalizeEncounterTurn } from "@/lib/rules/combat-pipeline";
import type { SpellConditionRecord } from "@/lib/rules/spell-conditions";

/**
 * The two ends of a spell condition that happen on the enemies' side of the
 * table: an enemy's blow breaking the caster's concentration, and the spell's
 * duration running out when the caster's turn comes round.
 */
const SCIMITAR = {
  name: "Scimitar",
  attackBonus: 4,
  melee: { reachFt: 5 },
  ranged: null,
  damage: [{ dice: "1d6+2", type: "slashing" }],
};
const GOBLIN_PROFILE = {
  version: 1, walkSpeedFt: 30, multiattack: null, areaSaveAttack: null, attacks: [SCIMITAR],
};
const TWO_BLADES = {
  version: 1, walkSpeedFt: 30, areaSaveAttack: null, attacks: [SCIMITAR],
  multiattack: [{ attack: "Scimitar", count: 2 }],
};

const entangle = (overrides: Partial<SpellConditionRecord> = {}): SpellConditionRecord => ({
  condition: "restrained",
  spellIndex: "entangle",
  casterId: "p1",
  concentration: true,
  endsAtRound: 11,
  ...overrides,
});

function rows(goblin: Record<string, unknown> = {}) {
  return [
    {
      id: "p1", name: "Aldric", isPlayer: true, hp: 20, maxHp: 20, x: 5, y: 5,
      size: "Medium", conditions: [], spellConditions: [], initiativeOrder: 0,
      attackProfile: null, stableWakeRound: null,
    },
    {
      id: "g1", name: "Goblin", isPlayer: false, hp: 7, maxHp: 7, x: 5, y: 6,
      size: "Small", conditions: ["restrained"], spellConditions: [entangle()],
      initiativeOrder: 1, attackProfile: GOBLIN_PROFILE, ...goblin,
    },
  ];
}

function buildTx(combatants = rows(), character: Record<string, unknown> = {}) {
  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    combatant: {
      findMany: vi.fn().mockResolvedValue(combatants),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    encounter: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue({ campaignId: "camp-1", campaign: { characterId: "char-1" } }),
    },
    character: {
      findUnique: vi.fn().mockResolvedValue({
        hp: 20, maxHp: 20, stats: { DEX: 10, CON: 12 }, class: "wizard", level: 1,
        exhaustionLevel: 0, concentrationSpellId: "Entangle", name: "Aldric", inventory: [],
        ...character,
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

const logLines = (tx: Prisma.TransactionClient): string[] =>
  (tx.gameLog.create as ReturnType<typeof vi.fn>).mock.calls.map(([{ data }]) => data.content);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("an enemy's blow that breaks the player's concentration", () => {
  it("frees the creatures the spell was restraining", async () => {
    const tx = buildTx();
    // Restrained: disadvantage, d20s 16 and 13 → 13 + 4 = 17 hits AC 10.
    // 1d6 → 4 + 2 = 6; location; CON save d20 = 2 + 1 = 3 < DC 10.
    mockRandom([0.75, 0.6, 0.5, 0.3, 0.05]);

    await resolveEnemyTurn(tx, CTX);

    expect(tx.combatant.update).toHaveBeenCalledWith({
      where: { id: "g1" },
      data: { conditions: [], spellConditions: [] },
    });
    expect(logLines(tx)).toContain(
      "Goblin is no longer restrained: entangle — concentration broken.",
    );
  });

  it("frees nothing when the save holds", async () => {
    const tx = buildTx();
    mockRandom([0.75, 0.6, 0.5, 0.3, 0.9]); // CON save d20 = 19

    await resolveEnemyTurn(tx, CTX);

    expect(tx.combatant.update).not.toHaveBeenCalled();
  });

  it("lets the rest of that enemy's attacks roll without the condition that ended", async () => {
    const tx = buildTx(rows({ attackProfile: TWO_BLADES }));
    mockRandom([
      // First blade, restrained: 16 and 13 → 17, hit for 6; the save fails.
      0.75, 0.6, 0.5, 0.3, 0.05,
      // Second blade, free: one d20 = 15 → 19, hit, 1d6 → 4 + 2 = 6.
      0.7, 0.5, 0.3,
    ]);

    await resolveEnemyTurn(tx, CTX);

    // Still restrained, the second blade would roll 15 and 11 → 15, then
    // take 0.3 for its damage: 4 slashing.
    expect(logLines(tx)).toContain("Goblin — Scimitar: 19 vs AC 10, hit, 6 slashing damage.");
  });
});

describe("a spell condition's duration", () => {
  // The goblin has no attack profile, so its turn passes without a roll and
  // the chain comes back to the player.
  const idleGoblin = { attackProfile: null };

  it("ends at the start of the caster's turn once it has run out", async () => {
    const tx = buildTx(rows(idleGoblin));

    // Player's turn in round 10 ends; the goblin's passes; round 11 begins
    // on the player — the record's endsAtRound.
    const outcome = await finalizeEncounterTurn({
      tx,
      encounterId: "enc-1",
      currentTurnIndex: 0,
      round: 10,
      failOnStaleTurn: true,
    });

    expect(tx.combatant.update).toHaveBeenCalledWith({
      where: { id: "g1" },
      data: { conditions: [], spellConditions: [] },
    });
    expect(logLines(tx)).toContain("Goblin is no longer restrained: entangle — duration expired.");
    // The spell's duration is also the most its concentration lasts.
    expect(tx.character.update).toHaveBeenCalledWith({
      where: { id: "char-1" },
      data: { concentrationSpellId: null },
    });
    expect(outcome.events).toContainEqual({
      type: "CONCENTRATION_BROKEN",
      payload: { targetName: "Aldric", spellName: "Entangle", reason: "duration_expired" },
    });
  });

  it("holds while rounds remain", async () => {
    const tx = buildTx(rows(idleGoblin));

    await finalizeEncounterTurn({
      tx,
      encounterId: "enc-1",
      currentTurnIndex: 0,
      round: 9,
      failOnStaleTurn: true,
    });

    expect(tx.combatant.update).not.toHaveBeenCalled();
    expect(tx.character.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { concentrationSpellId: null } }),
    );
  });

  it("ends a timed condition without touching concentration", async () => {
    const tx = buildTx(
      rows({ ...idleGoblin, spellConditions: [entangle({ concentration: false })] }),
    );

    await finalizeEncounterTurn({
      tx,
      encounterId: "enc-1",
      currentTurnIndex: 0,
      round: 10,
      failOnStaleTurn: true,
    });

    expect(tx.combatant.update).toHaveBeenCalledWith({
      where: { id: "g1" },
      data: { conditions: [], spellConditions: [] },
    });
    expect(tx.character.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { concentrationSpellId: null } }),
    );
  });
});
