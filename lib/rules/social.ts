/**
 * lib/rules/social.ts
 *
 * Social Interaction & NPC Disposition System — Milestone N Data Layer (Slice 1).
 *
 * Architectural contract ("Code is Law"):
 *   This module contains ONLY Zod schemas and TypeScript type definitions.
 *   DO NOT implement function logic here (see social-logic.ts for Slice 2).
 *   DO NOT perform I/O or side effects.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Constants & Bands
// ---------------------------------------------------------------------------

/**
 * The five reaction bands and their properties.
 * Adapted from OSR/AD&D 1e Reaction Roll.
 */
export const DISPOSITION_BANDS = {
  Hostile:     { min: 2,  max: 3,        initial: -8 },
  Unfriendly:  { min: 4,  max: 5,        initial: -4 },
  Indifferent: { min: 6,  max: 8,        initial:  0 },
  Friendly:    { min: 9,  max: 11,       initial:  4 },
  Helpful:     { min: 12, max: Infinity,  initial:  8 },
} as const;

export type DispositionBand = keyof typeof DISPOSITION_BANDS;

// ---------------------------------------------------------------------------
// Core Types
// ---------------------------------------------------------------------------

/** The three Personality Tags that define an NPC's social identity. */
export interface NPCPersonality {
  motivation: string;
  secret: string;
  distinctiveTrait: string;
}

/** The persistent social state of an NPC as stored in the database. */
export const NPCSocialStateSchema = z.object({
  disposition: z.number().int().min(-10).max(10).nullable(),
  personalityTags: z.object({
    motivation: z.string(),
    secret: z.string(),
    distinctiveTrait: z.string(),
  }).nullable(),
  hasMetPlayer: z.boolean(),
  knownRumors: z.array(z.string()),
});

export type NPCSocialState = z.infer<typeof NPCSocialStateSchema>;

/** The social fields for a freshly-created or unmet NPC record. */
export interface DefaultNPCSocialState {
  disposition: null;
  personalityTags: null;
  hasMetPlayer: false;
  knownRumors: string[];
}

// ---------------------------------------------------------------------------
// Tool Schemas
// ---------------------------------------------------------------------------

// --- ReactionRoll ---

export const ReactionRollInputSchema = z
  .object({
    npcSeed: z.string().min(1).max(100),
    npcRole: z.enum(["guard", "bandit", "commoner"]),
    charismaModifier: z.number().int().min(-5).max(5),
  })
  .strict();

export type ReactionRollInput = z.infer<typeof ReactionRollInputSchema>;

export const ReactionRollResultSchema = z.object({
  dice: z.tuple([z.number().int().min(1).max(6), z.number().int().min(1).max(6)]),
  rawTotal: z.number().int(),
  modifiedTotal: z.number().int(),
  charismaModifier: z.number().int(),
  dispositionBand: z.enum(["Hostile", "Unfriendly", "Indifferent", "Friendly", "Helpful"]),
  initialDisposition: z.number().int().min(-10).max(10),
  personality: z.object({
    motivation: z.string(),
    secret: z.string(),
    distinctiveTrait: z.string(),
  }),
});

export type ReactionRollResult = z.infer<typeof ReactionRollResultSchema>;

// --- SocialCheck ---

export const SocialCheckInputSchema = z
  .object({
    npcSeed: z.string().min(1).max(100),
    approach: z.enum(["persuade", "intimidate", "deceive"]),
    dispositionDelta: z.number().int().min(1).max(4),
    intent: z.string().max(200),
  })
  .strict();

export type SocialCheckInput = z.infer<typeof SocialCheckInputSchema>;

export const SocialCheckResultSchema = z.object({
  approach: z.enum(["persuade", "intimidate", "deceive"]),
  roll: z.number().int(),
  charismaModifier: z.number().int(),
  total: z.number().int(),
  dc: z.number().int(),
  success: z.boolean(),
  isCriticalSuccess: z.boolean(),
  isCriticalFailure: z.boolean(),
  dispositionBefore: z.number().int().min(-10).max(10),
  dispositionAfter: z.number().int().min(-10).max(10),
  dispositionBandBefore: z.enum(["Hostile", "Unfriendly", "Indifferent", "Friendly", "Helpful"]),
  dispositionBandAfter: z.enum(["Hostile", "Unfriendly", "Indifferent", "Friendly", "Helpful"]),
  backfire: z.boolean(),
});

export type SocialCheckResult = z.infer<typeof SocialCheckResultSchema>;

// --- Rumors ---

export const GetRumorsInputSchema = z
  .object({
    npcSeed: z.string().min(1).max(100),
  })
  .strict();

export type GetRumorsInput = z.infer<typeof GetRumorsInputSchema>;

