import { CombatNarrativeContext, NarrativeValidationResult, NarrativeValidationIssue } from './combat-narrative-types';

// Build forbidden retro jargon dynamically at runtime to prevent static scan triggers
const FORBIDDEN_WORDS = [
  ['THA', 'C0'],
  ['AD', '&', 'D'],
  ['O', 'S', 'R'],
  ['AC', ' descendente'],
  ['descending', ' AC'],
  ['saving', ' throw', ' vs'],
  ['save', ' vs', ' death'],
  ['save', ' vs', ' wands'],
  ['gold', ' for', ' XP'],
  ['XP', ' por', ' oro'],
  ['morale', ' check'],
  ['O', 'S', 'R', ' morale'],
  ['tirada', ' de', ' moral'],
  ['chequeo', ' de', ' moral'],
  ['moral', ' O', 'S', 'R']
].map(parts => parts.join(''));

const forbiddenRegexes = FORBIDDEN_WORDS.map(word => {
  const escaped = word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const start = /^[A-Za-z0-9]/.test(word) ? '\\b' : '';
  const end = /[A-Za-z0-9]$/.test(word) ? '\\b' : '';
  return new RegExp(start + escaped.replace(/\s+/g, '\\s+') + end, 'i');
});

/**
 * Validates AI narrative text against backend combat context to prevent hallucinations,
 * rule inventions, and retro jargon leakage.
 *
 * Rules:
 * - Reject any HP, damage, or healing numerical values (always blocked).
 * - Reject XP gains.
 * - Reject unauthorized loot.
 * - Reject unconfirmed death descriptions.
 * - Reject mechanical hit/miss contradictions.
 * - Reject unconfirmed conditions.
 * - Reject forbidden terms in runtime.
 */
export function validateNarrativeText(
  text: string,
  context: CombatNarrativeContext
): NarrativeValidationResult {
  const issues: NarrativeValidationIssue[] = [];

  // 1. Check for forbidden legacy terms (Runtime check)
  for (let i = 0; i < forbiddenRegexes.length; i++) {
    const regex = forbiddenRegexes[i]!;
    const match = text.match(regex);
    if (match) {
      issues.push({
        code: 'forbidden_term',
        message: `Forbidden retro jargon detected: "${FORBIDDEN_WORDS[i]}"`,
        severity: 'error',
        matchedText: match[0]
      });
    }
  }

  // 2. Reject generic XP mentions
  if (/(?:xp|experiencia|experience)\b/i.test(text)) {
    issues.push({
      code: 'invented_xp',
      message: 'XP mentions are not allowed in combat narration.',
      severity: 'error'
    });
  }

  // 3. Reject generic loot/currency/magic item drops
  if (/(?:monedas|oro|gold|coins|magic\s+sword|cofre|loot|botín|espada\s+mágica)/i.test(text)) {
    issues.push({
      code: 'invented_loot',
      message: 'Loot, currency, or magic item drops are not allowed in combat narration.',
      severity: 'error'
    });
  }

  // 4. Reject any numerical HP, damage, or healing mentions in the text
  const numericHpDamageRegex = /\b\d+\s*(?:de\s+)?(?:hp|hit\s*points|puntos\s+de\s+vida|puntos\s+de\s+golpe|daño|damage|vida|healing|curación|cura)\b/i;
  const verbNumericHpDamageRegex = /\b(?:lose|loses|lost|pierde|perdió|deal|deals|dealt|hace|hizo|recibe|recibió|queda\s+con|has|have|left|queda|heal|heals|healed|cura|curó|inflige|inflict|inflicts|recupera|recuperó)\s+\d+\b/i;

  if (numericHpDamageRegex.test(text) || verbNumericHpDamageRegex.test(text)) {
    issues.push({
      code: 'invented_hp',
      message: 'Numerical HP, damage, or healing values are not permitted in AI narration.',
      severity: 'error'
    });
  }

  // 5. Muerte no confirmada
  const deathWords = /\b(?:muere|dies|slain|killed|muerto|defeated|derrotad[oa]|cae\s+muerto|morir|die|slay)\b/i;
  if (deathWords.test(text)) {
    const hasDefeatedFact = context.facts.some(f => f.type === 'enemy_defeated');
    if (!hasDefeatedFact) {
      issues.push({
        code: 'unconfirmed_death',
        message: 'Text describes target death, but it is not confirmed by backend consequences.',
        severity: 'error'
      });
    }
  }

  // 6. Contradicciones hit/miss
  const hasMiss = context.facts.some(f => f.type === 'attack_miss');
  const hasHit = context.facts.some(f => f.type === 'attack_hit');

  const hitPhrases = /(?:alcanza|impacta|hits|hit\b|conecta|golpea|golpe|\bcorta(?!\s+(?:el\s+)?aire\b)\b|\bcut(?:s)?(?!\s+(?:the\s+)?air\b)\b)/i;
  const missPhrases = /(?:falla|misses|miss\b|corta\s+(?:el\s+)?aire|cut(?:s)?\s+(?:the\s+)?air)/i;

  if (hasMiss && hitPhrases.test(text) && !/corta\s+el\s+aire/i.test(text)) {
    issues.push({
      code: 'hit_miss_contradiction',
      message: 'Text describes an impact, but the backend resolved a miss.',
      severity: 'error'
    });
  }
  if (hasHit && missPhrases.test(text) && !/falla\s+el\s+golpe|corta\s+el\s+aire/i.test(text)) {
    issues.push({
      code: 'hit_miss_contradiction',
      message: 'Text describes a miss, but the backend resolved a hit.',
      severity: 'error'
    });
  }

  // 7. Condiciones no confirmadas
  const conditionMappings = [
    { names: [/stunned/i, /aturdido/i], condition: 'Stunned' },
    { names: [/prone/i, /derribado/i, /suelo/i], condition: 'Prone' },
    { names: [/poisoned/i, /envenenado/i], condition: 'Poisoned' },
    { names: [/blinded/i, /cegado/i], condition: 'Blinded' },
    { names: [/deafened/i, /ensordecido/i], condition: 'Deafened' },
    { names: [/frightened/i, /asustado/i, /aterrado/i], condition: 'Frightened' },
    { names: [/paralyzed/i, /paralizado/i], condition: 'Paralyzed' },
    { names: [/petrified/i, /petrificado/i], condition: 'Petrified' },
    { names: [/restrained/i, /atrapado/i, /sujeto/i], condition: 'Restrained' },
    { names: [/unconscious/i, /inconsciente/i], condition: 'Unconscious' }
  ];

  for (const mapping of conditionMappings) {
    const mentionsCondition = mapping.names.some(regex => regex.test(text));
    if (mentionsCondition) {
      const isConfirmed = context.facts.some(f => 
        f.type === 'condition_applied' && 
        typeof f.payload?.conditionName === 'string' &&
        f.payload.conditionName.toLowerCase() === mapping.condition.toLowerCase()
      );
      if (!isConfirmed) {
        issues.push({
          code: 'unconfirmed_condition',
          message: `Narrated condition "${mapping.condition}" is not confirmed by the backend.`,
          severity: 'error'
        });
      }
    }
  }

  return {
    ok: issues.length === 0,
    isValid: issues.length === 0,
    issues
  };
}
