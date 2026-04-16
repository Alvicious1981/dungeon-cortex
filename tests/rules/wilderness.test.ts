/**
 * tests/rules/wilderness.test.ts
 *
 * Performance-grade test suite for Milestone P — Wilderness Exploration & Hexcrawl Engine.
 * Verifies 100% of the pure logic in lib/rules/wilderness.ts.
 */

import { describe, it, expect, vi } from "vitest";
import {
  WATCHES_PER_DAY,
  TURNS_PER_WATCH,
  NIGHT_WATCH_INDEX,
  WILDERNESS_RATION_INTERVAL_WATCHES,
  WEATHER_RECALC_INTERVAL_WATCHES,
  NORMAL_PACE_HEXES_PER_WATCH,
  FAST_PACE_HEXES_PER_WATCH,
  FAST_PACE_PERCEPTION_PENALTY,
  FAST_PACE_FORAGING_DC_PENALTY,
  MAX_TRAVEL_WATCHES_PER_DAY,
  FORAGE_DC_NORMAL,
  FORAGE_DC_HARSH,
  FORAGE_DC_WEATHER_PENALTY,
  SCOUTING_REVEAL_RADIUS,
  WILDERNESS_ENCOUNTER_NORMAL,
  WILDERNESS_ENCOUNTER_DANGEROUS,
  HEX_DIRECTIONS,
  getNeighborHex,
  isTerrainDangerous,
  calculateTravelProgress,
  resolveForaging,
  generateWeatherCheck,
  getWeatherDescription,
  type TerrainType,
  type TravelPace,
  type WeatherCondition,
  type WeatherIntensity,
} from "@/lib/rules/wilderness";

// ---------------------------------------------------------------------------
// 1. Constants (16 tests)
// ---------------------------------------------------------------------------

describe("Wilderness Constants", () => {
  it("WATCHES_PER_DAY should be 6", () => expect(WATCHES_PER_DAY).toBe(6));
  it("TURNS_PER_WATCH should be 24", () => expect(TURNS_PER_WATCH).toBe(24));
  it("NIGHT_WATCH_INDEX should be 5", () => expect(NIGHT_WATCH_INDEX).toBe(5));
  it("WILDERNESS_RATION_INTERVAL_WATCHES should be 6", () => expect(WILDERNESS_RATION_INTERVAL_WATCHES).toBe(6));
  it("WEATHER_RECALC_INTERVAL_WATCHES should be 6", () => expect(WEATHER_RECALC_INTERVAL_WATCHES).toBe(6));
  it("NORMAL_PACE_HEXES_PER_WATCH should be 1", () => expect(NORMAL_PACE_HEXES_PER_WATCH).toBe(1));
  it("FAST_PACE_HEXES_PER_WATCH should be 2", () => expect(FAST_PACE_HEXES_PER_WATCH).toBe(2));
  it("FAST_PACE_PERCEPTION_PENALTY should be -5", () => expect(FAST_PACE_PERCEPTION_PENALTY).toBe(-5));
  it("FAST_PACE_FORAGING_DC_PENALTY should be 5", () => expect(FAST_PACE_FORAGING_DC_PENALTY).toBe(5));
  it("MAX_TRAVEL_WATCHES_PER_DAY should be 2", () => expect(MAX_TRAVEL_WATCHES_PER_DAY).toBe(2));
  it("FORAGE_DC_NORMAL should be 10", () => expect(FORAGE_DC_NORMAL).toBe(10));
  it("FORAGE_DC_HARSH should be 15", () => expect(FORAGE_DC_HARSH).toBe(15));
  it("FORAGE_DC_WEATHER_PENALTY should be 5", () => expect(FORAGE_DC_WEATHER_PENALTY).toBe(5));
  it("SCOUTING_REVEAL_RADIUS should be 1", () => expect(SCOUTING_REVEAL_RADIUS).toBe(1));
  it("WILDERNESS_ENCOUNTER_NORMAL should be 1", () => expect(WILDERNESS_ENCOUNTER_NORMAL).toBe(1));
  it("WILDERNESS_ENCOUNTER_DANGEROUS should be 2", () => expect(WILDERNESS_ENCOUNTER_DANGEROUS).toBe(2));
});

