import { rollDie } from "@/lib/rules/dice";
import { seededFloat } from "@/lib/rules/generators";
import {
  FAST_PACE_FORAGING_DC_PENALTY,
  NIGHT_WATCH_INDEX,
  TravelWatchInputSchema,
  WATCHES_PER_DAY,
  WEATHER_RECALC_INTERVAL_WATCHES,
  WILDERNESS_ENCOUNTER_DANGEROUS,
  WILDERNESS_ENCOUNTER_NORMAL,
  WILDERNESS_RATION_INTERVAL_WATCHES,
  calculateTravelProgress,
  generateWeatherCheck,
  getNeighborHex,
  isTerrainDangerous,
  resolveForaging,
  type ForagingResult,
  type TerrainType,
  type TravelPace,
  type WeatherCondition,
  type WeatherIntensity,
} from "@/lib/rules/wilderness";

export type WildernessServiceErrorCode =
  | "CAMPAIGN_NOT_FOUND"
  | "CAMPAIGN_OWNERSHIP_MISMATCH"
  | "INVALID_TRAVEL_WATCH_INPUT"
  | "LEGACY_SUBSYSTEM_DISABLED";

export class WildernessServiceError extends Error {
  constructor(
    public readonly code: WildernessServiceErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "WildernessServiceError";
  }
}

export interface HexTerrainData {
  terrain: TerrainType;
  biome: string;
  elevation: number;
  moisture: number;
}

interface WildernessCampaignRecord {
  id?: string;
  userId?: string | null;
  characterId?: string | null;
  character?: { id?: string; stats?: unknown } | null;
}

interface WildernessCharacterRecord {
  id?: string;
  stats?: unknown;
}

interface TravelStateRecord {
  id?: string;
  campaignId: string;
  currentQ: number;
  currentR: number;
  currentWatch: number;
  totalWatches: number;
  totalDays: number;
  watchesTraveledToday: number;
  watchesSinceRation: number;
  weatherWatchCounter: number;
  partialHexProgress: number;
  partyPace: string;
  weatherCondition: string;
  weatherIntensity: number;
  seasonIndex: number;
}

interface WildernessHexRecord {
  id?: string;
  campaignId: string;
  q: number;
  r: number;
  terrain: string;
  biome: string;
  elevation: number;
  moisture: number;
  discovered?: boolean;
  scouted?: boolean;
  seed: string;
}

interface PartyInventoryRecord {
  campaignId: string;
  rations?: number | null;
}

interface WildernessDb {
  $transaction?<T>(fn: (tx: WildernessDb) => Promise<T>): Promise<T>;
  campaign: {
    findUnique(args: {
      where: { id: string };
      select?: Record<string, unknown>;
    }): Promise<WildernessCampaignRecord | null | undefined>;
  };
  character: {
    findUnique(args: {
      where: { id: string };
      select?: Record<string, unknown>;
    }): Promise<WildernessCharacterRecord | null | undefined>;
  };
  travelState: {
    findUnique(args: {
      where: { campaignId?: string; id?: string };
    }): Promise<TravelStateRecord | null | undefined>;
    upsert(args: {
      where: { campaignId: string };
      create: TravelStateRecord;
      update: Partial<TravelStateRecord>;
    }): Promise<TravelStateRecord>;
  };
  wildernessMap: {
    findUnique(args: {
      where:
        | { id: string }
        | { campaignId_q_r: { campaignId: string; q: number; r: number } };
    }): Promise<WildernessHexRecord | null | undefined>;
    upsert(args: {
      where: { campaignId_q_r: { campaignId: string; q: number; r: number } };
      create: Omit<WildernessHexRecord, "id">;
      update: Partial<WildernessHexRecord>;
    }): Promise<WildernessHexRecord>;
  };
  partyInventory: {
    findUnique(args: {
      where: { campaignId: string };
    }): Promise<PartyInventoryRecord | null | undefined>;
    upsert(args: {
      where: { campaignId: string };
      create: { campaignId: string; rations: number };
      update: { rations: number };
    }): Promise<PartyInventoryRecord>;
  };
}

