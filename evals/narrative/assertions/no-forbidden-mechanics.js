const forbiddenTerms = [
  ['THA', 'C0'],
  ['AD', '&', 'D'],
  ['O', 'S', 'R'],
  ['AC', ' descendente'],
  ['descending', ' AC'],
  ['saving', ' throw', ' vs'],
  ['save', ' vs', ' death'],
  ['save', ' vs', ' wands'],
  ['XP', ' por', ' oro'],
  ['gold', ' for', ' XP'],
  ['morale', ' check'],
  ['O', 'S', 'R', ' morale'],
  ['tirada', ' de', ' moral'],
  ['chequeo', ' de', ' moral'],
  ['moral', ' O', 'S', 'R'],
].map((parts) => parts.join(''));

function wordPattern(term) {
  const escaped = term.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&').replace(/\s+/g, '\\s+');
  const start = /^[A-Za-z0-9]/.test(term) ? '\\b' : '';
  const end = /[A-Za-z0-9]$/.test(term) ? '\\b' : '';
  return new RegExp(`${start}${escaped}${end}`, 'i');
}

const forbiddenPatterns = forbiddenTerms.map((term) => ({
  term,
  regex: wordPattern(term),
}));

const checks = [
  {
    code: 'invented_hp',
    regex: /\b\d+\s*(?:de\s+)?(?:hp|hit\s*points|puntos\s+de\s+vida|puntos\s+de\s+golpe|dano|damage|vida|healing|curacion|cura)\b/i,
    reason: 'Numeric HP, damage, or healing values are not allowed.',
  },
  {
    code: 'invented_hp',
    regex: /\b(?:lose|loses|lost|pierde|perdio|deal|deals|dealt|hace|hizo|recibe|recibio|queda\s+con|has|have|left|queda|heal|heals|healed|cura|curo|inflige|inflict|inflicts|recupera|recupero)\s+\d+\b/i,
    reason: 'Numeric HP, damage, or healing verbs are not allowed.',
  },
  {
    code: 'invented_xp',
    regex: /\b(?:xp|experiencia|experience)\b/i,
    reason: 'XP must not be invented in narration.',
  },
  {
    code: 'invented_loot',
    regex: /\b(?:monedas?|oro|gold|coins?|loot|botin|cofre|chest|drops?|deja|encuentras?|finds?|magic\s+sword|espada\s+magica)\b/i,
    reason: 'Loot, currency, or magic item drops must not be invented in narration.',
  },
  {
    code: 'unconfirmed_condition',
    regex: /\b(?:stunned|aturdido|prone|derribado|poisoned|envenenado|blinded|cegado|deafened|ensordecido|frightened|asustado|paralyzed|paralizado|petrified|petrificado|restrained|atrapado|unconscious|inconsciente)\b/i,
    reason: 'Conditions must not be narrated unless confirmed by a backend fact.',
  },
];

function getText(output) {
  if (typeof output === 'string') {
    return output;
  }
  if (output == null) {
    return '';
  }
  return JSON.stringify(output);
}

function getVars(context) {
  if (context && context.vars) {
    return context.vars;
  }
  if (context && context.test && context.test.vars) {
    return context.test.vars;
  }
  return {};
}

function evaluate(output, context) {
  const text = getText(output);
  const vars = getVars(context);
  const failures = [];

  for (const { term, regex } of forbiddenPatterns) {
    if (regex.test(text)) {
      failures.push(`forbidden_term:${term}`);
    }
  }

  for (const check of checks) {
    if (check.regex.test(text)) {
      failures.push(`${check.code}:${check.reason}`);
    }
  }

  const deathRegex = /\b(?:muere|dies|slain|killed|muerto|defeated|derrotad[oa]|cae\s+muerto|morir|die|slay)\b/i;
  if (deathRegex.test(text) && vars.allowDeath !== true) {
    failures.push('unconfirmed_death: Death or defeat requires vars.allowDeath === true.');
  }

  const expectBlocked = vars.expectBlocked === true;
  const pass = expectBlocked ? failures.length > 0 : failures.length === 0;

  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? (expectBlocked ? `Blocked as expected: ${failures.join('; ')}` : 'Narrative output stayed within local safety bounds.')
      : (expectBlocked ? 'Expected output to be blocked, but it passed.' : failures.join('; ')),
  };
}

module.exports = evaluate;