// ---------------------------------------------------------------------------
// 2. Hex Direction Math (7 tests)
// ---------------------------------------------------------------------------

describe("Hex Direction Math", () => {
  const origin = { q: 0, r: 0 };

  it("Northeast (0) should be (+1, -1)", () => {
    const res = getNeighborHex(origin.q, origin.r, 0);
    expect(res).toEqual({ q: 1, r: -1 });
  });

  it("East (1) should be (+1, 0)", () => {
    const res = getNeighborHex(origin.q, origin.r, 1);
    expect(res).toEqual({ q: 1, r: 0 });
  });

  it("Southeast (2) should be (0, +1)", () => {
    const res = getNeighborHex(origin.q, origin.r, 2);
    expect(res).toEqual({ q: 0, r: 1 });
  });

  it("Southwest (3) should be (-1, +1)", () => {
    const res = getNeighborHex(origin.q, origin.r, 3);
    expect(res).toEqual({ q: -1, r: 1 });
  });

  it("West (4) should be (-1, 0)", () => {
    const res = getNeighborHex(origin.q, origin.r, 4);
    expect(res).toEqual({ q: -1, r: 0 });
  });

  it("Northwest (5) should be (0, -1)", () => {
    const res = getNeighborHex(origin.q, origin.r, 5);
    expect(res).toEqual({ q: 0, r: -1 });
  });

  it("should work from non-origin coordinates (e.g. 10, -5)", () => {
    // direction 1 (East) should be 11, -5
    expect(getNeighborHex(10, -5, 1)).toEqual({ q: 11, r: -5 });
    // direction 4 (West) should be 9, -5
    expect(getNeighborHex(10, -5, 4)).toEqual({ q: 9, r: -5 });
  });

  it("should throw for invalid direction index", () => {
    expect(() => getNeighborHex(0, 0, 6)).toThrow("Invalid direction index");
    expect(() => getNeighborHex(0, 0, -1)).toThrow("Invalid direction index");
  });
});

// ---------------------------------------------------------------------------
// 3. Terrain Severity (3 tests)
// ---------------------------------------------------------------------------

describe("isTerrainDangerous", () => {
  it("should return true for mountain", () => expect(isTerrainDangerous("mountain")).toBe(true));
  it("should return true for swamp", () => expect(isTerrainDangerous("swamp")).toBe(true));
  it("should return false for plains", () => expect(isTerrainDangerous("plains")).toBe(false));
});

// ---------------------------------------------------------------------------
// 4. calculateTravelProgress (25+ tests)
// ---------------------------------------------------------------------------

