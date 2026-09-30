import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { executeCombatAction, type CombatActionPayload } from "@/lib/rules/combat-pipeline";
import { resolveSpellEffect } from "@/lib/rules/magic";
import { resolveAttackRoll } from "@/lib/rules/combat";
import {
  SPELL_CONDITIONS,
  isUnaffected,
  readSpellConditionRecords,
  recordsForGrant,
  repeatableHolds,
  targetRefusal,
  type SpellConditionRecord,
} from "@/lib/rules/spell-conditions";
import {
  buildEncounter,
  buildEnemy,
  buildMockTx,
  buildPlayer,
} from "./combat-pipeline-fixtures";

/**
 * Phase 2 of docs/DECISION_SPELL_CONDITIONS.md: spells whose target repeats
 * the save — Hold Person, Hold Monster, Tasha's Hideous Laughter — through the
 * SRD cache the game reads and the real pipeline.
 */
const SPELLS = JSON.parse(
  readFileSync(join(process.cwd(), "data", "srd-es", "spells.json"), "utf8"),
) as Array<Record<string, unknown>>;
const data = (index: string) => SPELLS.find((s) => s.index === index)!;

const HOLD_PERSON = { ...resolveSpellEffect(data("hold-person"), 2, 3, 3), concentration: true };
const HOLD_MONSTER = { ...resolveSpellEffect(data("hold-monster"), 5, 3, 9), concentration: true };
const TASHAS = { ...resolveSpellEffect(data("hideous-laughter"), 1, 3, 1), concentration: true };

function mockRandom(values: number[]) {
  let i = 0;
  return vi.spyOn(Math, "random").mockImplementation(() => values[i++] ?? 0.5);
}

afterEach(() => {
  vi.restoreAllMocks();
});

function cast(
  effect: typeof HOLD_PERSON,
  target: ReturnType<typeof buildEnemy>,
  overrides: Partial<CombatActionPayload> = {},
): CombatActionPayload {
  return {
    actionType: "cast_spell",
    encounter: { ...buildEncounter([buildPlayer(), target]), round: 2 },
    actorId: "player-1",
    actorName: "Aldric",
    actorConditions: [],
    targetCombatants: [target],
    spellName: "Test spell",
    spellLevel: 0,
    spellEffect: effect,
    spellSaveDC: 13,
    playerCharacterId: "char-1",
    collectEvents: true,
    ...overrides,
  };
}

const conditionWrites = (tx: ReturnType<typeof buildMockTx>) =>
  (tx.combatant.update as ReturnType<typeof vi.fn>).mock.calls.filter(
    ([args]) => args.data?.conditions !== undefined,
  );

describe("the table's phase 2 rows, resolved from the SRD cache", () => {
  it("Hold Person: paralyzed, Wisdom, repeat save, humanoids only", () => {
    expect(HOLD_PERSON).toMatchObject({
      type: "utility",
      hasSavingThrow: true,
      saveAbility: "WIS",
      conditions: ["paralyzed"],
      conditionTerms: {
        spellIndex: "hold-person",
        concentration: true,
        durationRounds: 10,
        repeatSave: { onDamage: false },
        onlyTypes: ["humanoid"],
      },
    });
  });

  it("Hold Monster: paralyzed, no effect on undead", () => {
    expect(HOLD_MONSTER.conditionTerms).toMatchObject({
      repeatSave: { onDamage: false },
      unaffectedTypes: ["undead"],
    });
    expect(HOLD_MONSTER.conditionTerms?.onlyTypes).toBeUndefined();
  });

  it("Tasha's: prone and incapacitated, repeat save on damage, INT 4 unaffected", () => {
    expect(TASHAS).toMatchObject({
      saveAbility: "WIS",
      conditions: ["prone", "incapacitated"],
      conditionTerms: { repeatSave: { onDamage: true }, unaffectedAtIntelligence: 4 },
    });
  });

  it("keeps every row that repeats a save on a spell with a save to repeat", () => {
    for (const [index, entry] of Object.entries(SPELL_CONDITIONS)) {
      if (entry.repeatSave) expect(entry.save, index).not.toBeNull();
    }
  });
});

