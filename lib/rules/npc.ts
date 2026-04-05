/**
 * lib/rules/npc.ts
 *
 * Deterministic NPC statblock generation — the RPG Tinker paradigm.
 *
 * Architectural contract ("State is Truth"):
 *   generateNPC(seed, role) is a pure function. The same (seed, role) pair
 *   ALWAYS produces the same statblock, forever. No randomness is introduced
 *   at call time. The world is populated by persistent individuals, not
 *   regenerated clones.
 *
 *   This means the database only needs to store the seed ID; the full statblock
 *   can be reconstructed on demand without persisting every field.
 *
 * This module is pure: no I/O, no side effects, no external dependencies
 * beyond the project's own deterministic PRNG utilities.
 */

import { seededFloat, pickSeeded } from "@/lib/rules/generators";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NPCRole = "guard" | "bandit" | "commoner";

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
  /** Current hit points (starts equal to maxHp; callers track damage). */
  hp: number;
  /** Maximum hit points — deterministic from seed. */
  maxHp: number;
  /** Armor Class — fixed per role. */
  ac: number;
  /** Attack notation string, e.g. "1d6+2". Passed directly to damageRoll(). */
  attackString: string;
}

// ---------------------------------------------------------------------------
// Name tables
// ---------------------------------------------------------------------------

/**
 * First names drawn from a wide range of medieval / fantasy registers.
 * 30 entries gives reasonable variety without becoming unwieldy.
 */
const NPC_FIRST_NAMES: readonly string[] = [
  "Aldric", "Brynn", "Calder", "Dara",   "Edric",
  "Fiona",  "Gareth", "Hilda",  "Ivor",  "Jessa",
  "Kael",   "Lira",   "Maren",  "Nolan", "Oswin",
  "Petra",  "Quinn",  "Rolf",   "Signe", "Tomas",
  "Ulric",  "Vessa",  "Wren",   "Xander","Yara",
  "Zara",   "Harlan", "Isolde", "Jorin", "Kessa",
] as const;

/**
 * Surnames with a grounded, low-fantasy feel — trades, geography, lineage.
 */
const NPC_LAST_NAMES: readonly string[] = [
  "Ashford",  "Blackthorn", "Coldwater", "Dunmore",  "Eastmere",
  "Fenwick",  "Greystone",  "Harwick",   "Ironside",  "Kettlebrook",
  "Larkmoor",  "Merriweather","Nighthollow","Oakhurst", "Pinewood",
  "Ravenscroft","Stonebridge","Thicket",  "Underhill", "Vane",
  "Whitmore",  "Yarrow",     "Copperfield","Dunwall",  "Embervale",
] as const;

// ---------------------------------------------------------------------------
// Role configs
// ---------------------------------------------------------------------------

/**
 * Fixed combat parameters per role, sourced from D&D 5e SRD baselines.
 * HP min/max define the deterministic range; the exact value within that range
 * is derived from the seed so each individual NPC has a unique pool.
 */
interface RoleConfig {
  hpMin: number;
  hpMax: number;
  ac: number;
  attackString: string;
}

const ROLE_CONFIGS: Record<NPCRole, RoleConfig> = {
  commoner: {
    hpMin: 4,
    hpMax: 8,
    ac: 10,
    attackString: "1d4",        // improvised weapon / unarmed
  },
  guard: {
    hpMin: 11,
    hpMax: 16,
    ac: 16,                     // chain shirt + shield
    attackString: "1d6+2",      // spear
  },
  bandit: {
    hpMin: 11,
    hpMax: 15,
    ac: 12,                     // leather armour
    attackString: "1d6+1",      // scimitar
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates a fully-resolved, deterministic NPC statblock.
 *
 * The same (seed, role) pair always returns the same statblock — guaranteed.
 * This allows the world to be populated with persistent individuals whose
 * stats can be reconstructed from their database ID alone.
 *
 * @param seed  A stable, unique identifier for this NPC (e.g. a database ID
 *              like "npc_town_guard_1" or a UUID). Must not change over time.
 * @param role  The NPC archetype, which determines the stat baseline.
 *
 * @example
 * generateNPC("npc_town_guard_1", "guard")
 * // { name: "Aldric Fenwick", role: "guard", hp: 14, maxHp: 14, ac: 16, attackString: "1d6+2" }
 */
export function generateNPC(seed: string, role: NPCRole): NPCStatblock {
  const config = ROLE_CONFIGS[role];

  // Each field uses a distinct salt so the picks are uncorrelated.
  const firstName = pickSeeded(seed + ":first", NPC_FIRST_NAMES);
  const lastName  = pickSeeded(seed + ":last",  NPC_LAST_NAMES);

  const hpRange = config.hpMax - config.hpMin + 1;
  const maxHp   = config.hpMin + Math.floor(seededFloat(seed + ":hp") * hpRange);

  return {
    name:         `${firstName} ${lastName}`,
    role,
    hp:           maxHp,   // callers own damage tracking; statblock starts full
    maxHp,
    ac:           config.ac,
    attackString: config.attackString,
  };
}