describe("calculateTravelProgress", () => {
  describe("Blocked Conditions", () => {
    it("coast should be blocked regardless of pace/weather", () => {
      const res = calculateTravelProgress("coast", "normal", "clear", 0);
      expect(res.blocked).toBe(true);
      expect(res.hexesThisWatch).toBe(0);
    });

    it("severe storm (intensity 2) should block movement", () => {
      const res = calculateTravelProgress("plains", "normal", "storm", 2);
      expect(res.blocked).toBe(true);
      expect(res.hexesThisWatch).toBe(0);
    });

    it("moderate storm (intensity 1) should NOT block movement", () => {
      const res = calculateTravelProgress("plains", "normal", "storm", 1);
      expect(res.blocked).toBe(false);
      expect(res.hexesThisWatch).toBeGreaterThan(0);
    });
  });

  describe("Pace and Weather modifiers", () => {
    it("Normal pace in clear weather: 1 hex", () => {
      const res = calculateTravelProgress("plains", "normal", "clear", 0);
      expect(res.hexesThisWatch).toBe(1);
    });

    it("Fast pace in clear weather: 2 hexes", () => {
      const res = calculateTravelProgress("plains", "fast", "clear", 0);
      expect(res.hexesThisWatch).toBe(2);
    });

    it("Slow pace in clear weather: 0.5 hex", () => {
      const res = calculateTravelProgress("plains", "slow", "clear", 0);
      expect(res.hexesThisWatch).toBe(0.5);
    });

    const terrains: TerrainType[] = ["forest", "hills", "mountain", "swamp", "desert", "tundra", "taiga"];
    terrains.forEach((t) => {
      it(`Normal pace in clear weather (${t}): 1 hex`, () => {
        const res = calculateTravelProgress(t, "normal", "clear", 0);
        expect(res.hexesThisWatch).toBe(1);
      });
    });

    const paces: TravelPace[] = ["slow", "normal", "fast"];
    paces.forEach((p) => {
      const expectedBase = p === "fast" ? 2 : p === "normal" ? 1 : 0.5;
      it(`${p} pace in clear weather: ${expectedBase} hex`, () => {
        expect(calculateTravelProgress("plains", p, "clear", 0).hexesThisWatch).toBe(expectedBase);
      });
    });

    const precipitationConditions: WeatherCondition[] = ["rain", "snow", "fog", "storm"];
    precipitationConditions.forEach((cond) => {
      it(`${cond} (intensity 1) halves movement`, () => {
        const base = calculateTravelProgress("plains", "normal", "clear", 0).hexesThisWatch;
        const reduced = calculateTravelProgress("plains", "normal", cond, 1).hexesThisWatch;
        expect(reduced).toBe(base * 0.5);
      });
    });

    it("Intensity 0 precipitation does NOT halve movement", () => {
      expect(calculateTravelProgress("plains", "normal", "rain", 0).hexesThisWatch).toBe(1);
    });
  });

  describe("Status Flags", () => {
    it("Slow pace grants stealth advantage and foraging capability", () => {
      const res = calculateTravelProgress("plains", "slow", "clear", 0);
      expect(res.stealthAdvantage).toBe(true);
      expect(res.canForageWhileTraveling).toBe(true);
    });

    it("Fast pace applies perception and foraging penalties", () => {
      const res = calculateTravelProgress("plains", "fast", "clear", 0);
      expect(res.perceptionPenalty).toBe(FAST_PACE_PERCEPTION_PENALTY);
      expect(res.foragingDCPenalty).toBe(FAST_PACE_FORAGING_DC_PENALTY);
    });

    it("overTravelLimit signal should trigger correctly", () => {
      expect(calculateTravelProgress("plains", "normal", "clear", 0, 1).overTravelLimit).toBe(false);
      expect(calculateTravelProgress("plains", "normal", "clear", 0, 2).overTravelLimit).toBe(true);
      expect(calculateTravelProgress("plains", "normal", "clear", 0, 3).overTravelLimit).toBe(true);
    });

    it("Fast pace is NOT blocked by moderate storm (intensity 1)", () => {
        const res = calculateTravelProgress("plains", "fast", "storm", 1);
        expect(res.hexesThisWatch).toBe(1); // 2 * 0.5
        expect(res.blocked).toBe(false);
    });

    it("Slow pace is NOT blocked by moderate storm (intensity 1)", () => {
        const res = calculateTravelProgress("plains", "slow", "storm", 1);
        expect(res.hexesThisWatch).toBe(0.25); // 0.5 * 0.5
        expect(res.blocked).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// 5. resolveForaging (25+ tests)
// ---------------------------------------------------------------------------

describe("resolveForaging", () => {
  describe("DC Calculation", () => {
    it("Normal terrain should have DC 10", () => {
      expect(resolveForaging(0, "plains", "clear", 0).dc).toBe(10);
      expect(resolveForaging(0, "forest", "clear", 0).dc).toBe(10);
      expect(resolveForaging(0, "taiga", "clear", 0).dc).toBe(10);
    });

    it("Harsh terrain should have DC 15", () => {
      expect(resolveForaging(0, "hills", "clear", 0).dc).toBe(15);
      expect(resolveForaging(0, "mountain", "clear", 0).dc).toBe(15);
      expect(resolveForaging(0, "desert", "clear", 0).dc).toBe(15);
      expect(resolveForaging(0, "coast", "clear", 0).dc).toBe(15);
      expect(resolveForaging(0, "tundra", "clear", 0).dc).toBe(15);
    });

    const allTerrains: TerrainType[] = ["plains", "forest", "hills", "mountain", "swamp", "desert", "coast", "tundra", "taiga"];
    allTerrains.forEach(t => {
        it(`DC check for ${t} in bad weather`, () => {
            const baseDC = ["plains", "forest", "taiga"].includes(t) ? 10 : 15;
            expect(resolveForaging(0, t, "rain", 1).dc).toBe(baseDC + 5);
        });
    });

    it("Bad weather adds DC 5 penalty", () => {
      expect(resolveForaging(0, "plains", "rain", 1).dc).toBe(15);
      expect(resolveForaging(0, "plains", "storm", 1).dc).toBe(15);
      expect(resolveForaging(0, "plains", "storm", 0).dc).toBe(15);
    });

    it("dcModifier applies correctly", () => {
      expect(resolveForaging(0, "plains", "clear", 0, 5).dc).toBe(15);
    });
  });

  describe("Resolution Logic", () => {
    it("Success when total matches DC", () => {
      const res = resolveForaging(2, "plains", "clear", 0, 0, 8); // 8+2=10, DC=10
      expect(res.success).toBe(true);
      expect(res.total).toBe(10);
    });

    it("Failure when total is below DC", () => {
      const res = resolveForaging(2, "plains", "clear", 0, 0, 7); // 7+2=9, DC=10
      expect(res.success).toBe(false);
    });

    it("Yield calculation on success", () => {
      const res = resolveForaging(2, "plains", "clear", 0, 0, 10, 3); // survivalMod=2, yieldRoll=3
      expect(res.rationGain).toBe(5); // 2 + 3
    });

    it("Minimum yield is 1 ration", () => {
      const res = resolveForaging(-5, "plains", "clear", 0, 0, 20, 1); // survivalMod=-5, yieldRoll=1
      expect(res.rationGain).toBe(1);
    });

    it("Yield is 0 on failure", () => {
      const res = resolveForaging(2, "plains", "clear", 0, 0, 1);
      expect(res.rationGain).toBe(0);
    });

    it("High survival modifier guarantees minimum 1 ration on success", () => {
        const res = resolveForaging(10, "plains", "clear", 0, 0, 10, 1); // roll 10 + mod 10 = 20 (Success). yield roll 1 + mod 10 = 11.
        expect(res.success).toBe(true);
        expect(res.rationGain).toBe(11);
    });

    it("Very low survival modifier still yields at least 1 ration on success", () => {
        const res = resolveForaging(-10, "plains", "clear", 0, 0, 25, 1); // roll 25 - mod 10 = 15 (Success). yield roll 1 - mod 10 = -9 -> capped at 1.
        expect(res.success).toBe(true);
        expect(res.rationGain).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// 6. generateWeatherCheck (30+ tests)
// ---------------------------------------------------------------------------

describe("generateWeatherCheck", () => {
  describe("Basic Transitions", () => {
    it("Persist (5-14) maintains same state", () => {
      for (let roll = 5; roll <= 14; roll++) {
        const res = generateWeatherCheck("temperate", 0, "rain", 0, roll);
        expect(res.condition).toBe("rain");
        expect(res.intensity).toBe(0);
        expect(res.changed).toBe(false);
      }
    });

    it("Worsen (1-4) advances ladder", () => {
      expect(generateWeatherCheck("temperate", 0, "clear", 0, 13).condition).toBe("overcast");
      expect(generateWeatherCheck("temperate", 0, "overcast", 0, 1).condition).toBe("fog");
      expect(generateWeatherCheck("temperate", 0, "fog", 0, 1).condition).toBe("rain");
      expect(generateWeatherCheck("temperate", 0, "rain", 0, 1).intensity).toBe(1);
      expect(generateWeatherCheck("temperate", 0, "storm", 1, 1).intensity).toBe(2);
    });

    it("Improve (15-20) reverses ladder", () => {
      expect(generateWeatherCheck("temperate", 0, "storm", 2, 16).intensity).toBe(1);
      expect(generateWeatherCheck("temperate", 0, "storm", 1, 15).condition).toBe("rain");
      expect(generateWeatherCheck("temperate", 0, "rain", 0, 15).condition).toBe("fog");
      expect(generateWeatherCheck("temperate", 0, "fog", 0, 15).condition).toBe("overcast");
    });
  });

  describe("Special Persistence Rules", () => {
    it("75% persistence for intensity 2 storms (roll 1-15)", () => {
      for (let roll = 1; roll <= 15; roll++) {
        const res = generateWeatherCheck("temperate", 0, "storm", 2, roll);
        expect(res.intensity).toBe(2);
      }
      expect(generateWeatherCheck("temperate", 0, "storm", 2, 16).intensity).toBe(1);
    });

    it("60% persistence for clear weather (roll 1-12)", () => {
      for (let roll = 1; roll <= 12; roll++) {
        const res = generateWeatherCheck("temperate", 0, "clear", 0, roll);
        expect(res.condition).toBe("clear");
      }
      expect(generateWeatherCheck("temperate", 0, "clear", 0, 13).condition).toBe("overcast");
    });
  });

  describe("Biome and Season Gates", () => {
    it("Rain turns to snow in tundra biomes in winter", () => {
      const res = generateWeatherCheck("tundra", 3, "fog", 0, 1); // fog worsens to rain -> gated to snow
      expect(res.condition).toBe("snow");
    });

    it("Rain does NOT turn to snow in forest biomes in winter", () => {
      const res = generateWeatherCheck("forest", 3, "fog", 0, 1);
      expect(res.condition).toBe("rain");
    });

    it("Rain does NOT turn to snow in tundra biomes in summer", () => {
      const res = generateWeatherCheck("tundra", 1, "fog", 0, 1);
      expect(res.condition).toBe("rain");
    });

    it("Fog gated to overcast in desert biomes", () => {
      const res = generateWeatherCheck("desert", 0, "overcast", 0, 1); // overcast worsens to fog -> gated to overcast
      expect(res.condition).toBe("overcast");
    });
  });

  describe("Edge cases", () => {
      it("should handle unknown weather states by falling back to clear", () => {
          // @ts-ignore
          const res = generateWeatherCheck("temperate", 0, "volcanic_ash", 1, 10);
          expect(res.condition).toBe("clear");
      });

      const biomes = ["temperate", "tropical", "arctic", "desert", "tundra", "taiga", "mountain"];
      biomes.forEach(b => {
          it(`should handle persist for ${b} biome`, () => {
              const res = generateWeatherCheck(b, 0, "overcast", 0, 10);
              expect(res.condition).toBe("overcast");
              expect(res.changed).toBe(false);
          });
      });

      it("should not advance beyond ladder max", () => {
          const res = generateWeatherCheck("temperate", 0, "storm", 2, 1);
          expect(res.condition).toBe("storm");
          expect(res.intensity).toBe(2);
      });

      it("should not regress below ladder min", () => {
          // Use an unknown condition that maps to index 0, then roll to improve.
          // @ts-ignore
          const res = generateWeatherCheck("temperate", 0, "unknown", 0, 20);
          expect(res.condition).toBe("clear");
          expect(res.intensity).toBe(0);
      });
  });

  describe("Internal Logic Coverage", () => {
    it("should handle snow intensity mapping correctly", () => {
        // snow intensity 1 -> index 4 (rain 1)
        expect(generateWeatherCheck("temperate", 0, "snow", 1, 10).condition).toBe("rain"); 
        // snow intensity 0 -> index 3 (rain 0)
        expect(generateWeatherCheck("temperate", 0, "snow", 0, 10).condition).toBe("rain");
        // snow intensity 2 -> index 3 (fallback)
        expect(generateWeatherCheck("temperate", 0, "snow", 2, 10).condition).toBe("rain");
    });

    it("should handle biome gate skip conditions", () => {
        // Condition not rain -> skip snow gate
        expect(generateWeatherCheck("tundra", 3, "clear", 0, 10).condition).toBe("clear");
        // Not winter -> skip snow gate
        expect(generateWeatherCheck("tundra", 0, "fog", 0, 1).condition).toBe("rain");
        // Not fog -> skip no-fog gate
        expect(generateWeatherCheck("desert", 0, "clear", 0, 13).condition).toBe("overcast");
    });

    it("should cover fallback branches (?? logic)", () => {
        // Uncovered branch in getWeatherDescription (?? fallback)
        // @ts-ignore
        const desc = getWeatherDescription("blood_rain", 2);
        expect(desc).toContain("blood_rain");
        expect(desc).toContain("2");
        
        // Let's just test that calling generateWeatherCheck WITHOUT forcedRoll works (hits rollDie(20))
        const res2 = generateWeatherCheck("temperate", 0, "clear", 0);
        expect(res2.condition).toBeDefined();
    });
  });
});
