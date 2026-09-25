import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { executeCombatAction, type CombatActionPayload } from "@/lib/rules/combat-pipeline";
import { resolveSpellEffect } from "@/lib/rules/magic";
import { planEnemyTurn } from "@/lib/rules/enemy-turn";
import type { MonsterAttackProfileV1 } from "@/lib/rules/monster-attack-profile";
import type { SpellConditionRecord } from "@/lib/rules/spell-conditions";
import { adaptCombatEventsToNarrativeContext } from "@/lib/narrative/combat-fact-adapter";
import type { GameEvent } from "@/lib/events/game-events";
import {
  buildEncounter,
  buildEnemy,
  buildMockTx,
  buildPlayer,
} from "./combat-pipeline-fixtures";

/**
 * A spell condition from cast to end, through the real resolver and the real
 * pipeline: Entangle as the SRD cache stores it, not a hand-written effect.
 */
const SPELLS = JSON.parse(
  readFileSync(join(process.cwd(), "data", "srd-es", "spells.json"), "utf8"),
) as Array<Record<string, unknown>>;
const entangleData = SPELLS.find((s) => s.index === "entangle")!;
const ENTANGLE = { ...resolveSpellEffect(entangleData, 1, 3, 1), concentration: true };

function mockRandom(values: number[]): void {
  let i = 0;
  vi.spyOn(Math, "random").mockImplementation(() => values[i++] ?? 0.5);
}

afterEach(() => {
  vi.restoreAllMocks();
});

function castEntangle(
  targets: ReturnType<typeof buildEnemy>[],
  overrides: Partial<CombatActionPayload> = {},
): CombatActionPayload {
  return {
    actionType: "cast_spell",
    encounter: { ...buildEncounter([buildPlayer(), ...targets]), round: 3 },
    actorId: "player-1",
    actorName: "Aldric",
    actorConditions: [],
    targetCombatants: targets,
    spellName: "Entangle",
    spellLevel: 1,
    spellEffect: ENTANGLE,
    spellSaveDC: 13,
    playerCharacterId: "char-1",
    collectEvents: true,
    ...overrides,
  };
}

const entangleRecord = (overrides: Partial<SpellConditionRecord> = {}): SpellConditionRecord => ({
  condition: "restrained",
  spellIndex: "entangle",
  casterId: "player-1",
  concentration: true,
  endsAtRound: 13,
  ...overrides,
});

describe("casting Entangle", () => {
  it("restrains a creature that fails its Strength save, and records why", async () => {
    const tx = buildMockTx();
    const goblin = buildEnemy(); // STR 8: -1
    mockRandom([0.2]); // d20 = 5, 5 - 1 = 4 < DC 13

    const outcome = await executeCombatAction(castEntangle([goblin]), tx);

    expect(tx.combatant.update).toHaveBeenCalledWith({
      where: { id: "enemy-1" },
      data: { conditions: ["restrained"], spellConditions: [entangleRecord()] },
    });
    expect(outcome.consequences).toEqual([
      expect.objectContaining({ targetId: "enemy-1", damage: 0, conditionsApplied: ["restrained"] }),
    ]);
  });

  it("writes nothing onto a creature that saves, but still reports it", async () => {
    const tx = buildMockTx();
    const goblin = buildEnemy();
    mockRandom([0.95]); // d20 = 20

    const outcome = await executeCombatAction(castEntangle([goblin]), tx);

    const conditionWrites = (tx.combatant.update as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([args]) => args.data?.conditions !== undefined,
    );
    expect(conditionWrites).toEqual([]);
    expect(outcome.consequences).toEqual([
      expect.objectContaining({ targetId: "enemy-1", conditionsApplied: [] }),
    ]);
  });

  it("does not apply a condition that arrives without a way to end", async () => {
    const tx = buildMockTx();
    mockRandom([0.2]);

    await executeCombatAction(
      castEntangle([buildEnemy()], { spellEffect: { ...ENTANGLE, conditionTerms: null } }),
      tx,
    );

    const conditionWrites = (tx.combatant.update as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([args]) => args.data?.conditions !== undefined,
    );
    expect(conditionWrites).toEqual([]);
  });
});

