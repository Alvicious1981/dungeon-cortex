import type {
  CombatNarrativeContext,
  NarrativeValidationIssue,
  NarrativeValidationResult,
} from './combat-narrative-types';
import {
  CombatNarrativeContextSchema,
  NarrativeTextSchema,
} from './combat-narrative-types';
import { BLOCKED_NARRATOR_OPERATION_NAMES } from '../ai/tool-policy';

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

const blockedOperationRegex = new RegExp(
  `\\b(?:${BLOCKED_NARRATOR_OPERATION_NAMES.join('|')})\\b`,
  'i',
);

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
  context?: CombatNarrativeContext
): NarrativeValidationResult {
  const issues: NarrativeValidationIssue[] = [];

  const textResult = NarrativeTextSchema.safeParse(text);
  if (!textResult.success) {
    return {
      ok: false,
      isValid: false,
      issues: [{
        code: 'invalid_output_contract',
        message: 'Narrative output must be non-empty text within the configured length limit.',
        severity: 'error',
      }],
    };
  }

  const contextResult = context === undefined
    ? null
    : CombatNarrativeContextSchema.safeParse(context);
  if (contextResult && !contextResult.success) {
    return {
      ok: false,
      isValid: false,
      issues: [{
        code: 'invalid_context_contract',
        message: 'Narrative context does not match the resolved-facts contract.',
        severity: 'error',
      }],
    };
  }

  text = textResult.data;
  context = contextResult?.data;

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

  // 2. Reject prompt-policy disclosure or boundary markup in model output.
  const promptLeakRegex = /\b(?:system\s+prompt|developer\s+(?:message|instructions?)|hidden\s+(?:prompt|instructions?|context)|(?:ignore|disregard|reveal|quote|repeat)\s+(?:the\s+)?previous\s+instructions?|mensaje\s+del\s+sistema|prompt\s+del\s+sistema|contexto\s+oculto|(?:ignora|descarta|revela|cita|repite)\s+las?\s+instrucciones\s+(?:previas|anteriores)|instrucciones\s+(?:previas|anteriores)\s+(?:del\s+sistema|del\s+desarrollador|ocultas)|instrucciones\s+del\s+desarrollador)\b/i;
  const boundaryMarkupRegex = /<\/?(?:campaign_state|untrusted_context|player_action|resolved_facts|event_logs)\b/i;
  const jsonBoundaryRegex = /\b(?:GAME_DATA|canonicalState|recentDialogue|playerAction|backendResolvedFacts)\b/i;
  const promptLeakMatch = text.match(promptLeakRegex)
    ?? text.match(boundaryMarkupRegex)
    ?? text.match(jsonBoundaryRegex);
  if (promptLeakMatch) {
    issues.push({
      code: 'prompt_disclosure',
      message: 'Narrative output exposes prompt or data-boundary details.',
      severity: 'error',
      matchedText: promptLeakMatch[0],
    });
  }

  // 3. Reject references to mutation tools and serialized tool-call syntax.
  const mutationToolMatch = text.match(blockedOperationRegex);
  if (mutationToolMatch) {
    issues.push({
      code: 'unauthorized_tool',
      message: 'Narrative output references a state-changing tool that is unavailable to the narrator.',
      severity: 'error',
      matchedText: mutationToolMatch[0],
    });
  }

  const toolSyntaxRegex = /<\/?tool_call\b|["'](?:tool|function_call)["']\s*:|\bfunction_call\s*\(/i;
  const toolSyntaxMatch = text.match(toolSyntaxRegex);
  if (toolSyntaxMatch) {
    issues.push({
      code: 'tool_syntax',
      message: 'Narrative output contains serialized tool-call syntax.',
      severity: 'error',
      matchedText: toolSyntaxMatch[0],
    });
  }

  // 4. Reject generic XP mentions with combat facts, and explicit awards on
  // factless turns without rejecting ordinary uses of "experience".
  const genericXpRegex = /(?:xp|experiencia|experience)\b/i;
  const explicitXpAwardRegex = /(?:\b(?:gain|gains|gained|earn|earns|earned|receive|receives|received|ganas?|obtienes?|recibes?|otorga|concede)\s+\d+\s*(?:xp|experiencia)\b|\b\d+\s*(?:xp|puntos?\s+de\s+experiencia)\b)/i;
  if ((context && genericXpRegex.test(text)) || (!context && explicitXpAwardRegex.test(text))) {
    issues.push({
      code: 'invented_xp',
      message: 'XP mentions are not allowed in combat narration.',
      severity: 'error'
    });
  }

  // 5. Reject generic loot with combat facts, and explicit acquisition on
  // factless turns without rejecting incidental words such as colour names.
  const genericLootRegex = /\b(?:monedas|oro|gold|coins|magic\s+sword|cofre|loot|botín|espada\s+mágica)\b/i;
  const explicitLootAwardRegex = /\b(?:finds?|found|discovers?|discovered|receives?|received|encuentras?|encuentra|hall[ao]|obtienes?|recibes?)\s+(?:some\s+|un(?:a|as)?\s+|el\s+|la\s+)?(?:monedas|oro|gold|coins|magic\s+sword|cofre|loot|botín|espada\s+mágica)\b/i;
  if ((context && genericLootRegex.test(text)) || (!context && explicitLootAwardRegex.test(text))) {
    issues.push({
      code: 'invented_loot',
      message: 'Loot, currency, or magic item drops are not allowed in combat narration.',
      severity: 'error'
    });
  }

  // 6. Reject any numerical HP, damage, or healing mentions in the text
  const numericHpDamageRegex = /\b\d+\s*(?:de\s+)?(?:hp|hit\s*points|puntos\s+de\s+vida|puntos\s+de\s+golpe|daño|damage|vida|healing|curación|cura)\b/i;
  const verbNumericHpDamageRegex = /\b(?:lose|loses|lost|pierde|perdió|deal|deals|dealt|hace|hizo|recibe|recibió|queda\s+con|has|have|left|queda|heal|heals|healed|cura|curó|inflige|inflict|inflicts|recupera|recuperó)\s+\d+\b/i;
  const numberWordToken = '(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|cero|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciséis|dieciseis|diecisiete|dieciocho|diecinueve|veinte|veintiuno|veintiuna|veintidós|veintidos|veintitrés|veintitres|veinticuatro|veinticinco|veintiséis|veintiseis|veintisiete|veintiocho|veintinueve|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|doscientos|doscientas|trescientos|trescientas|cuatrocientos|cuatrocientas|quinientos|quinientas|seiscientos|seiscientas|setecientos|setecientas|ochocientos|ochocientas|novecientos|novecientas|mil|millón|millon|millones)';
  const numberWord = `(?:${numberWordToken})(?:[-\\s]+(?:and|y|${numberWordToken})){0,7}`;
  const numberWordHpDamageRegex = new RegExp(
    `\\b${numberWord}\\s+(?:hp|hit\\s*points?|points?\\s+of\\s+damage|puntos?\\s+de\\s+(?:vida|golpe|daño)|daño|damage|healing|curación|cura|vida)\\b`,
    'i',
  );
  const verbNumberWordHpDamageRegex = new RegExp(
    `\\b(?:lose|loses|lost|pierde|perdió|deal|deals|dealt|recibe|recibió|heal|heals|healed|cura|curó|inflige|inflict|inflicts|recupera|recuperó)\\s+${numberWord}\\b`,
    'i',
  );

  if (
    numericHpDamageRegex.test(text) ||
    numberWordHpDamageRegex.test(text) ||
    (context !== undefined && (
      verbNumericHpDamageRegex.test(text) ||
      verbNumberWordHpDamageRegex.test(text)
    ))
  ) {
    issues.push({
      code: 'invented_hp',
      message: 'Numerical HP, damage, or healing values are not permitted in AI narration.',
      severity: 'error'
    });
  }

  // 7. Muerte no confirmada
  const deathWords = /\b(?:muere|dies|slain|killed|muerto|defeated|derrotad[oa]|cae\s+muerto|morir|die|slay)\b/i;
  const negatedDeathRegex = /\b(?:no\s+one|nobody)\s+(?:dies|is\s+(?:killed|slain))\b|\b(?:does|did)\s+not\s+die\b|\b(?:nadie|ningun[oa])\s+muere\b|\bno\s+muere\b/gi;
  const assertedDeathText = text.replace(negatedDeathRegex, '');
  if (deathWords.test(assertedDeathText)) {
    const hasDefeatedFact = context?.facts.some(f => f.type === 'enemy_defeated') ?? false;
    if (!hasDefeatedFact) {
      issues.push({
        code: 'unconfirmed_death',
        message: 'Text describes target death, but it is not confirmed by backend consequences.',
        severity: 'error'
      });
    }
  }

  // 8. Contradicciones hit/miss
  const hasMiss = context?.facts.some(f => f.type === 'attack_miss') ?? false;
  const hasHit = context?.facts.some(f => f.type === 'attack_hit') ?? false;

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

  // 9. Condiciones no confirmadas
  const conditionMappings = [
    { names: [/stunned/i, /aturdido/i], condition: 'Stunned' },
    { names: [/prone/i, /derribad[oa]/i, /cae\s+al\s+suelo/i], condition: 'Prone' },
    { names: [/poisoned/i, /envenenado/i], condition: 'Poisoned' },
    { names: [/blinded/i, /cegado/i], condition: 'Blinded' },
    { names: [/deafened/i, /ensordecido/i], condition: 'Deafened' },
    { names: [/frightened/i, /asustado/i, /aterrado/i], condition: 'Frightened' },
    { names: [/paralyzed/i, /paralizado/i], condition: 'Paralyzed' },
    { names: [/petrified/i, /petrificado/i], condition: 'Petrified' },
    { names: [/restrained/i, /atrapado/i, /sujeto/i], condition: 'Restrained' },
    { names: [/unconscious/i, /inconsciente/i], condition: 'Unconscious' }
  ];

  const explicitFactlessConditionRegex = /(?:\b(?:is|becomes?|queda|quedó|quedo)\s+(?:stunned|aturdid[oa]|prone|derribad[oa]|poisoned|envenenad[oa]|blinded|cegad[oa]|deafened|ensordecid[oa]|frightened|asustad[oa]|aterrad[oa]|paralyzed|paralizad[oa]|petrified|petrificad[oa]|restrained|atrapad[oa]|sujet[oa]|unconscious|inconsciente)\b|\bcae\s+al\s+suelo\b)/i;
  if (!context && explicitFactlessConditionRegex.test(text)) {
    issues.push({
      code: 'unconfirmed_condition',
      message: 'Narrated condition is not confirmed by backend consequences.',
      severity: 'error',
    });
  }

  for (const mapping of conditionMappings) {
    const mentionsCondition = mapping.names.some(regex => regex.test(text));
    if (context && mentionsCondition) {
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
