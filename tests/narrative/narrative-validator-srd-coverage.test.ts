import { describe, it, expect } from 'vitest';
import { validateNarrativeText } from '../../lib/narrative/narrative-validator';
import { generateFallbackProse } from '../../lib/narrative/fallback-prose';
import type { CombatNarrativeContext } from '../../lib/narrative/combat-narrative-types';
import { CONDITION_REGISTRY } from '../../lib/rules/conditions';

// DECISION_5E_SRD_API.md §7: the narrator must not invent AC, HP, DCs or
// conditions. These cases pin every SRD 2014 condition and the AC/DC figures
// the narrator can see in the campaign state.

const factsWithoutConditions: CombatNarrativeContext = {
  facts: [{ type: 'turn_started', description: 'Turn started' }],
};

function withCondition(conditionName: string): CombatNarrativeContext {
  return {
    facts: [{
      type: 'condition_applied',
      description: `Condition ${conditionName} applied to Goblin`,
      payload: { conditionName, targetName: 'Goblin' },
    }],
  };
}

const codes = (text: string, context?: CombatNarrativeContext) =>
  validateNarrativeText(text, context).issues.map(issue => issue.code);

// One English and one Spanish sentence per registry condition id.
const CONDITION_CASES: Record<string, { en: string; es: string }> = {
  blinded: { en: 'The goblin is blinded.', es: 'El goblin queda cegado.' },
  charmed: { en: 'The goblin is charmed.', es: 'El goblin queda hechizado.' },
  deafened: { en: 'The goblin is deafened.', es: 'El goblin queda ensordecido.' },
  exhaustion: {
    en: 'The goblin gains a level of exhaustion.',
    es: 'El goblin sufre un nivel de agotamiento.',
  },
  frightened: { en: 'The goblin is frightened.', es: 'El goblin queda asustado.' },
  grappled: { en: 'The goblin is grappled.', es: 'El goblin queda agarrado.' },
  incapacitated: { en: 'The goblin is incapacitated.', es: 'El goblin queda incapacitado.' },
  invisible: { en: 'The goblin turns invisible.', es: 'El goblin se vuelve invisible.' },
  paralyzed: { en: 'The goblin is paralyzed.', es: 'El goblin queda paralizado.' },
  petrified: { en: 'The goblin is petrified.', es: 'El goblin queda petrificado.' },
  poisoned: { en: 'The goblin is poisoned.', es: 'El goblin queda envenenado.' },
  prone: { en: 'The goblin is prone.', es: 'El goblin cae al suelo.' },
  restrained: { en: 'The goblin is restrained.', es: 'El goblin queda atrapado.' },
  stunned: { en: 'The goblin is stunned.', es: 'El goblin queda aturdido.' },
  unconscious: { en: 'The goblin is unconscious.', es: 'El goblin queda inconsciente.' },
};

const conditionRows = Object.values(CONDITION_REGISTRY).flatMap(entry => [
  { id: entry.id, name: entry.name, lang: 'en', text: CONDITION_CASES[entry.id]?.en ?? '' },
  { id: entry.id, name: entry.name, lang: 'es', text: CONDITION_CASES[entry.id]?.es ?? '' },
]);

describe('SRD 2014 condition coverage in the narrative validator', () => {
  it('covers exactly the 15 conditions of the rules registry', () => {
    expect(Object.keys(CONDITION_REGISTRY).sort()).toEqual(Object.keys(CONDITION_CASES).sort());
    expect(Object.keys(CONDITION_REGISTRY)).toHaveLength(15);
  });

  it.each(conditionRows)('rejects unconfirmed $name ($lang): $text', ({ text }) => {
    expect(codes(text, factsWithoutConditions)).toContain('unconfirmed_condition');
  });

  it.each(conditionRows)('rejects $name ($lang) on a turn without combat facts: $text', ({ text }) => {
    expect(codes(text)).toContain('unconfirmed_condition');
  });

  it.each(conditionRows)('accepts $name ($lang) once the backend confirms it: $text', ({ name, text }) => {
    expect(validateNarrativeText(text, withCondition(name)).issues).toEqual([]);
  });

  it.each([
    'The guard is charmed by the vampire.',
    'El guardia queda hechizado por la bruja.',
  ])('still rejects being charmed by a creature: %s', (text) => {
    expect(codes(text, factsWithoutConditions)).toContain('unconfirmed_condition');
    expect(codes(text)).toContain('unconfirmed_condition');
  });

  it('does not accept a condition confirmed for a different condition', () => {
    expect(codes('The goblin is charmed.', withCondition('Frightened'))).toContain('unconfirmed_condition');
    expect(codes('El goblin se vuelve invisible.', withCondition('Blinded'))).toContain('unconfirmed_condition');
  });

  it.each([
    'La goblin queda aturdida.',
    'Las arañas quedan envenenadas.',
    'La guardia queda hechizada.',
    'The guard vanishes from sight and becomes invisible.',
    'Te vuelves invisible.',
    'You gain one level of exhaustion.',
    'Acumulas agotamiento.',
  ])('rejects other unconfirmed wordings: %s', (text) => {
    expect(codes(text, factsWithoutConditions)).toContain('unconfirmed_condition');
  });

  it('keeps accepting an unconscious player confirmed by death-save facts', () => {
    const downed: CombatNarrativeContext = {
      facts: [{ type: 'player_downed', description: 'Player falls unconscious at 0 HP' }],
    };
    expect(validateNarrativeText('Caes inconsciente.', downed).ok).toBe(true);
  });
});

