/**
 * The player's HP has one source of truth, Character.hp, and the player's
 * Combatant row in an active encounter is its mirror
 * (docs/superpowers/specs/2026-09-15-enemy-turns-design.md §6.3).
 * resolveEncounterEnd reads the mirror, so every in-combat HP write must keep
 * the two equal.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeCombatAction } from "@/lib/rules/combat-pipeline";
import {
  buildEncounter,
  buildEnemy,
  buildMockTx,
  buildPlayer,
} from "./combat-pipeline-fixtures";

function mockRandom(values: number[]): void {
  let i = 0;
  vi.spyOn(Math, "random").mockImplementation(() => values[i++] ?? 0.5);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("player HP single write path", () => {
  it("mirrors in-combat item healing onto the player's Combatant", async () => {
    const tx = buildMockTx({ characterHp: 10, characterMaxHp: 20 });
    mockRandom([0.5, 0.5]);

    const outcome = await executeCombatAction(
      {
        actionType: "use_item",
        encounter: buildEncounter([buildPlayer({ hp: 10 }), buildEnemy()]),
        actorId: "player-1",
        actorName: "Aldric",
        actorConditions: [],
        targetCombatants: [],
        itemId: "item-1",
        itemName: "Potion of Healing",
        healingDice: "2d4",
        healingBonus: 2,
        playerCharacterId: "char-1",
        collectEvents: true,
      },
      tx,
    );

    const healed = outcome.events.find((e) => e.type === "HEALING_RECEIVED");
    expect(healed).toBeDefined();
    const newHp = (healed!.payload as { newHp: number }).newHp;
    expect(tx.combatant.updateMany).toHaveBeenCalledWith({
      where: { encounterId: "enc-1", characterId: "char-1" },
      data: { hp: newHp, deathSaveSuccesses: 0, deathSaveFailures: 0, stableWakeRound: null },
    });
  });

  it("mirrors healing on the compare-and-set path real transactions take", async () => {
    // Real Prisma exposes character.updateMany, which routes healing through its
    // compare-and-set loop. The shared fixture omits it, so the test above only
    // exercises the fallback branch; this one pins the branch production runs.
    const tx = buildMockTx({ characterHp: 10, characterMaxHp: 20 });
    const casClaim = vi.fn().mockResolvedValue({ count: 1 });
    (tx.character as unknown as { updateMany: typeof casClaim }).updateMany = casClaim;
    mockRandom([0.5, 0.5]);

    const outcome = await executeCombatAction(
      {
        actionType: "use_item",
        encounter: buildEncounter([buildPlayer({ hp: 10 }), buildEnemy()]),
        actorId: "player-1",
        actorName: "Aldric",
        actorConditions: [],
        targetCombatants: [],
        itemId: "item-1",
        itemName: "Potion of Healing",
        healingDice: "2d4",
        healingBonus: 2,
        playerCharacterId: "char-1",
        collectEvents: true,
      },
      tx,
    );

    const healed = outcome.events.find((e) => e.type === "HEALING_RECEIVED");
    expect(healed).toBeDefined();
    const newHp = (healed!.payload as { newHp: number }).newHp;
    expect(casClaim).toHaveBeenCalled();
    expect(tx.combatant.updateMany).toHaveBeenCalledWith({
      where: { encounterId: "enc-1", characterId: "char-1" },
      data: { hp: newHp, deathSaveSuccesses: 0, deathSaveFailures: 0, stableWakeRound: null },
    });
  });

  it("writes Character when the player is caught in their own area spell", async () => {
    const tx = buildMockTx({ characterHp: 20, characterMaxHp: 20 });
    mockRandom([0.95, 0.5, 0.5, 0.5]);
    const player = buildPlayer({ hp: 20 });

    const outcome = await executeCombatAction(
      {
        actionType: "cast_spell",
        encounter: buildEncounter([player, buildEnemy()]),
        actorId: "player-1",
        actorName: "Aldric",
        actorConditions: [],
        targetCombatants: [player],
        spellName: "Burning Hands",
        spellLevel: 1,
        spellEffect: { type: "damage", dice: "3d6", damageType: "fire", hasSavingThrow: false },
        rawSpellSlots: { "1": { current: 2, max: 4 } },
        playerCharacterId: "char-1",
        collectEvents: true,
      },
      tx,
    );

    const hpAfter = outcome.consequences[0]!.hpAfter;
    expect(tx.character.update).toHaveBeenCalledWith({
      where: { id: "char-1" },
      data: { hp: hpAfter },
    });
  });

  it("locks Character before the damaged player's Combatant row", async () => {
    // Real Prisma exposes $queryRaw, so the Character lock is actually taken.
    // It must come before the HP decrement: setPlayerHp writes Character, and
    // a Combatant → Character order deadlocks against a concentration
    // replacement, which writes Character → Combatant.
    const tx = buildMockTx({ characterHp: 20, characterMaxHp: 20 });
    const queryRaw = vi.fn().mockResolvedValue([]);
    (tx as unknown as { $queryRaw: typeof queryRaw }).$queryRaw = queryRaw;
    mockRandom([0.95, 0.5, 0.5, 0.5]);
    const player = buildPlayer({ hp: 20 });

    await executeCombatAction(
      {
        actionType: "cast_spell",
        encounter: buildEncounter([player, buildEnemy()]),
        actorId: "enemy-1",
        actorName: "Goblin",
        actorConditions: [],
        targetCombatants: [player],
        spellName: "Fire Bolt",
        spellLevel: 0,
        spellEffect: { type: "damage", dice: "1d10", damageType: "fire", hasSavingThrow: false },
        playerCharacterId: "char-1",
        collectEvents: false,
      },
      tx,
    );

    const lockOrder = queryRaw.mock.invocationCallOrder[0];
    const decrementOrder = (tx.combatant.update as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    expect(lockOrder).toBeDefined();
    expect(decrementOrder).toBeDefined();
    expect(lockOrder!).toBeLessThan(decrementOrder!);
  });
});