export interface ResolveTravelWatchInput {
  campaignId: string;
  userId?: string;
  watchAction?: string;
  actionType?: string;
  action?: string;
  direction?: number;
  pace?: TravelPace;
  travelStateId?: string;
  hexId?: string;
  weatherRoll?: number;
  encounterRoll?: number;
  foragingRoll?: number;
  foragingYieldRoll?: number;
  scoutingRoll?: number;
  tx?: WildernessDb;
  db?: WildernessDb;
}

export interface TravelWatchFacts {
  type: "travel_watch_resolved";
  campaignId: string;
  action: string;
  travelState: TravelStateRecord;
  wildernessMap: {
    current: { q: number; r: number; terrain: TerrainType; biome: string };
    updatedHexes: Array<{ q: number; r: number; discovered?: boolean; scouted?: boolean }>;
  };
  resourceChanges: {
    rationsBefore: number;
    rationsAfter: number;
    rationsConsumed: number;
    rationsGained: number;
    rationsDepleted: boolean;
  };
  travelProgress: {
    position: { q: number; r: number };
    partialHexProgress: number;
    movementBlocked: boolean;
    exhaustionRisk: boolean;
  };
  scoutingResult: { revealedHexes: Array<{ q: number; r: number }> } | null;
  foragingResult: ForagingResult | null;
  weather: { condition: WeatherCondition; intensity: WeatherIntensity; changed: boolean };
  encounter: { triggered: boolean; roll: number } | null;
  events: string[];
}

export interface ResolveTravelWatchResult {
  ok: true;
  action: string;
  watchIndex: number;
  watchName: string;
  totalWatches: number;
  totalDays: number;
  position: { q: number; r: number };
  terrain: TerrainType;
  biome: string;
  featureDiscovered: string | null;
  encounter: { triggered: boolean; roll: number } | null;
  randomEncounter: { triggered: boolean; roll: number } | null;
  weather: { condition: WeatherCondition; intensity: WeatherIntensity; changed: boolean };
  rationsDepleted: boolean;
  restRequired: boolean;
  movementBlocked: boolean;
  exhaustionRisk: boolean;
  foragingResult: ForagingResult | null;
  scoutingResult: { revealedHexes: Array<{ q: number; r: number }> } | null;
  warnings: string[];
  resourceChanges: TravelWatchFacts["resourceChanges"];
  facts: TravelWatchFacts;
}

const WATCH_NAMES = [
  "Dawn",
  "Morning",
  "Midday",
  "Afternoon",
  "Evening",
  "Night",
] as const;

function resolveDb(input: ResolveTravelWatchInput): WildernessDb {
  const injectedDb = input.tx ?? input.db;
  if (!injectedDb) {
    throw new WildernessServiceError(
      "LEGACY_SUBSYSTEM_DISABLED",
      "Legacy wilderness persistence is disabled until it is redesigned for D&D 5e/SRD 2014.",
    );
  }
  return injectedDb;
}

function determineTerrain(elevation: number, moisture: number): TerrainType {
  if (elevation < 5) return "coast";
  if (elevation >= 70) return "mountain";
  if (elevation < 20 && moisture >= 75) return "swamp";
  if (moisture < 20) return "desert";
  if (elevation >= 50 && moisture < 35) return "tundra";
  if (elevation >= 35 && moisture >= 55) return "taiga";
  if (moisture >= 55) return "forest";
  if (elevation >= 30) return "hills";
  return "plains";
}

