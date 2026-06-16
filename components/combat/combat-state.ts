import type { SingleTargetConsequence } from "@/lib/events/game-events";
import type { CombatHUDProps } from "./CombatHUD";

type Combatant = CombatHUDProps["combatants"][number];

export function applyCombatTargetsToCombatants(
  combatants: Combatant[],
  targets: SingleTargetConsequence[]
): Combatant[] {
  if (targets.length === 0) return combatants;

  const targetById = new Map(targets.map((target) => [target.targetId, target]));

  return combatants.map((combatant) => {
    const target = targetById.get(combatant.id);
    if (!target) return combatant;

    return {
      ...combatant,
      hp: target.hpAfter,
      maxHp: target.targetMaxHp,
      conditions: Array.from(new Set([...combatant.conditions, ...target.conditionsApplied])),
    };
  });
}
