import { describe, expect, it } from 'vitest';
import { adaptCombatEventsToNarrativeContext } from '../../lib/narrative/combat-fact-adapter';
import { CombatNarrativeContextSchema } from '../../lib/narrative/combat-narrative-types';
import { buildNarrativePrompt } from '../../lib/narrative/prompt-builder';
import type { GameEvent, SingleTargetConsequence } from '../../lib/events/game-events';

/**
 * Who is the player character in the narrator's resolved facts?
 *
 * The adapter used to answer with two literals: every COMBAT_CONSEQUENCE
 * attacker was `isPlayer: true` and every target `isPlayer: false`. The
 * enemy-turn chain emits the same event type with an enemy as the attacker and
 * the player as the target, so the narrator was handed a goblin labelled
 * `player_character` and a hero labelled `non_player_character`.
 *
 * The role is a fact of the Combatant row, stated by the code that builds the
 * event. Every assertion here reads the roles off the prompt data the model is
 * actually given — the last hop, where a wrong role becomes narration.
 */

type Role = 'player_character' | 'non_player_character';
interface PromptCreature { name: string; role: Role }
interface ResolvedFacts {
  actor: PromptCreature | null;
  targets: Array<PromptCreature & { ref: string }>;
}

/** The JSON inside <resolved_facts>: what the narrator model receives. */
function resolvedFactsFor(events: GameEvent[]): ResolvedFacts {
  const prompt = buildNarrativePrompt(adaptCombatEventsToNarrativeContext(events));
  return JSON.parse(prompt.user.split('\n')[1]!) as ResolvedFacts;
}

function consequenceTarget(
  overrides: Pick<SingleTargetConsequence, 'targetId' | 'targetName' | 'targetIsPlayer'> &
    Partial<SingleTargetConsequence>,
): SingleTargetConsequence {
  return {
    damage: 4,
    naturalRoll: 12,
    isCrit: false,
    isFumble: false,
    hitLocation: 'chest',
    narrativeTags: [],
    hpAfter: 10,
    targetMaxHp: 20,
    isKill: false,
    conditionsApplied: [],
    ...overrides,
  };
}

const HERO = { targetId: 'p1', targetName: 'Aldric', targetIsPlayer: true } as const;
const GOBLIN = { targetId: 'g1', targetName: 'Goblin', targetIsPlayer: false } as const;

/** What resolveEnemyTurn emits: an enemy attacker, the player as the target. */
const goblinHitsHero: GameEvent = {
  type: 'COMBAT_CONSEQUENCE',
  payload: {
    attackerName: 'Goblin',
    attackerIsPlayer: false,
    targets: [consequenceTarget({ ...HERO, damage: 6, hpAfter: 14 })],
  },
};

/** What the action route emits for the player's own attack. */
const heroHitsGoblin: GameEvent = {
  type: 'COMBAT_CONSEQUENCE',
  payload: {
    attackerName: 'Aldric',
    attackerIsPlayer: true,
    targets: [consequenceTarget({ ...GOBLIN, damage: 4, hpAfter: 3 })],
  },
};

describe('narrator roles come from what the event producer stated', () => {
  it('describes an enemy attacker as a non-player character and the player it hits as the player character', () => {
    const facts = resolvedFactsFor([goblinHitsHero]);

    expect(facts.actor).toEqual({ name: 'Goblin', role: 'non_player_character' });
    expect(facts.targets).toEqual([{ ref: 'target_1', name: 'Aldric', role: 'player_character' }]);
  });

  it('describes a player attacker as the player character and the enemy it hits as a non-player character', () => {
    const facts = resolvedFactsFor([heroHitsGoblin]);

    expect(facts.actor).toEqual({ name: 'Aldric', role: 'player_character' });
    expect(facts.targets).toEqual([{ ref: 'target_1', name: 'Goblin', role: 'non_player_character' }]);
  });

  it('describes the player as the player character when the player is the target of their own action', () => {
    // A caster-only spell: the action route aims it at the caster's own
    // Combatant, so the player is the attacker *and* the target.
    const facts = resolvedFactsFor([
      {
        type: 'COMBAT_CONSEQUENCE',
        payload: {
          attackerName: 'Aldric',
          attackerIsPlayer: true,
          targets: [consequenceTarget({ ...HERO, damage: 0, hpAfter: 20 })],
        },
      },
    ]);

    expect(facts.actor).toEqual({ name: 'Aldric', role: 'player_character' });
    expect(facts.targets).toEqual([{ ref: 'target_1', name: 'Aldric', role: 'player_character' }]);
  });

  it.each([
    ['the enemy answers the player (chronological order)', [heroHitsGoblin, goblinHitsHero]],
    ['turn events come first, the player consequence last (the action route order)', [goblinHitsHero, heroHitsGoblin]],
  ])('gives each creature one role when a player attack and an enemy counter-attack share a turn: %s', (_label, events) => {
    const facts = resolvedFactsFor(events);
    const named = [facts.actor, ...facts.targets].filter(
      (creature): creature is PromptCreature => creature !== null,
    );

    // Both creatures must actually appear, or the loop below proves nothing.
    expect(new Set(named.map((creature) => creature.name))).toEqual(new Set(['Aldric', 'Goblin']));
    for (const creature of named) {
      expect(creature.role, `${creature.name} in the prompt`).toBe(
        creature.name === 'Aldric' ? 'player_character' : 'non_player_character',
      );
    }
  });

  const UNSTATED: Array<[string, Record<string, unknown>]> = [
    ['the attacker', { attackerName: 'Goblin', targets: [consequenceTarget({ ...HERO })] }],
    [
      'a target',
      {
        attackerName: 'Goblin',
        attackerIsPlayer: false,
        targets: [{ ...consequenceTarget({ ...HERO }), targetIsPlayer: undefined }],
      },
    ],
  ];

  it.each(UNSTATED)(
    'does not invent a role for %s the producer left unstated: the context fails the strict schema',
    (_label, payload) => {
      // An event from code that bypassed the types. The adapter copies what the
      // event says and defaults nothing, so the gap reaches the schema at the
      // narrator boundary and is refused there, never a quiet non_player_character.
      const context = adaptCombatEventsToNarrativeContext([
        { type: 'COMBAT_CONSEQUENCE', payload } as unknown as GameEvent,
      ]);

      expect(CombatNarrativeContextSchema.safeParse(context).success).toBe(false);
    },
  );
});