function determineBiome(terrain: TerrainType, elevation: number, moisture: number): string {
  switch (terrain) {
    case "plains":
      return moisture > 45 ? "temperate grassland" : "dry steppe";
    case "forest":
      return elevation > 25 ? "temperate broadleaf forest" : "tropical rainforest";
    case "hills":
      return moisture > 45 ? "temperate hills" : "arid hills";
    case "mountain":
      return moisture > 50 ? "alpine highland" : "barren mountain";
    case "swamp":
      return elevation < 10 ? "coastal wetland" : "inland swamp";
    case "desert":
      return elevation > 30 ? "high desert plateau" : "hot sandy desert";
    case "coast":
      return "coastal shoreline";
    case "tundra":
      return "arctic tundra";
    case "taiga":
      return "boreal taiga forest";
  }
}

export function generateHexTerrain(hexSeed: string): HexTerrainData {
  const elevation = Math.round(seededFloat(hexSeed, 0) * 100);
  const moisture = Math.round(seededFloat(hexSeed, 1) * 100);
  const terrain = determineTerrain(elevation, moisture);
  const biome = determineBiome(terrain, elevation, moisture);
  return { terrain, biome, elevation, moisture };
}

export function makeHexSeed(campaignId: string, q: number, r: number): string {
  return `${campaignId}:${q}:${r}`;
}

export function extractSurvivalMod(stats: unknown): number {
  if (typeof stats !== "object" || stats === null) return 0;
  const record = stats as Record<string, unknown>;
  const wis = typeof record.WIS === "number" ? record.WIS : 10;
  return Math.floor((wis - 10) / 2);
}

export function getWatchName(watchIndex: number): string {
  return WATCH_NAMES[watchIndex % WATCHES_PER_DAY] ?? `Watch ${watchIndex}`;
}

function parseInput(input: ResolveTravelWatchInput) {
  const parsed = TravelWatchInputSchema.safeParse({
    action: input.watchAction ?? input.actionType ?? input.action,
    direction: input.direction,
    pace: input.pace,
  });

  if (!parsed.success) {
    throw new WildernessServiceError(
      "INVALID_TRAVEL_WATCH_INPUT",
      "Invalid travel watch input.",
      { issues: parsed.error.issues }
    );
  }

  return parsed.data;
}

async function resolveCampaign(
  db: WildernessDb,
  input: ResolveTravelWatchInput
): Promise<WildernessCampaignRecord> {
  const campaign = await db.campaign.findUnique({
    where: { id: input.campaignId },
    select: { id: true, userId: true, characterId: true, character: { select: { id: true, stats: true } } },
  });

  if (!campaign) {
    throw new WildernessServiceError(
      "CAMPAIGN_NOT_FOUND",
      `Campaign not found: ${input.campaignId}`
    );
  }

  if (input.userId && campaign.userId && campaign.userId !== input.userId) {
    throw new WildernessServiceError(
      "CAMPAIGN_OWNERSHIP_MISMATCH",
      `Campaign ${input.campaignId} does not belong to user ${input.userId}.`
    );
  }

  return campaign;
}

function bootstrapTravelState(campaignId: string): TravelStateRecord {
  return {
    id: "",
    campaignId,
    currentQ: 0,
    currentR: 0,
    currentWatch: 0,
    totalWatches: 0,
    totalDays: 0,
    watchesTraveledToday: 0,
    watchesSinceRation: 0,
    weatherWatchCounter: 0,
    partialHexProgress: 0,
    partyPace: "normal",
    weatherCondition: "clear",
    weatherIntensity: 0,
    seasonIndex: 0,
  };
}

function normalizeTerrain(value: string | undefined): TerrainType {
  const terrain = value ?? "plains";
  return (
    [
      "plains",
      "forest",
      "hills",
      "mountain",
      "swamp",
      "desert",
      "coast",
      "tundra",
      "taiga",
    ] as const
  ).includes(terrain as TerrainType)
    ? (terrain as TerrainType)
    : "plains";
}

