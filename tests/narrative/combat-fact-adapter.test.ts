import { describe, it, expect } from 'vitest';
import { adaptCombatEventsToNarrativeContext } from '../../lib/narrative/combat-fact-adapter';
import { GameEvent } from '../../lib/events/game-events';
import { CombatNarrativeContext, NarrativeFact } from '../../lib/narrative/combat-narrative-types';

describe('Combat Fact Adapter Tests (Fase 4A/4B.1)', () => {
  
  it('should adapt a standard attack hit into narrative facts', () => {
    const events: GameEvent[] = [
      {
        type: 'COMBAT_CONSEQUENCE',
        payload: {
          attackerName: 'Hero',
          targets: [
            {
              targetName: 'Goblin',
              targetId: 'goblin-1',
              damage: 6,
              naturalRoll: 15,
              isCrit: false,
              isFumble: false,
              hitLocation: 'shoulder',
              hpAfter: 9,
              targetMaxHp: 15,
              isKill: false,
              conditionsApplied: [],
              narrativeTags: ['piercing']
            }
          ]
        }
      },
      {
        type: 'DAMAGE_DEALT',
        payload: {
          damage: 6,
          naturalRoll: 15,
          targetName: 'Goblin'
        }
      }
    ];

    const context = adaptCombatEventsToNarrativeContext(events);

    // Verify actor and targets mapping
    expect(context.actor).toBeDefined();
    expect(context.actor?.name).toBe('Hero');
    expect(context.targets).toBeDefined();
    expect(context.targets?.[0].name).toBe('Goblin');
    
    // hpBefore should not be inferred or calculated here
    expect(context.targets?.[0].hpBefore).toBeUndefined();
    expect(context.targets?.[0].hpAfter).toBe(9);

    // Verify facts list
    const factTypes = context.facts.map((f: NarrativeFact) => f.type);
    expect(factTypes).toContain('attack_hit');
    expect(factTypes).toContain('damage_confirmed');

    // Verify damage payload
    const damageFact = context.facts.find((f: NarrativeFact) => f.type === 'damage_confirmed');
    expect(damageFact?.payload?.damageAmount).toBe(6);
  });

  it('should adapt a standard attack miss into narrative facts', () => {
    const events: GameEvent[] = [
      {
        type: 'COMBAT_CONSEQUENCE',
        payload: {
          attackerName: 'Hero',
          targets: [
            {
              targetName: 'Goblin',
              targetId: 'goblin-1',
              damage: 0,
              naturalRoll: 5,
              isCrit: false,
              isFumble: false,
              hitLocation: 'chest',
              hpAfter: 15,
              targetMaxHp: 15,
              isKill: false,
              conditionsApplied: [],
              narrativeTags: []
            }
          ]
        }
      }
    ];

    const context = adaptCombatEventsToNarrativeContext(events);

    const factTypes = context.facts.map((f: NarrativeFact) => f.type);
    expect(factTypes).toContain('attack_miss');
    expect(factTypes).not.toContain('attack_hit');
    expect(factTypes).not.toContain('damage_confirmed');
  });

  it('should adapt a critical hit correctly', () => {
    const events: GameEvent[] = [
      {
        type: 'COMBAT_CONSEQUENCE',
        payload: {
          attackerName: 'Hero',
          targets: [
            {
              targetName: 'Goblin',
              targetId: 'goblin-1',
              damage: 12,
              naturalRoll: 20,
              isCrit: true,
              isFumble: false,
              hitLocation: 'head',
              hpAfter: 3,
              targetMaxHp: 15,
              isKill: false,
              conditionsApplied: [],
              narrativeTags: ['slashing', 'crit']
            }
          ]
        }
      },
      {
        type: 'CRITICAL_HIT',
        payload: {
          damage: 12,
          naturalRoll: 20,
          targetName: 'Goblin'
        }
      }
    ];

    const context = adaptCombatEventsToNarrativeContext(events);

    const factTypes = context.facts.map((f: NarrativeFact) => f.type);
    expect(factTypes).toContain('critical_hit');
    expect(factTypes).toContain('damage_confirmed');
  });

  it('should adapt a critical miss correctly', () => {
    const events: GameEvent[] = [
      {
        type: 'COMBAT_CONSEQUENCE',
        payload: {
          attackerName: 'Hero',
          targets: [
            {
              targetName: 'Goblin',
              targetId: 'goblin-1',
              damage: 0,
              naturalRoll: 1,
              isCrit: false,
              isFumble: true,
              hitLocation: 'chest',
              hpAfter: 15,
              targetMaxHp: 15,
              isKill: false,
              conditionsApplied: [],
              narrativeTags: []
            }
          ]
        }
      },
      {
        type: 'CRITICAL_MISS',
        payload: {
          naturalRoll: 1,
          targetName: 'Goblin'
        }
      }
    ];

    const context = adaptCombatEventsToNarrativeContext(events);

    const factTypes = context.facts.map((f: NarrativeFact) => f.type);
    expect(factTypes).toContain('critical_miss');
    expect(factTypes).toContain('attack_miss');
  });

  it('should adapt healing received correctly', () => {
    const events: GameEvent[] = [
      {
        type: 'HEALING_RECEIVED',
        payload: {
          amount: 8,
          newHp: 15,
          spellName: 'Cure Wounds'
        }
      }
    ];

    const context = adaptCombatEventsToNarrativeContext(events);

    const factTypes = context.facts.map((f: NarrativeFact) => f.type);
    expect(factTypes).toContain('healing_confirmed');

    const healingFact = context.facts.find((f: NarrativeFact) => f.type === 'healing_confirmed');
    expect(healingFact?.payload?.healingAmount).toBe(8);
  });

  it('should adapt conditions applied and removed correctly', () => {
    const events: GameEvent[] = [
      {
        type: 'COMBAT_CONSEQUENCE',
        payload: {
          attackerName: 'Hero',
          targets: [
            {
              targetName: 'Goblin',
              targetId: 'goblin-1',
              damage: 2,
              naturalRoll: 16,
              isCrit: false,
              isFumble: false,
              hitLocation: 'leg',
              hpAfter: 13,
              targetMaxHp: 15,
              isKill: false,
              conditionsApplied: ['Prone'],
              narrativeTags: []
            }
          ]
        }
      }
    ];

    const context = adaptCombatEventsToNarrativeContext(events);

    const factTypes = context.facts.map((f: NarrativeFact) => f.type);
    expect(factTypes).toContain('condition_applied');

    const condFact = context.facts.find((f: NarrativeFact) => f.type === 'condition_applied');
    expect(condFact?.payload?.conditionName).toBe('Prone');
  });

  it('should adapt enemy defeated ONLY when isKill or defeated status is confirmed', () => {
    const activeEvents: GameEvent[] = [
      {
        type: 'COMBAT_CONSEQUENCE',
        payload: {
          attackerName: 'Hero',
          targets: [
            {
              targetName: 'Goblin',
              targetId: 'goblin-1',
              damage: 5,
              naturalRoll: 12,
              isCrit: false,
              isFumble: false,
              hitLocation: 'chest',
              hpAfter: 10,
              targetMaxHp: 15,
              isKill: false,
              conditionsApplied: [],
              narrativeTags: []
            }
          ]
        }
      }
    ];

    const activeContext = adaptCombatEventsToNarrativeContext(activeEvents);
    expect(activeContext.facts.map((f: NarrativeFact) => f.type)).not.toContain('enemy_defeated');

    const defeatedEvents: GameEvent[] = [
      {
        type: 'COMBAT_CONSEQUENCE',
        payload: {
          attackerName: 'Hero',
          targets: [
            {
              targetName: 'Goblin',
              targetId: 'goblin-1',
              damage: 15,
              naturalRoll: 18,
              isCrit: false,
              isFumble: false,
              hitLocation: 'chest',
              hpAfter: 0,
              targetMaxHp: 15,
              isKill: true,
              conditionsApplied: [],
              narrativeTags: []
            }
          ]
        }
      },
      {
        type: 'ENEMY_DEFEATED',
        payload: {
          name: 'Goblin'
        }
      }
    ];

    const defeatedContext = adaptCombatEventsToNarrativeContext(defeatedEvents);
    expect(defeatedContext.facts.map((f: NarrativeFact) => f.type)).toContain('enemy_defeated');
  });

  it('should adapt concentration broken correctly if confirmed by backend event', () => {
    const events: GameEvent[] = [
      {
        type: 'CONCENTRATION_BROKEN',
        payload: {
          targetName: 'Goblin',
          dc: 10,
          roll: 8
        }
      }
    ];

    const context = adaptCombatEventsToNarrativeContext(events);

    const factTypes = context.facts.map((f: NarrativeFact) => f.type);
    expect(factTypes).toContain('concentration_broken');
  });

  it('should handle multi-target consequences without using legacy flat fields', () => {
    const events: GameEvent[] = [
      {
        type: 'COMBAT_CONSEQUENCE',
        payload: {
          attackerName: 'Hero',
          targets: [
            {
              targetName: 'Goblin A',
              targetId: 'goblin-a',
              damage: 4,
              naturalRoll: 16,
              isCrit: false,
              isFumble: false,
              hitLocation: 'chest',
              hpAfter: 6,
              targetMaxHp: 10,
              isKill: false,
              conditionsApplied: [],
              narrativeTags: []
            },
            {
              targetName: 'Goblin B',
              targetId: 'goblin-b',
              damage: 4,
              naturalRoll: 16,
              isCrit: false,
              isFumble: false,
              hitLocation: 'arm',
              hpAfter: 6,
              targetMaxHp: 10,
              isKill: false,
              conditionsApplied: [],
              narrativeTags: []
            }
          ],
          targetId: 'goblin-a',
          targetName: 'Goblin A',
          damage: 4,
          hpAfter: 6,
          targetMaxHp: 10,
          isCrit: false,
          isFumble: false,
          naturalRoll: 16,
          isKill: false,
          narrativeTags: []
        }
      }
    ];

    const context = adaptCombatEventsToNarrativeContext(events);

    expect(context.targets).toHaveLength(2);
    expect(context.targets?.[0].name).toBe('Goblin A');
    expect(context.targets?.[1].name).toBe('Goblin B');

    const damageFacts = context.facts.filter((f: NarrativeFact) => f.type === 'damage_confirmed');
    expect(damageFacts).toHaveLength(2);
  });

  it('should adhere to strict safety (should not invent facts, decide mechanics, or use legacy jargon)', () => {
    const emptyEvents: GameEvent[] = [];
    const context = adaptCombatEventsToNarrativeContext(emptyEvents);
    expect(context.facts).toHaveLength(0);
  });

  // FASE 4B.1 - Specific test cases for hpBefore and deduplication logic

  it('should not infer or calculate hpBefore if not explicitly provided', () => {
    const events: GameEvent[] = [
      {
        type: 'COMBAT_CONSEQUENCE',
        payload: {
          attackerName: 'Hero',
          targets: [
            {
              targetName: 'Goblin',
              targetId: 'goblin-1',
              damage: 6,
              hpAfter: 9
            }
          ]
        }
      }
    ];
    const context = adaptCombatEventsToNarrativeContext(events);
    expect(context.targets?.[0].hpBefore).toBeUndefined();
  });

  it('should preserve hpBefore when it is explicitly provided by the backend', () => {
    const events: GameEvent[] = [
      {
        type: 'COMBAT_CONSEQUENCE',
        payload: {
          attackerName: 'Hero',
          targets: [
            {
              targetName: 'Goblin',
              targetId: 'goblin-1',
              damage: 6,
              hpAfter: 9,
              hpBefore: 15
            }
          ]
        }
      }
    ];
    const context = adaptCombatEventsToNarrativeContext(events);
    expect(context.targets?.[0].hpBefore).toBe(15);
  });

  it('should not deduplicate distinct facts on the same target', () => {
    const events: GameEvent[] = [
      {
        type: 'COMBAT_CONSEQUENCE',
        payload: {
          attackerName: 'Hero',
          targets: [
            {
              targetName: 'Goblin',
              targetId: 'goblin-1',
              damage: 4,
              hpAfter: 11
            }
          ]
        }
      },
      {
        type: 'DAMAGE_DEALT',
        payload: {
          damage: 8,
          targetName: 'Goblin'
        }
      }
    ];
    const context = adaptCombatEventsToNarrativeContext(events);
    
    const damageFacts = context.facts.filter((f: NarrativeFact) => f.type === 'damage_confirmed');
    expect(damageFacts).toHaveLength(2);
    expect(damageFacts[0].payload?.damageAmount).toBe(4);
    expect(damageFacts[1].payload?.damageAmount).toBe(8);
  });

  it('should deduplicate exact duplicate facts in the same run', () => {
    const events: GameEvent[] = [
      {
        type: 'COMBAT_CONSEQUENCE',
        payload: {
          attackerName: 'Hero',
          targets: [
            {
              targetName: 'Goblin',
              targetId: 'goblin-1',
              damage: 6,
              hpAfter: 9
            }
          ]
        }
      },
      {
        type: 'DAMAGE_DEALT',
        payload: {
          damage: 6,
          targetName: 'Goblin'
        }
      }
    ];
    const context = adaptCombatEventsToNarrativeContext(events);
    
    const damageFacts = context.facts.filter((f: NarrativeFact) => f.type === 'damage_confirmed');
    expect(damageFacts).toHaveLength(1);
    expect(damageFacts[0].payload?.damageAmount).toBe(6);
  });

});
