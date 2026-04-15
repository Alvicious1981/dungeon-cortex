/**
 * lib/ai/tools/wilderness.ts
 *
 * Vercel AI SDK tool: executeTravelWatch
 *
 * Architecture contract ("Code is Law"):
 *   This tool is the sole authority for overworld time progression.
 *   All hex discovery, terrain data, weather transitions, ration depletion,
 *   and exhaustion signals are computed here — the AI narrator only voices
 *   what this tool returns.
 *
 *   Pure function layer (lib/rules/wilderness.ts) ← zero I/O
 *   This file                                     ← all Prisma writes
 *   lib/ai/narrator.ts                            ← integrates this tool
 *
 * Terrain generation uses seededFloat (cyrb53 hash) so the same hex
 * coordinate in the same campaign always produces identical geography.
 */

import { tool } from "ai";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { seededFloat } from "@/lib/rules/generators";
import { rollDie } from "@/lib/rules/dice";
import {
  WATCHES_PER_DAY,
  NIGHT_WATCH_INDEX,
  WILDERNESS_RATION_INTERVAL_WATCHES,
  WEATHER_RECALC_INTERVAL_WATCHES,
  WILDERNESS_ENCOUNTER_NORMAL,
  WILDERNESS_ENCOUNTER_DANGEROUS,
  FAST_PACE_FORAGING_DC_PENALTY,
  SCOUTING_REVEAL_RADIUS,
  calculateTravelProgress,
  resolveForaging,
  generateWeatherCheck,
  getNeighborHex,
  isTerrainDangerous,
  type TerrainType,
  type TravelPace,
  type WeatherCondition,
  type WeatherIntensity,
} from "@/lib/rules/wilderness";

// ---------------------------------------------------------------------------
// Exported helpers — pure, no I/O, tested in wilderness tool tests
// ---------------------------------------------------------------------------

export interface HexTerrainData {
  terrain: TerrainType;
  biome: string;
  elevation: number;
  moisture: number;
}

/** Deterministic terrain lookup from elevation and moisture axes (Azgaar-inspired). */
function determineTerrain(elevation: number, moisture: number): TerrainType {
  if (elevation < 5)                          return "coast";
  if (elevation >= 70)                         return "mountain";
  if (elevation < 20 && moisture >= 75)        return "swamp";
  if (moisture < 20)                           return "desert";
  if (elevation >= 50 && moisture < 35)        return "tundra";
  if (elevation >= 35 && moisture >= 55)       return "taiga";
  if (moisture >= 55)                          return "forest";
  if (elevation >= 30)                         return "hills";
  return "plains";
}

/** Azgaar-style biome label derived from terrain + axes for narrator flavor. */
function determineBiome(
  terrain: TerrainType,
  elevation: number,
  moisture: number,
): string {
  switch (terrain) {
    case "plains":   return moisture > 45 ? "temperate grassland" : "dry steppe";
    case "forest":   return elevation > 25 ? "temperate broadleaf forest" : "tropical rainforest";
    case "hills":    return moisture > 45 ? "temperate hills" : "arid hills";
    case "mountain": return moisture > 50 ? "alpine highland" : "barren mountain";
    case "swamp":    return elevation < 10 ? "coastal wetland" : "inland swamp";
    case "desert":   return elevation > 30 ? "high desert plateau" : "hot sandy desert";
    case "coast":    return "coastal shoreline";
    case "tundra":   return "arctic tundra";
    case "taiga":    return "boreal taiga forest";
  }
}

/**
 * Generates deterministic terrain data for a hex from its seed string.
 * The same seed ALWAYS produces the same terrain, biome, elevation, and moisture.
 * Exported for unit testing.
 */
export function generateHexTerrain(hexSeed: string): HexTerrainData {
  const elevation = Math.round(seededFloat(hexSeed, 0) * 100);
  const moisture  = Math.round(seededFloat(hexSeed, 1) * 100);
  const terrain   = determineTerrain(elevation, moisture);
  const biome     = determineBiome(terrain, elevation, moisture);
  return { terrain, biome, elevation, moisture };
}

