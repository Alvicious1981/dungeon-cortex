/**
 * lib/rules/npc.ts
 *
 * Deterministic NPC generation — rich 5e statblocks (Milestone I Slice 3).
 *
 * Architectural contract ("State is Truth"):
 *   generateNPC(seed, role) is a pure function. The same (seed, role) pair
 *   ALWAYS produces the same statblock, forever. No randomness is introduced
 *   at call time. The world is populated by persistent individuals, not
 *   regenerated clones.
 *
 * This module is pure: no I/O, no side effects.
 */

import { z } from "zod";
import { seededFloat, pickSeeded } from "@/lib/rules/generators";
import { abilityModifier } from "@/lib/rules/dice";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NPCRole = "guard" | "bandit" | "commoner";

/** The six core 5e ability scores. */
export interface AbilityScores {
  STR: number;
  DEX: number;
  CON: number;
  INT: number;
  WIS: number;
  CHA: number;
}

/** The four 5e personality pillars. */
export interface NPCTraits {
  personality: string;
  ideal: string;
  bond: string;
  flaw: string;
}

/**
 * A fully-resolved NPC statblock. All fields are deterministic from the seed.
 * Treat this as a value object — never mutate it; derive a new one if state
 * needs to change (e.g. damage taken should be tracked externally).
 */
export interface NPCStatblock {
  /** Proper name derived from the seed. Persistent across all calls. */
  name: string;
  /** Archetype that drove stat selection. */
  role: NPCRole;
  /** Current HP (starts equal to maxHp; callers track damage). */
  hp: number;
  /** Maximum HP — derived from hit dice + CON modifier. */
  maxHp: number;
  /** Armor Class — fixed per role (equipment-based). */
  ac: number;
  /** Attack notation string, e.g. "1d6+2". Passed directly to damageRoll(). */
  attackString: string;
  /** Creature race, e.g. "human", "elf", "dwarf". */
  race: string;
  /** Mundane profession, e.g. "blacksmith", "soldier". */
  profession: string;
  /** Moral alignment, e.g. "lawful good", "chaotic neutral". */
  alignment: string;
  /** The six ability scores derived from a seeded shuffle of the standard array. */
  abilityScores: AbilityScores;
  /** Personality pillars — personality, ideal, bond, flaw. */
  traits: NPCTraits;
}

// ---------------------------------------------------------------------------
// Tool Input Schemas
// ---------------------------------------------------------------------------

export const GenerateNPCInputSchema = z.object({
  seed: z
    .string()
    .min(1)
    .max(100)
    .describe("Stable unique identifier, e.g. 'blacksmith_ironhaven_oskar'."),
  role: z.enum(["guard", "bandit", "commoner"]),
}).strict();

export type GenerateNPCInput = z.infer<typeof GenerateNPCInputSchema>;

export const TrackNPCInputSchema = z.object({
  seed: z
    .string()
    .min(1)
    .max(100)
    .describe("Stable unique identifier, e.g. 'innkeeper_saltmarsh_main'."),
  role: z.enum(["guard", "bandit", "commoner"]),
  notes: z
    .string()
    .max(500)
    .optional()
    .describe("Brief contextual notes."),
  hp: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Current HP — supply only if changed."),
}).strict();

export type TrackNPCInput = z.infer<typeof TrackNPCInputSchema>;

// ---------------------------------------------------------------------------
// Name tables
// ---------------------------------------------------------------------------

const NPC_FIRST_NAMES: readonly string[] = [
  "Aldric", "Brynn",  "Calder", "Dara",   "Edric",
  "Fiona",  "Gareth", "Hilda",  "Ivor",   "Jessa",
  "Kael",   "Lira",   "Maren",  "Nolan",  "Oswin",
  "Petra",  "Quinn",  "Rolf",   "Signe",  "Tomas",
  "Ulric",  "Vessa",  "Wren",   "Xander", "Yara",
  "Zara",   "Harlan", "Isolde", "Jorin",  "Kessa",
] as const;

const NPC_LAST_NAMES: readonly string[] = [
  "Ashford",     "Blackthorn",  "Coldwater",   "Dunmore",     "Eastmere",
  "Fenwick",     "Greystone",   "Harwick",     "Ironside",    "Kettlebrook",
  "Larkmoor",    "Merriweather","Nighthollow",  "Oakhurst",    "Pinewood",
  "Ravenscroft", "Stonebridge", "Thicket",     "Underhill",   "Vane",
  "Whitmore",    "Yarrow",      "Copperfield",  "Dunwall",     "Embervale",
] as const;

