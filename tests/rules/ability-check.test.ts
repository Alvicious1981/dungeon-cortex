import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DIFFICULTY_DC,
  SKILLS,
  SKILL_ABILITY,
  computeAbilityCheckDC,
  resolveAbilityCheck,
  type AbilityCheckActor,
} from "@/lib/rules/ability-check";

/** Math.random → r yields floor(r * 20) + 1 on a d20. */
const d20 = (natural: number) => (natural - 1) / 20 + 0.001;

const HERO: AbilityCheckActor = {
  // STR 16 → +3, DEX 10 → +0, CHA 8 → -1
  stats: { STR: 16, DEX: 10, CHA: 8 },
  level: 5, // proficiency bonus +3
  skillProficiencies: ["Athletics"],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SRD skill vocabulary", () => {
  it("covers the eighteen SRD skills", () => {
    expect(SKILLS).toHaveLength(18);
  });

  it("keys every skill off a valid ability", () => {
    for (const skill of SKILLS) {
      expect(["STR", "DEX", "CON", "INT", "WIS", "CHA"]).toContain(SKILL_ABILITY[skill]);
    }
  });
});

describe("difficulty bands", () => {
  it("maps the DMG difficulty table", () => {
    expect(DIFFICULTY_DC).toEqual({
      very_easy: 5,
      easy: 10,
      medium: 15,
      hard: 20,
      very_hard: 25,
      nearly_impossible: 30,
    });
  });

  it("falls back to medium for an absent band instead of throwing", () => {
    expect(computeAbilityCheckDC()).toBe(15);
  });

  it("falls back to medium for a band outside the table", () => {
    expect(computeAbilityCheckDC("impossible" as never)).toBe(15);
  });
});

describe("resolveAbilityCheck", () => {
  it("adds the ability modifier and proficiency for a proficient skill", () => {
    vi.spyOn(Math, "random").mockReturnValue(d20(10));

    const result = resolveAbilityCheck({ skill: "Athletics", band: "medium" }, HERO);

    expect(result.ability).toBe("STR");
    expect(result.roll).toBe(10);
    expect(result.abilityModifier).toBe(3);
    expect(result.proficiencyApplied).toBe(3); // level 5
    expect(result.total).toBe(16);
    expect(result.dc).toBe(15);
    expect(result.success).toBe(true);
  });

  it("omits proficiency for a skill the character is not proficient in", () => {
    vi.spyOn(Math, "random").mockReturnValue(d20(10));

    const result = resolveAbilityCheck({ skill: "Stealth", band: "medium" }, HERO);

    expect(result.ability).toBe("DEX");
    expect(result.abilityModifier).toBe(0);
    expect(result.proficiencyApplied).toBe(0);
    expect(result.total).toBe(10);
    expect(result.success).toBe(false);
  });

  it("never applies proficiency to a raw ability check", () => {
    vi.spyOn(Math, "random").mockReturnValue(d20(10));

    const result = resolveAbilityCheck({ ability: "STR", band: "easy" }, HERO);

    expect(result.skill).toBeNull();
    expect(result.proficiencyApplied).toBe(0);
    expect(result.total).toBe(13);
    expect(result.dc).toBe(10);
  });

  it("treats a missing ability score as 10", () => {
    vi.spyOn(Math, "random").mockReturnValue(d20(10));

    const result = resolveAbilityCheck({ ability: "INT" }, HERO);

    expect(result.abilityModifier).toBe(0);
    expect(result.total).toBe(10);
  });

  it("succeeds on a natural 20 even when the total misses the DC", () => {
    vi.spyOn(Math, "random").mockReturnValue(d20(20));

    const result = resolveAbilityCheck(
      { skill: "Persuasion", band: "nearly_impossible" },
      HERO
    );

    expect(result.roll).toBe(20);
    expect(result.dc).toBe(30);
    expect(result.total).toBe(19); // 20 + CHA -1, no proficiency
    expect(result.isCriticalSuccess).toBe(true);
    expect(result.success).toBe(true);
  });

  it("fails on a natural 1 even when the total clears the DC", () => {
    vi.spyOn(Math, "random").mockReturnValue(d20(1));

    const result = resolveAbilityCheck({ skill: "Athletics", band: "very_easy" }, HERO);

    expect(result.roll).toBe(1);
    expect(result.total).toBe(7); // 1 + 3 + 3, clears DC 5
    expect(result.isCriticalFailure).toBe(true);
    expect(result.success).toBe(false);
  });

  it("reports the roll mode and cancels advantage against disadvantage", () => {
    vi.spyOn(Math, "random").mockReturnValue(d20(12));

    expect(
      resolveAbilityCheck({ skill: "Athletics", advantage: true }, HERO).rollMode
    ).toBe("advantage");
    expect(
      resolveAbilityCheck({ skill: "Athletics", disadvantage: true }, HERO).rollMode
    ).toBe("disadvantage");
    expect(
      resolveAbilityCheck(
        { skill: "Athletics", advantage: true, disadvantage: true },
        HERO
      ).rollMode
    ).toBe("normal");
  });

  it("defaults to a medium DC when no band is proposed", () => {
    vi.spyOn(Math, "random").mockReturnValue(d20(10));

    expect(resolveAbilityCheck({ skill: "Athletics" }, HERO).band).toBe("medium");
    expect(resolveAbilityCheck({ skill: "Athletics" }, HERO).dc).toBe(15);
  });

  it("cannot be handed a raw DC: difficulty only enters through the band table", () => {
    vi.spyOn(Math, "random").mockReturnValue(d20(10));

    const smuggled = { skill: "Athletics", band: "medium", dc: 2 } as never;
    expect(resolveAbilityCheck(smuggled, HERO).dc).toBe(15);
  });
});
