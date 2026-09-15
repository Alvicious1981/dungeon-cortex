import { describe, expect, it } from "vitest";
import { adaptCombatEventsToNarrativeContext } from "@/lib/narrative/combat-fact-adapter";
import { validateNarrativeText } from "@/lib/narrative/narrative-validator";

describe("death-save narration (death-saves spec §6.6)", () => {
  it("turns each death event into a fact", () => {
    const { facts } = adaptCombatEventsToNarrativeContext([
      { type: "PLAYER_DOWNED", payload: {} },
      { type: "DEATH_SAVE_ROLLED", payload: { natural: 14, successes: 1, failures: 0, outcome: "dying" } },
      { type: "PLAYER_STABILIZED", payload: {} },
      { type: "PLAYER_REVIVED", payload: { hp: 1 } },
      { type: "PLAYER_WOKE", payload: { hp: 1 } },
      { type: "PLAYER_DIED", payload: { cause: "death_saves" } },
    ]);
    expect(facts.map((f) => f.type)).toEqual([
      "player_downed",
      "death_save_rolled",
      "player_stabilized",
      "player_revived",
      "player_woke",
      "player_died",
    ]);
  });

  it("refuses prose that kills the player without the fact", () => {
    const { issues } = validateNarrativeText("Caes al suelo y mueres.", { facts: [] } as never);
    expect(issues.map((i) => i.code)).toContain("unconfirmed_player_death");
  });

  it("accepts the player's death when the backend confirms it", () => {
    const { issues } = validateNarrativeText("Caes al suelo y mueres.", {
      facts: [{ type: "player_died", description: "", payload: {} }],
    } as never);
    expect(issues.map((i) => i.code)).not.toContain("unconfirmed_player_death");
    expect(issues.map((i) => i.code)).not.toContain("unconfirmed_death");
  });
});
