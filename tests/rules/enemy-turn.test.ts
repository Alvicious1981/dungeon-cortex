import { describe, expect, it } from "vitest";
import { planEnemyTurn, type EnemyTurnInput } from "@/lib/rules/enemy-turn";
import { isIncapacitated } from "@/lib/rules/conditions";
import { toSizeCategory, type GridCombatant } from "@/lib/rules/geometry";
import type { MonsterAttackProfileV1 } from "@/lib/rules/monster-attack-profile";

const GOBLIN: MonsterAttackProfileV1 = {
  version: 1,
  walkSpeedFt: 30,
  attacks: [
    {
      name: "Scimitar", attackBonus: 4, melee: { reachFt: 5 }, ranged: null,
      damage: [{ dice: "1d6+2", type: "slashing" }],
    },
    {
      name: "Shortbow", attackBonus: 4, melee: null, ranged: { normalFt: 80, longFt: 320 },
      damage: [{ dice: "1d6+2", type: "piercing" }],
    },
  ],
  multiattack: null,
};
const BITER: MonsterAttackProfileV1 = {
  version: 1, walkSpeedFt: 30, multiattack: null,
  attacks: [{
    name: "Bite", attackBonus: 4, melee: { reachFt: 5 }, ranged: null,
    damage: [{ dice: "2d4+2", type: "piercing" }],
  }],
};
const ARCHER: MonsterAttackProfileV1 = {
  version: 1, walkSpeedFt: 30, multiattack: null,
  attacks: [{
    name: "Shortbow", attackBonus: 4, melee: null, ranged: { normalFt: 80, longFt: 320 },
    damage: [{ dice: "1d6+2", type: "piercing" }],
  }],
};
const SLINGER: MonsterAttackProfileV1 = {
  version: 1, walkSpeedFt: 30, multiattack: null,
  attacks: [{
    name: "Sling", attackBonus: 3, melee: null, ranged: { normalFt: 20, longFt: 60 },
    damage: [{ dice: "1d4+1", type: "bludgeoning" }],
  }],
};
const BEAR: MonsterAttackProfileV1 = {
  version: 1, walkSpeedFt: 40,
  attacks: [
    {
      name: "Bite", attackBonus: 5, melee: { reachFt: 5 }, ranged: null,
      damage: [{ dice: "1d8+4", type: "piercing" }],
    },
    {
      name: "Claws", attackBonus: 5, melee: { reachFt: 5 }, ranged: null,
      damage: [{ dice: "2d6+4", type: "slashing" }],
    },
  ],
  multiattack: [{ attack: "Bite", count: 1 }, { attack: "Claws", count: 1 }],
};
const LASHER: MonsterAttackProfileV1 = {
  version: 1, walkSpeedFt: 30,
  attacks: [
    {
      name: "Bite", attackBonus: 5, melee: { reachFt: 5 }, ranged: null,
      damage: [{ dice: "1d10+3", type: "piercing" }],
    },
    {
      name: "Tail", attackBonus: 5, melee: { reachFt: 15 }, ranged: null,
      damage: [{ dice: "1d8+3", type: "bludgeoning" }],
    },
  ],
  multiattack: [{ attack: "Bite", count: 1 }, { attack: "Tail", count: 1 }],
};

function medium(id: string, x: number, y: number): GridCombatant {
  return { id, x, y, size: "Medium" };
}

function input(
  profile: MonsterAttackProfileV1 | null,
  at: { x: number; y: number },
  player: GridCombatant,
  extra: GridCombatant[] = [],
  overrides: Partial<EnemyTurnInput["enemy"]> = {},
): EnemyTurnInput {
  return {
    enemy: { id: "e1", x: at.x, y: at.y, size: "Medium", hp: 7, conditions: [], profile, ...overrides },
    player,
    others: [player, ...extra],
  };
}