describe("who a condition spell may target, and who it leaves alone", () => {
  const holdPerson = SPELL_CONDITIONS["hold-person"]!;
  const holdMonster = SPELL_CONDITIONS["hold-monster"]!;
  const tashas = SPELL_CONDITIONS["hideous-laughter"]!;

  it("refuses a non-humanoid for Hold Person, and any unknown type", () => {
    expect(targetRefusal(holdPerson, { name: "Wolf", creatureType: "beast" })).toMatch(/humanoid/);
    expect(targetRefusal(holdPerson, { name: "Thing", creatureType: null })).toMatch(/unknown/);
    expect(targetRefusal(holdPerson, { name: "Bandit", creatureType: "humanoid" })).toBeNull();
  });

  it("lets Hold Monster name an undead, which it then leaves unaffected", () => {
    expect(targetRefusal(holdMonster, { name: "Zombie", creatureType: "undead" })).toBeNull();
    expect(targetRefusal(holdMonster, { name: "Thing", creatureType: null })).toMatch(/unknown/);
    expect(isUnaffected(holdMonster, { creatureType: "undead", intelligence: 3 })).toBe(true);
    expect(isUnaffected(holdMonster, { creatureType: "dragon", intelligence: 3 })).toBe(false);
  });

  it("leaves a creature of Intelligence 4 or less unaffected by Tasha's", () => {
    expect(targetRefusal(tashas, { name: "Wolf", creatureType: null })).toBeNull();
    expect(isUnaffected(tashas, { creatureType: "beast", intelligence: 4 })).toBe(true);
    expect(isUnaffected(tashas, { creatureType: "beast", intelligence: 5 })).toBe(false);
  });
});

const hold = (overrides: Partial<SpellConditionRecord> = {}): SpellConditionRecord => ({
  condition: "paralyzed",
  spellIndex: "hold-person",
  casterId: "player-1",
  concentration: true,
  endsAtRound: 12,
  repeatSave: { ability: "WIS", dc: 13, onDamage: false },
  ...overrides,
});

describe("repeat-save records", () => {
  it("carries the save's ability and DC from the cast", () => {
    expect(
      recordsForGrant({
        granted: ["paralyzed"],
        spellIndex: "hold-person",
        casterId: "player-1",
        entry: { concentration: true, durationRounds: 10 },
        round: 2,
        repeatSave: { ability: "WIS", dc: 13, onDamage: false },
      }),
    ).toEqual([hold()]);
  });

  it("gives one hold per spell and caster, however many conditions it put on", () => {
    const laugh = { spellIndex: "hideous-laughter", repeatSave: { ability: "WIS" as const, dc: 13, onDamage: true } };
    const holds = repeatableHolds([
      hold({ ...laugh, condition: "prone" }),
      hold({ ...laugh, condition: "incapacitated" }),
      hold({ spellIndex: "entangle", condition: "restrained", repeatSave: undefined }),
    ]);
    expect(holds).toEqual([{ spellIndex: "hideous-laughter", casterId: "player-1", repeatSave: laugh.repeatSave }]);
  });

  it("drops a record whose repeat save is malformed", () => {
    expect(readSpellConditionRecords([hold(), hold({ repeatSave: { ability: "LUCK", dc: 13, onDamage: false } as never })]))
      .toEqual([hold()]);
  });
});

