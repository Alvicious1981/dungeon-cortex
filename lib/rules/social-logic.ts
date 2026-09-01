/**
 * lib/rules/social-logic.ts
 * 
 * Logic engine for the Social Interaction & NPC Disposition System.
 * Moved from social.ts to adhere to Milestone N Slice 2 separation.
 */

import { pickSeeded } from "@/lib/rules/generators";
import { type NPCRole } from "@/lib/rules/npc";
import { resolveAbilityCheck, type AbilityCheckActor, type Skill } from "@/lib/rules/ability-check";
import {
  NPCPersonality,
  DispositionBand,
  DefaultNPCSocialState,
  SocialCheckInput,
  SocialCheckResult,
  RumorPayload,
  RumorItem,
  MOTIVATIONS,
  SECRETS,
  DISTINCTIVE_TRAITS,
  ATTITUDE_DIFFICULTY,
  type NpcAttitude
} from "./social";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** How far one check moves the stored disposition. */
export const ATTITUDE_SHIFT = 4;

const MIN_DISPOSITION = -10;
const MAX_DISPOSITION = 10;

/**
 * The attitude a stored disposition represents.
 *
 * Null means the party has never spoken to this NPC. A stranger is
 * Indifferent — the 5e default — rather than a special fourth state.
 */
export function attitudeFor(disposition: number | null | undefined): NpcAttitude {
  const value = disposition ?? 0;
  if (value <= -4) return "Hostile";
  if (value <= 3) return "Indifferent";
  return "Friendly";
}

/**
 * The disposition after one social check.
 *
 * Success and failure are worth the same in opposite directions, and the
 * approach does not enter it: persuading, deceiving and threatening differ in
 * which skill is rolled, not in what the attempt is worth. Each band is seven
 * points wide, so a shift of four moves attitude by at most one step.
 */
export function shiftDisposition(disposition: number, success: boolean): number {
  const shifted = disposition + (success ? ATTITUDE_SHIFT : -ATTITUDE_SHIFT);
  return Math.max(MIN_DISPOSITION, Math.min(MAX_DISPOSITION, shifted));
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
 * How a stranger of each role tends to receive the party.
 *
 * Weighted by repetition rather than by a probability table, because
 * `pickSeeded` picks uniformly and the weighting should be visible in the
 * data rather than hidden in arithmetic.
 */
const ATTITUDE_BY_ROLE: Record<NPCRole, readonly NpcAttitude[]> = {
  bandit: ["Hostile", "Hostile", "Indifferent"],
  guard: ["Indifferent", "Indifferent", "Friendly"],
  commoner: ["Indifferent", "Friendly", "Friendly"],
};

/** The stored disposition each attitude starts at — the middle of its band. */
export const INITIAL_DISPOSITION: Record<NpcAttitude, number> = {
  Hostile: -7,
  Indifferent: 0,
  Friendly: 7,
};

/**
 * The attitude an NPC holds the first time the party meets them.
 *
 * Derived from the seed, like every other fact about an NPC, so the same
 * person always greets the party the same way. This replaces a d20 + Charisma
 * roll: that was a reaction roll, which this project does not use as an
 * authoritative mechanic, and it made how a stranger felt about you depend on
 * who happened to be doing the talking.
 */
export function initialAttitudeFor(seed: string, role: NPCRole): NpcAttitude {
  return pickSeeded(seed + ":attitude", ATTITUDE_BY_ROLE[role]);
}

const APPROACH_SKILL = {
  persuade: "Persuasion",
  intimidate: "Intimidation",
  deceive: "Deception",
} as const satisfies Record<SocialCheckInput["approach"], Skill>;

/**
 * Resolves one attempt to talk a creature round.
 *
 * The dice, the ability, the proficiency bonus and advantage all come from
 * `resolveAbilityCheck` — this is a Charisma skill check like any other, and
 * reimplementing it here is how the two would come to disagree. What is social
 * about it is only which skill the approach names and where the DC comes from.
 *
 * `isCriticalSuccess` and `isCriticalFailure` are deliberately not read: in 5e
 * a natural 20 or 1 has no special effect on an ability check. The natural
 * roll is reported so narration can mention it, but no rule turns on it.
 */
export function resolveSocialCheck(
  input: SocialCheckInput,
  actor: AbilityCheckActor,
  disposition: number | null
): SocialCheckResult {
  const attitudeBefore = attitudeFor(disposition);
  const skill = APPROACH_SKILL[input.approach];

  const check = resolveAbilityCheck(
    { skill, band: ATTITUDE_DIFFICULTY[attitudeBefore] },
    actor
  );

  const dispositionBefore = disposition ?? 0;
  const dispositionAfter = shiftDisposition(dispositionBefore, check.success);

  return {
    approach: input.approach,
    skill,
    roll: check.roll,
    abilityModifier: check.abilityModifier,
    proficiencyApplied: check.proficiencyApplied,
    total: check.total,
    dc: check.dc,
    success: check.success,
    attitudeBefore,
    attitudeAfter: attitudeFor(dispositionAfter),
    dispositionBefore,
    dispositionAfter,
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
