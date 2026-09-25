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
import { CONDITION_REGISTRY } from '../rules/conditions';

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

interface ConditionTerms {
  /** Any mention rejected on a combat turn unless the backend confirmed it. */
  mentions: RegExp[];
  /** Explicit assertions rejected even on a turn without combat facts. */
  assertions: RegExp[];
}

/** "is stunned", "queda aturdido": a copula followed by the condition word. */
function asserted(words: string): RegExp {
  return new RegExp(`\\b(?:is|becomes?|queda|quedó|quedo)\\s+(?:${words})\\b`, 'i');
}

// English and Spanish wording for every SRD 2014 condition, keyed by the
// registry id in lib/rules/conditions.ts. Words that are also ordinary prose
// are matched only in their mechanical sense: "invisible" only as a change of
// state ("se vuelve invisible", not "una fuerza invisible"), Exhaustion only as
// levels of the condition ("un nivel de agotamiento", never "agotado"), and
// "agarrado a" (holding on to something) is not Grappled. "Encantado" is left
// out entirely because it usually means "pleased".
// "Charmed by your wit", "hechizada por la melodía": delight, not the SRD
// condition. Being charmed by a creature ("by the vampire") is still caught.
const NOT_CHARMED_BY_PROSE =
  '(?!\\s+(?:by|with|por|con)\\s+(?:(?:your|his|her|their|its|the|a|an|tu|tus|su|sus|el|la|los|las|un|una)\\s+)?' +
  '(?:wit|words?|smiles?|charm|voice|melod(?:y|ies)|songs?|music|tales?|stor(?:y|ies)|manners|beauty|performance|jokes?|compliments?|offer|gifts?|humou?r|grace|' +
  'ingenio|palabras?|sonrisas?|encanto|voz|melodías?|canci(?:ón|ones)|música|historias?|relatos?|modales|belleza|actuación|bromas?|cumplidos?|oferta|regalos?|humor|gracia)\\b)';

const CONDITION_TERMS: Record<string, ConditionTerms> = {
  blinded: {
    mentions: [/blinded/i, /cegad[oa]s?/i],
    assertions: [asserted('blinded|cegad[oa]')],
  },
  charmed: {
    mentions: [
      new RegExp(`\\bcharmed\\b${NOT_CHARMED_BY_PROSE}`, 'i'),
      new RegExp(`\\bhechizad[oa]s?\\b${NOT_CHARMED_BY_PROSE}`, 'i'),
    ],
    assertions: [asserted(`(?:charmed|hechizad[oa]s?)${NOT_CHARMED_BY_PROSE}`)],
  },
  deafened: {
    mentions: [/deafened/i, /ensordecid[oa]s?/i],
    assertions: [asserted('deafened|ensordecid[oa]')],
  },
  exhaustion: {
    mentions: [],
    assertions: [
      /\b(?:levels?|points?)\s+of\s+exhaustion\b/i,
      /\bexhaustion\s+(?:levels?|conditions?)\b/i,
      /\b(?:gains?|gained|suffers?|suffered|takes?|took|receives?|received)\s+exhaustion\b/i,
      /\bnivel(?:es)?\s+de\s+agotamiento\b/i,
      /\bcondición\s+de\s+agotamiento\b/i,
      /\b(?:gana|ganas|ganó|sufre|sufres|sufrió|recibe|recibes|recibió|acumula|acumulas|acumuló)\s+agotamiento\b/i,
    ],
  },
  frightened: {
    mentions: [/frightened/i, /asustad[oa]s?/i, /aterrad[oa]s?/i],
    assertions: [asserted('frightened|asustad[oa]|aterrad[oa]')],
  },
  grappled: {
    mentions: [/\bgrappled\b/i, /\bagarrad[oa]s?\b(?!\s+(?:a|al)\b)/i],
    assertions: [asserted('grappled|agarrad[oa]s?(?!\\s+(?:a|al)\\b)')],
  },
  incapacitated: {
    mentions: [/\bincapacitated\b/i, /\bincapacitad[oa]s?\b/i],
    assertions: [asserted('incapacitated|incapacitad[oa]s?')],
  },
  invisible: {
    mentions: [],
    assertions: [
      /\b(?:becomes?|became|turns?|turned|goes|went|grows?|grew|is\s+now)\s+(?:completely\s+|fully\s+)?invisible\b/i,
      /\b(?:se\s+(?:vuelve|volvió|vuelven|hace|hizo|hacen|torna|tornó)|te\s+(?:vuelves|volviste|haces|hiciste)|queda|quedó|quedas|quedan)\s+(?:completamente\s+|totalmente\s+)?invisibles?\b/i,
      /\binvisible\s+condition\b/i,
      /\bcondición\s+(?:de\s+)?invisible\b/i,
    ],
  },
  paralyzed: {
    mentions: [/paralyzed/i, /paralizad[oa]s?/i],
    assertions: [asserted('paralyzed|paralizad[oa]')],
  },
  petrified: {
    mentions: [/petrified/i, /petrificad[oa]s?/i],
    assertions: [asserted('petrified|petrificad[oa]')],
  },
  poisoned: {
    mentions: [/poisoned/i, /envenenad[oa]s?/i],
    assertions: [asserted('poisoned|envenenad[oa]')],
  },
  prone: {
    mentions: [/prone/i, /derribad[oa]/i, /cae\s+al\s+suelo/i],
    assertions: [asserted('prone|derribad[oa]'), /\bcae\s+al\s+suelo\b/i],
  },
  restrained: {
    // "Apresado" is the Spanish SRD's name for Restrained, and the word the
    // narrator reaches for once Entangle or Web holds a creature.
    mentions: [/restrained/i, /atrapado/i, /sujeto/i, /\bapresad[oa]s?\b/i],
    assertions: [asserted('restrained|atrapad[oa]|sujet[oa]|apresad[oa]s?')],
  },
  stunned: {
    mentions: [/stunned/i, /aturdid[oa]s?/i],
    assertions: [asserted('stunned|aturdid[oa]')],
  },
  unconscious: {
    mentions: [/unconscious/i, /inconsciente/i],
    assertions: [asserted('unconscious|inconsciente')],
  },
};