describe("casting a phase 2 spell through the pipeline", () => {
  it("paralyzes a creature that fails, recording the repeat save", async () => {
    const tx = buildMockTx();
    mockRandom([0.2]); // d20 = 5; WIS 8 → -1: 4 < 13

    await executeCombatAction(cast(HOLD_PERSON, buildEnemy({ creatureType: "humanoid" })), tx);

    expect(tx.combatant.update).toHaveBeenCalledWith({
      where: { id: "enemy-1" },
      data: { conditions: ["paralyzed"], spellConditions: [hold()] },
    });
  });

  it("puts both of Tasha's conditions on, each held by the same save", async () => {
    const tx = buildMockTx();
    mockRandom([0.2]);

    await executeCombatAction(cast(TASHAS, buildEnemy()), tx);

    const laugh = { spellIndex: "hideous-laughter", repeatSave: { ability: "WIS" as const, dc: 13, onDamage: true } };
    expect(tx.combatant.update).toHaveBeenCalledWith({
      where: { id: "enemy-1" },
      data: {
        conditions: ["prone", "incapacitated"],
        spellConditions: [hold({ ...laugh, condition: "prone" }), hold({ ...laugh, condition: "incapacitated" })],
      },
    });
  });

  it("rolls nothing and applies nothing to a creature of Intelligence 4 or less", async () => {
    const tx = buildMockTx();
    const random = mockRandom([]);
    const wolf = buildEnemy({ name: "Wolf", stats: { STR: 12, DEX: 15, CON: 12, INT: 3, WIS: 12, CHA: 6 } });

    const outcome = await executeCombatAction(cast(TASHAS, wolf), tx);

    expect(random).not.toHaveBeenCalled();
    expect(conditionWrites(tx)).toEqual([]);
    expect(outcome.systemLogs).toContain("Wolf is unaffected by Test spell.");
  });

  it("leaves an undead unaffected by Hold Monster", async () => {
    const tx = buildMockTx();
    const random = mockRandom([]);

    await executeCombatAction(cast(HOLD_MONSTER, buildEnemy({ creatureType: "undead" })), tx);

    expect(random).not.toHaveBeenCalled();
    expect(conditionWrites(tx)).toEqual([]);
  });
});

describe("a paralyzed creature's saves", () => {
  it("fails a Dexterity save without rolling", async () => {
    const tx = buildMockTx();
    // Only the damage dice (1d8 → 8) and the hit location are rolled.
    mockRandom([0.99, 0.0]);

    const outcome = await executeCombatAction(
      cast(
        { type: "damage", dice: "1d8", damageType: "fire", hasSavingThrow: true, saveAbility: "DEX", saveDamage: "half" } as never,
        buildEnemy({ conditions: ["paralyzed"] }),
      ),
      tx,
    );

    expect(outcome.totalDamageDealt).toBe(8);
  });

  it("still rolls a Wisdom save", async () => {
    const tx = buildMockTx();
    const random = mockRandom([0.95]); // d20 = 20: saves

    await executeCombatAction(cast(HOLD_PERSON, buildEnemy({ creatureType: "humanoid", conditions: ["paralyzed"] })), tx);

    expect(random).toHaveBeenCalledTimes(1);
  });
});

