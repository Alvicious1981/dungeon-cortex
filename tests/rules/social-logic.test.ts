/**
 * tests/rules/social-logic.test.ts
 *
 * 100% branch coverage for Social Interaction Engine (Milestone N Slice 2).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateNPCPersonality,
  initialAttitudeFor,
  INITIAL_DISPOSITION,
  resolveSocialCheck,
  getRumorsPayload,
  getDispositionBand,
  attitudeFor,
  shiftDisposition,
  ATTITUDE_SHIFT
} from "@/lib/rules/social-logic";
import { NPC_ATTITUDES, SocialCheckInputSchema } from "@/lib/rules/social";
import type { AbilityCheckActor } from "@/lib/rules/ability-check";

describe("Social Logic Engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // generateNPCPersonality
  // ---------------------------------------------------------------------------

  describe("generateNPCPersonality", () => {
    it("is deterministic based on seed", () => {
      const p1 = generateNPCPersonality("merchant-001");
      const p2 = generateNPCPersonality("merchant-001");
      expect(p1).toEqual(p2);
      expect(p1.motivation).toBeDefined();
      expect(p1.secret).toBeDefined();
      expect(p1.distinctiveTrait).toBeDefined();
    });

    it("gives different results for different seeds", () => {
      const p1 = generateNPCPersonality("seed-a");
      const p2 = generateNPCPersonality("seed-b");
      // Statistically high chance to differ
      expect(p1.motivation !== p2.motivation || p1.secret !== p2.secret || p1.distinctiveTrait !== p2.distinctiveTrait).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // getRumorsPayload
  // ---------------------------------------------------------------------------

  describe("getRumorsPayload", () => {
    const nodes = [{ id: "n1", name: "Cave", feature: "treasure", description: "Shining gold." }];

    it("refuses if disposition < 3 (Indifferent/Unfriendly)", () => {
      const res = getRumorsPayload("seed", "Bert", 0, nodes);
      expect(res.rumors).toHaveLength(0);
      expect(res.refusalReason).toContain("indifferent");
    });

    it("refuses if disposition < -2 (Hostile)", () => {
      const res = getRumorsPayload("seed", "Bert", -5, nodes);
      expect(res.rumors).toHaveLength(0);
      expect(res.refusalReason).toContain("hostile");
    });

    it("returns rumors if friendly", () => {
      const res = getRumorsPayload("seed", "Bert", 5, nodes);
      expect(res.rumors).toHaveLength(1);
      expect(res.rumors[0].nodeName).toBe("Cave");
      expect(res.rumors[0].rumor).toContain("worth finding");
    });

    it("filters out 'empty' features", () => {
      const nodesWithEmpty = [...nodes, { id: "n2", name: "Hall", feature: "empty", description: "Nothing." }];
      const res = getRumorsPayload("seed", "Bert", 5, nodesWithEmpty);
      expect(res.rumors).toHaveLength(1);
    });

    it("includes personal rumors", () => {
      const res = getRumorsPayload("seed", "Bert", 5, nodes, ["I heard a dragon died."]);
      expect(res.rumors).toHaveLength(2);
      expect(res.rumors[1].source).toBe("personal");
    });
  });

  // ---------------------------------------------------------------------------
  // getDispositionBand
  // ---------------------------------------------------------------------------

  describe("getDispositionBand", () => {
    it("maps values correctly", () => {
      expect(getDispositionBand(-10)).toBe("Hostile");
      expect(getDispositionBand(-7)).toBe("Hostile");
      expect(getDispositionBand(-6)).toBe("Unfriendly");
      expect(getDispositionBand(-2)).toBe("Unfriendly");
      expect(getDispositionBand(-1)).toBe("Indifferent");
      expect(getDispositionBand(2)).toBe("Indifferent");
      expect(getDispositionBand(3)).toBe("Friendly");
      expect(getDispositionBand(7)).toBe("Friendly");
      expect(getDispositionBand(8)).toBe("Helpful");
      expect(getDispositionBand(10)).toBe("Helpful");
    });
  });
});

describe("initialAttitudeFor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("gives the same NPC the same greeting every time", () => {
    const first = initialAttitudeFor("innkeeper_saltmarsh", "commoner");
    for (let i = 0; i < 20; i++) {
      expect(initialAttitudeFor("innkeeper_saltmarsh", "commoner")).toBe(first);
    }
  });

  it("does not depend on any roll", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const low = initialAttitudeFor("gate_guard_north", "guard");
    vi.spyOn(Math, "random").mockReturnValue(0.9999);
    const high = initialAttitudeFor("gate_guard_north", "guard");
    expect(low).toBe(high);
  });

  it("varies between NPCs of the same role", () => {
    const seen = new Set(
      Array.from({ length: 40 }, (_, i) => initialAttitudeFor(`commoner_${i}`, "commoner"))
    );
    expect(seen.size).toBeGreaterThan(1);
  });

  it("seats each attitude at a disposition that reads back as itself", () => {
    for (const [attitude, disposition] of Object.entries(INITIAL_DISPOSITION)) {
      expect(attitudeFor(disposition)).toBe(attitude);
    }
  });
});

describe("attitudeFor", () => {
  it("reads the three bands off the stored disposition", () => {
    expect(attitudeFor(-10)).toBe("Hostile");
    expect(attitudeFor(-4)).toBe("Hostile");
    expect(attitudeFor(-3)).toBe("Indifferent");
    expect(attitudeFor(0)).toBe("Indifferent");
    expect(attitudeFor(3)).toBe("Indifferent");
    expect(attitudeFor(4)).toBe("Friendly");
    expect(attitudeFor(10)).toBe("Friendly");
  });

  it("treats an unmet NPC as Indifferent", () => {
    expect(attitudeFor(null)).toBe("Indifferent");
    expect(attitudeFor(undefined)).toBe("Indifferent");
  });
});

describe("shiftDisposition", () => {
  it("clamps to the stored range", () => {
    expect(shiftDisposition(10, true)).toBe(10);
    expect(shiftDisposition(-10, false)).toBe(-10);
  });

  it("moves attitude by at most one step from every starting value", () => {
    for (let d = -10; d <= 10; d++) {
      for (const success of [true, false]) {
        const before = NPC_ATTITUDES.indexOf(attitudeFor(d));
        const after = NPC_ATTITUDES.indexOf(attitudeFor(shiftDisposition(d, success)));
        expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("moves in the direction the outcome dictates", () => {
    expect(shiftDisposition(0, true)).toBeGreaterThan(0);
    expect(shiftDisposition(0, false)).toBeLessThan(0);
  });
});

const BASE_ACTOR: AbilityCheckActor = { stats: { CHA: 10 }, level: 1 };

function socialInput(approach: "persuade" | "intimidate" | "deceive" = "persuade") {
  return { npcSeed: "innkeeper_1", approach, intent: "a room for the night" };
}

describe("resolveSocialCheck — SRD conformance", () => {
  afterEach(() => {
    vi.spyOn(Math, "random").mockRestore();
  });

  it("takes its DC from the attitude", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.45); // natural 10
    expect(resolveSocialCheck(socialInput(), BASE_ACTOR, -10).dc).toBe(20);
    expect(resolveSocialCheck(socialInput(), BASE_ACTOR, 0).dc).toBe(15);
    expect(resolveSocialCheck(socialInput(), BASE_ACTOR, 10).dc).toBe(10);
  });

  it("adds the proficiency bonus for a proficient character", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.45);
    const plain = resolveSocialCheck(socialInput(), BASE_ACTOR, 0);
    const proficient = resolveSocialCheck(
      socialInput(),
      { ...BASE_ACTOR, skillProficiencies: ["Persuasion"] },
      0
    );
    expect(proficient.proficiencyApplied).toBeGreaterThan(0);
    expect(proficient.total).toBeGreaterThan(plain.total);
  });

  it("rolls the skill the approach names", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.45);
    expect(resolveSocialCheck(socialInput("persuade"), BASE_ACTOR, 0).skill).toBe("Persuasion");
    expect(resolveSocialCheck(socialInput("intimidate"), BASE_ACTOR, 0).skill).toBe("Intimidation");
    expect(resolveSocialCheck(socialInput("deceive"), BASE_ACTOR, 0).skill).toBe("Deception");
  });

  // NOTE: `resolveAbilityCheck` (lib/rules/ability-check.ts) auto-succeeds a
  // natural 20 and auto-fails a natural 1 regardless of total-vs-DC — an
  // existing, separately-tested contract of the engine this function must
  // delegate to (see tests/rules/ability-check.test.ts:106-128). That is a
  // real tension with 5e RAW, where nat 20/1 only auto-resolve *attack*
  // rolls, not ability checks — but fixing the shared engine is out of this
  // task's scope. What THIS task owns is making sure resolveSocialCheck adds
  // no *further* crit-based special-casing on top of whatever `success` the
  // engine returns: the disposition shift must be the plain, single-step
  // ATTITUDE_SHIFT in the outcome's direction, never a bonus/penalty keyed
  // off isCriticalSuccess/isCriticalFailure (the old implementation's bug).
  it("gives a natural 20 the standard shift, not an extra crit bonus", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9999); // natural 20
    const result = resolveSocialCheck(socialInput(), { stats: { CHA: 1 }, level: 1 }, -10);
    expect(result.roll).toBe(20);
    expect(result.success).toBe(true);
    expect(result.dispositionAfter - result.dispositionBefore).toBe(ATTITUDE_SHIFT);
  });

  it("gives a natural 1 the standard shift, not an extra crit penalty", () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // natural 1
    const result = resolveSocialCheck(socialInput(), { stats: { CHA: 30 }, level: 1 }, 10);
    expect(result.roll).toBe(1);
    expect(result.success).toBe(false);
    expect(result.dispositionBefore - result.dispositionAfter).toBe(ATTITUDE_SHIFT);
  });

  it("shifts disposition identically for every approach on the same outcome", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.45);
    const shifts = (["persuade", "intimidate", "deceive"] as const).map((a) => {
      const r = resolveSocialCheck(socialInput(a), BASE_ACTOR, 0);
      return r.dispositionAfter - r.dispositionBefore;
    });
    expect(new Set(shifts).size).toBe(1);
  });
});

describe("SocialCheckInputSchema", () => {
  it("refuses a caller-supplied disposition delta", () => {
    const parsed = SocialCheckInputSchema.safeParse({
      ...socialInput(),
      dispositionDelta: 4,
    });
    expect(parsed.success).toBe(false);
  });
});
