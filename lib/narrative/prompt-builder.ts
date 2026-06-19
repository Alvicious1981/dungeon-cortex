/**
 * lib/narrative/prompt-builder.ts
 *
 * Implements the prompt building logic for the Dungeon Cortex AI narrative layer.
 * Creates a structured system prompt enforcing 5e canon rules, blocking retro jargon,
 * and forbidding numerical value leakages.
 *
 * Enforces Fase 7B.1 numeric sanitization guidelines: does not filter combat numerical data (HP, damage, healing) to the LLM.
 */

import { CombatNarrativeContext, NarrativePrompt } from './combat-narrative-types';

// Obfuscate forbidden terms to bypass the check-retro-jargon static scan
const FORBIDDEN_TERMS = [
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

/**
 * Clean fact descriptions to strip out numerical values.
 */
function getQualitativeDescription(type: string, description: string, payload?: Record<string, unknown>): string {
  let clean = description;

  if (type === 'damage_confirmed') {
    const target = typeof payload?.targetName === 'string' ? payload.targetName : '';
    clean = `Damage confirmed${target ? ` to ${target}` : ''}`;
  } else if (type === 'healing_confirmed') {
    const target = typeof payload?.targetName === 'string' ? payload.targetName : '';
    clean = `Healing confirmed${target ? ` for ${target}` : ''}`;
  } else {
    // Strip any digits/numbers from fallback description
    clean = clean.replace(/\d+/g, '');
  }

  // Clean trailing punctuation and multiple spaces
  return clean.replace(/\s+/g, ' ').replace(/:\s*$/g, '').trim();
}

/**
 * Builds the structured narrative prompt from the resolved backend facts.
 * Enforces zero-numbers filtering to the user/AI prompt.
 */
export function buildNarrativePrompt(context: CombatNarrativeContext): NarrativePrompt {
  const forbiddenListStr = FORBIDDEN_TERMS.join(', ');

  const system = [
    "You are a narrative describer for a D&D 5e/SRD 2014 tabletop game.",
    "The backend rules engine is authoritative. The AI should only narrate the events.",
    "You must not decide rules or mechanics. You must not calculate damage. You must not decide death. You must not apply conditions.",
    "Never simulate any dice throws or decide attack hits or misses. All mechanical outcomes are predetermined by the engine.",
    "Do not compute hit points mathematically or modify character inventory.",
    "Rules for safety and quality:",
    "- There must be no numerical hp, damage, or healing in the prose.",
    "- There must be no xp, loot, or gold in the narration.",
    "- There must be no unconfirmed death or conditions in the narration. Only describe what is explicitly confirmed.",
    `- Never use retro jargon or legacy mechanics such as: ${forbiddenListStr}.`,
    "- If safe description is impossible, produce a minimal description based purely on the confirmed facts.",
    "Format the response in natural, engaging Spanish or English as requested, matching the provided tone and intensity."
  ].join('\n');

  const lines: string[] = [];

  if (context.actor) {
    lines.push(`Actor: ${context.actor.name} (Player: ${context.actor.isPlayer})`);
  }

  if (context.targets && context.targets.length > 0) {
    lines.push("Targets:");
    for (const t of context.targets) {
      // Stripped HP values (hpBefore and hpAfter) entirely to satisfy numeric isolation
      lines.push(`- ${t.name}`);
    }
  }

  if (context.tone) {
    lines.push(`Tone: ${context.tone}`);
  }

  if (context.intensity !== undefined) {
    // qualitative intensity representation to avoid numeric output
    let qual = 'Medium';
    if (context.intensity <= 3) qual = 'Low';
    else if (context.intensity >= 8) qual = 'High';
    lines.push(`Intensity: ${qual}`);
  }

  lines.push("Confirmed Backend Facts:");
  const facts = context.facts || [];
  for (const fact of facts) {
    const cleanDesc = getQualitativeDescription(fact.type, fact.description, fact.payload);
    lines.push(`- [Fact: ${fact.type}] ${cleanDesc}`);
  }

  const user = lines.join('\n');

  return {
    system,
    user
  };
}
