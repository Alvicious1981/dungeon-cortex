/**
 * tests/rules/social.test.ts
 *
 * Unit tests for lib/rules/social.ts — Milestone N Slice 1.
 *
 * Architectural contract ("Code is Law"):
 *   - Strictly tests Zod schema validation (parsing, constraints, error handling).
 *   - No tests for function logic or dice math (Slice 2).
 */

import { describe, it, expect } from "vitest";
import {
  NPCSocialStateSchema,
  ReactionRollInputSchema,
  ReactionRollResultSchema,
  SocialCheckInputSchema,
  SocialCheckResultSchema,
  GetRumorsInputSchema,
  RumorItemSchema,
  RumorPayloadSchema,
} from "@/lib/rules/social";

// ---------------------------------------------------------------------------
// NPCSocialStateSchema
// ---------------------------------------------------------------------------

describe("NPCSocialStateSchema", () => {
  const valid = {
    disposition: 5,
    personalityTags: {
      motivation: "To find their lost sibling.",
      secret: "They are a former bandit.",
      distinctiveTrait: "Wears a red scarf.",
    },
    hasMetPlayer: true,
    knownRumors: ["The goblin cave is near the river.", "The merchant is hiding gold."],
  };

  it("parses a valid social state", () => {
    expect(() => NPCSocialStateSchema.parse(valid)).not.toThrow();
  });

  it("allows null disposition and tags", () => {
    const unmet = { ...valid, disposition: null, personalityTags: null, hasMetPlayer: false };
    expect(() => NPCSocialStateSchema.parse(unmet)).not.toThrow();
  });

  it("rejects out-of-range disposition", () => {
    expect(() => NPCSocialStateSchema.parse({ ...valid, disposition: 11 })).toThrow();
    expect(() => NPCSocialStateSchema.parse({ ...valid, disposition: -11 })).toThrow();
  });

  it("requires knownRumors to be an array of strings", () => {
    expect(() => NPCSocialStateSchema.parse({ ...valid, knownRumors: null })).toThrow();
    expect(() => NPCSocialStateSchema.parse({ ...valid, knownRumors: [123] })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ReactionRollInputSchema
// ---------------------------------------------------------------------------

describe("ReactionRollInputSchema", () => {
  const valid = {
    npcSeed: "guard-99",
    npcRole: "guard" as const,
    charismaModifier: 2,
  };

  it("parses valid input", () => {
    expect(() => ReactionRollInputSchema.parse(valid)).not.toThrow();
  });

  it("rejects out-of-range charismaModifier", () => {
    expect(() => ReactionRollInputSchema.parse({ ...valid, charismaModifier: 6 })).toThrow();
    expect(() => ReactionRollInputSchema.parse({ ...valid, charismaModifier: -6 })).toThrow();
  });

  it("rejects invalid npcRole", () => {
    expect(() => ReactionRollInputSchema.parse({ ...valid, npcRole: "king" })).toThrow();
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
      motivation: "Safety.",
      secret: "None.",
      distinctiveTrait: "None.",
    },
  };

  it("parses valid result", () => {
    expect(() => ReactionRollResultSchema.parse(valid)).not.toThrow();
  });

  it("rejects invalid dice values", () => {
    expect(() => ReactionRollResultSchema.parse({ ...valid, dice: [7, 7] })).toThrow();
  });

  it("rejects invalid dispositionBand", () => {
    expect(() => ReactionRollResultSchema.parse({ ...valid, dispositionBand: "Angry" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SocialCheckInputSchema
// ---------------------------------------------------------------------------

describe("SocialCheckInputSchema", () => {
  const valid = {
    npcSeed: "merchant-01",
    characterId: "char_123",
    approach: "persuade" as const,
    dispositionDelta: 2,
    intent: "Ask for a discount.",
  };

  it("parses valid social check input", () => {
    expect(() => SocialCheckInputSchema.parse(valid)).not.toThrow();
  });

  it("rejects out-of-range dispositionDelta", () => {
    expect(() => SocialCheckInputSchema.parse({ ...valid, dispositionDelta: 5 })).toThrow();
    expect(() => SocialCheckInputSchema.parse({ ...valid, dispositionDelta: 0 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SocialCheckResultSchema
// ---------------------------------------------------------------------------

describe("SocialCheckResultSchema", () => {
  const valid = {
    approach: "persuade" as const,
    roll: 12,
    charismaModifier: 2,
    total: 14,
    dc: 10,
    success: true,
    isCriticalSuccess: false,
    isCriticalFailure: false,
    dispositionBefore: 0,
    dispositionAfter: 2,
    dispositionBandBefore: "Indifferent" as const,
    dispositionBandAfter: "Indifferent" as const,
    backfire: false,
  };

  it("parses valid check result", () => {
    expect(() => SocialCheckResultSchema.parse(valid)).not.toThrow();
  });

  it("rejects incompatible disposition before/after types", () => {
    expect(() => SocialCheckResultSchema.parse({ ...valid, dispositionAfter: "great" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Rumors Schemas
// ---------------------------------------------------------------------------

describe("Rumor Schemas", () => {
  const validItem = {
    nodeId: "n1",
    nodeName: "Hall",
    feature: "treasure",
    rumor: "Gold is here.",
    source: "spatial" as const,
  };

  const validPayload = {
    npcName: "Bert",
    disposition: 5,
    dispositionBand: "Friendly" as const,
    rumors: [validItem],
  };

  it("parses valid RumorItem", () => {
    expect(() => RumorItemSchema.parse(validItem)).not.toThrow();
  });

  it("rejects invalid RumorItem source", () => {
    expect(() => RumorItemSchema.parse({ ...validItem, source: "unknown" })).toThrow();
  });

  it("parses valid RumorPayload", () => {
    expect(() => RumorPayloadSchema.parse(validPayload)).not.toThrow();
  });

  it("parses payload with refusalReason", () => {
    expect(() => RumorPayloadSchema.parse({
      ...validPayload,
      rumors: [],
      refusalReason: "No."
    })).not.toThrow();
  });
});
