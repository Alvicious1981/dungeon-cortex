import { afterEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { computeConsequences, type EncounterSnapshot } from "@/lib/rules/combat";
import { executeCombatAction } from "@/lib/rules/combat-pipeline";
import type { CombatActionPayload, PipelineCombatant } from "@/lib/rules/combat-pipeline";
import type { DamageModifiers, DamageType } from "@/lib/rules/damage-modifiers";
import { buildEnemy, buildEncounter, buildMockTx, buildPlayer } from "./combat-pipeline-fixtures";

/**
 * The two damage sites, given the same input, must reach the same number.
 *
 * `lib/rules/combat.ts` decides hit points for a weapon attack and
 * `lib/rules/combat-pipeline.ts` decides them for a spell, independently. This
 * codebase has already paid once for two implementations of one rule drifting:
 * two armour-class calculations disagreed about which armour counted, one
 * deciding what the player was attacked against and the other what they were
 * shown. This file exists so that cannot happen here quietly.
 *
 * Both helpers below drive the real production entry points —
 * `computeConsequences` for the weapon path, `executeCombatAction`'s
 * `cast_spell` branch for the spell path — never `applyDamageModifiers`
 * itself. Calling the shared function twice would only prove it is
 * deterministic, which nobody doubted; it would prove nothing about whether
 * both call sites actually reach it.
 */
describe("both damage paths resolve modifiers identically", () => {
  const CASES = [
    { damage: 10, damageType: "fire" as const, immunities: ["fire"], expected: 0 },
    { damage: 10, damageType: "cold" as const, resistances: ["cold"], expected: 5 },
    { damage: 7, damageType: "cold" as const, resistances: ["cold"], expected: 3 },
    { damage: 7, damageType: "bludgeoning" as const, vulnerabilities: ["bludgeoning"], expected: 14 },
    { damage: 9, damageType: "fire" as const, resistances: ["fire"], vulnerabilities: ["fire"], expected: 9 },
    { damage: 10, damageType: "slashing" as const, resistances: ["cold"], expected: 10 },
  ];

  afterEach(() => vi.restoreAllMocks());

  function makeSnapshot(overrides: Partial<EncounterSnapshot> = {}): EncounterSnapshot {
    return {
      round: 1,
      totalDamageDealt: 0,
      status: "active",
      currentBeat: "opening",
      defenderId: "npc1",
      combatants: [
        { id: "pc1", hp: 30, maxHp: 30, isPlayer: true, isBoss: false, hpBeforeThisTurn: 30 },
        { id: "npc1", hp: 999, maxHp: 999, isPlayer: false, isBoss: false, hpBeforeThisTurn: 999 },
      ],
      ...overrides,
    };
  }

  /**
   * Drives `computeConsequences` (the weapon path in `lib/rules/combat.ts`)
   * with a fixed `0d1` damage die and a large flat bonus, exactly as
   * `tests/rules/combat.test.ts`'s `consequenceInput()` does, so the number
   * asserted is the modifier's output, not the roll's. `attackModifier: 100`
   * against `targetAC: 1` guarantees a hit; `Math.random` is pinned so the
   * natural roll is never a 1 (an automatic fumble that would zero the
   * damage regardless of the modifier under test).
   */
  function damageAfterWeaponAttack(input: {
    damage: number;
    damageType: DamageType;
    modifiers: DamageModifiers;
  }): number {
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const result = computeConsequences({
      attacker: "PC:Kara",
      defender: "NPC:Target",
      weapon: "Longsword",
      weaponDice: "0d1",
      flatDamageBonus: input.damage,
      attackModifier: 100,
      damageType: input.damageType,
      targetAC: 1,
      targetHp: 999,
      targetMaxHp: 999,
      targetIsPlayer: false,
      targetIsBoss: false,
      statusApplied: [],
      attackerConditions: [],
      defenderConditions: [],
      isMelee: true,
      encounterSnapshot: makeSnapshot(),
      usedSenses: [],
      zones: [],
      targetModifiers: input.modifiers,
    });

    return result.combat_facts.damage;
  }

  /**
   * Drives `executeCombatAction`'s `cast_spell` branch (the spell path in
   * `lib/rules/combat-pipeline.ts`) with a deterministic `1d2+M` effect —
   * `Math.random` pinned to 0 makes the one die always roll 1, so the flat
   * modifier `input.damage - 1` makes the pre-modifier roll exactly
   * `input.damage`, the same figure the weapon path is handed directly.
   * `hasSavingThrow` is left off so the roll is not gated by a second random
   * call. The transaction double is the one `tests/rules/combat-pipeline.test.ts`
   * already builds for this file's own coverage.
   */
  async function damageAfterSpell(input: {
    damage: number;
    damageType: DamageType;
    modifiers: DamageModifiers;
  }): Promise<number> {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const target: PipelineCombatant = {
      ...buildEnemy(),
      hp: 999,
      maxHp: 999,
      damageImmunities: [...input.modifiers.immunities],
      damageResistances: [...input.modifiers.resistances],
      damageVulnerabilities: [...input.modifiers.vulnerabilities],
    };

    const payload: CombatActionPayload = {
      actionType: "cast_spell",
      encounter: buildEncounter([buildPlayer(), target]),
      actorId: "player-1",
      actorName: "Aldric",
      actorConditions: [],
      targetCombatants: [target],
      spellName: "Test Bolt",
      spellEffect: {
        type: "damage",
        dice: `1d2+${input.damage - 1}`,
        damageType: input.damageType,
        hasSavingThrow: false,
      },
      collectEvents: false,
    };

    const tx = buildMockTx();
    const outcome = await executeCombatAction(payload, tx as unknown as Prisma.TransactionClient);
    const consequence = outcome.consequences.find((c) => c.targetId === target.id);

    return consequence?.damage ?? 0;
  }

  for (const testCase of CASES) {
    it(`agrees on ${testCase.damage} ${testCase.damageType}`, async () => {
      const modifiers: DamageModifiers = {
        immunities: testCase.immunities ?? [],
        resistances: testCase.resistances ?? [],
        vulnerabilities: testCase.vulnerabilities ?? [],
      };

      const weaponPath = damageAfterWeaponAttack({
        damage: testCase.damage,
        damageType: testCase.damageType,
        modifiers,
      });

      const spellPath = await damageAfterSpell({
        damage: testCase.damage,
        damageType: testCase.damageType,
        modifiers,
      });

      expect(weaponPath).toBe(testCase.expected);
      expect(spellPath).toBe(testCase.expected);
      expect(weaponPath).toBe(spellPath);
    });
  }
});
