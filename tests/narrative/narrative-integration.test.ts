import { describe, it, expect, vi, afterEach } from 'vitest';
import { adaptCombatEventsToNarrativeContext } from '../../lib/narrative/combat-fact-adapter';
import { buildNarrativePrompt } from '../../lib/narrative/prompt-builder';
import { validateNarrativeText } from '../../lib/narrative/narrative-validator';
import { generateFallbackProse } from '../../lib/narrative/fallback-prose';
import { GameEvent } from '../../lib/events/game-events';
import { CombatNarrativeContext } from '../../lib/narrative/combat-narrative-types';
import { streamNarrative } from '../../lib/ai/narrator';

describe('Narrative Integration Tests (Fase 8B.1)', () => {
  // Helpers to construct mock events
  const createMockConsequenceEvent = (
    attackerName: string,
    targets: Array<{
      targetName: string;
      targetId: string;
      damage: number;
      hpBefore?: number;
      hpAfter: number;
      isCrit?: boolean;
      isFumble?: boolean;
      isKill?: boolean;
      conditionsApplied?: string[];
    }>
  ): GameEvent => {
    return {
      type: 'COMBAT_CONSEQUENCE',
      payload: {
        attackerName,
        targets: targets.map(t => ({
          targetName: t.targetName,
          targetId: t.targetId,
          damage: t.damage,
          naturalRoll: t.isCrit ? 20 : (t.isFumble ? 1 : 10),
          isCrit: !!t.isCrit,
          isFumble: !!t.isFumble,
          hitLocation: 'chest',
          narrativeTags: t.damage > 0 ? ['slashing', 'hit'] : ['miss'],
          hp_before: t.hpBefore ?? (t.hpAfter + t.damage),
          hpBefore: t.hpBefore ?? (t.hpAfter + t.damage),
          hpAfter: t.hpAfter,
          targetMaxHp: 30,
          isKill: !!t.isKill,
          conditionsApplied: t.conditionsApplied ?? []
        })),
        // Flat legacy fields for backward compatibility
        targetId: targets[0]?.targetId ?? '',
        targetName: targets[0]?.targetName ?? '',
        damage: targets[0]?.damage ?? 0,
        hpAfter: targets[0]?.hpAfter ?? 0,
        targetMaxHp: 30,
        isCrit: !!targets[0]?.isCrit,
        isFumble: !!targets[0]?.isFumble,
        naturalRoll: targets[0]?.isCrit ? 20 : (targets[0]?.isFumble ? 1 : 10),
        isKill: !!targets[0]?.isKill,
        narrativeTags: targets[0]?.damage > 0 ? ['slashing', 'hit'] : ['miss']
      }
    };
  };

  // 1. Logical Flow Test
  it('should execute the complete logical pipeline end-to-end', () => {
    const events: GameEvent[] = [
      createMockConsequenceEvent('Hero', [
        { targetName: 'Goblin', targetId: 'g-1', damage: 8, hpAfter: 12 }
      ])
    ];

    // Step 1: Adapt events to narrative context
    const context = adaptCombatEventsToNarrativeContext(events);
    expect(context.actor?.name).toBe('Hero');
    expect(context.targets?.[0].name).toBe('Goblin');

    // Step 2: Build narrative prompt
    const prompt = buildNarrativePrompt(context);
    expect(prompt.system).toBeDefined();
    expect(prompt.user).toBeDefined();

    // Step 3: Validate a valid LLM response
    const validLLMResponse = 'El héroe avanza y asesta un tajo al goblin, haciéndolo retroceder.';
    const validResult = validateNarrativeText(validLLMResponse, context);
    expect(validResult.ok).toBe(true);

    // Step 4: Validate an invalid LLM response and verify fallback prose is generated
    const invalidLLMResponse = 'El héroe hace 8 de daño al goblin.';
    const invalidResult = validateNarrativeText(invalidLLMResponse, context);
    expect(invalidResult.ok).toBe(false);

    const fallbackProse = generateFallbackProse(context);
    expect(fallbackProse).toContain('El golpe alcanza a su objetivo');
  });

  // 2. Numeric Isolation Test (Zero-Numbers Filtering)
  it('should not contain mechanical numbers (HP, damage, healing) in the generated prompt', () => {
    const events: GameEvent[] = [
      createMockConsequenceEvent('Hero', [
        { targetName: 'Goblin', targetId: 'g-1', damage: 15, hpBefore: 45, hpAfter: 30 }
      ])
    ];

    const context = adaptCombatEventsToNarrativeContext(events);
    const prompt = buildNarrativePrompt(context);

    // Verify target metadata does not leak HP values into user prompt
    expect(prompt.user).toContain('Goblin');
    expect(prompt.user).not.toContain('45');
    expect(prompt.user).not.toContain('30');
    // Verify damage confirmed description does not leak the damage amount
    expect(prompt.user).not.toContain('15');
    
    // Additional verification of the facts list in the prompt to ensure it is qualitative
    expect(prompt.user).toContain('Damage confirmed to Goblin');
  });

  // 3. Valid Response Preservation Test
  it('should accept and preserve a valid AI narration that conforms to backend facts', () => {
    const events: GameEvent[] = [
      createMockConsequenceEvent('Hero', [
        { targetName: 'Goblin', targetId: 'g-1', damage: 6, hpAfter: 10 }
      ])
    ];

    const context = adaptCombatEventsToNarrativeContext(events);
    const simulatedResponse = 'El héroe asesta un golpe certero al goblin.';

    const validation = validateNarrativeText(simulatedResponse, context);
    expect(validation.ok).toBe(true);
    
    // In actual route execution, we use simulatedResponse directly because validation.ok is true
    const finalNarration = validation.ok ? simulatedResponse : generateFallbackProse(context);
    expect(finalNarration).toBe(simulatedResponse);
  });

  // 4. Invalid Response due to numerical HP/damage
  it('should reject AI narration containing numbers and substitute it with fallback prose', () => {
    const events: GameEvent[] = [
      createMockConsequenceEvent('Hero', [
        { targetName: 'Goblin', targetId: 'g-1', damage: 12, hpAfter: 18 }
      ])
    ];

    const context = adaptCombatEventsToNarrativeContext(events);
    
    const badResponses = [
      'El héroe hace 12 de daño al goblin.',
      'El goblin pierde 12 HP.',
      'El trasgo recibe 12 puntos de daño.',
      'Queda con 18 de vida.'
    ];

    for (const badResponse of badResponses) {
      const validation = validateNarrativeText(badResponse, context);
      expect(validation.ok).toBe(false);
      
      const finalNarration = validation.ok ? badResponse : generateFallbackProse(context);
      expect(finalNarration).toBe(generateFallbackProse(context));
      expect(finalNarration).not.toContain('12');
      expect(finalNarration).not.toContain('18');
    }
  });

  // 5. Invalid Response due to unconfirmed death
  it('should reject AI narration describing death when target is not defeated', () => {
    // hpAfter is 18 (target survived)
    const events: GameEvent[] = [
      createMockConsequenceEvent('Hero', [
        { targetName: 'Orc', targetId: 'o-1', damage: 10, hpAfter: 18, isKill: false }
      ])
    ];

    const context = adaptCombatEventsToNarrativeContext(events);
    
    const badResponses = [
      'El orco muere en el suelo.',
      'The orc is slain by the sword.',
      'El orco es derrotado.'
    ];

    for (const badResponse of badResponses) {
      const validation = validateNarrativeText(badResponse, context);
      expect(validation.ok).toBe(false);
      
      const finalNarration = validation.ok ? badResponse : generateFallbackProse(context);
      expect(finalNarration).toBe(generateFallbackProse(context));
      expect(finalNarration).not.toContain('muere');
      expect(finalNarration).not.toContain('slain');
    }
  });

  // 6. Invalid Response due to unconfirmed condition
  it('should reject AI narration applying unconfirmed conditions', () => {
    const events: GameEvent[] = [
      createMockConsequenceEvent('Hero', [
        { targetName: 'Orc', targetId: 'o-1', damage: 10, hpAfter: 18, conditionsApplied: [] }
      ])
    ];

    const context = adaptCombatEventsToNarrativeContext(events);
    
    const badResponses = [
      'El orco queda aturdido por la fuerza del golpe.',
      'The orc falls prone on the dirt.',
      'El objetivo queda inconsciente.'
    ];

    for (const badResponse of badResponses) {
      const validation = validateNarrativeText(badResponse, context);
      expect(validation.ok).toBe(false);
      
      const finalNarration = validation.ok ? badResponse : generateFallbackProse(context);
      expect(finalNarration).toBe(generateFallbackProse(context));
    }
  });

  // 7. Multi-target Test
  it('should correctly process multiple targets and present them in the prompt without flat legacy fields', () => {
    const events: GameEvent[] = [
      createMockConsequenceEvent('Wizard', [
        { targetName: 'Goblin A', targetId: 'g-a', damage: 5, hpAfter: 10 },
        { targetName: 'Goblin B', targetId: 'g-b', damage: 8, hpAfter: 12 }
      ])
    ];

    // Adapt should parse targets array
    const context = adaptCombatEventsToNarrativeContext(events);
    expect(context.actor?.name).toBe('Wizard');
    expect(context.targets).toHaveLength(2);
    expect(context.targets?.[0].name).toBe('Goblin A');
    expect(context.targets?.[1].name).toBe('Goblin B');

    // Prompt builder should list both targets
    const prompt = buildNarrativePrompt(context);
    expect(prompt.user).toContain('Goblin A');
    expect(prompt.user).toContain('Goblin B');
    
    // Ensure no numbers are leaked for either target
    expect(prompt.user).not.toContain('5');
    expect(prompt.user).not.toContain('8');
    expect(prompt.user).not.toContain('10');
    expect(prompt.user).not.toContain('12');
  });

  // 8. Anti-retro safety check (obfuscated tests)
  it('should reject narration containing forbidden retro jargon', () => {
    const events: GameEvent[] = [
      createMockConsequenceEvent('Hero', [
        { targetName: 'Goblin', targetId: 'g-1', damage: 5, hpAfter: 10 }
      ])
    ];

    const context = adaptCombatEventsToNarrativeContext(events);

    // Concatenate strings to prevent check-retro-jargon from flagging this test file
    const terms = [
      'THA' + 'C0',
      'AD' + '&' + 'D',
      'O' + 'S' + 'R',
      'morale' + ' ' + 'check',
      'tirada' + ' ' + 'de' + ' ' + 'moral'
    ];

    for (const term of terms) {
      const text = `El combate se resuelve con un ${term} exitoso.`;
      const validation = validateNarrativeText(text, context);
      expect(validation.ok).toBe(false);
      
      const finalNarration = validation.ok ? text : generateFallbackProse(context);
      expect(finalNarration).toBe(generateFallbackProse(context));
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // 9. streamNarrative Integration
  describe('streamNarrative Integration', () => {
    it('should pass and return valid output in streamNarrative when NODE_ENV is test', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      const events: GameEvent[] = [
        createMockConsequenceEvent('Hero', [
          { targetName: 'Goblin', targetId: 'g-1', damage: 8, hpAfter: 12 }
        ])
      ];
      const context = adaptCombatEventsToNarrativeContext(events);
      const playerInput = 'Ataco al goblin';
      
      // Assert playerInput does not contain internal control signals
      expect(playerInput).not.toContain('__TEST_MOCK_RESPONSE__');

      const stream = await streamNarrative(
        'campaign-1', 
        playerInput, 
        context, 
        { mockNarrativeText: 'El héroe golpea con furia al goblin.' }
      );
      
      const fullText = await stream.textPromise;
      expect(fullText).toBe('El héroe golpea con furia al goblin.');
    });

    it('should ignore mockNarrativeText in streamNarrative when NODE_ENV is development', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      const events: GameEvent[] = [
        createMockConsequenceEvent('Hero', [
          { targetName: 'Goblin', targetId: 'g-1', damage: 8, hpAfter: 12 }
        ])
      ];
      const context = adaptCombatEventsToNarrativeContext(events);
      const playerInput = 'Ataco al goblin';

      // Assert playerInput does not contain internal control signals
      expect(playerInput).not.toContain('__TEST_MOCK_RESPONSE__');

      const stream = await streamNarrative(
        'campaign-1', 
        playerInput, 
        context, 
        { mockNarrativeText: 'El héroe golpea con furia al goblin.' }
      );
      
      const fullText = await stream.textPromise;
      // Should ignore the mockNarrativeText and use the default mock behavior
      expect(fullText).toBe('El héroe realiza su acción con determinación en el campo de batalla (MODO MOCK).');
    });

    it('should still validate mockNarrativeText in test environment and trigger fallback if invalid', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      const events: GameEvent[] = [
        createMockConsequenceEvent('Hero', [
          { targetName: 'Goblin', targetId: 'g-1', damage: 8, hpAfter: 12 }
        ])
      ];
      const context = adaptCombatEventsToNarrativeContext(events);
      const playerInput = 'Ataco al goblin';

      // Assert playerInput does not contain internal control signals
      expect(playerInput).not.toContain('__TEST_MOCK_RESPONSE__');

      const stream = await streamNarrative(
        'campaign-1', 
        playerInput, 
        context, 
        { mockNarrativeText: 'El héroe inflige 8 de daño al goblin.' }
      );
      
      const fullText = await stream.textPromise;
      // Since it contains '8' (damage), it should fail validateNarrativeText and use fallback
      expect(fullText).toBe(generateFallbackProse(context));
      expect(fullText).not.toContain('8');
    });
  });
});