/**
 * Derives the deterministic seed for a hex at (q, r) in a campaign.
 * Format: "<campaignId>:<q>:<r>"
 * Exported for testing.
 */
export function makeHexSeed(campaignId: string, q: number, r: number): string {
  return `${campaignId}:${q}:${r}`;
}

/**
 * Extracts the Survival modifier from a Character.stats JSON blob.
 * Modifier = floor((WIS - 10) / 2). Defaults to 0 if WIS is absent.
 * Exported for testing.
 */
export function extractSurvivalMod(stats: unknown): number {
  if (typeof stats !== "object" || stats === null) return 0;
  const s = stats as Record<string, unknown>;
  const wis = typeof s["WIS"] === "number" ? s["WIS"] : 10;
  return Math.floor((wis - 10) / 2);
}

/** Maps watch index (0–5) to a human-readable watch name. */
const WATCH_NAMES = [
  "Dawn", "Morning", "Midday", "Afternoon", "Evening", "Night",
] as const;

/** Returns the named watch for a given watch index (0-based mod 6). Exported for testing. */
export function getWatchName(watchIndex: number): string {
  return WATCH_NAMES[watchIndex % WATCHES_PER_DAY] ?? `Watch ${watchIndex}`;
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

/**
 * Builds the executeTravelWatch Vercel AI SDK tool bound to a specific campaign.
 *
 * Called by buildTools() in lib/ai/narrator.ts. The campaignId is closed over
 * so the AI never receives it as input (no injection surface).
 */
export function buildWildernessTool(campaignId: string) {
  return tool({
    description:
      "Advance the wilderness clock by one watch (4 hours) for the given overworld action. " +
      "MUST be called for every action in the overworld — traveling, foraging, resting, " +
      "making camp, or scouting. " +
      "Returns hex discovery state, weather, ration status, encounter trigger, and warnings. " +
      "NEVER narrate hex discovery, terrain, weather changes, ration loss, or encounters " +
      "without calling this tool first. " +
      "The hex does not exist for the party until WildernessMap.discovered is true — " +
      "NEVER describe an undiscovered hex. " +
      "If `restRequired` is true, the NEXT action MUST be action='rest'. " +
      "Voice `warnings[]` diegetically. Code is Law.",

    inputSchema: z.object({
      action: z
        .enum(["travel", "forage", "rest", "camp", "scout"])
        .describe(
          "The overworld action the party is taking this watch. " +
          "'travel' moves the party in the given direction. " +
          "'forage' attempts to gather food (takes the full watch unless pace is slow). " +
          "'rest' is the mandatory Night watch action — required at watch index 5. " +
          "'camp' makes camp for the watch without triggering long-rest recovery. " +
          "'scout' reveals adjacent hexes without moving.",
        ),
      direction: z
        .number()
        .int()
        .min(0)
        .max(5)
        .optional()
        .describe(
          "Hex direction for 'travel' action only. " +
          "0=NE 1=E 2=SE 3=SW 4=W 5=NW. Omit for all other actions.",
        ),
      pace: z
        .enum(["slow", "normal", "fast"])
        .optional()
        .describe(
          "Travel pace override for this watch. " +
          "Omit to use the party's persisted pace. " +
          "slow=0.5 hexes/watch (stealth advantage, can forage while traveling). " +
          "normal=1 hex/watch. fast=2 hexes/watch (−5 passive Perception, +5 foraging DC).",
        ),
    }).strict(),

    execute: async ({ action, direction, pace }) => {
      try {
        // ── 1. Fetch state ─────────────────────────────────────────────────

        const [travelStateRaw, partyInventoryRaw, characterRaw] = await Promise.all([
          prisma.travelState.findUnique({ where: { campaignId } }),
          prisma.partyInventory.findUnique({ where: { campaignId } }),
          prisma.campaign
            .findUnique({
              where: { id: campaignId },
              select: { character: { select: { id: true, stats: true } } },
            })
            .then((c) => c?.character ?? null),
        ]);

        // Bootstrap TravelState if this is the party's first overworld action.
        const ts = travelStateRaw ?? {
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
          updatedAt: new Date(),
        };

        const effectivePace = (pace ?? ts.partyPace) as TravelPace;
        const weatherCondition = ts.weatherCondition as WeatherCondition;
        const weatherIntensity = ts.weatherIntensity as WeatherIntensity;

        // Fetch current hex terrain (origin plains if not yet created).
        const currentHexRaw = await prisma.wildernessMap.findUnique({
          where: { campaignId_q_r: { campaignId, q: ts.currentQ, r: ts.currentR } },
        });
        const currentTerrain = (currentHexRaw?.terrain ?? "plains") as TerrainType;
        const currentBiome   = currentHexRaw?.biome ?? "temperate grassland";

        // ── 2. Night Watch Gate ────────────────────────────────────────────

        if (ts.currentWatch === NIGHT_WATCH_INDEX && action !== "rest") {
          return JSON.stringify({
            error: "restRequired",
            message: "The Night watch (00:00–04:00) is mandatory rest. The party cannot act until they have slept.",
          });
        }

        // ── 3. Shared helpers ──────────────────────────────────────────────

        const warnings: string[] = [];

        // Weather recalc check — fires every WEATHER_RECALC_INTERVAL_WATCHES.
        const newWeatherCounter = ts.weatherWatchCounter + 1;
        let newWeatherCondition = weatherCondition;
        let newWeatherIntensity = weatherIntensity;
        let weatherChanged = false;

        if (newWeatherCounter >= WEATHER_RECALC_INTERVAL_WATCHES) {
          const wr = generateWeatherCheck(
            currentBiome,
            ts.seasonIndex,
            weatherCondition,
            weatherIntensity,
          );
          newWeatherCondition = wr.condition;
          newWeatherIntensity = wr.intensity;
          weatherChanged = wr.changed;
          if (wr.changed) warnings.push(`Weather shifts: ${wr.description}`);
        }

        // Ration check — fires every WILDERNESS_RATION_INTERVAL_WATCHES.
        const newWatchesSinceRation = ts.watchesSinceRation + 1;
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

        // ── 4. Action branch ──────────────────────────────────────────────

        let newQ = ts.currentQ;
        let newR = ts.currentR;
        let newPartialHexProgress = ts.partialHexProgress;
        let newWatchesTraveledToday = ts.watchesTraveledToday;
        let featureDiscovered: string | null = null;
        let encounter: { triggered: boolean; roll: number } | null = null;
        let foragingResult = null;
        let exhaustionRisk = false;
        let movementBlocked = false;
        let destTerrain = currentTerrain;
        let destBiome = currentBiome;

        // Arrays of prisma mutations to include in transaction.
        const hexUpserts: ReturnType<typeof prisma.wildernessMap.upsert>[] = [];

        if (action === "travel") {
          // Validate direction.
          if (direction === undefined || direction === null) {
            return JSON.stringify({ error: "directionRequired", message: "Direction (0–5) is required for travel." });
          }

          const progress = calculateTravelProgress(
            currentTerrain,
            effectivePace,
            weatherCondition,
            weatherIntensity,
            ts.watchesTraveledToday,
          );

          if (progress.blocked) {
            movementBlocked = true;
            if (weatherCondition === "storm" && weatherIntensity >= 2) {
              warnings.push("A violent storm makes travel impossible. The party shelters in place.");
            } else {
              warnings.push("The coast is impassable without a vessel.");
            }
          } else {
            // Check over-travel limit (Q7).
            if (progress.overTravelLimit) {
              exhaustionRisk = true;
              warnings.push(
                "The party has marched beyond their endurance. A Constitution saving throw is required or exhaustion sets in.",
              );
            }

            // Calculate hex movement.
            const accumulated = ts.partialHexProgress + progress.hexesThisWatch;
            const hexesToMove = Math.floor(accumulated);
            newPartialHexProgress = accumulated % 1;
            newWatchesTraveledToday = ts.watchesTraveledToday + 1;

            if (hexesToMove > 0) {
              // Generate upserts for each hex crossed (handles fast pace = 2 hexes).
              for (let step = 1; step <= hexesToMove; step++) {
                const stepQ = ts.currentQ + (step * getNeighborHex(0, 0, direction).q);
                const stepR = ts.currentR + (step * getNeighborHex(0, 0, direction).r);
                const stepSeed  = makeHexSeed(campaignId, stepQ, stepR);
                const stepData  = generateHexTerrain(stepSeed);
                const isFinal   = step === hexesToMove;

                hexUpserts.push(
                  prisma.wildernessMap.upsert({
                    where: { campaignId_q_r: { campaignId, q: stepQ, r: stepR } },
                    create: {
                      campaignId,
                      q: stepQ,
                      r: stepR,
                      terrain: stepData.terrain,
                      biome: stepData.biome,
                      elevation: stepData.elevation,
                      moisture: stepData.moisture,
                      discovered: isFinal,
                      scouted: true,
                      seed: stepSeed,
                    },
                    update: {
                      discovered: isFinal ? true : undefined,
                      scouted: true,
                    },
                  }),
                );

                if (isFinal) {
                  newQ = stepQ;
                  newR = stepR;
                  destTerrain = stepData.terrain;
                  destBiome   = stepData.biome;
                  if (stepData.terrain === "coast") {
                    warnings.push("The party reaches the coast — no vessel, no passage.");
                  }
                }
              }

              // Scout adjacent hexes around new position.
              for (let d = 0; d < 6; d++) {
                const adj = getNeighborHex(newQ, newR, d);
                const adjSeed = makeHexSeed(campaignId, adj.q, adj.r);
                const adjData = generateHexTerrain(adjSeed);
                hexUpserts.push(
                  prisma.wildernessMap.upsert({
                    where: { campaignId_q_r: { campaignId, q: adj.q, r: adj.r } },
                    create: {
                      campaignId,
                      q: adj.q,
                      r: adj.r,
                      terrain: adjData.terrain,
                      biome: adjData.biome,
                      elevation: adjData.elevation,
                      moisture: adjData.moisture,
                      scouted: true,
                      seed: adjSeed,
                    },
                    update: { scouted: true },
                  }),
                );
              }

              // Encounter check on destination terrain.
              const encRoll = rollDie(6);
              const encThreshold = isTerrainDangerous(destTerrain)
                ? WILDERNESS_ENCOUNTER_DANGEROUS
                : WILDERNESS_ENCOUNTER_NORMAL;
              encounter = { triggered: encRoll <= encThreshold, roll: encRoll };
              if (encounter.triggered) {
                warnings.push("A random encounter is triggered — begin combat or reaction roll.");
              }

              // Feature check (deterministic from hex seed).
              const destSeed = makeHexSeed(campaignId, newQ, newR);
              const featureRoll = seededFloat(destSeed, 2);
              const features = ["dungeon_entrance", "village", "ruins", "shrine"] as const;
              if (featureRoll < 0.05) {
                featureDiscovered = features[Math.floor(featureRoll / 0.05 * features.length)] ?? null;
                warnings.push(`Point of interest discovered: ${featureDiscovered}.`);
              }
            }
          }

        } else if (action === "forage") {
          const survivalMod = extractSurvivalMod(characterRaw?.stats);
          const dcPenalty   = effectivePace === "fast" ? FAST_PACE_FORAGING_DC_PENALTY : 0;
          const result      = resolveForaging(
            survivalMod,
            currentTerrain,
            weatherCondition,
            weatherIntensity,
            dcPenalty,
          );
          foragingResult = result;
          if (result.success) {
            newRations = currentRations + result.rationGain;
            warnings.push(result.description);
          } else {
            warnings.push(result.description);
          }

        } else if (action === "rest") {
          // Mandatory Night watch rest — resets daily travel counter.
          newWatchesTraveledToday = 0;
          warnings.push("The party rests through the night watch.");

        } else if (action === "camp") {
          // Voluntary camp — advances time without long-rest benefits.
          warnings.push("The party makes camp for the watch.");

        } else if (action === "scout") {
          // Scout — reveals adjacent hexes within SCOUTING_REVEAL_RADIUS (1).
          for (let d = 0; d < 6; d++) {
            const adj = getNeighborHex(ts.currentQ, ts.currentR, d);
            const adjSeed = makeHexSeed(campaignId, adj.q, adj.r);
            const adjData = generateHexTerrain(adjSeed);
            hexUpserts.push(
              prisma.wildernessMap.upsert({
                where: { campaignId_q_r: { campaignId, q: adj.q, r: adj.r } },
                create: {
                  campaignId,
                  q: adj.q,
                  r: adj.r,
                  terrain: adjData.terrain,
                  biome: adjData.biome,
                  elevation: adjData.elevation,
                  moisture: adjData.moisture,
                  scouted: true,
                  seed: adjSeed,
                },
                update: { scouted: true },
              }),
            );
          }
          warnings.push("The party scouts the surrounding terrain. Adjacent hexes revealed.");
        }

        // ── 5. Advance watch ───────────────────────────────────────────────

        const newCurrentWatch = (ts.currentWatch + 1) % WATCHES_PER_DAY;
        const newTotalWatches = ts.totalWatches + 1;
        const newTotalDays    = Math.floor(newTotalWatches / WATCHES_PER_DAY);

        // Reset daily travel counter at the start of each new day.
        if (newCurrentWatch === 0) newWatchesTraveledToday = 0;

        const restRequired = newCurrentWatch === NIGHT_WATCH_INDEX;
        if (restRequired) {
          warnings.push("Night falls. The party must rest before the next action.");
        }

        // ── 6. Atomic transaction ──────────────────────────────────────────

        const upsertTravelState = prisma.travelState.upsert({
          where: { campaignId },
          create: {
            campaignId,
            currentQ: newQ,
            currentR: newR,
            currentWatch: newCurrentWatch,
            totalWatches: newTotalWatches,
            totalDays: newTotalDays,
            watchesTraveledToday: newWatchesTraveledToday,
            watchesSinceRation:
              newWatchesSinceRation >= WILDERNESS_RATION_INTERVAL_WATCHES
                ? 0
                : newWatchesSinceRation,
            weatherWatchCounter:
              newWeatherCounter >= WEATHER_RECALC_INTERVAL_WATCHES ? 0 : newWeatherCounter,
            partialHexProgress: newPartialHexProgress,
            partyPace: effectivePace,
            weatherCondition: newWeatherCondition,
            weatherIntensity: newWeatherIntensity,
            seasonIndex: ts.seasonIndex,
          },
          update: {
            currentQ: newQ,
            currentR: newR,
            currentWatch: newCurrentWatch,
            totalWatches: newTotalWatches,
            totalDays: newTotalDays,
            watchesTraveledToday: newWatchesTraveledToday,
            watchesSinceRation:
              newWatchesSinceRation >= WILDERNESS_RATION_INTERVAL_WATCHES
                ? 0
                : newWatchesSinceRation,
            weatherWatchCounter:
              newWeatherCounter >= WEATHER_RECALC_INTERVAL_WATCHES ? 0 : newWeatherCounter,
            partialHexProgress: newPartialHexProgress,
            partyPace: effectivePace,
            weatherCondition: newWeatherCondition,
            weatherIntensity: newWeatherIntensity,
          },
        });

        const mutations: Prisma.PrismaPromise<unknown>[] = [
          ...hexUpserts,
          upsertTravelState,
        ];

        // Update rations only when they changed.
        if (newRations !== currentRations) {
          mutations.push(
            prisma.partyInventory.update({
              where: { campaignId },
              data: { rations: newRations },
            }),
          );
        }

        await prisma.$transaction(mutations);

        // ── 7. Return payload ──────────────────────────────────────────────

        return JSON.stringify({
          action,
          watchIndex: newCurrentWatch,
          watchName: getWatchName(newCurrentWatch),
          totalWatches: newTotalWatches,
          totalDays: newTotalDays,
          position: { q: newQ, r: newR },
          terrain: destTerrain,
          biome: destBiome,
          featureDiscovered,
          encounter,
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
          warnings,
        });

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({
          error: "executeTravelWatch failed",
          detail: msg,
        });
      }
    },
  });
}