describe("planEnemyTurn", () => {
  it("attacks in melee without moving when already in reach", () => {
    expect(planEnemyTurn(input(GOBLIN, { x: 5, y: 6 }, medium("p", 5, 5)))).toEqual({
      move: null, mode: "melee", attacks: ["Scimitar"],
    });
  });

  it("closes to the square that moves least, then strikes", () => {
    // Adjacent squares on row 6 cost 3 moves from (5,9); ties break by y, then x.
    expect(planEnemyTurn(input(GOBLIN, { x: 5, y: 9 }, medium("p", 5, 5)))).toEqual({
      move: { x: 4, y: 6 }, mode: "melee", attacks: ["Scimitar"],
    });
  });

  it("skips an occupied square", () => {
    expect(
      planEnemyTurn(input(GOBLIN, { x: 5, y: 9 }, medium("p", 5, 5), [medium("ally", 4, 6)])),
    ).toEqual({ move: { x: 5, y: 6 }, mode: "melee", attacks: ["Scimitar"] });
  });

  it("shoots from where it stands when melee is out of reach this turn", () => {
    expect(planEnemyTurn(input(GOBLIN, { x: 5, y: 9 }, medium("p", 5, 0)))).toEqual({
      move: null, mode: "ranged", attacks: ["Shortbow"],
    });
  });

  it("only moves when nothing is usable", () => {
    expect(planEnemyTurn(input(BITER, { x: 9, y: 9 }, medium("p", 0, 0)))).toEqual({
      move: { x: 3, y: 3 }, mode: null, attacks: [],
    });
  });

  it("advances into range, then shoots", () => {
    expect(planEnemyTurn(input(SLINGER, { x: 9, y: 0 }, medium("p", 0, 0)))).toEqual({
      move: { x: 3, y: 0 }, mode: "ranged", attacks: ["Sling"],
    });
  });

  it("does nothing as a ranged-only enemy adjacent to the player (known limitation)", () => {
    expect(planEnemyTurn(input(ARCHER, { x: 5, y: 6 }, medium("p", 5, 5)))).toEqual({
      move: null, mode: null, attacks: [],
    });
  });

  it("uses a multiattack when every part is usable", () => {
    expect(planEnemyTurn(input(BEAR, { x: 5, y: 6 }, medium("p", 5, 5)))).toEqual({
      move: null, mode: "melee", attacks: ["Bite", "Claws"],
    });
  });

  it("falls back to the best usable attack when a multiattack part is out of reach", () => {
    expect(planEnemyTurn(input(LASHER, { x: 5, y: 7 }, medium("p", 5, 5)))).toEqual({
      move: null, mode: "melee", attacks: ["Tail"],
    });
  });

  it("keeps a Large footprint inside the grid and moves it least", () => {
    const plan = planEnemyTurn({
      enemy: {
        id: "e1", x: 8, y: 8, size: "Large", hp: 30, conditions: [],
        profile: { ...BITER, walkSpeedFt: 40 },
      },
      player: medium("p", 0, 0),
      others: [medium("p", 0, 0)],
    });
    expect(plan).toEqual({ move: { x: 1, y: 1 }, mode: "melee", attacks: ["Bite"] });
  });

  it.each([
    ["at 0 HP", { hp: 0 }],
    ["incapacitated", { conditions: ["Stunned"] }],
  ])("skips an enemy %s", (_label, overrides) => {
    expect(
      planEnemyTurn(input(GOBLIN, { x: 5, y: 6 }, medium("p", 5, 5), [], overrides)),
    ).toEqual({ move: null, mode: null, attacks: [] });
  });

  it("skips an enemy with no profile", () => {
    expect(planEnemyTurn(input(null, { x: 5, y: 6 }, medium("p", 5, 5)))).toEqual({
      move: null, mode: null, attacks: [],
    });
  });
});

describe("isIncapacitated", () => {
  it("reads the registry flag case-insensitively", () => {
    expect(isIncapacitated(["stunned"])).toBe(true);
    expect(isIncapacitated(["Paralyzed"])).toBe(true);
    expect(isIncapacitated(["Prone", "Poisoned"])).toBe(false);
  });
});

describe("toSizeCategory", () => {
  it("keeps a known size and degrades anything else to Medium", () => {
    expect(toSizeCategory("Large")).toBe("Large");
    expect(toSizeCategory("huge")).toBe("Medium");
    expect(toSizeCategory(undefined)).toBe("Medium");
  });
});
