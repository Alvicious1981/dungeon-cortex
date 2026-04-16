import { describe, it, expect } from 'vitest';
import { convertGoldToXP, payLivingExpenses, rollRetainerMorale } from '../../lib/rules/downtime';

describe('Downtime Rules Engine (Milestone Q)', () => {
  describe('convertGoldToXP', () => {
    it('grants 1:1 ratio for positive gold', () => {
      expect(convertGoldToXP(150)).toBe(150);
      expect(convertGoldToXP(5)).toBe(5);
    });

    it('returns 0 for negative or zero gold', () => {
      expect(convertGoldToXP(0)).toBe(0);
      expect(convertGoldToXP(-50)).toBe(0);
    });
  });

  describe('payLivingExpenses', () => {
    it('calculates properly with sufficient funds', () => {
      const result = payLivingExpenses(100, 10, 3, 2);
      expect(result.totalCost).toBe(60); // 10 * 3 * 2
      expect(result.fundsRemaining).toBe(40);
      expect(result.isBankrupt).toBe(false);
    });

    it('forces bankruptcy if totalCost > currentFunds', () => {
      const result = payLivingExpenses(50, 10, 5, 2);
      expect(result.totalCost).toBe(100);
      expect(result.fundsRemaining).toBe(0);
      expect(result.isBankrupt).toBe(true);
    });

    it('defaults party size to 1 if not provided', () => {
      const result = payLivingExpenses(100, 10, 5);
      expect(result.totalCost).toBe(50);
      expect(result.fundsRemaining).toBe(50);
      expect(result.isBankrupt).toBe(false);
    });

    it('throws on negative parameters', () => {
      expect(() => payLivingExpenses(100, -10, 5)).toThrowError(/negative/);
      expect(() => payLivingExpenses(100, 10, -5)).toThrowError(/negative/);
    });
  });

  describe('rollRetainerMorale', () => {
    it('succeeds simply if roll is below or equal to base loyalty', () => {
      const result = rollRetainerMorale(5, 7);
      expect(result.success).toBe(true);
      expect(result.newState).toBe('confident');
    });

    it('fails and becomes wavering if roll exceeds base loyalty', () => {
      const result = rollRetainerMorale(9, 7);
      expect(result.success).toBe(false);
      expect(result.newState).toBe('wavering');
    });

    it('incorporates positive charisma modifiers', () => {
      // Base 7 + 2 Cha = 9. Roll 8 is success.
      const result = rollRetainerMorale(8, 7, false, +2, false);
      expect(result.success).toBe(true);
    });

    it('factors unpaid wages resulting in hostle behavior on very bad rolls', () => {
      // Base 7 - 2 (unpaid) = 5. Roll 11 > 5 (fail) and roll >= 10 -> hostile
      const result = rollRetainerMorale(11, 7, true, 0, false);
      expect(result.success).toBe(false);
      expect(result.total).toBe(5);
      expect(result.newState).toBe('hostile');
    });

    it('factors unpaid wages but just wavering on normal failures', () => {
      // Base 7 - 2 (unpaid) = 5. Roll 8 > 5 (fail) and roll < 10 -> wavering
      const result = rollRetainerMorale(8, 7, true, 0, false);
      expect(result.success).toBe(false);
      expect(result.total).toBe(5);
      expect(result.newState).toBe('wavering');
    });

    it('factors trauma', () => {
      // Base 7 - 1 = 6. Roll 7 is fail.
      const result = rollRetainerMorale(7, 7, false, 0, true);
      expect(result.success).toBe(false);
    });

    it('throws error if roll2d6 is out of bounds', () => {
      expect(() => rollRetainerMorale(1, 7)).toThrowError();
      expect(() => rollRetainerMorale(13, 7)).toThrowError();
    });
  });
});
