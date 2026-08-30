import { match } from 'ts-pattern';

import { GameEvent } from '../events/game-events';
import {
  CombatNarrativeContext,
  MAX_NARRATIVE_NAME_LENGTH,
  NarrativeFact,
} from './combat-narrative-types';

function boundedNarrativeName(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, MAX_NARRATIVE_NAME_LENGTH) : '';
}

/**
 * Helper to compare two facts for exact equality.
 * Deduplication is strictly limited to identical facts (same type, description, and payload).
 */
function areFactsEqual(a: NarrativeFact, b: NarrativeFact): boolean {
  if (a.type !== b.type) return false;
  if (a.description !== b.description) return false;

  const payloadA = a.payload || {};
  const payloadB = b.payload || {};
  const targetIdA = payloadA.targetId;
  const targetIdB = payloadB.targetId;
  if (typeof targetIdA === 'string' && typeof targetIdB === 'string' && targetIdA !== targetIdB) {
    return false;
  }

  // Some companion events do not carry a target ID. Ignore the identity field
  // only for their cross-event comparison, while preserving it when both facts
  // identify different targets.
  const keysA = Object.keys(payloadA).filter(key => key !== 'targetId');
  const keysB = Object.keys(payloadB).filter(key => key !== 'targetId');

  if (keysA.length !== keysB.length) return false;

  return keysA.every(key => payloadA[key] === payloadB[key]);
}

/**
 * Deterministically adapts game events and resolved consequences from the backend
 * into a safe, 5e-compliant narrative context for description.
 *
 * Rules:
 * - D&D 5e/SRD 2014 only. No legacy terminology or mechanics.
 * - Consumes the canonical targets[] array as the sole consequence truth.
 * - Does not invent facts, rolls, or outcomes.
 * - Does not infer or calculate hpBefore.
 */
