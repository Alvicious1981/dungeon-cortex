import { CombatFacts, CombatNarrativeContext, NarrativeFact } from './combat-narrative-types';

function isCombatFacts(input: CombatNarrativeContext | CombatFacts): input is CombatFacts {
  return !('facts' in input);
}

function normalizeFallbackInput(input: CombatNarrativeContext | CombatFacts): CombatNarrativeContext {
  if (!isCombatFacts(input)) {
    return input;
  }

  const facts: NarrativeFact[] = [];

  if (input.damage > 0) {
    facts.push({ type: 'attack_hit', description: 'Attack hit', payload: { targetName: input.defenderName } });
    facts.push({
      type: 'damage_confirmed',
      description: 'Damage confirmed',
      payload: { damageAmount: input.damage, targetName: input.defenderName }
    });
  } else {
    facts.push({ type: 'attack_miss', description: 'Attack miss', payload: { targetName: input.defenderName } });
  }

  if (input.isCrit) {
    facts.push({ type: 'critical_hit', description: 'Critical hit', payload: { targetName: input.defenderName } });
  }

  if (input.isFumble) {
    facts.push({ type: 'critical_miss', description: 'Critical miss', payload: { targetName: input.defenderName } });
  }

  if (input.isKill) {
    facts.push({ type: 'enemy_defeated', description: 'Enemy defeated', payload: { targetName: input.defenderName } });
  }

  for (const conditionName of input.conditionsApplied) {
    facts.push({
      type: 'condition_applied',
      description: 'Condition applied',
      payload: { conditionName, targetName: input.defenderName }
    });
  }

  return {
    facts,
    actor: { id: '', name: input.attackerName, isPlayer: true },
    targets: [{ id: '', name: input.defenderName, isPlayer: false, hpAfter: input.hpAfter, hpBefore: input.hpBefore }]
  };
}

/**
 * Deterministically generates safe, qualitative fallback descriptions in Spanish
 * when the AI narration fails or is rejected.
 *
 * Rules:
 * - D&D 5e/SRD 2014 compliant.
 * - No numbers (HP, damage, healing) are allowed.
 * - Only describes confirmed mechanical facts from context.
 * - No retro jargon or forbidden terms.
 */
export function generateFallbackProse(
  input: CombatNarrativeContext | CombatFacts
): string {
  const parts: string[] = [];
  const context = normalizeFallbackInput(input);
  const facts = context.facts || [];

  const hasCritHit = facts.some(f => f.type === 'critical_hit');
  const hasCritMiss = facts.some(f => f.type === 'critical_miss');
  const hasHit = facts.some(f => f.type === 'attack_hit');
  const hasMiss = facts.some(f => f.type === 'attack_miss');
  const hasDefeated = facts.some(f => f.type === 'enemy_defeated');
  const hasHealing = facts.some(f => f.type === 'healing_confirmed');
  const hasConcBroken = facts.some(f => f.type === 'concentration_broken');

  // 1. Critical Hit Descriptor
  if (hasCritHit) {
    parts.push('¡Un impacto crítico!');
  }

  // 2. Critical Miss Descriptor
  if (hasCritMiss) {
    parts.push('¡Una pifia! El ataque resulta en un fallo torpe.');
  }

  // 3. Mixed Outcome Description
  if (hasHit && hasMiss) {
    parts.push('La ofensiva obtiene resultados dispares entre los objetivos.');
  }

  // 4. Standard Hit Description
  if (hasHit && !hasMiss && !hasCritHit) {
    parts.push('El golpe alcanza a su objetivo y lo obliga a retroceder.');
  }

  // 5. Standard Miss Description (Avoids terms like 'corta' which can imply hits in Spanish)
  if (hasMiss && !hasHit && !hasCritMiss) {
    parts.push('El ataque es esquivado y se desvía sin encontrar resistencia.');
  }

  // 6. Healing Description
  if (hasHealing) {
    parts.push('Una oleada de energía restauradora infunde vigor.');
  }

  // 7. Conditions Applied
  const conditionAppliedFacts = facts.filter(f => f.type === 'condition_applied');
  for (const fact of conditionAppliedFacts) {
    const condName = typeof fact.payload?.conditionName === 'string' ? fact.payload.conditionName : '';
    const targetName = typeof fact.payload?.targetName === 'string' ? fact.payload.targetName : 'El objetivo';
    if (condName) {
      const normalized = condName.toLowerCase();
      if (normalized === 'prone') {
        parts.push(`${targetName} cae al suelo.`);
      } else if (normalized === 'stunned') {
        parts.push(`${targetName} queda aturdido.`);
      } else if (normalized === 'poisoned') {
        parts.push(`${targetName} queda envenenado.`);
      } else {
        parts.push(`${targetName} queda bajo el estado de ${condName}.`);
      }
    }
  }

  // 8. Concentration Broken
  if (hasConcBroken) {
    parts.push('La concentración del conjurador se rompe.');
  }

  // 9. Enemy Defeated
  if (hasDefeated) {
    parts.push('La criatura cae derrotada.');
  }

  // 10. Default neutral statement
  if (parts.length === 0) {
    parts.push('La escena continúa.');
  }

  return parts.join(' ');
}
