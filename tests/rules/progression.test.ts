import { describe, it, expect } from "vitest";
import {
  getLevelFromXP,
  canLevelUp,
  xpForLevel,
  computeXPAward,
  MIN_LEVEL,
  MAX_LEVEL,
  HIT_DIE_MAP,
  EXPLORATION_XP,
  TriggerLevelUpInputSchema,
  LevelUpPayloadSchema,
  CombatXPInputSchema,
  ExplorationXPInputSchema,
  rollHitPointGain,
  computeCombatXP,
  computeExplorationXP,
  buildLevelUpPayload,
} from "@/lib/rules/progression";

// ---------------------------------------------------------------------------
// getLevelFromXP — threshold boundary tests (5e 2014 SRD Table p.15)
// ---------------------------------------------------------------------------

describe("getLevelFromXP", () => {
  it("returns level 1 at 0 XP", () => {
    expect(getLevelFromXP(0)).toBe(1);
  });

  it("returns level 1 at 299 XP (just below level 2 threshold)", () => {
    expect(getLevelFromXP(299)).toBe(1);
  });

  it("returns level 2 at exactly 300 XP", () => {
    expect(getLevelFromXP(300)).toBe(2);
  });

  it("returns level 2 at 899 XP (just below level 3 threshold)", () => {
    expect(getLevelFromXP(899)).toBe(2);
  });

  it("returns level 3 at exactly 900 XP", () => {
    expect(getLevelFromXP(900)).toBe(3);
  });

  it("returns level 4 at exactly 2700 XP", () => {
    expect(getLevelFromXP(2_700)).toBe(4);
  });

  it("returns level 5 at exactly 6500 XP", () => {
    expect(getLevelFromXP(6_500)).toBe(5);
  });

  it("returns level 10 at exactly 64000 XP", () => {
    expect(getLevelFromXP(64_000)).toBe(10);
  });

  it("returns level 10 at 84999 XP (just below level 11 threshold)", () => {
    expect(getLevelFromXP(84_999)).toBe(10);
  });

  it("returns level 11 at exactly 85000 XP", () => {
    expect(getLevelFromXP(85_000)).toBe(11);
  });

  it("returns level 20 at exactly 355000 XP", () => {
    expect(getLevelFromXP(355_000)).toBe(20);
  });

  it("returns level 20 for XP well above the cap (no level 21 exists)", () => {
    expect(getLevelFromXP(999_999)).toBe(20);
  });

  it("returns level 19 at 354999 XP (just below level 20 threshold)", () => {
    expect(getLevelFromXP(354_999)).toBe(19);
  });

  it("throws RangeError for negative XP", () => {
    expect(() => getLevelFromXP(-1)).toThrow(RangeError);
    expect(() => getLevelFromXP(-1)).toThrow("XP cannot be negative");
  });
});

// ---------------------------------------------------------------------------
// canLevelUp — level-up eligibility
// ---------------------------------------------------------------------------

describe("canLevelUp", () => {
  it("returns false at level 1 with 0 XP (not enough for level 2)", () => {
    expect(canLevelUp(0, 1)).toBe(false);
  });

  it("returns false at level 1 with 299 XP (one short of level 2)", () => {
    expect(canLevelUp(299, 1)).toBe(false);
  });

  it("returns true at level 1 with exactly 300 XP (level 2 threshold met)", () => {
    expect(canLevelUp(300, 1)).toBe(true);
  });

  it("returns true at level 1 with 500 XP (above level 2 threshold)", () => {
    expect(canLevelUp(500, 1)).toBe(true);
  });

  it("returns false at level 2 with 300 XP (not enough for level 3)", () => {
    expect(canLevelUp(300, 2)).toBe(false);
  });

  it("returns true at level 2 with exactly 900 XP (level 3 threshold met)", () => {
    expect(canLevelUp(900, 2)).toBe(true);
  });

  it("returns false at level 20 regardless of XP (already at cap)", () => {
    expect(canLevelUp(999_999, 20)).toBe(false);
  });

  it("returns false at level 19 with 354999 XP (one short of level 20)", () => {
    expect(canLevelUp(354_999, 19)).toBe(false);
  });

  it("returns true at level 19 with exactly 355000 XP (level 20 threshold met)", () => {
    expect(canLevelUp(355_000, 19)).toBe(true);
  });

  it("throws RangeError for negative XP", () => {
    expect(() => canLevelUp(-1, 1)).toThrow(RangeError);
    expect(() => canLevelUp(-1, 1)).toThrow("XP cannot be negative");
  });

  it("throws RangeError for level 0 (below minimum)", () => {
    expect(() => canLevelUp(0, 0)).toThrow(RangeError);
    expect(() => canLevelUp(0, 0)).toThrow("Level must be between");
  });

  it("throws RangeError for level 21 (above maximum)", () => {
    expect(() => canLevelUp(0, 21)).toThrow(RangeError);
    expect(() => canLevelUp(0, 21)).toThrow("Level must be between");
  });
});

