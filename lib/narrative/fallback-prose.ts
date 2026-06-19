import { CombatNarrativeContext } from './combat-narrative-types';

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
  context: CombatNarrativeContext
): string {
  const parts: string[] = [];
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

  // 3. Standard Hit Description
  if (hasHit && !hasCritHit) {
    parts.push('El golpe alcanza a su objetivo y lo obliga a retroceder.');
  }

  // 4. Standard Miss Description (Avoids terms like 'corta' which can imply hits in Spanish)
  if (hasMiss && !hasCritMiss) {
    parts.push('El ataque es esquivado y se desvía sin encontrar resistencia.');
  }

  // 5. Healing Description
  if (hasHealing) {
    parts.push('Una oleada de energía restauradora infunde vigor.');
  }

  // 6. Conditions Applied
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

  // 7. Concentration Broken
  if (hasConcBroken) {
    parts.push('La concentración del conjurador se rompe.');
  }

  // 8. Enemy Defeated
  if (hasDefeated) {
    parts.push('La criatura cae derrotada.');
  }

  // 9. Default Neutre Statement
  if (parts.length === 0) {
    parts.push('La acción se resuelve y el combate continúa.');
  }

  return parts.join(' ');
}
