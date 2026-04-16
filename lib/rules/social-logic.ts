/**
 * lib/rules/social-logic.ts
 * 
 * Logic engine for the Social Interaction & NPC Disposition System.
 * Moved from social.ts to adhere to Milestone N Slice 2 separation.
 */

import { rollDie, d20Check } from "@/lib/rules/dice";
import { pickSeeded } from "@/lib/rules/generators";
import { 
  NPCPersonality, 
  DispositionBand, 
  DISPOSITION_BANDS,
  DefaultNPCSocialState,
  ReactionRollInput,
  ReactionRollResult,
  SocialCheckInput,
  SocialCheckResult,
  RumorPayload,
  RumorItem,
  MOTIVATIONS,
  SECRETS,
  DISTINCTIVE_TRAITS
} from "./social";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamps `value` to the inclusive range [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Maps a numeric disposition value to its human-readable band label.
 */
export function getDispositionBand(disposition: number): DispositionBand {
  if (disposition <= -7) return "Hostile";
  if (disposition <= -2) return "Unfriendly";
  if (disposition <=  2) return "Indifferent";
  if (disposition <=  7) return "Friendly";
  return "Helpful";
}

/**
 * Maps a modified 2d6 roll total to a DispositionBand.
 */
function getBandFromRollTotal(total: number): DispositionBand {
  if (total <= 3)  return "Hostile";
  if (total <= 5)  return "Unfriendly";
  if (total <= 8)  return "Indifferent";
  if (total <= 11) return "Friendly";
  return "Helpful";
}

/**
 * Returns the default social state for a new NPC.
 */
export function defaultNPCSocialState(): DefaultNPCSocialState {
  return {
    disposition: null,
    personalityTags: null,
    hasMetPlayer: false,
    knownRumors: [],
  };
}

/**
 * Builds a single-sentence diegetic rumor from a location node.
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
// Engine Functions
// ---------------------------------------------------------------------------

/**
 * Generates deterministic personality tags from an NPC's stable seed string.
 */
export function generateNPCPersonality(seed: string): NPCPersonality {
  return {
    motivation:     pickSeeded(seed + ":motivation", MOTIVATIONS),
    secret:         pickSeeded(seed + ":secret",     SECRETS),
    distinctiveTrait: pickSeeded(seed + ":trait",    DISTINCTIVE_TRAITS),
  };
}

/**
 * Performs the AD&D 1e 2d6 Reaction Roll.
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
 */
export function computeSocialDC(
  disposition: number,
  attempt: number,
  approach: "persuade" | "intimidate" | "deceive",
): number {
  const baseDC           = 10;
  const dispositionPenalty = Math.max(0, -disposition);
  const ambitionPenalty  = (attempt - 1) * 3;
  const approachModifier = approach === "intimidate" ? -2 : 0;

  return baseDC + dispositionPenalty + ambitionPenalty + approachModifier;
}

/**
 * Resolves a social action (Persuade / Intimidate / Deceive).
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
 * Builds a RumorPayload from location and personal rumors.
 */
export function getRumorsPayload(
  _npcSeed: string,
  npcName: string,
  disposition: number,
  nearbyNodes: Array<{ id: string; name: string; feature: string; description: string }>,
  knownRumors: string[] = [],
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
      source:   "spatial",
    }));

  // Add personal rumors
  knownRumors.forEach((r, i) => {
    rumors.push({
      nodeId:   `personal-${i}`,
      nodeName: "Rumor",
      feature:  "personal",
      rumor:    r,
      source:   "personal",
    });
  });

  return { npcName, disposition, dispositionBand, rumors };
}
