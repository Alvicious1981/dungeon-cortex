/**
 * lib/rules/social.ts
 *
 * Social Interaction & NPC Disposition System — Milestone N Data Layer (Slice 1).
 *
 * Architectural contract ("Code is Law"):
 *   All types, constants, and helper functions in this module are PURE.
 *   No I/O, no Prisma, no side effects. The same inputs always produce the
 *   same outputs. Business logic (dice rolls, DB writes) lives in later slices.
 *
 * Disposition scale: −10 (Actively Hostile) … 0 (Neutral) … +10 (Actively Helpful).
 * The five-band reaction table is adapted from the OSR/AD&D 1e Reaction Roll.
 */

import { z } from "zod";
import { rollDie, d20Check } from "@/lib/rules/dice";
import { pickSeeded } from "@/lib/rules/generators";

// ---------------------------------------------------------------------------
// Personality Tags
// ---------------------------------------------------------------------------

/** The three Personality Tags that define an NPC's social identity. */
export interface NPCPersonality {
  /**
   * The NPC's primary driving desire — what they want above all else.
   * Example: "To retire and live peacefully on a farm far from the city."
   */
  motivation: string;
  /**
   * A hidden truth they guard carefully. Revealed only at high disposition.
   * Example: "They were once a spy for the Western Compact."
   */
  secret: string;
  /**
   * A memorable physical or behavioral habit that makes them distinct.
   * Example: "Taps the left side of their nose twice before speaking."
   */
  distinctiveTrait: string;
}

// ---------------------------------------------------------------------------
// Disposition Bands — OSR/AD&D 1e Reaction Roll table
// ---------------------------------------------------------------------------

/**
 * The five reaction bands and their properties.
 *   min / max: the 2d6 roll range that maps to this band.
 *   initial:   the disposition integer assigned when the band is first determined.
 */
export const DISPOSITION_BANDS = {
  Hostile:     { min: 2,  max: 3,        initial: -8 },
  Unfriendly:  { min: 4,  max: 5,        initial: -4 },
  Indifferent: { min: 6,  max: 8,        initial:  0 },
  Friendly:    { min: 9,  max: 11,       initial:  4 },
  Helpful:     { min: 12, max: Infinity,  initial:  8 },
} as const;

export type DispositionBand = keyof typeof DISPOSITION_BANDS;

/**
 * Maps a numeric disposition value to its human-readable band label.
 *
 * Boundaries (inclusive):
 *   ≤ −7  → Hostile
 *   ≤ −2  → Unfriendly
 *   ≤  2  → Indifferent
 *   ≤  7  → Friendly
 *   else  → Helpful
 */
export function getDispositionBand(disposition: number): DispositionBand {
  if (disposition <= -7) return "Hostile";
  if (disposition <= -2) return "Unfriendly";
  if (disposition <=  2) return "Indifferent";
  if (disposition <=  7) return "Friendly";
  return "Helpful";
}

// ---------------------------------------------------------------------------
// Default Social State helper
// ---------------------------------------------------------------------------

/** The social fields written to a freshly-created or unmet NPC record. */
export interface DefaultNPCSocialState {
  disposition: null;
  personalityTags: null;
  hasMetPlayer: false;
}

/**
 * Returns the default social state for a new NPC before any player interaction.
 * Pure — no arguments required; values are spec-mandated constants.
 */
export function defaultNPCSocialState(): DefaultNPCSocialState {
  return {
    disposition: null,
    personalityTags: null,
    hasMetPlayer: false,
  };
}

// ---------------------------------------------------------------------------
// Zod Schemas — Tool I/O contracts
// ---------------------------------------------------------------------------

// --- ReactionRollInput ---