// ---------------------------------------------------------------------------
// xpForLevel — threshold lookup
// ---------------------------------------------------------------------------

describe("xpForLevel", () => {
  it("returns 0 for level 1", () => {
    expect(xpForLevel(1)).toBe(0);
  });

  it("returns 300 for level 2", () => {
    expect(xpForLevel(2)).toBe(300);
  });

  it("returns 355000 for level 20", () => {
    expect(xpForLevel(20)).toBe(355_000);
  });

  it("throws RangeError for level 0", () => {
    expect(() => xpForLevel(0)).toThrow(RangeError);
  });

  it("throws RangeError for level 21", () => {
    expect(() => xpForLevel(21)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// MIN_LEVEL / MAX_LEVEL exports
// ---------------------------------------------------------------------------

describe("level constants", () => {
  it("MIN_LEVEL is 1", () => {
    expect(MIN_LEVEL).toBe(1);
  });

  it("MAX_LEVEL is 20", () => {
    expect(MAX_LEVEL).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// computeXPAward — pure XP orchestration helper
// ---------------------------------------------------------------------------

describe("computeXPAward", () => {
  it("returns correct newXP as sum of currentXP + amount", () => {
    const result = computeXPAward(0, 1, 300);
    expect(result.newXP).toBe(300);
  });

  it("detects level-up when award crosses a threshold", () => {
    // character at level 1 with 0 xp, award 300 → level 2
    const result = computeXPAward(0, 1, 300);
    expect(result.newLevel).toBe(2);
    expect(result.leveledUp).toBe(true);
  });

  it("no level-up when threshold is not crossed", () => {
    // character at level 1 with 0 xp, award 299 → still level 1
    const result = computeXPAward(0, 1, 299);
    expect(result.newLevel).toBe(1);
    expect(result.leveledUp).toBe(false);
  });

  it("detects level-up from level 4 to level 5 crossing 6500 threshold", () => {
    // character at level 4 with 2700 xp, award 3800 → 6500 xp → level 5
    const result = computeXPAward(2_700, 4, 3_800);
    expect(result.newXP).toBe(6_500);
    expect(result.newLevel).toBe(5);
    expect(result.leveledUp).toBe(true);
  });

  it("detects multi-level jump in a single large award", () => {
    // character at level 1 with 0 xp, award 6500 → level 5 (skips 2, 3, 4)
    const result = computeXPAward(0, 1, 6_500);
    expect(result.newLevel).toBe(5);
    expect(result.leveledUp).toBe(true);
  });

  it("no level-up when character is already at max level (20)", () => {
    const result = computeXPAward(355_000, 20, 10_000);
    expect(result.newLevel).toBe(20);
    expect(result.leveledUp).toBe(false);
  });

  it("accumulates correctly across multiple sequential awards", () => {
    const first  = computeXPAward(0, 1, 150);    // 150 xp, level 1
    const second = computeXPAward(first.newXP, first.newLevel, 150); // 300 xp → level 2
    expect(second.newXP).toBe(300);
    expect(second.leveledUp).toBe(true);
  });

  it("throws RangeError for amount of 0", () => {
    expect(() => computeXPAward(0, 1, 0)).toThrow(RangeError);
    expect(() => computeXPAward(0, 1, 0)).toThrow("positive integer");
  });

  it("throws RangeError for negative amount", () => {
    expect(() => computeXPAward(500, 2, -100)).toThrow(RangeError);
  });

  it("throws RangeError for fractional amount", () => {
    expect(() => computeXPAward(0, 1, 1.5)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Milestone L Slice 1 — HIT_DIE_MAP constant
// ---------------------------------------------------------------------------

describe("HIT_DIE_MAP", () => {
  it("covers all 12 SRD classes", () => {
    const classes = [
      "barbarian", "bard", "cleric", "druid", "fighter", "monk",
      "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard",
    ] as const;
    expect(Object.keys(HIT_DIE_MAP)).toHaveLength(12);
    for (const cls of classes) {
      expect(HIT_DIE_MAP).toHaveProperty(cls);
    }
  });

  it("barbarian is d12", () => expect(HIT_DIE_MAP.barbarian).toBe(12));
  it("fighter is d10", () => expect(HIT_DIE_MAP.fighter).toBe(10));
  it("wizard is d6",   () => expect(HIT_DIE_MAP.wizard).toBe(6));
  it("sorcerer is d6", () => expect(HIT_DIE_MAP.sorcerer).toBe(6));
  it("monk is d8",     () => expect(HIT_DIE_MAP.monk).toBe(8));
  it("paladin is d10", () => expect(HIT_DIE_MAP.paladin).toBe(10));

  it("all values are positive integers in [6, 12]", () => {
    for (const die of Object.values(HIT_DIE_MAP)) {
      expect(Number.isInteger(die)).toBe(true);
      expect(die).toBeGreaterThanOrEqual(6);
      expect(die).toBeLessThanOrEqual(12);
    }
  });
});

// ---------------------------------------------------------------------------
// Milestone L Slice 1 — EXPLORATION_XP constant
// ---------------------------------------------------------------------------

describe("EXPLORATION_XP", () => {
  it("defines all 7 event types", () => {
    const events = [
      "node_discovery", "hidden_passage", "locked_passage",
      "hazard_survived", "exit_reached", "treasure_found", "quest_hook_found",
    ];
    expect(Object.keys(EXPLORATION_XP)).toHaveLength(7);
    for (const e of events) {
      expect(EXPLORATION_XP).toHaveProperty(e);
    }
  });

  it("node_discovery is 25 XP",   () => expect(EXPLORATION_XP.node_discovery).toBe(25));
  it("hidden_passage is 75 XP",   () => expect(EXPLORATION_XP.hidden_passage).toBe(75));
  it("locked_passage is 50 XP",   () => expect(EXPLORATION_XP.locked_passage).toBe(50));
  it("hazard_survived is 100 XP", () => expect(EXPLORATION_XP.hazard_survived).toBe(100));
  it("exit_reached is 150 XP",    () => expect(EXPLORATION_XP.exit_reached).toBe(150));
  it("treasure_found is 50 XP",   () => expect(EXPLORATION_XP.treasure_found).toBe(50));
  it("quest_hook_found is 50 XP", () => expect(EXPLORATION_XP.quest_hook_found).toBe(50));

  it("all values are positive integers", () => {
    for (const xp of Object.values(EXPLORATION_XP)) {
      expect(Number.isInteger(xp)).toBe(true);
      expect(xp).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Milestone L Slice 1 — TriggerLevelUpInputSchema
// ---------------------------------------------------------------------------

describe("TriggerLevelUpInputSchema", () => {
  it("accepts valid input with required field only", () => {
    const result = TriggerLevelUpInputSchema.safeParse({ characterId: "abc123" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.useAverage).toBe(false); // default applied
    }
  });

  it("accepts useAverage: true explicitly", () => {
    const result = TriggerLevelUpInputSchema.safeParse({ characterId: "abc123", useAverage: true });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.useAverage).toBe(true);
  });

  it("rejects empty string characterId", () => {
    const result = TriggerLevelUpInputSchema.safeParse({ characterId: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing characterId", () => {
    const result = TriggerLevelUpInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects non-string characterId", () => {
    const result = TriggerLevelUpInputSchema.safeParse({ characterId: 42 });
    expect(result.success).toBe(false);
  });

  it("rejects non-boolean useAverage", () => {
    const result = TriggerLevelUpInputSchema.safeParse({ characterId: "x", useAverage: "yes" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Milestone L Slice 1 — LevelUpPayloadSchema
// ---------------------------------------------------------------------------

describe("LevelUpPayloadSchema", () => {
  const validPayload = {
    characterId:     "char_01",
    previousLevel:   4,
    newLevel:        5,
    hitDie:          "1d10",
    hpRoll:          7,
    conModifier:     2,
    hpGained:        9,
    previousMaxHp:   32,
    newMaxHp:        41,
    newHitDiceTotal: 5,
    className:       "fighter",
  };

  it("accepts a fully valid payload", () => {
    expect(LevelUpPayloadSchema.safeParse(validPayload).success).toBe(true);
  });

  it("rejects previousLevel of 20 (max 19 — must have somewhere to go)", () => {
    const result = LevelUpPayloadSchema.safeParse({ ...validPayload, previousLevel: 20 });
    expect(result.success).toBe(false);
  });

  it("rejects newLevel of 1 (min 2 — always an increase)", () => {
    const result = LevelUpPayloadSchema.safeParse({ ...validPayload, newLevel: 1 });
    expect(result.success).toBe(false);
  });

  it("rejects newLevel of 21 (above max level)", () => {
    const result = LevelUpPayloadSchema.safeParse({ ...validPayload, newLevel: 21 });
    expect(result.success).toBe(false);
  });

  it("rejects previousLevel of 0 (below min level)", () => {
    const result = LevelUpPayloadSchema.safeParse({ ...validPayload, previousLevel: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects hpRoll of 0 (min 1)", () => {
    const result = LevelUpPayloadSchema.safeParse({ ...validPayload, hpRoll: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects hpGained of 0 (min 1 — always gain at least 1 HP)", () => {
    const result = LevelUpPayloadSchema.safeParse({ ...validPayload, hpGained: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects newMaxHp of 1 (min 2)", () => {
    const result = LevelUpPayloadSchema.safeParse({ ...validPayload, newMaxHp: 1 });
    expect(result.success).toBe(false);
  });

  it("rejects newHitDiceTotal of 1 (min 2 — post-level-up)", () => {
    const result = LevelUpPayloadSchema.safeParse({ ...validPayload, newHitDiceTotal: 1 });
    expect(result.success).toBe(false);
  });

  it("accepts negative conModifier (e.g. -2 for low CON)", () => {
    const result = LevelUpPayloadSchema.safeParse({ ...validPayload, conModifier: -2 });
    expect(result.success).toBe(true);
  });

  it("accepts level boundary: previousLevel 19, newLevel 20", () => {
    const result = LevelUpPayloadSchema.safeParse({
      ...validPayload, previousLevel: 19, newLevel: 20, newHitDiceTotal: 20,
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Milestone L Slice 1 — CombatXPInputSchema
// ---------------------------------------------------------------------------

describe("CombatXPInputSchema", () => {
  it("accepts a single valid CR", () => {
    expect(CombatXPInputSchema.safeParse({ enemyCRs: [1] }).success).toBe(true);
  });

  it("accepts multiple CRs including fractional (0.5)", () => {
    expect(CombatXPInputSchema.safeParse({ enemyCRs: [0.25, 0.5, 1, 5] }).success).toBe(true);
  });

  it("accepts CR 0 (weakest monsters)", () => {
    expect(CombatXPInputSchema.safeParse({ enemyCRs: [0] }).success).toBe(true);
  });

  it("accepts CR 30 (strongest monster — Tarrasque)", () => {
    expect(CombatXPInputSchema.safeParse({ enemyCRs: [30] }).success).toBe(true);
  });

  it("rejects empty enemyCRs array (min 1 required)", () => {
    expect(CombatXPInputSchema.safeParse({ enemyCRs: [] }).success).toBe(false);
  });

  it("rejects negative CR values", () => {
    expect(CombatXPInputSchema.safeParse({ enemyCRs: [-1] }).success).toBe(false);
  });

  it("rejects CR above 30", () => {
    expect(CombatXPInputSchema.safeParse({ enemyCRs: [31] }).success).toBe(false);
  });

  it("rejects missing enemyCRs field", () => {
    expect(CombatXPInputSchema.safeParse({}).success).toBe(false);
  });

  it("rejects non-numeric CR values", () => {
    expect(CombatXPInputSchema.safeParse({ enemyCRs: ["1"] }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Milestone L Slice 1 — ExplorationXPInputSchema
// ---------------------------------------------------------------------------

describe("ExplorationXPInputSchema", () => {
  it("accepts all valid event types without nodeIndex", () => {
    const events = [
      "node_discovery", "hidden_passage", "locked_passage",
      "hazard_survived", "exit_reached", "treasure_found", "quest_hook_found",
    ] as const;
    for (const event of events) {
      expect(ExplorationXPInputSchema.safeParse({ event }).success).toBe(true);
    }
  });

  it("accepts valid event with optional nodeIndex", () => {
    const result = ExplorationXPInputSchema.safeParse({ event: "hazard_survived", nodeIndex: 3 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.nodeIndex).toBe(3);
  });

  it("rejects invalid event string", () => {
    expect(ExplorationXPInputSchema.safeParse({ event: "boss_killed" }).success).toBe(false);
  });

  it("rejects missing event field", () => {
    expect(ExplorationXPInputSchema.safeParse({}).success).toBe(false);
  });

  it("rejects negative nodeIndex", () => {
    expect(ExplorationXPInputSchema.safeParse({ event: "exit_reached", nodeIndex: -1 }).success).toBe(false);
  });

  it("rejects fractional nodeIndex (must be integer)", () => {
    expect(ExplorationXPInputSchema.safeParse({ event: "exit_reached", nodeIndex: 1.5 }).success).toBe(false);
  });

  it("accepts nodeIndex of 0 (valid — first node)", () => {
    expect(ExplorationXPInputSchema.safeParse({ event: "node_discovery", nodeIndex: 0 }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Milestone L Slice 2 — rollHitPointGain
// ---------------------------------------------------------------------------

describe("rollHitPointGain", () => {
  // Average mode tests — fully deterministic
  it("wizard (d6) average mode returns hpRoll of 4 (ceil(6/2)+1)", () => {
    const { hpRoll } = rollHitPointGain("wizard", 0, true);
    expect(hpRoll).toBe(4); // ceil(6/2) + 1 = 4
  });

  it("fighter (d10) average mode returns hpRoll of 6 (ceil(10/2)+1)", () => {
    const { hpRoll } = rollHitPointGain("fighter", 0, true);
    expect(hpRoll).toBe(6); // ceil(10/2) + 1 = 6
  });

  it("barbarian (d12) average mode returns hpRoll of 7 (ceil(12/2)+1)", () => {
    const { hpRoll } = rollHitPointGain("barbarian", 0, true);
    expect(hpRoll).toBe(7); // ceil(12/2) + 1 = 7
  });

  it("bard (d8) average mode returns hpRoll of 5 (ceil(8/2)+1)", () => {
    const { hpRoll } = rollHitPointGain("bard", 0, true);
    expect(hpRoll).toBe(5); // ceil(8/2) + 1 = 5
  });

  it("sorcerer (d6) average mode with +3 CON mod: hpGained = 7", () => {
    const { hpGained } = rollHitPointGain("sorcerer", 3, true);
    expect(hpGained).toBe(7); // 4 + 3
  });

  it("hpGained always >= 1 even with CON mod -5 (wizard average)", () => {
    const { hpGained } = rollHitPointGain("wizard", -5, true);
    // hpRoll = 4, hpGained = max(1, 4 + -5) = max(1, -1) = 1
    expect(hpGained).toBeGreaterThanOrEqual(1);
  });

  it("hpGained always >= 1 with extreme negative CON mod -10", () => {
    const { hpGained } = rollHitPointGain("wizard", -10, true);
    expect(hpGained).toBeGreaterThanOrEqual(1);
  });

  it("useAverage false — hpRoll is within valid die range (wizard d6)", () => {
    // Roll 20 times to be statistically confident it stays in [1, 6]
    for (let i = 0; i < 20; i++) {
      const { hpRoll } = rollHitPointGain("wizard", 0, false);
      expect(hpRoll).toBeGreaterThanOrEqual(1);
      expect(hpRoll).toBeLessThanOrEqual(6);
    }
  });

  it("useAverage false — hpRoll is within valid die range (barbarian d12)", () => {
    for (let i = 0; i < 20; i++) {
      const { hpRoll } = rollHitPointGain("barbarian", 0, false);
      expect(hpRoll).toBeGreaterThanOrEqual(1);
      expect(hpRoll).toBeLessThanOrEqual(12);
    }
  });

  it("average mode — verifies all 12 classes produce PHB average (ceil(die/2)+1)", () => {
    const expectedAverages: Record<string, number> = {
      barbarian: 7, // d12: ceil(12/2)+1
      bard:      5, // d8:  ceil(8/2)+1
      cleric:    5,
      druid:     5,
      fighter:   6, // d10: ceil(10/2)+1
      monk:      5,
      paladin:   6,
      ranger:    6,
      rogue:     5,
      sorcerer:  4, // d6:  ceil(6/2)+1
      warlock:   5,
      wizard:    4,
    };
    for (const [cls, expected] of Object.entries(expectedAverages)) {
      const { hpRoll } = rollHitPointGain(cls as keyof typeof HIT_DIE_MAP, 0, true);
      expect(hpRoll).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// Milestone L Slice 2 — computeCombatXP
// ---------------------------------------------------------------------------

describe("computeCombatXP", () => {
  it("single CR 1 enemy = 200 XP", () => {
    expect(computeCombatXP([1])).toBe(200);
  });

  it("single CR 0 enemy = 10 XP", () => {
    expect(computeCombatXP([0])).toBe(10);
  });

  it("single CR 5 enemy = 1800 XP", () => {
    expect(computeCombatXP([5])).toBe(1_800);
  });

  it("two CR 1 enemies = 400 XP (no multiplier applied)", () => {
    expect(computeCombatXP([1, 1])).toBe(400);
  });

  it("mixed CRs: 0.25 + 1 + 2 = 50 + 200 + 450 = 700 XP", () => {
    expect(computeCombatXP([0.25, 1, 2])).toBe(700);
  });

  it("CR 0.125 = 25 XP (weakest non-trivial monster)", () => {
    expect(computeCombatXP([0.125])).toBe(25);
  });

  it("CR 30 = 155000 XP (Tarrasque)", () => {
    expect(computeCombatXP([30])).toBe(155_000);
  });

  it("three identical CR 3 enemies = 3 × 700 = 2100 XP", () => {
    expect(computeCombatXP([3, 3, 3])).toBe(2_100);
  });
});

// ---------------------------------------------------------------------------
// Milestone L Slice 2 — computeExplorationXP
// ---------------------------------------------------------------------------

describe("computeExplorationXP", () => {
  it("node_discovery returns 25", () => expect(computeExplorationXP("node_discovery")).toBe(25));
  it("hidden_passage returns 75",  () => expect(computeExplorationXP("hidden_passage")).toBe(75));
  it("locked_passage returns 50",  () => expect(computeExplorationXP("locked_passage")).toBe(50));
  it("hazard_survived returns 100",() => expect(computeExplorationXP("hazard_survived")).toBe(100));
  it("exit_reached returns 150",   () => expect(computeExplorationXP("exit_reached")).toBe(150));
  it("treasure_found returns 50",  () => expect(computeExplorationXP("treasure_found")).toBe(50));
  it("quest_hook_found returns 50",() => expect(computeExplorationXP("quest_hook_found")).toBe(50));

  it("return value matches EXPLORATION_XP constant for all events", () => {
    const events = Object.keys(EXPLORATION_XP) as Array<keyof typeof EXPLORATION_XP>;
    for (const event of events) {
      expect(computeExplorationXP(event)).toBe(EXPLORATION_XP[event]);
    }
  });
});

// ---------------------------------------------------------------------------
// Milestone L Slice 2 — buildLevelUpPayload
// ---------------------------------------------------------------------------

describe("buildLevelUpPayload", () => {
  const baseInput = {
    characterId: "char-01",
    className: "fighter" as const,
    previousLevel: 4,
    newLevel: 5,
    currentMaxHp: 32,
    conModifier: 2,
  };

  it("returns a valid LevelUpPayload (passes Zod schema)", () => {
    const payload = buildLevelUpPayload({ ...baseInput, useAverage: true });
    expect(LevelUpPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("newMaxHp = currentMaxHp + hpGained (fighter average: 6+2=8 → 32+8=40)", () => {
    const payload = buildLevelUpPayload({ ...baseInput, useAverage: true });
    // fighter d10 average: ceil(10/2)+1 = 6; +2 CON = 8 hpGained
    expect(payload.hpGained).toBe(8);
    expect(payload.newMaxHp).toBe(40);
  });

  it("newHitDiceTotal equals newLevel", () => {
    const payload = buildLevelUpPayload({ ...baseInput, useAverage: true });
    expect(payload.newHitDiceTotal).toBe(baseInput.newLevel);
  });

  it("hitDie string matches class (fighter = '1d10')", () => {
    const payload = buildLevelUpPayload({ ...baseInput, useAverage: true });
    expect(payload.hitDie).toBe("1d10");
  });

  it("previousLevel and newLevel are preserved", () => {
    const payload = buildLevelUpPayload({ ...baseInput, useAverage: true });
    expect(payload.previousLevel).toBe(4);
    expect(payload.newLevel).toBe(5);
  });

  it("previousMaxHp equals currentMaxHp input", () => {
    const payload = buildLevelUpPayload({ ...baseInput, useAverage: true });
    expect(payload.previousMaxHp).toBe(32);
  });

  it("hpGained >= 1 even with CON -5 (wizard, extreme case)", () => {
    const payload = buildLevelUpPayload({
      characterId: "c1",
      className: "wizard",
      previousLevel: 1,
      newLevel: 2,
      currentMaxHp: 6,
      conModifier: -5,
      useAverage: true,
    });
    expect(payload.hpGained).toBeGreaterThanOrEqual(1);
    expect(payload.newMaxHp).toBeGreaterThan(6);
  });

  it("level 19 → 20 boundary produces valid payload (max level)", () => {
    const payload = buildLevelUpPayload({
      characterId: "c1",
      className: "barbarian",
      previousLevel: 19,
      newLevel: 20,
      currentMaxHp: 200,
      conModifier: 4,
      useAverage: true,
    });
    expect(LevelUpPayloadSchema.safeParse(payload).success).toBe(true);
    expect(payload.newHitDiceTotal).toBe(20);
  });

  it("random mode (useAverage false) still returns valid payload", () => {
    const payload = buildLevelUpPayload({ ...baseInput, useAverage: false });
    expect(LevelUpPayloadSchema.safeParse(payload).success).toBe(true);
    expect(payload.newMaxHp).toBeGreaterThan(baseInput.currentMaxHp);
  });
});