describe('ordinary words that must not be read as conditions', () => {
  it.each([
    'Te sientes agotado tras la larga marcha.',
    'El guardia, agotado, bosteza junto a la puerta.',
    'El agotamiento se refleja en su rostro.',
    'The exhausted guard yawns by the gate.',
    'Exhaustion weighs on your shoulders after the climb.',
    'Una fuerza invisible agita las antorchas.',
    'Hilos invisibles cuelgan del techo.',
    'An invisible draft chills the corridor.',
    'The runes are invisible in the dark.',
    'Encantado de conocerte, dice el tabernero.',
    'The charming bard bows to the crowd.',
    'El marinero se mantiene agarrado a la cuerda.',
    'The guard captain is charmed by your wit.',
    'The innkeeper seems charmed with the compliment.',
    'La dama queda hechizada por la melodía.',
    'El mercader parece hechizado con tu sonrisa.',
  ])('accepts on combat and factless turns: %s', (text) => {
    expect(validateNarrativeText(text, factsWithoutConditions).issues).toEqual([]);
    expect(validateNarrativeText(text).issues).toEqual([]);
  });
});

describe('AC, DC and labelled HP figures', () => {
  it.each([
    ['CA 15', 'El orco tiene CA 15.'],
    ['AC: 15', 'The orc has AC: 15.'],
    ['AC 15', 'Its AC 15 holds.'],
    ['clase de armadura 15', 'Su clase de armadura 15 resiste el golpe.'],
    ['armor class of 15', 'The knight has an armor class of 15.'],
    ['15 de CA', 'El caballero tiene 15 de CA.'],
    ['CA quince', 'El caballero tiene CA quince.'],
    ['CA once', 'El caballero tiene CA once.'],
    ['CD 13', 'Necesitas superar una CD 13.'],
    ['DC 13', 'Make a DC 13 Dexterity saving throw.'],
    ['CD de 13', 'La trampa tiene una CD de 13.'],
    ['clase de dificultad 13', 'La cerradura tiene clase de dificultad 13.'],
  ])('rejects %s on combat and factless turns', (_label, text) => {
    expect(codes(text, factsWithoutConditions)).toContain('invented_ac_dc');
    expect(codes(text)).toContain('invented_ac_dc');
  });

  it.each([
    'Te quedan HP: 7.',
    'The goblin has HP: 7.',
    'Estado: PV 7.',
  ])('rejects labelled HP figures on combat and factless turns: %s', (text) => {
    expect(codes(text, factsWithoutConditions)).toContain('invented_hp');
    expect(codes(text)).toContain('invented_hp');
  });

  it.each([
    'El orco lleva una armadura gruesa.',
    'The orc wears thick plate armor.',
    'La cerradura parece difícil de forzar.',
    'Hay catres viejos en la sala.',
    'The spell mends your wounds and your hit points once more swell with vigor.',
    'Its armor class once again proves formidable.',
  ])('accepts qualitative descriptions: %s', (text) => {
    expect(validateNarrativeText(text, factsWithoutConditions).issues).toEqual([]);
    expect(validateNarrativeText(text).issues).toEqual([]);
  });
});

describe('fallback prose stays valid for every condition', () => {
  it.each(Object.values(CONDITION_REGISTRY).map(entry => entry.name))(
    'fallback prose for %s passes its own validation',
    (name) => {
      const context = withCondition(name);
      const fallback = generateFallbackProse(context);
      expect(validateNarrativeText(fallback, context).issues).toEqual([]);
    },
  );

  it.each(['player_downed', 'player_stabilized'] as const)(
    'fallback prose for %s passes its own validation',
    (type) => {
      const context: CombatNarrativeContext = { facts: [{ type, description: type }] };
      expect(validateNarrativeText(generateFallbackProse(context), context).issues).toEqual([]);
    },
  );
});
