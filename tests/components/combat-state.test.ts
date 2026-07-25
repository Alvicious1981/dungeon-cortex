import { describe, expect, it } from "vitest";
import { applyCombatTargetsToCombatants } from "@/components/combat/combat-state";
import type { SingleTargetConsequence } from "@/lib/events/game-events";

function target(
  targetId: string,
  hpAfter: number,
  conditionsApplied: string[]
): SingleTargetConsequence {
  return {
    targetId,
    targetName: targetId,
    damage: 4,
    naturalRoll: 14,
    isCrit: false,
    isFumble: false,
    hitLocation: "chest",
    narrativeTags: [],
    hpAfter,
    targetMaxHp: 10,
    isKill: hpAfter === 0,
    conditionsApplied,
  };
}

describe("applyCombatTargetsToCombatants", () => {
  it("applies every canonical target update before the server refresh", () => {
    const combatants = [
      { id: "goblin-a", name: "Goblin A", hp: 10, maxHp: 10, initiativeTotal: 12, conditions: [] },
      { id: "goblin-b", name: "Goblin B", hp: 10, maxHp: 10, initiativeTotal: 10, conditions: ["prone"] },
      { id: "hero", name: "Hero", hp: 20, maxHp: 20, initiativeTotal: 15, conditions: [] },
    ];

    const result = applyCombatTargetsToCombatants(combatants, [
      target("goblin-a", 6, ["poisoned"]),
      target("goblin-b", 0, ["prone", "stunned"]),
    ]);

    expect(result).toEqual([
      { ...combatants[0], hp: 6, conditions: ["poisoned"] },
      { ...combatants[1], hp: 0, conditions: ["prone", "stunned"] },
      combatants[2],
    ]);
  });
});
