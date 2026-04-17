import { z } from "zod";
import { rollDie } from "@/lib/rules/dice";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of watches in a 24-hour wilderness day. */
export const WATCHES_PER_DAY = 6;

/** Dungeon turns that fit inside one wilderness watch (4 hours × 6 turns/hour). */
export const TURNS_PER_WATCH = 24;

/** Watch index (0-based) that is mandatory rest. Mirrors Milestone O restRequired gate. */
export const NIGHT_WATCH_INDEX = 5;

/** Rations are consumed once per full day — every 6 watches. */
export const WILDERNESS_RATION_INTERVAL_WATCHES = 6;

/** Weather is recalculated once per day — every 6 watches (Q5). */
export const WEATHER_RECALC_INTERVAL_WATCHES = 6;

/** Normal pace clears 1 hex per watch. */
export const NORMAL_PACE_HEXES_PER_WATCH = 1;

/** Fast pace clears 2 hexes per watch. */
export const FAST_PACE_HEXES_PER_WATCH = 2;

/**
 * Fast pace penalty to passive Perception and active Perception checks.
 * Negative: subtracted from the score/check result.
 */
export const FAST_PACE_PERCEPTION_PENALTY = -5;

/**
 * Fast pace additional DC applied to foraging checks.
 * Positive: added to the DC, making foraging harder.
 */
export const FAST_PACE_FORAGING_DC_PENALTY = 5;

/** Traveling beyond this many watches in one day signals a Constitution save risk. */
export const MAX_TRAVEL_WATCHES_PER_DAY = 2;

/** Survival DC for easy foraging terrain (plains, forest, taiga). */
export const FORAGE_DC_NORMAL = 10;

/** Survival DC for harsh foraging terrain (all others). */
export const FORAGE_DC_HARSH = 15;

/** DC added to foraging during heavy rain or storm. */
export const FORAGE_DC_WEATHER_PENALTY = 5;

/** Hexes revealed around the party's current position during a Scout action. */
export const SCOUTING_REVEAL_RADIUS = 1;

/** 1d6 trigger threshold for random encounter in normal terrain. */
export const WILDERNESS_ENCOUNTER_NORMAL = 1;

/** 1d6 trigger threshold for random encounter in dangerous terrain (mountain, swamp). */
export const WILDERNESS_ENCOUNTER_DANGEROUS = 2;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const TERRAIN_TYPES = [
  "plains",
  "forest",
  "hills",
  "mountain",
  "swamp",
  "desert",
  "coast",
  "tundra",
  "taiga",
] as const;
export type TerrainType = (typeof TERRAIN_TYPES)[number];

export const TRAVEL_PACES = ["slow", "normal", "fast"] as const;
export type TravelPace = (typeof TRAVEL_PACES)[number];

export const WEATHER_CONDITIONS = [
  "clear",
  "overcast",
  "rain",
  "storm",
  "fog",
  "snow",
] as const;
export type WeatherCondition = (typeof WEATHER_CONDITIONS)[number];

export type WeatherIntensity = 0 | 1 | 2;

// ---------------------------------------------------------------------------
// Hex Direction System (Azgaar cube coordinates: q + r + s = 0)
// ---------------------------------------------------------------------------

export const HEX_DIRECTIONS = [
  { dq: +1, dr: -1, name: "Northeast" },
  { dq: +1, dr:  0, name: "East" },
  { dq:  0, dr: +1, name: "Southeast" },
  { dq: -1, dr: +1, name: "Southwest" },
  { dq: -1, dr:  0, name: "West" },
  { dq:  0, dr: -1, name: "Northwest" },
] as const;

/**
 * Returns the cube coordinates of the hex adjacent to (q, r) in the given direction.
 * Direction index 0–5 maps to NE, E, SE, SW, W, NW per HEX_DIRECTIONS.
 */
export function getNeighborHex(
  q: number,
  r: number,
  directionIndex: number,
): { q: number; r: number } {
  if (directionIndex < 0 || directionIndex > 5) {
    throw new Error(
      `Invalid direction index: ${directionIndex}. Must be 0–5.`,
    );
  }
  const dir = HEX_DIRECTIONS[directionIndex];
  return { q: q + dir.dq, r: r + dir.dr };
}