export const RumorItemSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  feature: z.string(),
  rumor: z.string().max(300),
  source: z.enum(["spatial", "personal"]),
});

export const RumorPayloadSchema = z.object({
  npcName: z.string(),
  disposition: z.number().int().min(-10).max(10),
  dispositionBand: z.enum(["Hostile", "Unfriendly", "Indifferent", "Friendly", "Helpful"]),
  rumors: z.array(RumorItemSchema),
  refusalReason: z.string().optional(),
});

export type RumorItem = z.infer<typeof RumorItemSchema>;
export type RumorPayload = z.infer<typeof RumorPayloadSchema>;

// ---------------------------------------------------------------------------
// Tables (Deterministic source data)
// ---------------------------------------------------------------------------

export const MOTIVATIONS: readonly string[] = [
  "To repay an old debt before they die.",
  "To protect a family member no one else knows about.",
  "To accumulate enough wealth to buy land and retire.",
  "To prove themselves to a mentor who doubted them.",
  "To find a cure for a slow illness that plagues them.",
  "To uncover the truth behind a loved one's disappearance.",
  "To atone for an act of cowardice they committed years ago.",
  "To outlast every enemy who has ever wronged them.",
  "To reach a place they have only ever read about in a book.",
  "To keep a promise made to someone now dead.",
  "To see their hometown one more time before they die.",
  "To ensure their children never suffer the poverty they grew up in.",
  "To find out whether a rumour about their parentage is true.",
  "To earn enough respect that no one ever looks down at them again.",
  "To destroy something they once created and now regret.",
  "To find absolution from a religious authority they wronged.",
  "To gather enough information to bring down someone powerful.",
  "To finish a piece of work their dead master left incomplete.",
  "To keep a dangerous secret buried until they can die in peace.",
  "To understand why they alone survived when everyone else perished.",
  "To return a stolen heirloom to the family it was taken from.",
  "To outlive a sibling who was always deemed the favourite.",
] as const;

export const SECRETS: readonly string[] = [
  "They once betrayed a trusted friend to save their own life.",
  "They can read and write, but hide it to appear nonthreatening.",
  "They are secretly employed by the city watch as an informant.",
  "They stole their current name from a dead stranger.",
  "They owe money to people who will hurt their family if unpaid.",
  "They witnessed a murder and chose to say nothing.",
  "Their skill set was learned in prison.",
  "They have a child in another settlement that they don't acknowledge.",
  "They are slowly dying and have made peace with it.",
  "They know the location of something valuable and illegal.",
  "They were once a member of a now-outlawed organisation.",
  "They lied under oath and an innocent person suffered for it.",
  "They have been impersonating someone else for over a year.",
  "They possess a stolen document that could ruin a powerful family.",
  "They are not the person they claim to be — not even close.",
  "They practice a religion that would earn them exile if discovered.",
  "They sold a comrade's whereabouts to their enemies to survive.",
  "They are in contact with someone everyone else believes to be dead.",
  "They have never told anyone about the thing they saw in the dark.",
  "They carry an object they do not know the purpose of — but fear it.",
  "They have memorised the faces of the three people who ruined their life.",
  "They are terrified of a specific sound and cannot explain why.",
] as const;

export const DISTINCTIVE_TRAITS: readonly string[] = [
  "Always touches the left side of their jaw when thinking.",
  "Pauses mid-sentence and looks away as if hearing something distant.",
  "Moves with startling silence despite their apparent size.",
  "Refers to strangers as 'friend' before being given a reason to.",
  "Never sits with their back to a door.",
  "Counts things obsessively — stones in a wall, chairs in a room.",
  "Smells faintly of damp earth and old parchment.",
  "Their eyes are of slightly different colors, one clouding with a cataract.",
  "Wears a ring that they constantly twist until the skin is raw.",
  "Carries a small, dried flower in their hand, stroking it absentmindedly.",
  "Always stands just an inch too close for comfort.",
  "Has a voice like gravel grinding on silk.",
  "Possesses a nervous tic where they occasionally tap their chest three times.",
  "Avoids eye contact, looking instead at the player's throat.",
  "Their clothes are meticulously clean but decades out of fashion.",
  "Has a long, silver scar that runs from their ear to their collarbone.",
  "Laughs at things that aren't funny, a dry, wheezing sound.",
  "Constantly adjusts a heavy, leather-bound book strapped to their hip.",
  "Their fingernails are bitten down to the quick and stained with ink.",
  "Carries a faint, metallic scent of old blood about them.",
  "Has a habit of whistling a low, mournful tune when alone.",
  "Their shadow seems to move a fraction of a second after they do.",
] as const;