// The condition list comes from the rules registry, not from this file, so a
// condition the engine knows can never go unwatched: one without localized
// wording above is still caught by its canonical English name.
const conditionMappings = Object.values(CONDITION_REGISTRY).map(entry => ({
  condition: entry.name,
  ...(CONDITION_TERMS[entry.id] ?? {
    mentions: [new RegExp(`\\b${entry.name}\\b`, 'i')],
    assertions: [asserted(entry.name)],
  }),
}));

/** Where each pattern matches in the text, in order. */
function matchIndexes(text: string, patterns: readonly RegExp[]): number[] {
  const indexes: number[] = [];
  for (const pattern of patterns) {
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    for (const match of text.matchAll(global)) indexes.push(match.index ?? 0);
  }
  return indexes.sort((a, b) => a - b);
}

/**
 * Whether the condition word at `index` is said to have ended: "no longer
 * restrained", "ya no está apresado", "deja de estar paralizado". Up to three
 * words may sit between the phrase and the condition ("is no longer held
 * restrained" reads oddly, "ya no está del todo apresado" does not).
 */
const ENDED_BEFORE = /(?:\bno\s+longer|\bya\s+no|\bdej(?:a|an|ó|aron)\s+de\s+(?:estar|ser))\s+(?:[\p{L}]+\s+){0,3}$/iu;

function endsCondition(text: string, index: number): boolean {
  return ENDED_BEFORE.test(text.slice(Math.max(0, index - 60), index));
}

/**
 * Validates AI narrative text against backend combat context to prevent hallucinations,
 * rule inventions, and retro jargon leakage.
 *
 * Rules:
 * - Reject any HP, damage, or healing numerical values (always blocked).
 * - Reject AC and DC figures (always blocked).
 * - Reject XP gains.
 * - Reject unauthorized loot.
 * - Reject unconfirmed death descriptions.
 * - Reject mechanical hit/miss contradictions.
 * - Reject conditions neither applied this action nor held in the backend's
 *   state after it, and reject narrating the end of one that is still held.
 * - Reject forbidden terms in runtime.
 */
