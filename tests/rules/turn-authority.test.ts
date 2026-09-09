import { describe, expect, it } from "vitest";

import { resolveEncounterTurnAuthority } from "@/lib/rules/turn-authority";

const combatants = [
  { id: "player", isPlayer: true },
  { id: "enemy", isPlayer: false },
];

describe("resolveEncounterTurnAuthority", () => {
  it("identifies the player as the active combatant from the persisted order", () => {
    expect(
      resolveEncounterTurnAuthority({
        id: "encounter",
        currentTurnIndex: 0,
        combatants,
      }),
    ).toMatchObject({
      ok: true,
      activeCombatant: combatants[0],
      playerCombatant: combatants[0],
      playerOwnsTurn: true,
    });
  });

  it("identifies an enemy-owned initiative slot", () => {
    expect(
      resolveEncounterTurnAuthority({
        id: "encounter",
        currentTurnIndex: 1,
        combatants,
      }),
    ).toMatchObject({
      ok: true,
      activeCombatant: combatants[1],
      playerOwnsTurn: false,
    });
  });

  it.each([-1, 2, 0.5])("rejects invalid turn index %s", (currentTurnIndex) => {
    expect(
      resolveEncounterTurnAuthority({
        id: "encounter",
        currentTurnIndex,
        combatants,
      }),
    ).toEqual({ ok: false, code: "INVALID_TURN_INDEX" });
  });

  it.each([
    [[{ id: "enemy-a", isPlayer: false }]],
    [[
      { id: "player-a", isPlayer: true },
      { id: "player-b", isPlayer: true },
    ]],
  ])("rejects an encounter without exactly one player combatant", (invalidCombatants) => {
    expect(
      resolveEncounterTurnAuthority({
        id: "encounter",
        currentTurnIndex: 0,
        combatants: invalidCombatants,
      }),
    ).toEqual({ ok: false, code: "INVALID_PLAYER_COMBATANT" });
  });
});