export const ReactionRollInputSchema = z
  .object({
    npcSeed: z
      .string()
      .min(1)
      .max(100)
      .describe(
        "The NPC's stable seed identifier. Must match the NPC's seed in the database. " +
          "This drives personality tag generation and disposition persistence."
      ),
    npcRole: z
      .enum(["guard", "bandit", "commoner"])
      .describe("The NPC's role — used to ensure the NPC record exists before rolling."),
    charismaModifier: z
      .number()
      .int()
      .min(-5)
      .max(5)
      .describe(
        "The party leader's Charisma ability modifier (NOT the score itself). " +
          "Derived from the Character's CHA stat: floor((CHA - 10) / 2). " +
          "Clamped to [-5, +5] — extremely high or low CHA has diminishing returns."
      ),
  })
  .strict();

export type ReactionRollInput = z.infer<typeof ReactionRollInputSchema>;

// --- ReactionRollResult ---

export const ReactionRollResultSchema = z.object({
  dice: z.tuple([
    z.number().int().min(1).max(6),
    z.number().int().min(1).max(6),
  ]),
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

// --- SocialCheckInput ---

export const SocialCheckInputSchema = z
  .object({
    npcSeed: z
      .string()
      .min(1)
      .max(100)
      .describe("The NPC's stable seed identifier."),
    characterId: z
      .string()
      .min(1)
      .describe("The character performing the social action — drives CHA mod derivation."),
    approach: z
      .enum(["persuade", "intimidate", "deceive"])
      .describe(
        "The social technique the player is using. " +
          "Persuade: appeals to reason or goodwill. " +
          "Intimidate: appeals to fear — risks backfire. " +
          "Deceive: uses misdirection — DC scales with NPC's INT modifier."
      ),
    dispositionDelta: z
      .number()
      .int()
      .min(1)
      .max(4)
      .describe(
        "How many disposition points the player is attempting to shift. " +
          "Higher deltas are harder to achieve (DC increases proportionally). " +
          "Typical values: 1 (small shift), 2 (notable shift), 3 (major shift), 4 (exceptional)."
      ),
    intent: z
      .string()
      .max(200)
      .describe(
        "A brief description of what the player said or did, in their own words. " +
          "Used by the Narrator to frame the outcome narratively. Not used in the math."
      ),
  })
  .strict();

export type SocialCheckInput = z.infer<typeof SocialCheckInputSchema>;

// --- SocialCheckResult ---

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
  backfire: z.boolean().describe("True if Intimidate failed and caused disposition to drop."),
});

export type SocialCheckResult = z.infer<typeof SocialCheckResultSchema>;

// --- GetRumorsInput ---

export const GetRumorsInputSchema = z
  .object({
    npcSeed: z
      .string()
      .min(1)
      .max(100)
      .describe("The NPC seed — used to verify disposition before sharing information."),
    campaignId: z
      .string()
      .min(1)
      .describe("The campaign ID — used to scope the location graph query."),
  })
  .strict();

export type GetRumorsInput = z.infer<typeof GetRumorsInputSchema>;

// --- RumorPayload ---

export const RumorItemSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  feature: z.string(),
  /** A single sentence of in-world knowledge the NPC can share about this node. */
  rumor: z.string().max(300),
});

export const RumorPayloadSchema = z.object({
  npcName: z.string(),
  disposition: z.number().int().min(-10).max(10),
  dispositionBand: z.enum(["Hostile", "Unfriendly", "Indifferent", "Friendly", "Helpful"]),
  rumors: z.array(RumorItemSchema),
  /** If disposition < 3 — explains why no rumors were shared. */
  refusalReason: z.string().optional(),
});

export type RumorItem = z.infer<typeof RumorItemSchema>;
export type RumorPayload = z.infer<typeof RumorPayloadSchema>;

// ---------------------------------------------------------------------------
// Personality tag tables — deterministic source of NPC character
// ---------------------------------------------------------------------------

/** Primary driving desires — what the NPC wants above all else. */
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

/** Hidden truths the NPC guards carefully. */
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