// ---------------------------------------------------------------------------
// Terrain data tables
// ---------------------------------------------------------------------------

/** Survival DC for foraging in each terrain type. */
const TERRAIN_FORAGE_DC: Record<TerrainType, number> = {
  plains:   FORAGE_DC_NORMAL,
  forest:   FORAGE_DC_NORMAL,
  taiga:    FORAGE_DC_NORMAL,
  hills:    FORAGE_DC_HARSH,
  mountain: FORAGE_DC_HARSH,
  swamp:    FORAGE_DC_HARSH,
  desert:   FORAGE_DC_HARSH,
  coast:    FORAGE_DC_HARSH,
  tundra:   FORAGE_DC_HARSH,
};

const DANGEROUS_TERRAIN: ReadonlySet<TerrainType> = new Set([
  "mountain",
  "swamp",
]);

/** Returns true for terrain types that use the heightened encounter threshold. */
export function isTerrainDangerous(terrain: TerrainType): boolean {
  return DANGEROUS_TERRAIN.has(terrain);
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface TravelProgressResult {
  /** Hex progress achievable this watch. May be fractional (0.5) for Slow pace. */
  hexesThisWatch: number;
  /** Movement impossible this watch (impassable terrain or severe storm). */
  blocked: boolean;
  /** Slow pace grants advantage on Stealth checks. */
  stealthAdvantage: boolean;
  /**
   * Signed modifier applied to passive Perception and active Perception rolls.
   * −5 at Fast pace; 0 otherwise.
   */
  perceptionPenalty: number;
  /**
   * Amount added to foraging DC when the party traveled at Fast pace this watch.
   * +5 at Fast pace; 0 otherwise.
   */
  foragingDCPenalty: number;
  /** Only Slow pace allows foraging during a travel watch. */
  canForageWhileTraveling: boolean;
  /**
   * True when watchesTraveledToday >= MAX_TRAVEL_WATCHES_PER_DAY.
   * Signals that executeTravelWatch must prompt a Constitution saving throw.
   */
  overTravelLimit: boolean;
}

export interface ForagingResult {
  /** Whether the Survival check met or exceeded the DC. */
  success: boolean;
  /** Effective DC after terrain, weather, and pace modifiers. */
  dc: number;
  /** Raw d20 result before applying survivalMod. */
  roll: number;
  /** roll + survivalMod. */
  total: number;
  /** Rations gathered. 0 on failure; max(1, 1d6 + survivalMod) on success. */
  rationGain: number;
  /** One-line diegetic result for the narrator to voice verbatim. */
  description: string;
}

export interface WeatherResult {
  condition: WeatherCondition;
  intensity: WeatherIntensity;
  /** True if condition or intensity changed from the previous value. */
  changed: boolean;
  /** One-sentence diegetic description for the narrator. */
  description: string;
}

// ---------------------------------------------------------------------------
// calculateTravelProgress
// ---------------------------------------------------------------------------

/**
 * Determines hex progress achievable in one wilderness watch given pace, terrain, and weather.
 *
 * Pure function — zero I/O. All state decisions belong to the caller.
 *
 * @param terrain          Canonical terrain type of the current hex.
 * @param pace             Party's declared travel pace for this watch.
 * @param weatherCondition Current weather condition.
 * @param weatherIntensity Weather severity (0–2).
 * @param watchesTraveledToday How many travel watches have already been spent today.
 *                         Defaults to 0 if not supplied.
 */
export function calculateTravelProgress(
  terrain: TerrainType,
  pace: TravelPace,
  weatherCondition: WeatherCondition,
  weatherIntensity: WeatherIntensity,
  watchesTraveledToday = 0,
): TravelProgressResult {
  const overTravelLimit = watchesTraveledToday >= MAX_TRAVEL_WATCHES_PER_DAY;

  // Coast is always impassable without a vessel.
  if (terrain === "coast") {
    return {
      hexesThisWatch: 0,
      blocked: true,
      stealthAdvantage: false,
      perceptionPenalty: 0,
      foragingDCPenalty: 0,
      canForageWhileTraveling: false,
      overTravelLimit,
    };
  }

  // A severe storm (intensity 2) halts all overland movement.
  if (weatherCondition === "storm" && weatherIntensity >= 2) {
    return {
      hexesThisWatch: 0,
      blocked: true,
      stealthAdvantage: false,
      perceptionPenalty: 0,
      foragingDCPenalty: 0,
      canForageWhileTraveling: false,
      overTravelLimit,
    };
  }

  // Base movement from pace (architect decisions Q6).
  const baseHexes: number =
    pace === "slow" ? 0.5 :
    pace === "fast" ? FAST_PACE_HEXES_PER_WATCH :
    NORMAL_PACE_HEXES_PER_WATCH;

  // Significant precipitation (intensity ≥ 1) halves movement.
  const weatherReduces =
    (weatherCondition === "rain"  && weatherIntensity >= 1) ||
    (weatherCondition === "snow"  && weatherIntensity >= 1) ||
    (weatherCondition === "fog"   && weatherIntensity >= 1) ||
    (weatherCondition === "storm" && weatherIntensity === 1);

  const hexesThisWatch = weatherReduces ? baseHexes * 0.5 : baseHexes;

  return {
    hexesThisWatch,
    blocked: false,
    stealthAdvantage: pace === "slow",
    perceptionPenalty: pace === "fast" ? FAST_PACE_PERCEPTION_PENALTY : 0,
    foragingDCPenalty: pace === "fast" ? FAST_PACE_FORAGING_DC_PENALTY : 0,
    canForageWhileTraveling: pace === "slow",
    overTravelLimit,
  };
}

// ---------------------------------------------------------------------------
// resolveForaging
// ---------------------------------------------------------------------------

/**
 * Resolves a wilderness foraging attempt for the current watch.
 *
 * Pure function — zero I/O. The caller is responsible for persisting rationGain.
 *
 * @param survivalMod      Character's Wisdom (Survival) ability modifier.
 * @param terrain          Terrain type of the current hex (determines base DC).
 * @param weatherCondition Current weather (affects DC if heavy rain or storm).
 * @param weatherIntensity Weather severity.
 * @param dcModifier       Additional DC applied by the caller (e.g. +5 for Fast pace). Defaults to 0.
 * @param forcedRoll       Override the d20 check result (for deterministic testing).
 * @param forcedYieldRoll  Override the 1d6 yield roll (for deterministic testing).
 */
export function resolveForaging(
  survivalMod: number,
  terrain: TerrainType,
  weatherCondition: WeatherCondition,
  weatherIntensity: WeatherIntensity,
  dcModifier = 0,
  forcedRoll?: number,
  forcedYieldRoll?: number,
): ForagingResult {
  // Build effective DC.
  let dc = TERRAIN_FORAGE_DC[terrain];

  // Heavy rain (intensity ≥ 1) or any storm adds difficulty.
  if (
    (weatherCondition === "rain" && weatherIntensity >= 1) ||
    weatherCondition === "storm"
  ) {
    dc += FORAGE_DC_WEATHER_PENALTY;
  }

  // Caller-supplied modifier (e.g. Fast pace foraging penalty).
  dc += dcModifier;

  const roll = forcedRoll ?? rollDie(20);
  const total = roll + survivalMod;
  const success = total >= dc;

  let rationGain = 0;
  let description: string;

  if (success) {
    const yieldRoll = forcedYieldRoll ?? rollDie(6);
    rationGain = Math.max(1, yieldRoll + survivalMod);
    description =
      `The foraging attempt succeeds (${total} vs DC ${dc}). ` +
      `The party gathers ${rationGain} ration${rationGain === 1 ? "" : "s"}.`;
  } else {
    description =
      `The foraging attempt fails (${total} vs DC ${dc}). ` +
      `The party finds nothing edible.`;
  }

  return { success, dc, roll, total, rationGain, description };
}

// ---------------------------------------------------------------------------
// generateWeatherCheck
// ---------------------------------------------------------------------------

/**
 * Severity ladder used to transition weather states.
 * clear → overcast → fog → rain(0) → rain(1) → storm(1) → storm(2)
 *
 * Snow substitutes rain in eligible biomes during winter.
 * Fog is replaced by overcast in desert/tundra biomes.
 */
const WEATHER_LADDER: ReadonlyArray<{
  condition: WeatherCondition;
  intensity: WeatherIntensity;
}> = [
  { condition: "clear",    intensity: 0 },
  { condition: "overcast", intensity: 0 },
  { condition: "fog",      intensity: 0 },
  { condition: "rain",     intensity: 0 },
  { condition: "rain",     intensity: 1 },
  { condition: "storm",    intensity: 1 },
  { condition: "storm",    intensity: 2 },
];

const SNOW_ELIGIBLE_BIOMES = ["tundra", "taiga", "mountain"] as const;
const NO_FOG_BIOMES = ["desert", "tundra"] as const;

/**
 * Maps a condition+intensity pair to its index in the severity ladder.
 * Snow states are mapped to their rain equivalents (same severity, different label).
 * Unknown combinations fall back to 0 (clear).
 */
function getWeatherLadderIndex(
  condition: WeatherCondition,
  intensity: WeatherIntensity,
): number {
  // Snow maps to rain slots of the same intensity.
  if (condition === "snow") {
    return intensity === 1 ? 4 : 3;
  }
  const idx = WEATHER_LADDER.findIndex(
    (w) => w.condition === condition && w.intensity === intensity,
  );
  return idx === -1 ? 0 : idx;
}

/**
 * Applies biome and season gates to a raw ladder step:
 * - Rain → Snow in tundra/taiga/mountain biomes during winter (seasonIndex 3).
 * - Fog → Overcast in desert/tundra biomes (no persistent fog there).
 */
function applyBiomeGates(
  step: { condition: WeatherCondition; intensity: WeatherIntensity },
  biome: string,
  seasonIndex: number,
): { condition: WeatherCondition; intensity: WeatherIntensity } {
  const lowerBiome = biome.toLowerCase();

  const isSnowBiome = SNOW_ELIGIBLE_BIOMES.some((b) => lowerBiome.includes(b));
  if (step.condition === "rain" && isSnowBiome && seasonIndex === 3) {
    return { condition: "snow", intensity: step.intensity };
  }

  const isNoFogBiome = NO_FOG_BIOMES.some((b) => lowerBiome.includes(b));
  if (step.condition === "fog" && isNoFogBiome) {
    return { condition: "overcast", intensity: 0 };
  }

  return step;
}

/** Diegetic one-sentence descriptions keyed by "condition_intensity". */
const WEATHER_DESCRIPTIONS: Record<string, string> = {
  clear_0:    "The sky is clear and the air is still.",
  overcast_0: "Heavy clouds roll in, dimming the light without bringing rain.",
  overcast_1: "Dense overcast presses down, threatening rain.",
  overcast_2: "The sky is a uniform grey slate, oppressive and still.",
  fog_0:      "A low mist clings to the ground and hollows.",
  fog_1:      "Thick fog reduces visibility to a few dozen feet.",
  fog_2:      "A dense fog bank blankets the land — navigation is treacherous.",
  rain_0:     "Light rain patters against cloaks and leaves.",
  rain_1:     "Heavy rain falls in grey curtains, soaking everything through.",
  storm_0:    "Storm clouds gather, and lightning flickers at the horizon.",
  storm_1:    "A fierce storm lashes the land with wind and driving rain.",
  storm_2:    "A violent tempest tears across the open land — all travel is impossible.",
  snow_0:     "Light snowflakes drift down from a pale, iron sky.",
  snow_1:     "Heavy snow falls steadily, blanketing the ground in white.",
  snow_2:     "A blizzard howls across the open land, blinding and deadly.",
};

export function getWeatherDescription(
  condition: WeatherCondition,
  intensity: WeatherIntensity,
): string {
  return (
    WEATHER_DESCRIPTIONS[`${condition}_${intensity}`] ??
    `The weather turns to ${condition} (intensity ${intensity}).`
  );
}

/**
 * Generates the weather condition for the upcoming day.
 * Called by executeTravelWatch every WEATHER_RECALC_INTERVAL_WATCHES (6) watches.
 *
 * Pure function — zero I/O. Accepts a forcedRoll for deterministic testing.
 *
 * Transition rules (d20):
 *   - Storm(2):  1–15 = persist (75%); 16–20 = improve
 *   - Clear:     1–12 = persist (60%); 13–20 = worsen
 *   - All others: 1–4  = worsen (20%); 5–14 = persist (50%); 15–20 = improve (30%)
 *
 * @param biome             Azgaar biome label of the party's current hex.
 * @param seasonIndex       0=spring, 1=summer, 2=autumn, 3=winter.
 * @param previousCondition Last day's weather condition.
 * @param previousIntensity Last day's weather intensity.
 * @param forcedRoll        Override the d20 transition roll (for testing).
 */
export function generateWeatherCheck(
  biome: string,
  seasonIndex: number,
  previousCondition: WeatherCondition,
  previousIntensity: WeatherIntensity,
  forcedRoll?: number,
): WeatherResult {
  const roll = forcedRoll ?? rollDie(20);
  const currentIndex = getWeatherLadderIndex(previousCondition, previousIntensity);

  let newIndex = currentIndex;

  if (previousCondition === "storm" && previousIntensity === 2) {
    // Storm(2): 75% persistence — roll 1–15 = persist; 16–20 = improve.
    if (roll <= 15) {
      return {
        condition: "storm",
        intensity: 2,
        changed: false,
        description: getWeatherDescription("storm", 2),
      };
    }
    newIndex = Math.max(0, currentIndex - 1);
  } else if (previousCondition === "clear" && previousIntensity === 0) {
    // Clear: 60% persistence — roll 1–12 = persist; 13–20 = worsen.
    if (roll <= 12) {
      return {
        condition: "clear",
        intensity: 0,
        changed: false,
        description: getWeatherDescription("clear", 0),
      };
    }
    newIndex = Math.min(WEATHER_LADDER.length - 1, currentIndex + 1);
  } else {
    // Standard: 1–4 = worsen; 5–14 = persist; 15–20 = improve.
    if (roll <= 4) {
      newIndex = Math.min(WEATHER_LADDER.length - 1, currentIndex + 1);
    } else if (roll >= 15) {
      newIndex = Math.max(0, currentIndex - 1);
    }
    // 5–14: newIndex unchanged (persist).
  }

  const baseStep = WEATHER_LADDER[newIndex];
  const gated = applyBiomeGates(baseStep, biome, seasonIndex);
  const changed =
    gated.condition !== previousCondition || gated.intensity !== previousIntensity;

  return {
    condition: gated.condition,
    intensity: gated.intensity,
    changed,
    description: getWeatherDescription(gated.condition, gated.intensity),
  };
}

// ---------------------------------------------------------------------------
// Tool Input Schemas (Single Source of Truth)
// ---------------------------------------------------------------------------

export const TravelWatchInputSchema = z.object({
  action: z
    .enum(["travel", "forage", "rest", "camp", "scout"])
    .describe(
      "The overworld action the party is taking this watch. " +
      "'travel' moves the party, 'forage' finds food, 'rest' is mandatory at Night, " +
      "'camp' stays put, 'scout' reveals terrain."
    ),
  direction: z
    .number()
    .int()
    .min(0)
    .max(5)
    .optional()
    .describe(
      "Hex direction for 'travel' action only. " +
      "0=Northeast, 1=East, 2=Southeast, 3=Southwest, 4=West, 5=Northwest."
    ),
  pace: z
    .enum(["slow", "normal", "fast"])
    .optional()
    .describe(
      "Travel pace override for this watch. " +
      "slow=0.5 hexes/watch, normal=1 hex/watch, fast=2 hexes/watch."
    ),
}).strict();
