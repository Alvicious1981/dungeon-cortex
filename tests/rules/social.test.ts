/**
 * tests/rules/social.test.ts
 *
 * Unit tests for lib/rules/social.ts — Milestone N Slice 1.
 *
 * Coverage:
 *   • getDispositionBand — all boundary values per the spec
 *   • defaultNPCSocialState — shape and immutability
 *   • ReactionRollInputSchema — valid inputs pass, each invalid category rejected
 *   • ReactionRollResultSchema — valid inputs pass, invalid rejected
 *   • SocialCheckInputSchema — valid inputs pass, invalid rejected
 *   • SocialCheckResultSchema — valid inputs pass, invalid rejected
 *   • GetRumorsInputSchema — valid inputs pass, invalid rejected
 *   • RumorItemSchema / RumorPayloadSchema — valid inputs pass, invalid rejected
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getDispositionBand,
  defaultNPCSocialState,
  DISPOSITION_BANDS,
  ReactionRollInputSchema,
  ReactionRollResultSchema,
  SocialCheckInputSchema,
  SocialCheckResultSchema,
  GetRumorsInputSchema,
  RumorItemSchema,
  RumorPayloadSchema,
  generateNPCPersonality,
  rollReaction,
  computeSocialDC,
  resolveSocialCheck,
  getRumorsPayload,
  type SocialCheckInput,
} from "@/lib/rules/social";

// ---------------------------------------------------------------------------
// getDispositionBand
// ---------------------------------------------------------------------------

describe("getDispositionBand", () => {
  it("returns Hostile for −10", () => {
    expect(getDispositionBand(-10)).toBe("Hostile");
  });

  it("returns Hostile for −7 (boundary)", () => {
    expect(getDispositionBand(-7)).toBe("Hostile");
  });

  it("returns Unfriendly for −6 (one above Hostile boundary)", () => {
    expect(getDispositionBand(-6)).toBe("Unfriendly");
  });

  it("returns Unfriendly for −3", () => {
    expect(getDispositionBand(-3)).toBe("Unfriendly");
  });

  it("returns Unfriendly for −2 (boundary)", () => {
    expect(getDispositionBand(-2)).toBe("Unfriendly");
  });

  it("returns Indifferent for −1 (one above Unfriendly boundary)", () => {
    expect(getDispositionBand(-1)).toBe("Indifferent");
  });

  it("returns Indifferent for 0", () => {
    expect(getDispositionBand(0)).toBe("Indifferent");
  });

  it("returns Indifferent for 2 (boundary)", () => {
    expect(getDispositionBand(2)).toBe("Indifferent");
  });

  it("returns Friendly for 3 (one above Indifferent boundary)", () => {
    expect(getDispositionBand(3)).toBe("Friendly");
  });

  it("returns Friendly for 5", () => {
    expect(getDispositionBand(5)).toBe("Friendly");
  });

  it("returns Friendly for 7 (boundary)", () => {
    expect(getDispositionBand(7)).toBe("Friendly");
  });

  it("returns Helpful for 8 (one above Friendly boundary)", () => {
    expect(getDispositionBand(8)).toBe("Helpful");
  });

  it("returns Helpful for 10", () => {
    expect(getDispositionBand(10)).toBe("Helpful");
  });
});

// ---------------------------------------------------------------------------
// defaultNPCSocialState
// ---------------------------------------------------------------------------

describe("defaultNPCSocialState", () => {
  it("returns disposition null", () => {
    expect(defaultNPCSocialState().disposition).toBeNull();
  });

  it("returns personalityTags null", () => {
    expect(defaultNPCSocialState().personalityTags).toBeNull();
  });

  it("returns hasMetPlayer false", () => {
    expect(defaultNPCSocialState().hasMetPlayer).toBe(false);
  });

  it("returns a fresh object each call (not shared reference)", () => {
    const a = defaultNPCSocialState();
    const b = defaultNPCSocialState();
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// DISPOSITION_BANDS — sanity
// ---------------------------------------------------------------------------

describe("DISPOSITION_BANDS", () => {
  it("Hostile initial is −8", () => {
    expect(DISPOSITION_BANDS.Hostile.initial).toBe(-8);
  });

  it("Helpful initial is 8", () => {
    expect(DISPOSITION_BANDS.Helpful.initial).toBe(8);
  });

  it("Indifferent initial is 0", () => {
    expect(DISPOSITION_BANDS.Indifferent.initial).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ReactionRollInputSchema
// ---------------------------------------------------------------------------

describe("ReactionRollInputSchema", () => {
  const valid = {
    npcSeed: "tavern-guard-01",
    npcRole: "guard" as const,
    charismaModifier: 2,
  };

  it("parses a valid input", () => {
    expect(() => ReactionRollInputSchema.parse(valid)).not.toThrow();
  });

  it("rejects empty npcSeed", () => {
    expect(() =>
      ReactionRollInputSchema.parse({ ...valid, npcSeed: "" })
    ).toThrow();
  });

  it("rejects npcSeed longer than 100 chars", () => {
    expect(() =>
      ReactionRollInputSchema.parse({ ...valid, npcSeed: "x".repeat(101) })
    ).toThrow();
  });

  it("rejects invalid npcRole", () => {
    expect(() =>
      ReactionRollInputSchema.parse({ ...valid, npcRole: "wizard" })
    ).toThrow();
  });

  it("rejects charismaModifier below −5", () => {
    expect(() =>
      ReactionRollInputSchema.parse({ ...valid, charismaModifier: -6 })
    ).toThrow();
  });

  it("rejects charismaModifier above +5", () => {
    expect(() =>
      ReactionRollInputSchema.parse({ ...valid, charismaModifier: 6 })
    ).toThrow();
  });

  it("accepts charismaModifier at −5 boundary", () => {
    expect(() =>
      ReactionRollInputSchema.parse({ ...valid, charismaModifier: -5 })
    ).not.toThrow();
  });

  it("accepts charismaModifier at +5 boundary", () => {
    expect(() =>
      ReactionRollInputSchema.parse({ ...valid, charismaModifier: 5 })
    ).not.toThrow();
  });

  it("rejects non-integer charismaModifier", () => {
    expect(() =>
      ReactionRollInputSchema.parse({ ...valid, charismaModifier: 1.5 })
    ).toThrow();
  });

  it("rejects extra unknown fields (strict)", () => {
    expect(() =>
      ReactionRollInputSchema.parse({ ...valid, extraField: "oops" })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ReactionRollResultSchema
// ---------------------------------------------------------------------------

describe("ReactionRollResultSchema", () => {
  const valid = {
    dice: [3, 4] as [number, number],
    rawTotal: 7,
    modifiedTotal: 9,
    charismaModifier: 2,
    dispositionBand: "Friendly" as const,
    initialDisposition: 4,
    personality: {
      motivation: "To repay an old debt.",
      secret: "Formerly a spy.",
      distinctiveTrait: "Taps nose twice before speaking.",
    },
  };

  it("parses a valid result", () => {
    expect(() => ReactionRollResultSchema.parse(valid)).not.toThrow();
  });

  it("rejects dice[0] out of range (0)", () => {
    expect(() =>
      ReactionRollResultSchema.parse({ ...valid, dice: [0, 4] })
    ).toThrow();
  });

  it("rejects dice[1] out of range (7)", () => {
    expect(() =>
      ReactionRollResultSchema.parse({ ...valid, dice: [3, 7] })
    ).toThrow();
  });

  it("rejects invalid dispositionBand", () => {
    expect(() =>
      ReactionRollResultSchema.parse({ ...valid, dispositionBand: "Terrified" })
    ).toThrow();
  });

  it("rejects initialDisposition below −10", () => {
    expect(() =>
      ReactionRollResultSchema.parse({ ...valid, initialDisposition: -11 })
    ).toThrow();
  });

  it("rejects initialDisposition above +10", () => {
    expect(() =>
      ReactionRollResultSchema.parse({ ...valid, initialDisposition: 11 })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SocialCheckInputSchema
// ---------------------------------------------------------------------------

describe("SocialCheckInputSchema", () => {
  const valid = {
    npcSeed: "merchant-03",
    characterId: "char_abc123",
    approach: "persuade" as const,
    dispositionDelta: 2,
    intent: "Offered to help carry their goods.",
  };

  it("parses a valid input", () => {
    expect(() => SocialCheckInputSchema.parse(valid)).not.toThrow();
  });

  it("accepts all valid approach values", () => {
    for (const approach of ["persuade", "intimidate", "deceive"] as const) {
      expect(() =>
        SocialCheckInputSchema.parse({ ...valid, approach })
      ).not.toThrow();
    }
  });

  it("rejects invalid approach", () => {
    expect(() =>
      SocialCheckInputSchema.parse({ ...valid, approach: "bribe" })
    ).toThrow();
  });

  it("rejects dispositionDelta of 0", () => {
    expect(() =>
      SocialCheckInputSchema.parse({ ...valid, dispositionDelta: 0 })
    ).toThrow();
  });

  it("rejects dispositionDelta of 5", () => {
    expect(() =>
      SocialCheckInputSchema.parse({ ...valid, dispositionDelta: 5 })
    ).toThrow();
  });

  it("accepts dispositionDelta at boundaries 1 and 4", () => {
    expect(() =>
      SocialCheckInputSchema.parse({ ...valid, dispositionDelta: 1 })
    ).not.toThrow();
    expect(() =>
      SocialCheckInputSchema.parse({ ...valid, dispositionDelta: 4 })
    ).not.toThrow();
  });

  it("rejects intent longer than 200 chars", () => {
    expect(() =>
      SocialCheckInputSchema.parse({ ...valid, intent: "a".repeat(201) })
    ).toThrow();
  });

  it("rejects empty characterId", () => {
    expect(() =>
      SocialCheckInputSchema.parse({ ...valid, characterId: "" })
    ).toThrow();
  });

  it("rejects extra fields (strict)", () => {
    expect(() =>
      SocialCheckInputSchema.parse({ ...valid, bonus: 99 })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SocialCheckResultSchema
// ---------------------------------------------------------------------------

describe("SocialCheckResultSchema", () => {
  const valid = {
    approach: "persuade" as const,
    roll: 14,
    charismaModifier: 2,
    total: 16,
    dc: 12,
    success: true,
    isCriticalSuccess: false,
    isCriticalFailure: false,
    dispositionBefore: 0,
    dispositionAfter: 2,
    dispositionBandBefore: "Indifferent" as const,
    dispositionBandAfter: "Indifferent" as const,
    backfire: false,
  };

  it("parses a valid result", () => {
    expect(() => SocialCheckResultSchema.parse(valid)).not.toThrow();
  });

  it("rejects dispositionBefore below −10", () => {
    expect(() =>
      SocialCheckResultSchema.parse({ ...valid, dispositionBefore: -11 })
    ).toThrow();
  });

  it("rejects dispositionAfter above +10", () => {
    expect(() =>
      SocialCheckResultSchema.parse({ ...valid, dispositionAfter: 11 })
    ).toThrow();
  });

  it("rejects invalid dispositionBandAfter", () => {
    expect(() =>
      SocialCheckResultSchema.parse({ ...valid, dispositionBandAfter: "Ecstatic" })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// GetRumorsInputSchema
// ---------------------------------------------------------------------------

describe("GetRumorsInputSchema", () => {
  const valid = { npcSeed: "innkeeper-07", campaignId: "camp_xyz" };

  it("parses a valid input", () => {
    expect(() => GetRumorsInputSchema.parse(valid)).not.toThrow();
  });

  it("rejects empty npcSeed", () => {
    expect(() =>
      GetRumorsInputSchema.parse({ ...valid, npcSeed: "" })
    ).toThrow();
  });

  it("rejects empty campaignId", () => {
    expect(() =>
      GetRumorsInputSchema.parse({ ...valid, campaignId: "" })
    ).toThrow();
  });

  it("rejects npcSeed longer than 100 chars", () => {
    expect(() =>
      GetRumorsInputSchema.parse({ ...valid, npcSeed: "z".repeat(101) })
    ).toThrow();
  });

  it("rejects extra fields (strict)", () => {
    expect(() =>
      GetRumorsInputSchema.parse({ ...valid, extra: "oops" })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// RumorItemSchema
// ---------------------------------------------------------------------------

describe("RumorItemSchema", () => {
  const valid = {
    nodeId: "node_001",
    nodeName: "The Whispering Gallery",
    feature: "hazard",
    rumor: "A collapsed ceiling makes the east passage impassable.",
  };

  it("parses a valid item", () => {
    expect(() => RumorItemSchema.parse(valid)).not.toThrow();
  });

  it("rejects rumor longer than 300 chars", () => {
    expect(() =>
      RumorItemSchema.parse({ ...valid, rumor: "r".repeat(301) })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// RumorPayloadSchema
// ---------------------------------------------------------------------------

describe("RumorPayloadSchema", () => {
  const validItem = {
    nodeId: "node_001",
    nodeName: "The Whispering Gallery",
    feature: "hazard",
    rumor: "A collapsed ceiling blocks the east passage.",
  };

  const valid = {
    npcName: "Old Bertram",
    disposition: 5,
    dispositionBand: "Friendly" as const,
    rumors: [validItem],
  };

  it("parses a valid payload with rumors", () => {
    expect(() => RumorPayloadSchema.parse(valid)).not.toThrow();
  });

  it("parses a payload with empty rumors array", () => {
    expect(() =>
      RumorPayloadSchema.parse({ ...valid, rumors: [] })
    ).not.toThrow();
  });

  it("parses a payload with refusalReason", () => {
    expect(() =>
      RumorPayloadSchema.parse({
        ...valid,
        disposition: -5,
        dispositionBand: "Unfriendly",
        rumors: [],
        refusalReason: "The NPC glares and says nothing.",
      })
    ).not.toThrow();
  });

  it("rejects disposition below −10", () => {
    expect(() =>
      RumorPayloadSchema.parse({ ...valid, disposition: -11 })
    ).toThrow();
  });

  it("rejects disposition above +10", () => {
    expect(() =>
      RumorPayloadSchema.parse({ ...valid, disposition: 11 })
    ).toThrow();
  });

  it("rejects invalid dispositionBand", () => {
    expect(() =>
      RumorPayloadSchema.parse({ ...valid, dispositionBand: "Neutral" })
    ).toThrow();
  });
});

// ===========================================================================
// SLICE 2 — Interaction Engine
// ===========================================================================

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// generateNPCPersonality
// ---------------------------------------------------------------------------

describe("generateNPCPersonality", () => {
  it("returns identical tags for the same seed (task 2.7 — determinism)", () => {
    const a = generateNPCPersonality("npc_gate_guard_01");
    const b = generateNPCPersonality("npc_gate_guard_01");
    expect(a.motivation).toBe(b.motivation);
    expect(a.secret).toBe(b.secret);
    expect(a.distinctiveTrait).toBe(b.distinctiveTrait);
  });

  it("returns different tags for different seeds (task 2.8)", () => {
    const guard    = generateNPCPersonality("npc_gate_guard_01");
    const innkeeper = generateNPCPersonality("npc_innkeeper_02");
    // At least one of the three tags must differ to count as distinct NPCs.
    const anyDiffers =
      guard.motivation    !== innkeeper.motivation ||
      guard.secret        !== innkeeper.secret ||
      guard.distinctiveTrait !== innkeeper.distinctiveTrait;
    expect(anyDiffers).toBe(true);
  });

  it("returns non-empty strings for all three tags", () => {
    const p = generateNPCPersonality("npc_bandit_leader_88");
    expect(p.motivation.length).toBeGreaterThan(0);
    expect(p.secret.length).toBeGreaterThan(0);
    expect(p.distinctiveTrait.length).toBeGreaterThan(0);
  });

  it("accepts the canonical acceptance-criteria seed", () => {
    expect(() => generateNPCPersonality("npc_gate_guard_01")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// rollReaction
// ---------------------------------------------------------------------------

describe("rollReaction", () => {
  const baseInput = { npcSeed: "test_npc", npcRole: "commoner" as const };

  it("result includes a non-null personality object (task 2.11)", () => {
    const result = rollReaction({ ...baseInput, charismaModifier: 0 });
    expect(result.personality).toBeTruthy();
    expect(typeof result.personality.motivation).toBe("string");
    expect(typeof result.personality.secret).toBe("string");
    expect(typeof result.personality.distinctiveTrait).toBe("string");
  });

  it("result has a valid dispositionBand", () => {
    const result = rollReaction({ ...baseInput, charismaModifier: 0 });
    const validBands = ["Hostile", "Unfriendly", "Indifferent", "Friendly", "Helpful"];
    expect(validBands).toContain(result.dispositionBand);
  });

  it("CHA −5 clamp: worst dice (1+1) never produces modifiedTotal below 2 (task 2.10)", () => {
    // Force both dice to 1 by mocking Math.random to return 0.
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0) // die1 = Math.floor(0*6)+1 = 1
      .mockReturnValueOnce(0); // die2 = 1
    const result = rollReaction({ ...baseInput, charismaModifier: -5 });
    expect(result.modifiedTotal).toBeGreaterThanOrEqual(2);
    expect(result.rawTotal).toBe(2);
    expect(result.modifiedTotal).toBe(2); // clamp(2-5, 2, 14) = 2
  });

  it("CHA +5 with high dice produces Helpful band (task 2.9 — skew toward Friendly/Helpful)", () => {
    // Force both dice to 6 (5/6 = 0.833…): raw=12, modified=clamp(12+5,2,14)=14 → Helpful
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(5 / 6) // die1 = Math.floor(0.833*6)+1 = 6
      .mockReturnValueOnce(5 / 6); // die2 = 6
    const result = rollReaction({ ...baseInput, charismaModifier: 5 });
    expect(result.dispositionBand).toBe("Helpful");
  });

  it("CHA +5 with mediocre dice (3+3=6) elevates to Friendly vs Indifferent at CHA 0 (task 2.9)", () => {
    // raw=6: CHA 0 → 6 → Indifferent; CHA +5 → 11 → Friendly
    const mockValue = 2 / 6; // die = Math.floor(0.333*6)+1 = 3

    vi.spyOn(Math, "random")
      .mockReturnValueOnce(mockValue)
      .mockReturnValueOnce(mockValue);
    const neutral = rollReaction({ ...baseInput, charismaModifier: 0 });
    expect(neutral.dispositionBand).toBe("Indifferent");

    vi.spyOn(Math, "random")
      .mockReturnValueOnce(mockValue)
      .mockReturnValueOnce(mockValue);
    const charmed = rollReaction({ ...baseInput, charismaModifier: 5 });
    expect(charmed.dispositionBand).toBe("Friendly");
  });

  it("initialDisposition matches the DISPOSITION_BANDS initial value for the rolled band", () => {
    const result = rollReaction({ ...baseInput, charismaModifier: 0 });
    expect(result.initialDisposition).toBe(DISPOSITION_BANDS[result.dispositionBand].initial);
  });

  it("dice tuple is within [1, 6]", () => {
    const result = rollReaction({ ...baseInput, charismaModifier: 0 });
    expect(result.dice[0]).toBeGreaterThanOrEqual(1);
    expect(result.dice[0]).toBeLessThanOrEqual(6);
    expect(result.dice[1]).toBeGreaterThanOrEqual(1);
    expect(result.dice[1]).toBeLessThanOrEqual(6);
  });
});

// ---------------------------------------------------------------------------
// computeSocialDC
// ---------------------------------------------------------------------------

describe("computeSocialDC", () => {
  it("hostile NPC (disp −8) has higher DC than neutral (disp 0) for same attempt (task 2.12)", () => {
    const hostile = computeSocialDC(-8, 3, "persuade");
    const neutral = computeSocialDC( 0, 3, "persuade");
    expect(hostile).toBeGreaterThan(neutral);
  });

  it("hostile DC vs neutral DC difference equals |disposition| for negative values", () => {
    // dispositionPenalty = Math.max(0, -disposition); so -8 → +8 penalty
    expect(computeSocialDC(-8, 1, "persuade") - computeSocialDC(0, 1, "persuade")).toBe(8);
  });

  it("delta 4 DC is exactly 9 higher than delta 1 DC (task 2.13)", () => {
    const dc1 = computeSocialDC(0, 1, "persuade"); // baseDC + 0 ambition
    const dc4 = computeSocialDC(0, 4, "persuade"); // baseDC + 9 ambition
    expect(dc4 - dc1).toBe(9);
  });

  it("Intimidate DC is exactly 2 lower than Persuade for same disposition and attempt (task 2.14)", () => {
    const intimidate = computeSocialDC(0, 1, "intimidate");
    const persuade   = computeSocialDC(0, 1, "persuade");
    expect(persuade - intimidate).toBe(2);
  });

  it("Deceive DC equals Persuade DC (no modifier)", () => {
    expect(computeSocialDC(0, 2, "deceive")).toBe(computeSocialDC(0, 2, "persuade"));
  });

  it("positive disposition does not reduce DC below baseDC + ambition (dispositionPenalty = 0)", () => {
    expect(computeSocialDC(10, 1, "persuade")).toBe(10); // baseDC=10, no penalty
  });
});

// ---------------------------------------------------------------------------
// resolveSocialCheck
// ---------------------------------------------------------------------------

describe("resolveSocialCheck", () => {
  const baseInput: SocialCheckInput = {
    npcSeed:         "npc_merchant_05",
    characterId:     "char_hero_01",
    approach:        "persuade",
    dispositionDelta: 2,
    intent:          "Offered to share their rations.",
  };

  it("successful Persuade shifts disposition up by delta (task 2.15)", () => {
    // DC = 10 + 0 + (2-1)*3 = 13; roll 15 → success
    vi.spyOn(Math, "random").mockReturnValueOnce(14 / 20); // natural 15
    const result = resolveSocialCheck(baseInput, 0, 0);
    expect(result.success).toBe(true);
    expect(result.dispositionAfter).toBe(0 + 2); // currentDisposition + delta
    expect(result.backfire).toBe(false);
  });

  it("Critical Success (natural 20) shifts disposition by delta + 1 (task 2.18)", () => {
    vi.spyOn(Math, "random").mockReturnValueOnce(19 / 20); // natural 20
    const result = resolveSocialCheck(baseInput, 0, 0);
    expect(result.isCriticalSuccess).toBe(true);
    expect(result.dispositionAfter).toBe(0 + 2 + 1); // delta + 1 bonus
  });

  it("failed Intimidate sets backfire:true and decrements disposition by 1 (task 2.16)", () => {
    // Intimidate DC = 10 + 0 + 0 - 2 = 8; roll 5 → failure
    vi.spyOn(Math, "random").mockReturnValueOnce(4 / 20); // natural 5
    const intimidateInput: SocialCheckInput = {
      ...baseInput,
      approach:        "intimidate",
      dispositionDelta: 1,
    };
    const result = resolveSocialCheck(intimidateInput, 0, 0);
    expect(result.success).toBe(false);
    expect(result.backfire).toBe(true);
    expect(result.dispositionAfter).toBe(0 - 1); // -1 from intimidate failure
  });

  it("Critical Failure + Intimidate decrements disposition by 2 and sets backfire (task 2.16)", () => {
    vi.spyOn(Math, "random").mockReturnValueOnce(0); // natural 1
    const intimidateInput: SocialCheckInput = {
      ...baseInput,
      approach:        "intimidate",
      dispositionDelta: 1,
    };
    const result = resolveSocialCheck(intimidateInput, 0, 0);
    expect(result.isCriticalFailure).toBe(true);
    expect(result.backfire).toBe(true);
    expect(result.dispositionAfter).toBe(0 - 2); // -2 from crit-fail intimidate
  });

  it("failed Persuade does not change disposition", () => {
    // DC = 13; roll 8 → failure
    vi.spyOn(Math, "random").mockReturnValueOnce(7 / 20); // natural 8
    const result = resolveSocialCheck(baseInput, 0, 0);
    expect(result.success).toBe(false);
    expect(result.backfire).toBe(false);
    expect(result.dispositionAfter).toBe(0); // unchanged
  });

  it("disposition clamped at +10 even on Critical Success with high existing disposition (task 2.17)", () => {
    // currentDisposition=9, delta=4 → crit success shift=5 → 9+5=14 clamped to 10
    vi.spyOn(Math, "random").mockReturnValueOnce(19 / 20); // natural 20
    const highDeltaInput: SocialCheckInput = { ...baseInput, dispositionDelta: 4 };
    const result = resolveSocialCheck(highDeltaInput, 0, 9);
    expect(result.dispositionAfter).toBe(10);
  });

  it("disposition clamped at −10 on Critical Failure Intimidate from near-bottom (task 2.17)", () => {
    // currentDisposition=-9, crit fail intimidate shift=-2 → -11 clamped to -10
    vi.spyOn(Math, "random").mockReturnValueOnce(0); // natural 1
    const intimidateInput: SocialCheckInput = {
      ...baseInput,
      approach:        "intimidate",
      dispositionDelta: 1,
    };
    const result = resolveSocialCheck(intimidateInput, 0, -9);
    expect(result.dispositionAfter).toBe(-10);
  });

  it("dispositionBandBefore and dispositionBandAfter are set correctly", () => {
    vi.spyOn(Math, "random").mockReturnValueOnce(19 / 20); // natural 20, always success
    const result = resolveSocialCheck(baseInput, 0, 0); // 0 → Indifferent before
    expect(result.dispositionBandBefore).toBe("Indifferent");
    // After: 0 + 2 + 1 = 3 → Friendly
    expect(result.dispositionBandAfter).toBe("Friendly");
  });

  it("charismaModifier is reflected in total", () => {
    // Roll natural 10, CHA +3 → total 13
    vi.spyOn(Math, "random").mockReturnValueOnce(9 / 20); // natural 10
    const result = resolveSocialCheck(baseInput, 3, 0);
    expect(result.roll).toBe(10);
    expect(result.total).toBe(13);
    expect(result.charismaModifier).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// getRumorsPayload
// ---------------------------------------------------------------------------

describe("getRumorsPayload", () => {
  const nodes = [
    { id: "n1", name: "The Iron Gate",    feature: "exit",    description: "A heavy iron portcullis that seals the lower ward." },
    { id: "n2", name: "The Armoury",      feature: "shop",    description: "Racks of spears and battered shields line the walls." },
    { id: "n3", name: "The Flooded Hall", feature: "hazard",  description: "Knee-deep water conceals something beneath the surface." },
    { id: "n4", name: "The Antechamber",  feature: "empty",   description: "Nothing of note." },
    { id: "n5", name: "The Vault",        feature: "treasure",description: "A locked strongbox sits on a raised dais." },
  ];

  it("returns refusalReason when disposition < 3 (task 2.19 — Hostile)", () => {
    const payload = getRumorsPayload("seed", "Gruff Guard", -8, nodes);
    expect(payload.rumors).toHaveLength(0);
    expect(typeof payload.refusalReason).toBe("string");
    expect(payload.refusalReason!.length).toBeGreaterThan(0);
  });

  it("returns refusalReason when disposition is 2 (Indifferent, < 3)", () => {
    const payload = getRumorsPayload("seed", "Gruff Guard", 2, nodes);
    expect(payload.rumors).toHaveLength(0);
    expect(payload.refusalReason).toBeDefined();
  });

  it("hostile refusal reason differs from indifferent refusal reason", () => {
    const hostile     = getRumorsPayload("seed", "NPC", -5, nodes);
    const indifferent = getRumorsPayload("seed", "NPC",  2, nodes);
    expect(hostile.refusalReason).not.toBe(indifferent.refusalReason);
  });

  it("returns only non-empty-feature nodes when disposition ≥ 3 (task 2.20)", () => {
    const payload = getRumorsPayload("seed", "Friendly Guard", 5, nodes);
    // n4 (empty) must be excluded; the other 4 should be present
    expect(payload.rumors).toHaveLength(4);
    const features = payload.rumors.map((r) => r.feature);
    expect(features).not.toContain("empty");
  });

  it("includes correct nodeId, nodeName, and feature in each RumorItem", () => {
    const payload = getRumorsPayload("seed", "Helpful Guard", 8, nodes);
    const hazardItem = payload.rumors.find((r) => r.nodeId === "n3");
    expect(hazardItem).toBeDefined();
    expect(hazardItem!.nodeName).toBe("The Flooded Hall");
    expect(hazardItem!.feature).toBe("hazard");
  });

  it("each RumorItem.rumor is derived from the node description (task 2.21)", () => {
    const payload = getRumorsPayload("seed", "Helpful Guard", 8, nodes);
    const hazardItem = payload.rumors.find((r) => r.nodeId === "n3");
    // The hazard template includes the description excerpt
    expect(hazardItem!.rumor).toContain("Knee-deep water");
  });

  it("treasure rumor does not include description (template has no excerpt)", () => {
    const payload = getRumorsPayload("seed", "Helpful Guard", 8, nodes);
    const treasureItem = payload.rumors.find((r) => r.nodeId === "n5");
    expect(treasureItem!.rumor).toMatch(/worth finding/i);
    // treasure template: "I've heard there's something worth finding in {name}."
    expect(treasureItem!.rumor).not.toContain("locked strongbox");
  });

  it("exit rumor uses the exit template", () => {
    const payload = getRumorsPayload("seed", "Helpful Guard", 8, nodes);
    const exitItem = payload.rumors.find((r) => r.nodeId === "n1");
    expect(exitItem!.rumor).toMatch(/leads out of this area/i);
  });

  it("returns no refusalReason when disposition ≥ 3", () => {
    const payload = getRumorsPayload("seed", "Helpful Guard", 5, nodes);
    expect(payload.refusalReason).toBeUndefined();
  });

  it("description excerpt is capped at 120 chars in rumor text", () => {
    const longDesc = "X".repeat(200);
    const singleNode = [{ id: "nx", name: "Somewhere", feature: "hazard", description: longDesc }];
    const payload = getRumorsPayload("seed", "Helpful Guard", 5, singleNode);
    // rumor = "Be careful near {name}. {excerpt}."
    // excerpt = longDesc.slice(0,120) = 120 X's
    const rumorText = payload.rumors[0]!.rumor;
    // Should contain exactly 120 X's followed by a period
    expect(rumorText).toContain("X".repeat(120));
    expect(rumorText).not.toContain("X".repeat(121));
  });
});
