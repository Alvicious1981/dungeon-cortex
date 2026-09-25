import { describe, expect, it } from "vitest";
import { validateNarrativeText } from "@/lib/narrative/narrative-validator";
import type { CombatNarrativeContext } from "@/lib/narrative/combat-narrative-types";

/**
 * A condition that lasts several turns (Entangle, Hold Person) is applied on
 * one turn and confirmed by the backend's state on every turn after it. The
 * validator used to accept a condition only from a `condition_applied` fact
 * of the same action, so any later mention of it — "the goblin, still
 * restrained" — was rejected and replaced by fallback prose.
 */
const COMBAT_TURN: CombatNarrativeContext = {
  facts: [{ type: "attack_miss", description: "Attack missed Goblin", payload: { targetName: "Goblin" } }],
};

const codes = (result: ReturnType<typeof validateNarrativeText>) => result.issues.map((i) => i.code);

describe("a condition the backend still holds", () => {
  it("may be narrated on a turn that applied nothing", () => {
    const result = validateNarrativeText(
      "The goblin, still restrained by the vines, swings wide.",
      COMBAT_TURN,
      { activeConditions: ["restrained"] },
    );
    expect(result.ok).toBe(true);
  });

  it("is matched in Spanish too", () => {
    const result = validateNarrativeText(
      "El goblin sigue apresado por las raíces.",
      COMBAT_TURN,
      { activeConditions: ["restrained"] },
    );
    expect(result.ok).toBe(true);
  });

  it("confirms an explicit assertion on a turn without combat facts", () => {
    const result = validateNarrativeText("The bandit is paralyzed where he stands.", undefined, {
      activeConditions: ["paralyzed"],
    });
    expect(result.ok).toBe(true);
  });

  it("confirms only the condition that is held, not any other", () => {
    const result = validateNarrativeText(
      "The goblin is restrained by the vines.",
      COMBAT_TURN,
      { activeConditions: ["paralyzed"] },
    );
    expect(codes(result)).toContain("unconfirmed_condition");
  });
});

describe("a condition nobody holds", () => {
  it("is still rejected when narrated as present", () => {
    const result = validateNarrativeText("The goblin is restrained by the vines.", COMBAT_TURN, {
      activeConditions: [],
    });
    expect(codes(result)).toContain("unconfirmed_condition");
  });

  it("is still rejected without backend state at all", () => {
    const result = validateNarrativeText("The goblin is restrained by the vines.", COMBAT_TURN);
    expect(codes(result)).toContain("unconfirmed_condition");
  });

  it.each([
    "The goblin is no longer restrained and lunges forward.",
    "El goblin ya no está apresado y se abalanza.",
    "La hechicera deja de estar paralizada.",
  ])("may be narrated as ended: %s", (text) => {
    const result = validateNarrativeText(text, COMBAT_TURN, { activeConditions: [] });
    expect(result.ok).toBe(true);
  });
});

describe("narrating the end of a condition the backend still holds", () => {
  it.each([
    ["The goblin is no longer restrained.", "restrained"],
    ["El goblin ya no está apresado.", "restrained"],
    ["The bandit is no longer paralyzed.", "paralyzed"],
  ])("is rejected: %s", (text, condition) => {
    const result = validateNarrativeText(text, COMBAT_TURN, { activeConditions: [condition] });
    expect(codes(result)).toContain("contradicted_condition");
  });
});

describe("a condition applied this action", () => {
  it("is confirmed by its fact whatever the state says", () => {
    const result = validateNarrativeText(
      "Vines burst from the ground and the goblin is restrained.",
      {
        facts: [{
          type: "condition_applied",
          description: "Condition restrained applied to Goblin",
          payload: { conditionName: "restrained", targetName: "Goblin" },
        }],
      },
      { activeConditions: [] },
    );
    expect(result.ok).toBe(true);
  });
});

describe("the Spanish SRD's word for Restrained", () => {
  it("is recognised, so an unconfirmed \"apresado\" is caught", () => {
    const result = validateNarrativeText("El goblin queda apresado entre las raíces.", COMBAT_TURN, {
      activeConditions: [],
    });
    expect(codes(result)).toContain("unconfirmed_condition");
  });
});