export function adaptCombatEventsToNarrativeContext(
  events: GameEvent[]
): CombatNarrativeContext {
  const facts: NarrativeFact[] = [];
  let actor: CombatNarrativeContext['actor'] = undefined;
  const targets: NonNullable<CombatNarrativeContext['targets']> = [];

  // Helper to add fact only if it is not an exact duplicate of an already added fact.
  // LIMITACIÓN DE DEDUPLICACIÓN: Debido a la falta de IDs únicos de eventos en el
  // SSE stream, la deduplicación se limita a hechos exactamente idénticos (mismo tipo,
  // descripción y payload). Múltiples ataques idénticos (mismo daño y objetivo) en la
  // misma ráfaga de eventos se unificarán. Esto evita duplicados cruzados entre
  // COMBAT_CONSEQUENCE y DAMAGE_DEALT pero puede agrupar ataques idénticos legítimos.
  const addFact = (fact: NarrativeFact) => {
    if (!facts.some(f => areFactsEqual(f, fact))) {
      facts.push(fact);
    }
  };

  for (const event of events) {
    if (event.type === 'COMBAT_CONSEQUENCE') {
      const { attackerName: rawAttackerName, targets: consequenceTargets } = event.payload;
      const attackerName = boundedNarrativeName(rawAttackerName);

      actor = {
        id: '',
        name: attackerName,
        isPlayer: true
      };

      for (const target of consequenceTargets) {
        const {
          targetName: rawTargetName,
          targetId,
          damage,
          hpAfter,
          isCrit,
          isFumble,
          isKill,
          conditionsApplied,
        } = target;
        const targetName = boundedNarrativeName(rawTargetName);
        const targetIdentity = { targetId, targetName };

        if (!targets.some(item => item.id === targetId)) {
          targets.push({
            id: targetId,
            name: targetName,
            isPlayer: false,
            hpAfter,
          });
        }

        if (damage > 0) {
          addFact({
            type: 'attack_hit',
            description: `Attack hit on ${targetName}`,
            payload: targetIdentity
          });
          addFact({
            type: 'damage_confirmed',
            description: `Damage confirmed: ${damage} to ${targetName}`,
            payload: { damageAmount: damage, ...targetIdentity }
          });
        } else {
          addFact({
            type: 'attack_miss',
            description: `Attack missed ${targetName}`,
            payload: targetIdentity
          });
        }

        if (isCrit) {
          addFact({
            type: 'critical_hit',
            description: `Critical hit on ${targetName}`,
            payload: targetIdentity
          });
        }

        if (isFumble) {
          addFact({
            type: 'critical_miss',
            description: `Critical miss targeting ${targetName}`,
            payload: targetIdentity
          });
        }

        for (const conditionName of conditionsApplied) {
          addFact({
            type: 'condition_applied',
            description: `Condition ${conditionName} applied to ${targetName}`,
            payload: { conditionName, ...targetIdentity }
          });
        }

        if (isKill) {
          addFact({
            type: 'enemy_defeated',
            description: `${targetName} was defeated`,
            payload: targetIdentity
          });
        }
      }

      continue;
    }

    match(event.type)
      .with('CRITICAL_HIT', () => {
        const payload = event.payload || {};
        const targetName = boundedNarrativeName(payload.targetName);
        addFact({
          type: 'critical_hit',
          description: `Critical hit recorded${targetName ? ` on ${targetName}` : ''}`,
          payload: { targetName }
        });
      })
      .with('CRITICAL_MISS', () => {
        const payload = event.payload || {};
        const targetName = boundedNarrativeName(payload.targetName);
        addFact({
          type: 'critical_miss',
          description: `Critical miss recorded${targetName ? ` targeting ${targetName}` : ''}`,
          payload: { targetName }
        });
      })
      .with('DAMAGE_DEALT', () => {
        const payload = event.payload || {};
        const damage = typeof payload.damage === 'number' ? payload.damage : 0;
        const targetName = boundedNarrativeName(payload.targetName);

        addFact({
          type: 'attack_hit',
          description: `Attack hit${targetName ? ` on ${targetName}` : ''}`,
          payload: { targetName }
        });
        addFact({
          type: 'damage_confirmed',
          description: `Damage confirmed: ${damage}${targetName ? ` to ${targetName}` : ''}`,
          payload: { damageAmount: damage, targetName }
        });
      })
      .with('ENEMY_DEFEATED', () => {
        const payload = event.payload || {};
        const targetName = boundedNarrativeName(payload.name);
        if (targetName) {
          addFact({
            type: 'enemy_defeated',
            description: `${targetName} was defeated`,
            payload: { targetName }
          });
        }
      })
      .with('HEALING_RECEIVED', () => {
        const payload = event.payload || {};
        const amount = typeof payload.amount === 'number' ? payload.amount : 0;
        const targetName = boundedNarrativeName(payload.targetName);
        addFact({
          type: 'healing_confirmed',
          description: `Healing received: ${amount}${targetName ? ` by ${targetName}` : ''}`,
          payload: { healingAmount: amount, targetName }
        });
      })
      .with('CONCENTRATION_BROKEN', () => {
        const payload = event.payload || {};
        const targetName = boundedNarrativeName(payload.targetName);
        addFact({
          type: 'concentration_broken',
          description: `Concentration broken${targetName ? ` for ${targetName}` : ''}`,
          payload: { targetName }
        });
      })
      .with(
        'SPELL_CAST',
        'PLAYER_DOWNED',
        'ENCOUNTER_START',
        'TURN_ADVANCE',
        'ROUND_ADVANCE',
        'LOOT_GENERATED',
        'LEVEL_UP_RESOLVED',
        'CONCENTRATION_STARTED',
        'MOVE_COMBATANT',
        'EQUIP_ITEM',
        'REST_COMPLETED',
        'EXPLORATION_WARNING',
        'PLAYER_MOVE',
        // Not a combat fact. The resolved check reaches the narrator through the
        // system game log written by the action route, in the same way trades do.
        'ABILITY_CHECK_RESOLVED',
        () => undefined
      )
      .exhaustive();
  }

  return {
    facts,
    actor,
    targets
  };
}