// ---------------------------------------------------------------------------
// World tables
// ---------------------------------------------------------------------------

const NPC_RACES: readonly string[] = [
  "human", "elf", "dwarf", "halfling", "gnome",
  "half-elf", "half-orc", "tiefling", "dragonborn", "aasimar",
] as const;

const NPC_PROFESSIONS: readonly string[] = [
  "merchant", "farmer", "blacksmith", "scholar", "soldier",
  "thief", "priest", "healer", "ranger", "noble", "sailor", "innkeeper",
] as const;

const ALIGNMENTS: readonly string[] = [
  "lawful good",    "neutral good",   "chaotic good",
  "lawful neutral", "true neutral",   "chaotic neutral",
  "lawful evil",    "neutral evil",   "chaotic evil",
] as const;

/** One ideal per alignment — drives a morally grounded personality. */
const ALIGNMENT_IDEALS: Readonly<Record<string, string>> = {
  "lawful good":    "Greater Good. My gifts are meant to be shared with all.",
  "neutral good":   "Charity. I always try to help those less fortunate than myself.",
  "chaotic good":   "Freedom. Chains — real or metaphorical — should always be broken.",
  "lawful neutral": "Tradition. The old ways are sacred and must be preserved.",
  "true neutral":   "Balance. Everything in moderation, including good and evil.",
  "chaotic neutral":"Change. The world is in constant flux, and I embrace that.",
  "lawful evil":    "Power. If I become strong, I can take what I want.",
  "neutral evil":   "Greed. I'm only in it for the coin and the comfort.",
  "chaotic evil":   "Chaos. There is no order in the world — I revel in that truth.",
};

// ---------------------------------------------------------------------------
// Personality, bond, and flaw tables
// ---------------------------------------------------------------------------

const PERSONALITY_TRAITS: readonly string[] = [
  "I always have a plan for when things go wrong.",
  "I'm always polite and respectful, even to those who don't deserve it.",
  "I am terribly, horribly awkward in social situations.",
  "I'm suspicious of everyone I meet — too many betrayals in my past.",
  "I've been blessed with great luck, and I parley that luck into bold gambles.",
  "I ask too many questions. Everyone finds it irritating.",
  "I speak bluntly without regard for how others might take my words.",
  "I'm a habitual liar — I even lie when the truth would serve me better.",
  "I can't help but pocket small objects that catch my eye.",
  "I face every problem with optimism and a smile.",
  "I hold a deep grudge against the nobility and their kind.",
  "My word is my bond — once given, I never break it.",
] as const;

const BONDS: readonly string[] = [
  "I would lay down my life for the people I grew up with.",
  "Someone I loved died because of a mistake I made. It will not happen again.",
  "I owe my life to a stranger who once took a chance on me.",
  "I will not rest until I recover a precious item that was stolen from me.",
  "I seek to prove myself worthy of my family's name.",
  "I joined a cause I believe in deeply — nothing will stop me.",
  "A single family in the city knows me as a protector. I will not fail them.",
  "I fell in love once. I have not forgotten, and likely never will.",
  "The town I grew up in was burned. I look for the ones responsible.",
  "I carry an heirloom I believe has great significance.",
] as const;

const FLAWS: readonly string[] = [
  "Once I start drinking, I have a hard time stopping.",
  "My pride will be the death of me. I can never admit when I am wrong.",
  "I'm terrified of losing my life — I'll do almost anything to survive.",
  "I can't resist a pretty face. It has gotten me into trouble before.",
  "I talk before I think, and I often regret it.",
  "I have a weakness for wealth; I'll bend my principles if the coin is right.",
  "I secretly believe I'm better than everyone else.",
  "I harbor a deep resentment toward a particular group of people.",
  "Violence is always my first resort, even when other options exist.",
  "I am so curious that I often don't think about the danger I'm walking into.",
] as const;

// ---------------------------------------------------------------------------
// Ability scores — standard array
// ---------------------------------------------------------------------------

/** The 5e standard ability score array. */
const STANDARD_ARRAY: readonly number[] = [15, 14, 13, 12, 10, 8] as const;

