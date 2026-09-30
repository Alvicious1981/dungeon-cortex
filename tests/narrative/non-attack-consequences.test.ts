import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildCombatConsequenceEvent,
  executeCombatAction,
  type CombatActionPayload,
  type CombatOutcome,
} from '../../lib/rules/combat-pipeline';
import { adaptCombatEventsToNarrativeContext } from '../../lib/narrative/combat-fact-adapter';
import type { NarrativeFactType } from '../../lib/narrative/combat-narrative-types';
import type { GameEvent } from '../../lib/events/game-events';
import {
  buildEncounter,
  buildEnemy,
  buildMockTx,
  buildPlayer,
} from '../rules/combat-pipeline-fixtures';

/**
 * What the narrator is told about a spell that did nothing to the creatures it
 * named.
 *
 * The pipeline built one consequence per named creature, with damage 0 for a
 * heal or a utility spell, and the adapter reads a target with no damage as
 * "Attack missed". So a Cure Wounds cast on the caster reached the model as
 * `healing_confirmed` *and* `attack_miss`: an attack no backend code resolved.
 *
 * Everything here runs the real pipeline into the real adapter. A hand-built
 * consequence would only prove the adapter agrees with itself, and the
 * adapter is not where the entry comes from.
 */

afterEach(() => vi.restoreAllMocks());

/** Queue Math.random values; any call past the queue returns 0.5. */
function mockRandom(values: number[]): void {
  let i = 0;
  vi.spyOn(Math, 'random').mockImplementation(() => values[i++] ?? 0.5);
}

/**
 * The fact types the action route hands the narrator for one action: the
 * pipeline's events, then a single COMBAT_CONSEQUENCE naming the caster when
 * the pipeline reported any creature. The route-level tests in
 * tests/api/action-intent-contract.test.ts check the same thing through the
 * route itself.
 */
function factTypesFor(outcome: CombatOutcome): NarrativeFactType[] {
  const events: GameEvent[] = [...outcome.events];
  if (outcome.consequences.length > 0) {
    events.push(
      buildCombatConsequenceEvent({
        attackerName: 'Aldric',
        attackerIsPlayer: true,
        targets: outcome.consequences,
      }),
    );
  }
  return adaptCombatEventsToNarrativeContext(events).facts.map((fact) => fact.type);
}

const ATTACK_FACTS: NarrativeFactType[] = ['attack_hit', 'attack_miss'];

function attackFactsIn(types: NarrativeFactType[]): NarrativeFactType[] {
  return types.filter((type) => ATTACK_FACTS.includes(type));
}

function cast(
  spellName: string,
  spellEffect: NonNullable<CombatActionPayload['spellEffect']>,
  targetCombatants: CombatActionPayload['targetCombatants'],
): CombatActionPayload {
  return {
    actionType: 'cast_spell',
    encounter: buildEncounter([buildPlayer({ hp: 10 }), buildEnemy()]),
    actorId: 'player-1',
    actorName: 'Aldric',
    actorConditions: [],
    targetCombatants,
    spellName,
    spellLevel: 1,
    spellEffect,
    spellSaveDC: 15,
    rawSpellSlots: { '1': { current: 2, max: 4 } },
    playerCharacterId: 'char-1',
    collectEvents: true,
  };
}

describe('a spell that does nothing to the creatures it names is not narrated as an attack', () => {
  it('tells the narrator a heal cast on the caster healed, with no attack in the facts', async () => {
    const caster = buildPlayer({ hp: 10 });
    mockRandom([0.5]); // roll("1d8") → 5

    const outcome = await executeCombatAction(
      cast('Cure Wounds', { type: 'healing', dice: '1d8' }, [caster]),
      buildMockTx({ characterHp: 10, characterMaxHp: 20 }),
    );

    const facts = factTypesFor(outcome);
    // The heal really resolved; without this the assertion below could pass on a cast that never ran.
    expect(facts).toContain('healing_confirmed');
    expect(attackFactsIn(facts)).toEqual([]);
  });

  it('tells the narrator a heal aimed at a hostile creature healed, with no attack on that creature', async () => {
    // The action route takes a non-area spell's targets from the client with
    // no hostile filter, so a heal can name an enemy.
    const goblin = buildEnemy();
    mockRandom([0.5]);

    const outcome = await executeCombatAction(
      cast('Cure Wounds', { type: 'healing', dice: '1d8' }, [goblin]),
      buildMockTx({ characterHp: 10, characterMaxHp: 20 }),
    );

    const facts = factTypesFor(outcome);
    expect(facts).toContain('healing_confirmed');
    expect(attackFactsIn(facts)).toEqual([]);
  });

  it.each([
    ['the caster', () => buildPlayer({ hp: 10 })],
    ['a hostile creature', () => buildEnemy()],
  ])('tells the narrator of no attack when a utility spell is aimed at %s', async (_who, makeTarget) => {
    mockRandom([]);

    const outcome = await executeCombatAction(
      cast('Shield', { type: 'utility', dice: null }, [makeTarget()]),
      buildMockTx({ characterHp: 10, characterMaxHp: 20 }),
    );

    // The cast resolved, so an empty result is a decision and not a spell that never ran.
    expect(outcome.events.some((event) => event.type === 'SPELL_CAST')).toBe(true);
    expect(attackFactsIn(factTypesFor(outcome))).toEqual([]);
  });
});

describe('an attack and a damaging spell still read as what they are', () => {
  // The other half of the guarantee: whatever stops a heal from reading as an
  // attack must not also stop an attack that misses, or a spell that lands,
  // from being reported.
  it('still reads a weapon attack that misses as attack_miss', async () => {
    const goblin = buildEnemy();
    mockRandom([0.2]); // d20 → 5: under AC 10, and not a natural 1

    const outcome = await executeCombatAction(
      {
        actionType: 'attack',
        encounter: buildEncounter([buildPlayer(), goblin]),
        actorId: 'player-1',
        actorName: 'Aldric',
        actorConditions: [],
        targetCombatants: [goblin],
        weaponName: 'Dagger',
        weaponDice: '1d4',
        damageType: 'piercing',
        attackModifier: 0,
        flatDamageBonus: 0,
        collectEvents: true,
      },
      buildMockTx(),
    );

    expect(factTypesFor(outcome)).toEqual(['attack_miss']);
  });

  it('still reads a damaging spell that lands as a hit with confirmed damage', async () => {
    const goblin = buildEnemy();
    // Save: 0.4 → 9 < DC 15, fails; roll("1d8"): 0.99 → 8; hit-location: 0.0
    mockRandom([0.4, 0.99, 0.0]);

    const outcome = await executeCombatAction(
      cast('Burning Hands', { type: 'damage', dice: '1d8', hasSavingThrow: true, saveAbility: 'DEX', damageType: 'fire' }, [goblin]),
      buildMockTx(),
    );

    const facts = factTypesFor(outcome);
    expect(facts).toContain('attack_hit');
    expect(facts).toContain('damage_confirmed');
    expect(facts).not.toContain('attack_miss');
  });
});
