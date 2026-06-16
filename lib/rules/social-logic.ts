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
  InitialDispositionInput,
  InitialDispositionResult,
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
 * Maps a modified D&D 5e d20 ability check total to a DispositionBand.
 */
function getBandFromD20Total(total: number): DispositionBand {
  if (total <= 5)  return "Hostile";
  if (total <= 9)  return "Unfriendly";
  if (total <= 14) return "Indifferent";
  if (total <= 19) return "Friendly";
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
 * Establishes first-contact disposition with a backend-owned D&D 5e d20
 * Charisma ability check. The AI may narrate only this resolved result.
 */
export function establishInitialDisposition(input: InitialDispositionInput): InitialDispositionResult {
  const roll = rollDie(20);
  const total = clamp(roll + input.charismaModifier, 1, 25);
  const dispositionBand = getBandFromD20Total(total);
  const initialDisposition = DISPOSITION_BANDS[dispositionBand].initial;
  const personality = generateNPCPersonality(input.npcSeed);

  return {
    roll,
    total,
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