describe("a spell condition ends with the caster's concentration", () => {
  function heldGoblinRow(records: SpellConditionRecord[]) {
    return {
      id: "enemy-1",
      name: "Goblin",
      conditions: ["restrained"],
      spellConditions: records,
    };
  }

  it("when the caster starts concentrating on another spell", async () => {
    const tx = buildMockTx();
    (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      heldGoblinRow([entangleRecord({ spellIndex: "web" })]),
    ]);

    const outcome = await executeCombatAction(
      castEntangle([], { actorConcentrationSpellId: "Web" }),
      tx,
    );

    expect(tx.combatant.update).toHaveBeenCalledWith({
      where: { id: "enemy-1" },
      data: { conditions: [], spellConditions: [] },
    });
    expect(outcome.systemLogs).toContain(
      "Goblin is no longer restrained: web — concentration ended.",
    );
  });

  it("leaves another caster's and a non-concentration record in place", async () => {
    const tx = buildMockTx();
    const other = entangleRecord({ casterId: "someone-else" });
    const timed = entangleRecord({ spellIndex: "web", concentration: false });
    (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      heldGoblinRow([other, timed]),
    ]);

    await executeCombatAction(castEntangle([], { actorConcentrationSpellId: "Web" }), tx);

    const writes = (tx.combatant.update as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([args]) => args.data?.spellConditions !== undefined,
    );
    expect(writes).toEqual([]);
  });

  it("when damage breaks it, after every target of the same action is resolved", async () => {
    const player = buildPlayer({ concentrationSpellId: "Entangle" });
    const tx = buildMockTx();
    (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      heldGoblinRow([entangleRecord()]),
    ]);
    // 1d6 → 6, hit location, CON save d20 = 9 < DC 10.
    mockRandom([0.99, 0.0, 0.4]);

    const outcome = await executeCombatAction(
      {
        actionType: "cast_spell",
        encounter: buildEncounter([player, buildEnemy()]),
        actorId: "player-1",
        actorName: "Aldric",
        actorConditions: [],
        targetCombatants: [player],
        spellName: "Fire Bolt",
        spellLevel: 0,
        spellEffect: { type: "damage", dice: "1d6", hasSavingThrow: false, damageType: "fire" },
        playerCharacterId: "char-1",
        collectEvents: true,
      },
      tx,
    );

    expect(tx.combatant.update).toHaveBeenCalledWith({
      where: { id: "enemy-1" },
      data: { conditions: [], spellConditions: [] },
    });
    expect(outcome.systemLogs).toContain(
      "Goblin is no longer restrained: entangle — concentration broken.",
    );
  });

  it("does not end anything when the concentration save holds", async () => {
    const player = buildPlayer({ concentrationSpellId: "Entangle" });
    const tx = buildMockTx();
    (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      heldGoblinRow([entangleRecord()]),
    ]);
    mockRandom([0.99, 0.0, 0.95]); // CON save d20 = 20

    await executeCombatAction(
      {
        actionType: "cast_spell",
        encounter: buildEncounter([player, buildEnemy()]),
        actorId: "player-1",
        actorName: "Aldric",
        actorConditions: [],
        targetCombatants: [player],
        spellName: "Fire Bolt",
        spellLevel: 0,
        spellEffect: { type: "damage", dice: "1d6", hasSavingThrow: false, damageType: "fire" },
        playerCharacterId: "char-1",
        collectEvents: true,
      },
      tx,
    );

    const writes = (tx.combatant.update as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([args]) => args.data?.spellConditions !== undefined,
    );
    expect(writes).toEqual([]);
  });
});

describe("the narrator's facts for a condition without damage", () => {
  const event = (conditionsApplied: string[]): GameEvent => ({
    type: "COMBAT_CONSEQUENCE",
    payload: {
      attackerName: "Aldric",
      attackerIsPlayer: true,
      targets: [
        {
          targetName: "Goblin",
          targetId: "enemy-1",
          targetIsPlayer: false,
          damage: 0,
          naturalRoll: 4,
          isCrit: false,
          isFumble: false,
          hitLocation: "chest",
          hpAfter: 15,
          targetMaxHp: 15,
          isKill: false,
          conditionsApplied,
          narrativeTags: [],
        },
      ],
    },
  });

  it("says the condition took hold, and not that anything missed", () => {
    const facts = adaptCombatEventsToNarrativeContext([event(["restrained"])]).facts;
    const types = facts.map((f) => f.type);
    expect(types).toContain("condition_applied");
    expect(types).not.toContain("attack_miss");
  });

  it("still reads an entry that changed nothing as a miss", () => {
    const facts = adaptCombatEventsToNarrativeContext([event([])]).facts;
    expect(facts.map((f) => f.type)).toContain("attack_miss");
  });
});

describe("planEnemyTurn — a restrained enemy's speed is 0", () => {
  const GOBLIN: MonsterAttackProfileV1 = {
    version: 1,
    walkSpeedFt: 30,
    multiattack: null,
    areaSaveAttack: null,
    attacks: [
      {
        name: "Scimitar", attackBonus: 4, melee: { reachFt: 5 }, ranged: null,
        damage: [{ dice: "1d6+2", type: "slashing" }],
      },
    ],
  };
  const player = { id: "p", x: 5, y: 5, size: "Medium" as const };

  it("does not close the distance", () => {
    const plan = planEnemyTurn({
      enemy: { id: "e1", x: 5, y: 9, size: "Medium", hp: 7, conditions: ["restrained"], profile: GOBLIN },
      player,
      others: [player],
    });
    expect(plan.move).toBeNull();
    expect(plan.attacks).toEqual([]);
  });

  it("still attacks from where it stands", () => {
    const plan = planEnemyTurn({
      enemy: { id: "e1", x: 5, y: 6, size: "Medium", hp: 7, conditions: ["restrained"], profile: GOBLIN },
      player,
      others: [player],
    });
    expect(plan).toMatchObject({ move: null, attacks: ["Scimitar"] });
  });

  it("closes the distance as before without the condition", () => {
    const plan = planEnemyTurn({
      enemy: { id: "e1", x: 5, y: 9, size: "Medium", hp: 7, conditions: [], profile: GOBLIN },
      player,
      others: [player],
    });
    expect(plan.move).not.toBeNull();
  });
});

