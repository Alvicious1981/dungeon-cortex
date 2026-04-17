/**
 * lib/rules/quests.ts
 *
 * Procedural quest template data and generator — Milestone I Slices 5 & 6.
 *
 * Pure module: no I/O, no side effects, no external dependencies beyond
 * the project's own deterministic PRNG utilities.
 *
 * generateQuest() is the public generation API; all four table picks are
 * driven by independent salts from a single numeric seed so they are
 * uncorrelated — the same seed always produces the same quest, forever.
 */

import { seededFloat } from "@/lib/rules/generators";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/**
 * A procedurally generated quest record, ready for DB insertion.
 * All text fields are drawn from the template tables below.
 */
export interface ProceduralQuest {
  /** Short, evocative quest title. */
  title: string;
  /** One-sentence narrative description. */
  description: string;
  /** The inciting detail that draws the party in. */
  hook: string;
  /** The primary location the quest leads to. */
  location: string;
  /** The specific task the party must accomplish. */
  objective: string;
  /** What the party stands to gain on completion. */
  reward: string;
  /** Seed of the NPC who issued the quest. Optional — some quests have no named giver. */
  giverId?: string;
}

// ---------------------------------------------------------------------------
// Hooks — the inciting incident that triggers the quest
// ---------------------------------------------------------------------------

/**
 * Dark-fantasy narrative hooks.
 * Each entry is a brief, atmospheric detail that raises a question demanding action.
 */
export const QUEST_HOOKS: readonly string[] = [
  "A dying merchant clutches a sealed letter addressed to no one.",
  "The village well has run black for three days.",
  "A child keeps drawing the same ruined tower in her sleep.",
  "The local lord's tax collector has not returned from the eastern road.",
  "Headstones in the old graveyard have begun to sink overnight.",
  "A merchant ship docked with no crew and a hold full of ash.",
  "The local priest was found dead in his locked vestry, hands folded in prayer.",
  "Three soldiers from the garrison deserted the same night without a word.",
  "Someone has been leaving carved bone figures on doorsteps.",
  "The blacksmith's apprentice returned from the mines speaking in a dead language.",
] as const;

// ---------------------------------------------------------------------------
// Locations — where the quest takes the party
// ---------------------------------------------------------------------------

/**
 * Dark-fantasy quest locations.
 * Each entry is a named place with an atmospheric qualifier.
 */
export const QUEST_LOCATIONS: readonly string[] = [
  "the Ashwood, a forest where no birds sing",
  "the sunken ruins of Old Crestfall beneath the lake",
  "the Ironveil Pass, perpetually shrouded in fog",
  "the Ember Cairn, a barrow mound that glows at night",
  "the Hollow Keep, a fortress abandoned after the Red Plague",
  "the Saltmarsh Catacombs beneath the docks",
  "Vordenmoor, a village that appears on no map",
  "the Broken Spire, a wizard's tower struck by lightning years ago",
  "the Charnel Fields east of the city walls",
  "the Drowned Warrens, flooded tunnels under the river district",
] as const;

// ---------------------------------------------------------------------------
// Objectives — what the party must accomplish
// ---------------------------------------------------------------------------

/**
 * Concrete, actionable quest objectives.
 * Phrased imperatively to drive player intent.
 */
export const QUEST_OBJECTIVES: readonly string[] = [
  "Recover the sealed chest before the garrison arrives.",
  "Find out what happened to the missing patrol.",
  "Destroy the source of the corruption before it spreads.",
  "Escort the witness to safety without being seen.",
  "Retrieve the artifact and ask no questions about its origin.",
  "End whatever has been feeding on the village livestock.",
  "Infiltrate the compound and confirm whether the contact is still alive.",
  "Burn the records before they fall into the wrong hands.",
  "Seal the breach in the vault before dawn.",
  "Identify the traitor before the delegation arrives.",
] as const;

// ---------------------------------------------------------------------------
// Rewards — what the party gains on completion
// ---------------------------------------------------------------------------

/**
 * Grounded, morally ambiguous rewards in keeping with the dark-fantasy tone.
 * Rewards are not just gold — they are favors, access, and information.
 */
export const QUEST_REWARDS: readonly string[] = [
  "Forty gold pieces and the merchant's silence.",
  "A deed to a small parcel of land outside the city walls.",
  "A favor from someone with influence over the city guard.",
  "Access to a locked vault no longer guarded by its original owner.",
  "A masterwork weapon recovered from the ruins.",
  "Immunity from a particular tax collector's scrutiny.",
  "A map fragment that leads somewhere worth the risk.",
  "A letter of introduction that opens doors in the capital.",
  "Three vials of rare alchemical substance — no questions asked.",
  "The name of the person who ordered the contract.",
] as const;

// ---------------------------------------------------------------------------
// Titles — short, evocative quest names
// ---------------------------------------------------------------------------

/**
 * Dark-fantasy quest titles.
 * Picked independently of the other tables so any title can pair with any hook.
 */
export const QUEST_TITLES: readonly string[] = [
  "The Black Messenger",
  "The Silent Well",
  "Waking in the Dark",
  "The Absent Patrol",
  "The Sinking Dead",
  "The Empty Hold",
  "The Locked Vestry",
  "The Night Deserters",
  "The Bone Figures",
  "The Dead Tongue",
] as const;

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

/**
 * Deterministically picks one item from `table` using `seed` and `salt`.
 * Different salts produce uncorrelated picks from the same numeric seed.
 */
function pick<T>(table: readonly T[], seed: number, salt: string): T {
  const idx = Math.floor(seededFloat(`${seed}:${salt}`) * table.length);
  return table[idx]!;
}

/**
 * Generates a fully-resolved procedural quest from a numeric seed.
 *
 * The same `seed` always produces the same quest — guaranteed.
 * Pass a timestamp or campaign-event counter as the seed so each
 * bounty-board visit yields a fresh quest.
 *
 * @param seed     Numeric seed — drives all four table picks independently.
 * @param giverId  Optional NPC seed that issued the quest.
 *
 * @pure — deterministic, no side effects.
 */
export function generateQuest(seed: number, giverId?: string): ProceduralQuest {
  const title     = pick(QUEST_TITLES,     seed, "title");
  const hook      = pick(QUEST_HOOKS,      seed, "hook");
  const location  = pick(QUEST_LOCATIONS,  seed, "location");
  const objective = pick(QUEST_OBJECTIVES, seed, "objective");
  const reward    = pick(QUEST_REWARDS,    seed, "reward");

  return {
    title,
    description: hook,   // hook doubles as the one-sentence description
    hook,
    location,
    objective,
    reward,
    ...(giverId !== undefined && { giverId }),
  };
}

// ---------------------------------------------------------------------------
// Tool Input Schemas (Single Source of Truth)
// ---------------------------------------------------------------------------

export const GenerateAndTrackQuestInputSchema = z.object({
  giverId: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe(
      "Seed of the NPC issuing this quest (e.g. 'innkeeper_saltmarsh_main'). " +
      "Omit for anonymous sources like bounty boards."
    ),
}).strict();

export type GenerateAndTrackQuestInput = z.infer<typeof GenerateAndTrackQuestInputSchema>;