function normalizeWeatherCondition(value: string): WeatherCondition {
  return (
    ["clear", "overcast", "rain", "storm", "fog", "snow"] as const
  ).includes(value as WeatherCondition)
    ? (value as WeatherCondition)
    : "clear";
}

function normalizeWeatherIntensity(value: number): WeatherIntensity {
  return value === 1 || value === 2 ? value : 0;
}

function buildHexCreate(
  campaignId: string,
  q: number,
  r: number,
  data: HexTerrainData,
  visibility: { discovered?: boolean; scouted?: boolean }
): Omit<WildernessHexRecord, "id"> {
  return {
    campaignId,
    q,
    r,
    terrain: data.terrain,
    biome: data.biome,
    elevation: data.elevation,
    moisture: data.moisture,
    discovered: visibility.discovered ?? false,
    scouted: visibility.scouted ?? false,
    seed: makeHexSeed(campaignId, q, r),
  };
}

async function resolveTravelWatchInTransaction(
  db: WildernessDb,
  input: ResolveTravelWatchInput
): Promise<ResolveTravelWatchResult> {
  const parsed = parseInput(input);
  const campaign = await resolveCampaign(db, input);

  const travelStateRaw = await db.travelState.findUnique({
    where: input.travelStateId ? { id: input.travelStateId } : { campaignId: input.campaignId },
  });
  const travelState = travelStateRaw ?? bootstrapTravelState(input.campaignId);

  const [partyInventoryRaw, characterRaw, currentHexRaw] = await Promise.all([
    db.partyInventory.findUnique({ where: { campaignId: input.campaignId } }),
    campaign.character?.stats
      ? Promise.resolve(campaign.character)
      : campaign.characterId
        ? db.character.findUnique({
            where: { id: campaign.characterId },
            select: { id: true, stats: true },
          })
        : Promise.resolve(null),
    db.wildernessMap.findUnique({
      where: input.hexId
        ? { id: input.hexId }
        : {
            campaignId_q_r: {
              campaignId: input.campaignId,
              q: travelState.currentQ,
              r: travelState.currentR,
            },
          },
    }),
  ]);

  const effectivePace = (parsed.pace ?? travelState.partyPace) as TravelPace;
  const weatherCondition = normalizeWeatherCondition(travelState.weatherCondition);
  const weatherIntensity = normalizeWeatherIntensity(travelState.weatherIntensity);
  const currentTerrain = normalizeTerrain(currentHexRaw?.terrain);
  const currentBiome = currentHexRaw?.biome ?? "temperate grassland";

  if (travelState.currentWatch === NIGHT_WATCH_INDEX && parsed.action !== "rest") {
    throw new WildernessServiceError(
      "INVALID_TRAVEL_WATCH_INPUT",
      "The Night watch is mandatory rest.",
      { reason: "restRequired" }
    );
  }

  const warnings: string[] = [];
  const updatedHexes: Array<{ q: number; r: number; discovered?: boolean; scouted?: boolean }> = [];
  const newWeatherCounter = travelState.weatherWatchCounter + 1;
  let newWeatherCondition = weatherCondition;
  let newWeatherIntensity = weatherIntensity;
  let weatherChanged = false;

  if (newWeatherCounter >= WEATHER_RECALC_INTERVAL_WATCHES) {
    const weather = generateWeatherCheck(
      currentBiome,
      travelState.seasonIndex,
      weatherCondition,
      weatherIntensity,
      input.weatherRoll
    );
    newWeatherCondition = weather.condition;
    newWeatherIntensity = weather.intensity;
    weatherChanged = weather.changed;
    if (weather.changed) warnings.push(`Weather shifts: ${weather.description}`);
  }

  const newWatchesSinceRation = travelState.watchesSinceRation + 1;
  let rationsDepleted = false;
  const currentRations = partyInventoryRaw?.rations ?? 0;
  let newRations = currentRations;

  if (newWatchesSinceRation >= WILDERNESS_RATION_INTERVAL_WATCHES) {
    newRations = Math.max(0, currentRations - 1);
    if (newRations === 0) {
      rationsDepleted = true;
      warnings.push("The last ration is gone. The party is out of food.");
    } else {
      warnings.push(`A day's rations consumed. ${newRations} remain.`);
    }
  }

  let newQ = travelState.currentQ;
  let newR = travelState.currentR;
  let newPartialHexProgress = travelState.partialHexProgress;
  let newWatchesTraveledToday = travelState.watchesTraveledToday;
  let featureDiscovered: string | null = null;
  let encounter: { triggered: boolean; roll: number } | null = null;
  let foragingResult: ForagingResult | null = null;
  let scoutingResult: { revealedHexes: Array<{ q: number; r: number }> } | null = null;
  let exhaustionRisk = false;
  let movementBlocked = false;
  let destTerrain = currentTerrain;
  let destBiome = currentBiome;

  if (parsed.action === "travel") {
    if (parsed.direction === undefined || parsed.direction === null) {
      throw new WildernessServiceError(
        "INVALID_TRAVEL_WATCH_INPUT",
        "Direction is required for travel.",
        { reason: "directionRequired" }
      );
    }

    const progress = calculateTravelProgress(
      currentTerrain,
      effectivePace,
      weatherCondition,
      weatherIntensity,
      travelState.watchesTraveledToday
    );

    if (progress.blocked) {
      movementBlocked = true;
      if (weatherCondition === "storm" && weatherIntensity >= 2) {
        warnings.push("A violent storm makes travel impossible. The party shelters in place.");
      } else {
        warnings.push("The coast is impassable without a vessel.");
      }
    } else {
      if (progress.overTravelLimit) {
        exhaustionRisk = true;
        warnings.push(
          "The party has marched beyond their endurance. A Constitution saving throw is required or exhaustion sets in."
        );
      }

      const accumulated = travelState.partialHexProgress + progress.hexesThisWatch;
      const hexesToMove = Math.floor(accumulated);
      newPartialHexProgress = accumulated % 1;
      newWatchesTraveledToday = travelState.watchesTraveledToday + 1;

      if (hexesToMove > 0) {
        const delta = getNeighborHex(0, 0, parsed.direction);
        for (let step = 1; step <= hexesToMove; step += 1) {
          const stepQ = travelState.currentQ + step * delta.q;
          const stepR = travelState.currentR + step * delta.r;
          const stepData = generateHexTerrain(makeHexSeed(input.campaignId, stepQ, stepR));
          const isFinal = step === hexesToMove;

          await db.wildernessMap.upsert({
            where: { campaignId_q_r: { campaignId: input.campaignId, q: stepQ, r: stepR } },
            create: buildHexCreate(input.campaignId, stepQ, stepR, stepData, {
              discovered: isFinal,
              scouted: true,
            }),
            update: { discovered: isFinal ? true : undefined, scouted: true },
          });
          updatedHexes.push({ q: stepQ, r: stepR, discovered: isFinal, scouted: true });

          if (isFinal) {
            newQ = stepQ;
            newR = stepR;
            destTerrain = stepData.terrain;
            destBiome = stepData.biome;
            if (stepData.terrain === "coast") {
              warnings.push("The party reaches the coast - no vessel, no passage.");
            }
          }
        }

        const revealedHexes: Array<{ q: number; r: number }> = [];
        for (let directionIndex = 0; directionIndex < 6; directionIndex += 1) {
          const adjacent = getNeighborHex(newQ, newR, directionIndex);
          const adjacentData = generateHexTerrain(
            makeHexSeed(input.campaignId, adjacent.q, adjacent.r)
          );
          await db.wildernessMap.upsert({
            where: {
              campaignId_q_r: {
                campaignId: input.campaignId,
                q: adjacent.q,
                r: adjacent.r,
              },
            },
            create: buildHexCreate(input.campaignId, adjacent.q, adjacent.r, adjacentData, {
              scouted: true,
            }),
            update: { scouted: true },
          });
          revealedHexes.push({ q: adjacent.q, r: adjacent.r });
          updatedHexes.push({ q: adjacent.q, r: adjacent.r, scouted: true });
        }
        scoutingResult = { revealedHexes };

        const encounterRoll = input.encounterRoll ?? rollDie(6);
        const encounterThreshold = isTerrainDangerous(destTerrain)
          ? WILDERNESS_ENCOUNTER_DANGEROUS
          : WILDERNESS_ENCOUNTER_NORMAL;
        encounter = { triggered: encounterRoll <= encounterThreshold, roll: encounterRoll };
        if (encounter.triggered) {
          warnings.push("A random encounter is triggered - begin combat or reaction roll.");
        }

        const destSeed = makeHexSeed(input.campaignId, newQ, newR);
        const featureRoll = seededFloat(destSeed, 2);
        const features = ["dungeon_entrance", "village", "ruins", "shrine"] as const;
        if (featureRoll < 0.05) {
          featureDiscovered = features[Math.floor((featureRoll / 0.05) * features.length)] ?? null;
          warnings.push(`Point of interest discovered: ${featureDiscovered}.`);
        }
      }
    }
  } else if (parsed.action === "forage") {
    const survivalMod = extractSurvivalMod(characterRaw?.stats);
    const dcPenalty = effectivePace === "fast" ? FAST_PACE_FORAGING_DC_PENALTY : 0;
    const result = resolveForaging(
      survivalMod,
      currentTerrain,
      weatherCondition,
      weatherIntensity,
      dcPenalty,
      input.foragingRoll,
      input.foragingYieldRoll
    );
    foragingResult = result;
    if (result.success) {
      newRations = currentRations + result.rationGain;
    }
    warnings.push(result.description);
  } else if (parsed.action === "rest") {
    newWatchesTraveledToday = 0;
    warnings.push("The party rests through the night watch.");
  } else if (parsed.action === "camp") {
    warnings.push("The party makes camp for the watch.");
  } else if (parsed.action === "scout") {
    const revealedHexes: Array<{ q: number; r: number }> = [];
    for (let directionIndex = 0; directionIndex < 6; directionIndex += 1) {
      const adjacent = getNeighborHex(travelState.currentQ, travelState.currentR, directionIndex);
      const adjacentData = generateHexTerrain(makeHexSeed(input.campaignId, adjacent.q, adjacent.r));
      await db.wildernessMap.upsert({
        where: {
          campaignId_q_r: {
            campaignId: input.campaignId,
            q: adjacent.q,
            r: adjacent.r,
          },
        },
        create: buildHexCreate(input.campaignId, adjacent.q, adjacent.r, adjacentData, {
          scouted: true,
        }),
        update: { scouted: true },
      });
      revealedHexes.push({ q: adjacent.q, r: adjacent.r });
      updatedHexes.push({ q: adjacent.q, r: adjacent.r, scouted: true });
    }
    scoutingResult = { revealedHexes };
    warnings.push("The party scouts the surrounding terrain. Adjacent hexes revealed.");
  }

  const newCurrentWatch = (travelState.currentWatch + 1) % WATCHES_PER_DAY;
  const newTotalWatches = travelState.totalWatches + 1;
  const newTotalDays = Math.floor(newTotalWatches / WATCHES_PER_DAY);
  if (newCurrentWatch === 0) newWatchesTraveledToday = 0;

  const restRequired = newCurrentWatch === NIGHT_WATCH_INDEX;
  if (restRequired) {
    warnings.push("Night falls. The party must rest before the next action.");
  }

  const nextTravelState: TravelStateRecord = {
    id: travelState.id ?? "",
    campaignId: input.campaignId,
    currentQ: newQ,
    currentR: newR,
    currentWatch: newCurrentWatch,
    totalWatches: newTotalWatches,
    totalDays: newTotalDays,
    watchesTraveledToday: newWatchesTraveledToday,
    watchesSinceRation:
      newWatchesSinceRation >= WILDERNESS_RATION_INTERVAL_WATCHES ? 0 : newWatchesSinceRation,
    weatherWatchCounter:
      newWeatherCounter >= WEATHER_RECALC_INTERVAL_WATCHES ? 0 : newWeatherCounter,
    partialHexProgress: newPartialHexProgress,
    partyPace: effectivePace,
    weatherCondition: newWeatherCondition,
    weatherIntensity: newWeatherIntensity,
    seasonIndex: travelState.seasonIndex,
  };

  const persistedTravelState = await db.travelState.upsert({
    where: { campaignId: input.campaignId },
    create: nextTravelState,
    update: {
      currentQ: nextTravelState.currentQ,
      currentR: nextTravelState.currentR,
      currentWatch: nextTravelState.currentWatch,
      totalWatches: nextTravelState.totalWatches,
      totalDays: nextTravelState.totalDays,
      watchesTraveledToday: nextTravelState.watchesTraveledToday,
      watchesSinceRation: nextTravelState.watchesSinceRation,
      weatherWatchCounter: nextTravelState.weatherWatchCounter,
      partialHexProgress: nextTravelState.partialHexProgress,
      partyPace: nextTravelState.partyPace,
      weatherCondition: nextTravelState.weatherCondition,
      weatherIntensity: nextTravelState.weatherIntensity,
      seasonIndex: nextTravelState.seasonIndex,
    },
  });

  if (newRations !== currentRations) {
    await db.partyInventory.upsert({
      where: { campaignId: input.campaignId },
      create: { campaignId: input.campaignId, rations: newRations },
      update: { rations: newRations },
    });
  }

  const resourceChanges = {
    rationsBefore: currentRations,
    rationsAfter: newRations,
    rationsConsumed: Math.max(0, currentRations - newRations),
    rationsGained: Math.max(0, newRations - currentRations),
    rationsDepleted,
  };

  const facts: TravelWatchFacts = {
    type: "travel_watch_resolved",
    campaignId: input.campaignId,
    action: parsed.action,
    travelState: persistedTravelState,
    wildernessMap: {
      current: { q: newQ, r: newR, terrain: destTerrain, biome: destBiome },
      updatedHexes,
    },
    resourceChanges,
    travelProgress: {
      position: { q: newQ, r: newR },
      partialHexProgress: newPartialHexProgress,
      movementBlocked,
      exhaustionRisk,
    },
    scoutingResult,
    foragingResult,
    weather: {
      condition: newWeatherCondition,
      intensity: newWeatherIntensity,
      changed: weatherChanged,
    },
    encounter,
    events: warnings,
  };

  return {
    ok: true,
    action: parsed.action,
    watchIndex: newCurrentWatch,
    watchName: getWatchName(newCurrentWatch),
    totalWatches: newTotalWatches,
    totalDays: newTotalDays,
    position: { q: newQ, r: newR },
    terrain: destTerrain,
    biome: destBiome,
    featureDiscovered,
    encounter,
    randomEncounter: encounter,
    weather: {
      condition: newWeatherCondition,
      intensity: newWeatherIntensity,
      changed: weatherChanged,
    },
    rationsDepleted,
    restRequired,
    movementBlocked,
    exhaustionRisk,
    foragingResult,
    scoutingResult,
    warnings,
    resourceChanges,
    facts,
  };
}

export async function resolveTravelWatch(
  input: ResolveTravelWatchInput
): Promise<ResolveTravelWatchResult> {
  const db = resolveDb(input);

  if (input.tx || !db.$transaction) {
    return resolveTravelWatchInTransaction(db, input);
  }

  return db.$transaction((tx) => resolveTravelWatchInTransaction(tx, input));
}