describe("Tasha's: the target repeats the save when it takes damage", () => {
  const laughRecords = [
    hold({ condition: "prone", spellIndex: "hideous-laughter", repeatSave: { ability: "WIS", dc: 13, onDamage: true } }),
    hold({ condition: "incapacitated", spellIndex: "hideous-laughter", repeatSave: { ability: "WIS", dc: 13, onDamage: true } }),
  ];
  const fireBolt = { type: "damage", dice: "1d6", damageType: "fire", hasSavingThrow: false } as never;

  function heldRow(records: SpellConditionRecord[], conditions: string[]) {
    return { id: "enemy-1", name: "Goblin", stats: { WIS: 10 }, conditions, spellConditions: records };
  }

  it("rolls with advantage and frees it on a success", async () => {
    const tx = buildMockTx();
    (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      heldRow(laughRecords, ["prone", "incapacitated"]),
    ]);
    // 1d6 → 6, location, then the save with advantage: 3 and 16 → 16 ≥ 13.
    mockRandom([0.99, 0.0, 0.1, 0.75]);

    const outcome = await executeCombatAction(
      cast(fireBolt, buildEnemy({ spellConditions: laughRecords, conditions: ["prone", "incapacitated"] })),
      tx,
    );

    expect(tx.combatant.update).toHaveBeenCalledWith({
      where: { id: "enemy-1" },
      data: { conditions: [], spellConditions: [] },
    });
    expect(outcome.systemLogs).toContain(
      "Goblin repeats the Wisdom save against hideous-laughter (advantage, took damage): 16 vs DC 13 — the spell ends on it.",
    );
  });

  it("keeps it held on a failure", async () => {
    const tx = buildMockTx();
    (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      heldRow(laughRecords, ["prone", "incapacitated"]),
    ]);
    mockRandom([0.99, 0.0, 0.1, 0.2]); // 3 and 5 → 5 < 13

    await executeCombatAction(
      cast(fireBolt, buildEnemy({ spellConditions: laughRecords, conditions: ["prone", "incapacitated"] })),
      tx,
    );

    const ends = (tx.combatant.update as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([args]) => args.data?.spellConditions !== undefined,
    );
    expect(ends).toEqual([]);
  });

  it("gives Hold Person no save on damage", async () => {
    const tx = buildMockTx();
    (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([heldRow([hold()], ["paralyzed"])]);
    const random = mockRandom([0.99, 0.0]);

    await executeCombatAction(
      cast(fireBolt, buildEnemy({ spellConditions: [hold()], conditions: ["paralyzed"] })),
      tx,
    );

    expect(random).toHaveBeenCalledTimes(2); // damage and location only
    expect(tx.combatant.findMany).not.toHaveBeenCalled();
  });

  it("reads the hold from the row the damage write returns, not the stale snapshot", async () => {
    const tx = buildMockTx();
    // The pre-transaction snapshot shows no hold; the locked row does.
    (tx.combatant.update as ReturnType<typeof vi.fn>).mockResolvedValue({ spellConditions: laughRecords });
    (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      heldRow(laughRecords, ["prone", "incapacitated"]),
    ]);
    const random = mockRandom([0.99, 0.0, 0.1, 0.75]);

    await executeCombatAction(cast(fireBolt, buildEnemy()), tx);

    expect(random).toHaveBeenCalledTimes(4); // damage, location, two d20s
  });

  it("does not query for holds on an ordinary hit", async () => {
    const tx = buildMockTx();
    mockRandom([0.99, 0.0]);

    await executeCombatAction(cast(fireBolt, buildEnemy()), tx);

    expect(tx.combatant.findMany).not.toHaveBeenCalled();
  });
});

describe("a melee hit on a paralyzed or unconscious creature is a critical hit", () => {
  // The defender grants advantage: two d20s, 12 and 3 → 12 + 5 = 17 vs AC 15.
  const hitRolls = [0.55, 0.1];

  it.each(["paralyzed", "unconscious"])("crits a melee hit on a %s creature", (condition) => {
    mockRandom(hitRolls);
    const roll = resolveAttackRoll(5, 15, [], [condition], true);
    expect(roll).toMatchObject({ hit: true, critical: true, roll: 12 });
  });

  it("does not crit a ranged hit", () => {
    mockRandom(hitRolls);
    expect(resolveAttackRoll(5, 15, [], ["paralyzed"], false)).toMatchObject({ hit: true, critical: false });
  });

  it("does not turn a miss into a crit", () => {
    mockRandom([0.2, 0.1]); // 5 and 3 → 5 + 5 = 10 vs AC 15
    expect(resolveAttackRoll(5, 15, [], ["paralyzed"], true)).toMatchObject({ hit: false, critical: false });
  });

  it("does not crit a melee hit on a creature that is merely restrained", () => {
    mockRandom(hitRolls);
    expect(resolveAttackRoll(5, 15, [], ["restrained"], true)).toMatchObject({ hit: true, critical: false });
  });
});