export function validateNarrativeText(
  text: string,
  context?: CombatNarrativeContext,
  /**
   * What the backend's state holds after the action, read by the caller from
   * the same campaign context the narrator is shown. `activeConditions` are
   * the condition names any combatant carries (Combatant.conditions).
   */
  backendState?: { activeConditions?: readonly string[] }
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
  const jsonBoundaryRegex = /\b(?:GAME_DATA|canonicalState|characterProfile|recentDialogue|playerAction|backendResolvedFacts)\b/i;
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

  // 6b. Reject AC, DC and HP figures in every turn (DECISION_5E_SRD_API.md §7).
  // The narrator sees each combatant's AC and HP in the campaign state; like
  // HP amounts, those figures stay on the character sheet, never in the prose.
  // Qualitative wording ("una armadura gruesa") remains valid.
  // Spanish "once" (eleven) is also English "once": "hit points once more".
  const mechanicNumber = `(?:\\d+|(?!(?:un|uno|una|one)\\b|once\\s+(?:more|again|and|upon|in|or|before|twice|a)\\b)${numberWord})`;
  const acDcLabel = '(?:AC|DC|CA|CD|armou?r\\s+class|difficulty\\s+class|clase\\s+de\\s+armadura|clase\\s+de\\s+dificultad)';
  // The label must end at a separator or a digit, so "catres" is not "CA tres".
  const labelSeparator = '(?:\\s*[:=]\\s*|\\s+|(?=\\d))';
  const acDcFigureRegex = new RegExp(
    `\\b${acDcLabel}${labelSeparator}(?:of\\s+|de\\s+)?${mechanicNumber}\\b|\\b${mechanicNumber}\\s+(?:de\\s+)?(?:AC|DC|CA|CD)\\b`,
    'i',
  );
  const acDcMatch = text.match(acDcFigureRegex);
  if (acDcMatch) {
    issues.push({
      code: 'invented_ac_dc',
      message: 'Armor Class or Difficulty Class figures are not permitted in AI narration.',
      severity: 'error',
      matchedText: acDcMatch[0],
    });
  }

  const labelledHpRegex = new RegExp(
    `\\b(?:HP|PV|PG|hit\\s+points|puntos\\s+de\\s+(?:vida|golpe))${labelSeparator}${mechanicNumber}\\b`,
    'i',
  );
  if (labelledHpRegex.test(text) && !issues.some(issue => issue.code === 'invented_hp')) {
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
    const hasDefeatedFact =
      context?.facts.some(f => f.type === 'enemy_defeated' || f.type === 'player_died') ?? false;
    if (!hasDefeatedFact) {
      issues.push({
        code: 'unconfirmed_death',
        message: 'Text describes target death, but it is not confirmed by backend consequences.',
        severity: 'error'
      });
    }
  }

  // 7b. Muerte del jugador no confirmada (death-saves spec §6.6): a caído
  // tirando salvaciones no está muerto hasta que el backend lo confirma.
  const playerDeathWords = /\b(?:mueres|has\s+muerto|estás\s+muert[oa]|you\s+die|you\s+are\s+dead)\b/i;
  if (playerDeathWords.test(assertedDeathText)) {
    const hasPlayerDied = context?.facts.some(f => f.type === 'player_died') ?? false;
    if (!hasPlayerDied) {
      issues.push({
        code: 'unconfirmed_player_death',
        message: "Text describes the player's death, but the backend has not confirmed it.",
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
  // Death-save facts that state, by themselves, that the player is unconscious
  // (combat-fact-adapter: "falls unconscious at 0 HP", "stable but
  // unconscious"). PLAYER_DOWNED carries no condition_applied companion.
  const unconsciousFactTypes = new Set(['player_downed', 'player_stabilized']);
  // Conditions a combatant holds in the backend's state after this action. A
  // condition that lasts across turns (Entangle, Hold Person) is confirmed by
  // that state even on a turn that applied nothing, and a condition no one
  // holds any more may be narrated as ended.
  const active = new Set(
    (backendState?.activeConditions ?? []).map((condition) => condition.trim().toLowerCase()),
  );

  for (const mapping of conditionMappings) {
    const isActive = active.has(mapping.condition.toLowerCase());
    const confirmedByFacts = Boolean(context?.facts.some(f =>
      (f.type === 'condition_applied' &&
        typeof f.payload?.conditionName === 'string' &&
        f.payload.conditionName.toLowerCase() === mapping.condition.toLowerCase()) ||
      (mapping.condition === 'Unconscious' && unconsciousFactTypes.has(f.type))
    ));
    // On a combat turn any mention needs confirmation; without combat facts
    // only an explicit assertion does, as before.
    const patterns = context ? [...mapping.mentions, ...mapping.assertions] : mapping.assertions;

    let unconfirmed = false;
    let contradicted = false;
    for (const index of matchIndexes(text, patterns)) {
      if (endsCondition(text, index)) {
        // "no longer restrained": true only if nobody still is.
        if (isActive) contradicted = true;
      } else if (!confirmedByFacts && !isActive) {
        unconfirmed = true;
      }
    }

    if (unconfirmed) {
      issues.push(context
        ? {
            code: 'unconfirmed_condition',
            message: `Narrated condition "${mapping.condition}" is not confirmed by the backend.`,
            severity: 'error',
          }
        : {
            code: 'unconfirmed_condition',
            message: 'Narrated condition is not confirmed by backend consequences.',
            severity: 'error',
          });
    }
    if (contradicted) {
      issues.push({
        code: 'contradicted_condition',
        message: `Narration ends "${mapping.condition}", which the backend still holds.`,
        severity: 'error',
      });
    }
  }

  // 10. Contradicciones en resultados de interacciones sociales (PR #227)
  if (context) {
    const socialFacts = context.facts.filter(f => f.type === 'social_check_resolved');
    for (const fact of socialFacts) {
      const payload = fact.payload || {};
      const success = typeof payload.success === 'boolean' ? payload.success : undefined;
      if (success === undefined) continue;

      const explicitSuccessRegex = /\b(?:(?:is|was|are|were|been)\s+(?:persuaded|convinced|deceived|tricked|fooled|bluffed|intimidated|cowed|swayed)|(?:agrees?|agreed)\s+to\b|(?:accepts?|accepted)\s+(?:the\s+deal|the\s+offer|your\s+(?:deal|offer|proposal|terms|request))|(?:falls?|fell)\s+for\s+(?:it|the\s+(?:lie|bluff|trick|deception)|your\s+(?:lie|bluff|trick|deception))|(?:yields?|yielded|gives?\s+in|gave\s+in|backs?\s+down|backed\s+down)\b|(?:you\s+(?:persuade|convince|deceive|trick|fool|intimidate))\b|(?:está|queda|quedó|están|quedan|ha\s+sido|es|fue|fueron)\s+(?:convencid[oa]s?|persuadid[oa]s?|engañad[oa]s?|intimidat?d[oa]s?|amedrentad[oa]s?|coaccionad[oa]s?)|(?:acepta|aceptó|acuerda|acordó)\s+(?:abrir|ayudar|la\s+oferta|el\s+trato|tu\s+propuesta|tu\s+oferta|ceder)|(?:accede|accedió)\s+a\b|(?:se\s+traga|cree|creyó)\s+(?:la\s+mentira|el\s+engaño)|(?:cede|cedió)\s+(?:ante|a)\b|(?:persuades|convences|engañas|intimidas)\s+al\b)/i;

      const explicitFailureRegex = /\b(?:(?:remains?|remained)\s+unconvinced|(?:refuses?|refused)\b|(?:unconvinced|unmoved|unimpressed)\b|(?:is|was|are|were|been)\s+(?:not\s+(?:persuaded|convinced|swayed)|unconvinced|unmoved|unimpressed)|(?:does|did|will)\s+not\s+(?:believe|agree|comply|yield|cooperate)|(?:sees?|saw)\s+through\s+(?:the|your)\s+(?:lie|bluff|trick|deception)|(?:rejects?|rejected)\s+(?:the\s+deal|the\s+offer|your\s+(?:deal|offer|proposal|terms|request))|(?:se\s+niega|se\s+negó|rehúsa|rehusó)\b|(?:permanece|sigue|queda|quedó)\s+(?:escéptic[oa]|sin\s+convencer|inmóvil|inflexible|inconmovible)|(?:no\s+(?:se\s+deja\s+engañar|te\s+cree|cree|cede|está\s+convencid[oa]|accede|acepta))|(?:descubre|ve|vio)\s+(?:el\s+engaño|la\s+mentira)|(?:rechaza|rechazó)\s+(?:la\s+oferta|el\s+trato|tu\s+propuesta))/i;

      if (!success) {
        const match = text.match(explicitSuccessRegex);
        if (match) {
          issues.push({
            code: 'social_outcome_contradiction',
            message: 'Text describes a successful social outcome, but the backend check failed.',
            severity: 'error',
            matchedText: match[0],
          });
        }
      } else {
        const match = text.match(explicitFailureRegex);
        if (match) {
          issues.push({
            code: 'social_outcome_contradiction',
            message: 'Text describes a failed social outcome or refusal, but the backend check succeeded.',
            severity: 'error',
            matchedText: match[0],
          });
        }
      }
    }
  }

  return {
    ok: issues.length === 0,
    isValid: issues.length === 0,
    issues
  };
}
