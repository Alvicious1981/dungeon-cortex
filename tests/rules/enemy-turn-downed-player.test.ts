import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planEnemyTurn } from "@/lib/rules/enemy-turn";
import { toSizeCategory } from "@/lib/rules/geometry";
import { profileMonster } from "@/lib/rules/monster-attack-profile";

const GOBLIN = (
  JSON.parse(readFileSync(join(process.cwd(), "data", "srd-es", "monsters.json"), "utf8")) as Array<
    Record<string, unknown>
  >
).find((m) => m.index === "goblin")!;

function input(playerDowned: boolean | undefined, goblinAt = { x: 5, y: 6 }) {
  return {
    enemy: {
      id: "g1", ...goblinAt, size: toSizeCategory("Small"),
      hp: 7, conditions: [], profile: profileMonster(GOBLIN),
    },
    player: { id: "p1", x: 5, y: 5, size: toSizeCategory("Medium") },
    others: [{ id: "p1", x: 5, y: 5, size: toSizeCategory("Medium") }],
    ...(playerDowned === undefined ? {} : { playerDowned }),
  };
}

describe("planEnemyTurn against a downed player (death-saves spec §5)", () => {
  it("holds an adjacent enemy that would otherwise strike", () => {
    expect(planEnemyTurn(input(false)).attacks).not.toHaveLength(0);
    expect(planEnemyTurn(input(true))).toEqual({ move: null, mode: null, attacks: [], areaSaveAttack: null });
  });

  it("holds a distant enemy that would otherwise close", () => {
    expect(planEnemyTurn(input(false, { x: 5, y: 9 })).move).not.toBeNull();
    expect(planEnemyTurn(input(true, { x: 5, y: 9 }))).toEqual({ move: null, mode: null, attacks: [], areaSaveAttack: null });
  });

  it("keeps today's behaviour when the flag is absent", () => {
    expect(planEnemyTurn(input(undefined))).toEqual(planEnemyTurn(input(false)));
  });
});