const STAT_KEYS: ReadonlyArray<keyof AbilityScores> = [
  "STR", "DEX", "CON", "INT", "WIS", "CHA",
] as const;

/**
 * Deterministically shuffles the standard array using Fisher-Yates driven
 * by seededFloat. Each index uses a distinct salt to avoid correlation.
 */
function shuffleStandardArray(seed: string): number[] {
  const arr = [...STANDARD_ARRAY];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(seededFloat(`${seed}:shuffle:${i}`) * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

// ---------------------------------------------------------------------------
// Role configs
// ---------------------------------------------------------------------------

interface RoleConfig {
  /** Number of hit dice. */
  hitDice: number;
  /** Die size (e.g. 8 for d8). */
  dieSize: number;
  /** Fixed armor class from equipment. */
  ac: number;
  /** Attack notation string. */
  attackString: string;
}

const ROLE_CONFIGS: Readonly<Record<NPCRole, RoleConfig>> = {
  commoner: { hitDice: 1, dieSize: 8, ac: 10, attackString: "1d4"   },
  guard:    { hitDice: 2, dieSize: 8, ac: 16, attackString: "1d6+2" },
  bandit:   { hitDice: 2, dieSize: 8, ac: 12, attackString: "1d6+1" },
};

// ---------------------------------------------------------------------------
// HP derivation
// ---------------------------------------------------------------------------

/**
 * Rolls hit dice deterministically and applies the CON modifier per die.
 * Floor: at least 1 HP per hit die (minimum = hitDice).
 *
 * Formula: Σ(roll_i + conMod) for i in 0..hitDice-1, floored at hitDice.
 */
function deriveMaxHp(seed: string, config: RoleConfig, conMod: number): number {
  let total = 0;
  for (let i = 0; i < config.hitDice; i++) {
    const roll = Math.floor(seededFloat(`${seed}:hd:${i}`) * config.dieSize) + 1;
    total += roll + conMod;
  }
  return Math.max(config.hitDice, total);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates a fully-resolved, deterministic NPC statblock.
 *
 * The same (seed, role) pair always returns the same statblock — guaranteed.
 * New fields (race, profession, alignment, abilityScores, traits) are included.
 *
 * @param seed  A stable, unique identifier for this NPC (e.g. "npc_town_guard_1").
 *              Must not change over time.
 * @param role  The NPC archetype, which determines combat stat baselines.
 */
export function generateNPC(seed: string, role: NPCRole): NPCStatblock {
  const config = ROLE_CONFIGS[role];

  // ── Name ──────────────────────────────────────────────────────────────────
  const firstName = pickSeeded(seed + ":first", NPC_FIRST_NAMES);
  const lastName  = pickSeeded(seed + ":last",  NPC_LAST_NAMES);

  // ── World identity ────────────────────────────────────────────────────────
  const race       = pickSeeded(seed + ":race",  NPC_RACES);
  const profession = pickSeeded(seed + ":prof",  NPC_PROFESSIONS);
  const alignment  = pickSeeded(seed + ":align", ALIGNMENTS);

  // ── Ability scores ────────────────────────────────────────────────────────
  // Shuffle the standard array deterministically, then assign to stat keys.
  const shuffled = shuffleStandardArray(seed + ":stats");
  const abilityScores: AbilityScores = {} as AbilityScores;
  for (let i = 0; i < STAT_KEYS.length; i++) {
    abilityScores[STAT_KEYS[i]!] = shuffled[i]!;
  }

  // ── HP ────────────────────────────────────────────────────────────────────
  const conMod = abilityModifier(abilityScores.CON);
  const maxHp  = deriveMaxHp(seed, config, conMod);

  // ── Traits ────────────────────────────────────────────────────────────────
  const personality = pickSeeded(seed + ":pers",  PERSONALITY_TRAITS);
  const ideal       = ALIGNMENT_IDEALS[alignment] ?? pickSeeded(seed + ":ideal", PERSONALITY_TRAITS);
  const bond        = pickSeeded(seed + ":bond",  BONDS);
  const flaw        = pickSeeded(seed + ":flaw",  FLAWS);

  return {
    name:         `${firstName} ${lastName}`,
    role,
    hp:           maxHp,
    maxHp,
    ac:           config.ac,
    attackString: config.attackString,
    race,
    profession,
    alignment,
    abilityScores,
    traits: { personality, ideal, bond, flaw },
  };
}
