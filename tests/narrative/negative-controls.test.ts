import { describe, it, expect } from 'vitest';
import { validateNarrativeText } from '../../lib/narrative/narrative-validator';
import { generateFallbackProse } from '../../lib/narrative/fallback-prose';
import { CombatFacts, CombatNarrativeContext, NarrativeFact } from '../../lib/narrative/combat-narrative-types';

// Temporarily map CombatFacts to CombatNarrativeContext for backward compatibility in these tests
function convertCombatFactsToContext(facts: CombatFacts): CombatNarrativeContext {
  const narrativeFacts: NarrativeFact[] = [];

  if (facts.damage > 0) {
    narrativeFacts.push({
      type: 'attack_hit',
      description: 'Attack hit',
      payload: { targetName: facts.defenderName }
    });
    narrativeFacts.push({
      type: 'damage_confirmed',
      description: `Damage: ${facts.damage}`,
      payload: { damageAmount: facts.damage, targetName: facts.defenderName }
    });
  } else {
    narrativeFacts.push({
      type: 'attack_miss',
      description: 'Attack miss',
      payload: { targetName: facts.defenderName }
    });
  }

  if (facts.isCrit) {
    narrativeFacts.push({
      type: 'critical_hit',
      description: 'Critical hit',
      payload: { targetName: facts.defenderName }
    });
  }

  if (facts.isFumble) {
    narrativeFacts.push({
      type: 'critical_miss',
      description: 'Critical miss',
      payload: { targetName: facts.defenderName }
    });
  }

  if (facts.isKill) {
    narrativeFacts.push({
      type: 'enemy_defeated',
      description: 'Enemy defeated',
      payload: { targetName: facts.defenderName }
    });
  }

  for (const cond of facts.conditionsApplied) {
    narrativeFacts.push({
      type: 'condition_applied',
      description: `Condition ${cond} applied`,
      payload: { conditionName: cond, targetName: facts.defenderName }
    });
  }

  return {
    facts: narrativeFacts,
    actor: { id: '', name: facts.attackerName, isPlayer: true },
    targets: [
      { id: '', name: facts.defenderName, isPlayer: false, hpAfter: facts.hpAfter, hpBefore: facts.hpBefore }
    ]
  };
}

function validateNarration(text: string, facts: CombatFacts) {
  return validateNarrativeText(text, convertCombatFactsToContext(facts));
}

describe('Narrative Safety - Negative Controls (TDD)', () => {
  const baseFacts: CombatFacts = {
    attackerName: 'Hero',
    defenderName: 'Goblin',
    weaponName: 'Longsword',
    damage: 8,
    damageType: 'slashing',
    hpBefore: 15,
    hpAfter: 7,
    targetMaxHp: 15,
    isCrit: false,
    isFumble: false,
    isKill: false,
    conditionsApplied: [],
  };

  describe('Factual Alignment Validation', () => {
    it('should reject invented HP numbers in narration', () => {
      const narrationEN = 'The goblin loses 12 HP from the blow.';
      const narrationES = 'El goblin pierde 8 HP y gime.';
      
      const resultEN = validateNarration(narrationEN, baseFacts);
      expect(resultEN.isValid).toBe(false);

      const resultES = validateNarration(narrationES, baseFacts);
      expect(resultES.isValid).toBe(false);
    });

    it('should reject invented XP gains in narration', () => {
      const narration1 = 'Ganáis 200 XP por esta victoria.';
      const narration2 = 'You gain 300 XP from defeating the beast.';
      expect(validateNarration(narration1, baseFacts).isValid).toBe(false);
      expect(validateNarration(narration2, baseFacts).isValid).toBe(false);
    });

    it('should reject invented loot/gold in narration', () => {
      const narration1 = 'El orco deja 10 monedas de oro en el suelo.';
      const narration2 = 'The goblin drops a magic sword.';
      const narration3 = 'You find gold for XP inside the chest.';
      expect(validateNarration(narration1, baseFacts).isValid).toBe(false);
      expect(validateNarration(narration2, baseFacts).isValid).toBe(false);
      expect(validateNarration(narration3, baseFacts).isValid).toBe(false);
    });

    it('should reject unconfirmed target death', () => {
      const narration1 = 'El esqueleto muere tras el impacto.';
      const narration2 = 'The skeleton dies.';
      const narration3 = 'The goblin is slain by your sword.';
      
      expect(validateNarration(narration1, baseFacts).isValid).toBe(false);
      expect(validateNarration(narration2, baseFacts).isValid).toBe(false);
      expect(validateNarration(narration3, baseFacts).isValid).toBe(false);
    });
  });

  describe('Forbidden Terminology Check', () => {
    const forbiddenTerms = [
      'THAC0',
      'AD&D',
      'OSR',
      'AC descendente',
      'descending AC',
      'saving throw vs',
      'save vs death',
      'save vs wands',
      'XP por oro',
      'gold for XP',
      'morale check',
      'OSR morale',
      'tirada de moral',
      'chequeo de moral',
      'moral OSR',
    ];

    forbiddenTerms.forEach((term) => {
      it(`should reject narration containing forbidden term: "${term}"`, () => {
        const narration = `The attack resolved, but we check ${term} anyway.`;
        expect(validateNarration(narration, baseFacts).isValid).toBe(false);
      });
    });

    it('should accept generic "moral" (Spanish) when not combined with forbidden terms', () => {
      const narration = 'El goblin mantiene la moral alta a pesar del golpe.';
      // We expect the mock/future validator to return true for generic Spanish "moral"
      // Since it's not a forbidden OSR combination
      expect(validateNarration(narration, baseFacts).isValid).toBe(true);
    });
  });

  describe('Safe Narration Approvals', () => {
    it('should approve safe diegetic narration without mechanical numbers', () => {
      const narration1 = 'El golpe alcanza al goblin y lo hace retroceder.';
      const narration2 = 'El ataque falla y la hoja corta el aire.';
      const missFacts = { ...baseFacts, damage: 0 };
      expect(validateNarration(narration1, baseFacts).isValid).toBe(true);
      expect(validateNarration(narration2, missFacts).isValid).toBe(true);
    });

    it('should approve target defeat narration ONLY when confirmed by backend', () => {
      const deadFacts: CombatFacts = {
        ...baseFacts,
        hpAfter: 0,
        isKill: true,
      };
      const narration = 'La criatura cae derrotada ante tu golpe.';
      expect(validateNarration(narration, deadFacts).isValid).toBe(true);

      // But should reject if isKill is false
      expect(validateNarration(narration, baseFacts).isValid).toBe(false);
    });
  });

  describe('Deterministic Fallback Integrity', () => {
    it('should guarantee that fallback prose does not contain forbidden terminology', () => {
      const fallbackText = generateFallbackProse(convertCombatFactsToContext(baseFacts));
      const validation = validateNarration(fallbackText, baseFacts);
      expect(validation.isValid).toBe(true);
    });
  });
});