/** Memorable physical or behavioural habits that make the NPC distinct. */
export const DISTINCTIVE_TRAITS: readonly string[] = [
  "Always touches the left side of their jaw when thinking.",
  "Repeats the last three words of anything they hear before responding.",
  "Keeps their hands folded behind their back at all times.",
  "Smells faintly of woodsmoke, even indoors.",
  "Refers to themselves in the second person when nervous.",
  "Never maintains eye contact for more than two seconds.",
  "Always knows exactly what time it is without checking a clock.",
  "Counts things obsessively — stones in a wall, chairs in a room.",
  "Has a habit of ending sentences with a question when uncertain.",
  "Moves with startling silence despite their apparent size.",
  "Never sits with their back to a door.",
  "Always finishes what is on their plate before speaking.",
  "Refers to strangers as 'friend' before being given a reason to.",
  "Taps the table twice with two fingers before answering a question.",
  "Pauses mid-sentence and looks away as if hearing something distant.",
  "Keeps a coin between two fingers and rolls it constantly.",
  "Laughs quietly to themselves at something only they understand.",
  "Straightens objects on surfaces nearby when they think no one is watching.",
  "Always seems to know the name of the person speaking before being told.",
  "Wears gloves indoors and never explains why.",
  "Addresses everyone by their occupation rather than their name.",
  "Whistles a few bars of the same tune whenever they are deciding something.",
] as const;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Clamps `value` to the inclusive range [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Maps a modified 2d6 roll total to a DispositionBand.
 * Matches the OSR/AD&D 1e Reaction Roll table exactly.
 */
function getBandFromRollTotal(total: number): DispositionBand {
  if (total <= 3)  return "Hostile";
  if (total <= 5)  return "Unfriendly";
  if (total <= 8)  return "Indifferent";
  if (total <= 11) return "Friendly";
  return "Helpful";
}

/**
 * Builds a single-sentence diegetic rumor from a location node.
 * Description is truncated to 120 chars for context economy.
 */
function buildRumorText(feature: string, name: string, description: string): string {
  const excerpt = description.slice(0, 120);
  switch (feature) {
    case "npc":        return `There's someone in ${name} — ${excerpt}.`;
    case "hazard":     return `Be careful near ${name}. ${excerpt}.`;
    case "treasure":   return `I've heard there's something worth finding in ${name}.`;
    case "quest_hook": return `Trouble in ${name}, if you're looking for work. ${excerpt}.`;
    case "rest":       return `${name} is safe to rest in, from what I know.`;
    case "shop":       return `You can buy supplies in ${name}.`;
    case "exit":       return `${name} leads out of this area.`;
    default:           return `I've heard something about ${name} — ${excerpt}.`;
  }
}

// ---------------------------------------------------------------------------
// Pure engine functions — Slice 2
// ---------------------------------------------------------------------------

/**
 * Generates deterministic personality tags from an NPC's stable seed string.
 * Pure: same seed always returns the same NPCPersonality.
 */
export function generateNPCPersonality(seed: string): NPCPersonality {
  return {
    motivation:     pickSeeded(seed + ":motivation", MOTIVATIONS),
    secret:         pickSeeded(seed + ":secret",     SECRETS),
    distinctiveTrait: pickSeeded(seed + ":trait",    DISTINCTIVE_TRAITS),
  };
}

/**
 * Performs the AD&D 1e 2d6 Reaction Roll to determine an NPC's initial disposition.
 * Pure: calls rollDie() internally for randomness; all other logic is deterministic.
 *
 * CHA modifier is clamped: the modified total cannot drop below 2 (worst possible
 * 2d6 result) or exceed 14 (well past the top of the Helpful band).
 */
export function rollReaction(input: ReactionRollInput): ReactionRollResult {
  const die1 = rollDie(6);
  const die2 = rollDie(6);
  const rawTotal = die1 + die2;
  const modifiedTotal = clamp(rawTotal + input.charismaModifier, 2, 14);
  const dispositionBand = getBandFromRollTotal(modifiedTotal);
  const initialDisposition = DISPOSITION_BANDS[dispositionBand].initial;
  const personality = generateNPCPersonality(input.npcSeed);

  return {
    dice: [die1, die2],
    rawTotal,
    modifiedTotal,
    charismaModifier: input.charismaModifier,
    dispositionBand,
    initialDisposition,
    personality,
  };
}

/**
 * Computes the Difficulty Class for a social check.
 *
 * Factors:
 *   - Hostile NPCs resist persuasion — every point below 0 adds 1 to DC.
 *   - Larger disposition shifts are harder — each extra point costs +3 DC.
 *   - Intimidation is 2 points easier in raw DC, but risks backfire on failure.
 */
export function computeSocialDC(
  disposition: number,
  attempt: number,
  approach: "persuade" | "intimidate" | "deceive",
): number {
  const baseDC           = 10;
  const dispositionPenalty = Math.max(0, -disposition);          // hostile NPC penalty
  const ambitionPenalty  = (attempt - 1) * 3;                   // delta scaling
  const approachModifier = approach === "intimidate" ? -2 : 0;  // intimidate is easier, but risky

  return baseDC + dispositionPenalty + ambitionPenalty + approachModifier;
}

/**
 * Resolves a social action (Persuade / Intimidate / Deceive) against an NPC.
 * Pure: all randomness comes from the internal d20Check call.
 *
 * Disposition shift rules:
 *   Critical Success (nat 20) → delta + 1
 *   Success                   → delta
 *   Critical Failure (nat 1) + Intimidate → −2 (backfire)
 *   Critical Failure (nat 1) + other      → 0
 *   Failure + Intimidate                  → −1 (backfire)
 *   Failure + other                       → 0
 */
export function resolveSocialCheck(
  input: SocialCheckInput,
  charismaModifier: number,
  currentDisposition: number,
): SocialCheckResult {
  const dc          = computeSocialDC(currentDisposition, input.dispositionDelta, input.approach);
  const checkResult = d20Check(charismaModifier, dc);
  const natural     = checkResult.roll.dice[0]!.result;

  let dispositionShift: number;
  if (checkResult.isCriticalSuccess) {
    dispositionShift = input.dispositionDelta + 1;
  } else if (checkResult.success) {
    dispositionShift = input.dispositionDelta;
  } else if (checkResult.isCriticalFailure) {
    dispositionShift = input.approach === "intimidate" ? -2 : 0;
  } else {
    // Normal failure
    dispositionShift = input.approach === "intimidate" ? -1 : 0;
  }

  const dispositionAfter = clamp(currentDisposition + dispositionShift, -10, 10);

  return {
    approach:             input.approach,
    roll:                 natural,
    charismaModifier,
    total:                checkResult.roll.total,
    dc,
    success:              checkResult.success,
    isCriticalSuccess:    checkResult.isCriticalSuccess,
    isCriticalFailure:    checkResult.isCriticalFailure,
    dispositionBefore:    currentDisposition,
    dispositionAfter,
    dispositionBandBefore: getDispositionBand(currentDisposition),
    dispositionBandAfter:  getDispositionBand(dispositionAfter),
    backfire:             input.approach === "intimidate" && !checkResult.success,
  };
}

/**
 * Builds a RumorPayload from in-memory location node data.
 * Pure: no I/O. Returns empty rumors with a refusal reason when disposition < 3.
 *
 * Only nodes with a non-"empty" feature tag contribute rumors.
 * Rumor text is derived entirely from the node's persisted description — no invention.
 */
export function getRumorsPayload(
  _npcSeed: string,
  npcName: string,
  disposition: number,
  nearbyNodes: Array<{ id: string; name: string; feature: string; description: string }>,
): RumorPayload {
  const dispositionBand = getDispositionBand(disposition);

  if (disposition < 3) {
    const refusalReason =
      disposition < -2
        ? "This NPC is hostile and will not speak."
        : "This NPC is indifferent and unwilling to share information freely.";
    return { npcName, disposition, dispositionBand, rumors: [], refusalReason };
  }

  const rumors: RumorItem[] = nearbyNodes
    .filter((node) => node.feature !== "empty")
    .map((node) => ({
      nodeId:   node.id,
      nodeName: node.name,
      feature:  node.feature,
      rumor:    buildRumorText(node.feature, node.name, node.description),
    }));

  return { npcName, disposition, dispositionBand, rumors };
}
