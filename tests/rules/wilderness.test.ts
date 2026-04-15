import { describe, it, expect } from "vitest";
import {
  // Constants
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
  // Types / arrays
  TERRAIN_TYPES,
  TRAVEL_PACES,
  WEATHER_CONDITIONS,
  HEX_DIRECTIONS,
  // Helpers
  getNeighborHex,
  isTerrainDangerous,
  // Pure functions
  calculateTravelProgress,
  resolveForaging,
  generateWeatherCheck,
} from "@/lib/rules/wilderness";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("wilderness constants", () => {
  it("WATCHES_PER_DAY = 6", () => expect(WATCHES_PER_DAY).toBe(6));
  it("TURNS_PER_WATCH = 24", () => expect(TURNS_PER_WATCH).toBe(24));
  it("NIGHT_WATCH_INDEX = 5", () => expect(NIGHT_WATCH_INDEX).toBe(5));
  it("WILDERNESS_RATION_INTERVAL_WATCHES = 6", () =>
    expect(WILDERNESS_RATION_INTERVAL_WATCHES).toBe(6));
  it("WEATHER_RECALC_INTERVAL_WATCHES = 6", () =>
    expect(WEATHER_RECALC_INTERVAL_WATCHES).toBe(6));
  it("NORMAL_PACE_HEXES_PER_WATCH = 1", () =>
    expect(NORMAL_PACE_HEXES_PER_WATCH).toBe(1));
  it("FAST_PACE_HEXES_PER_WATCH = 2", () =>
    expect(FAST_PACE_HEXES_PER_WATCH).toBe(2));
  it("FAST_PACE_PERCEPTION_PENALTY = -5", () =>
    expect(FAST_PACE_PERCEPTION_PENALTY).toBe(-5));
  it("FAST_PACE_FORAGING_DC_PENALTY = 5", () =>
    expect(FAST_PACE_FORAGING_DC_PENALTY).toBe(5));
  it("MAX_TRAVEL_WATCHES_PER_DAY = 2", () =>
    expect(MAX_TRAVEL_WATCHES_PER_DAY).toBe(2));
  it("FORAGE_DC_NORMAL = 10", () => expect(FORAGE_DC_NORMAL).toBe(10));
  it("FORAGE_DC_HARSH = 15", () => expect(FORAGE_DC_HARSH).toBe(15));
  it("FORAGE_DC_WEATHER_PENALTY = 5", () =>
    expect(FORAGE_DC_WEATHER_PENALTY).toBe(5));
  it("SCOUTING_REVEAL_RADIUS = 1", () => expect(SCOUTING_REVEAL_RADIUS).toBe(1));
  it("WILDERNESS_ENCOUNTER_NORMAL = 1", () =>
    expect(WILDERNESS_ENCOUNTER_NORMAL).toBe(1));
  it("WILDERNESS_ENCOUNTER_DANGEROUS = 2", () =>
    expect(WILDERNESS_ENCOUNTER_DANGEROUS).toBe(2));
});

// ---------------------------------------------------------------------------
// Types / arrays
// ---------------------------------------------------------------------------

describe("TERRAIN_TYPES", () => {
  it("contains all 9 canonical terrain types", () => {
    expect(TERRAIN_TYPES).toHaveLength(9);
    const expected = [
      "plains", "forest", "hills", "mountain", "swamp",
      "desert", "coast", "tundra", "taiga",
    ];
    for (const t of expected) {
      expect(TERRAIN_TYPES).toContain(t);
    }
  });
});

describe("TRAVEL_PACES", () => {
  it("contains slow, normal, fast", () => {
    expect(TRAVEL_PACES).toContain("slow");
    expect(TRAVEL_PACES).toContain("normal");
    expect(TRAVEL_PACES).toContain("fast");
  });
});

describe("WEATHER_CONDITIONS", () => {
  it("contains all 6 weather conditions", () => {
    const expected = ["clear", "overcast", "rain", "storm", "fog", "snow"];
    for (const c of expected) {
      expect(WEATHER_CONDITIONS).toContain(c);
    }
  });
});

// ---------------------------------------------------------------------------
// HEX_DIRECTIONS
// ---------------------------------------------------------------------------

describe("HEX_DIRECTIONS", () => {
  it("has exactly 6 directions", () => {
    expect(HEX_DIRECTIONS).toHaveLength(6);
  });

  it("direction 0 (Northeast) is (+1, -1)", () => {
    expect(HEX_DIRECTIONS[0].dq).toBe(+1);
    expect(HEX_DIRECTIONS[0].dr).toBe(-1);
  });
  it("direction 1 (East) is (+1, 0)", () => {
    expect(HEX_DIRECTIONS[1].dq).toBe(+1);
    expect(HEX_DIRECTIONS[1].dr).toBe(0);
  });
  it("direction 2 (Southeast) is (0, +1)", () => {
    expect(HEX_DIRECTIONS[2].dq).toBe(0);
    expect(HEX_DIRECTIONS[2].dr).toBe(+1);
  });
  it("direction 3 (Southwest) is (-1, +1)", () => {
    expect(HEX_DIRECTIONS[3].dq).toBe(-1);
    expect(HEX_DIRECTIONS[3].dr).toBe(+1);
  });
  it("direction 4 (West) is (-1, 0)", () => {
    expect(HEX_DIRECTIONS[4].dq).toBe(-1);
    expect(HEX_DIRECTIONS[4].dr).toBe(0);
  });
  it("direction 5 (Northwest) is (0, -1)", () => {
    expect(HEX_DIRECTIONS[5].dq).toBe(0);
    expect(HEX_DIRECTIONS[5].dr).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// getNeighborHex
// ---------------------------------------------------------------------------

describe("getNeighborHex", () => {
  it("direction 0 (NE) from (0,0) → (1,-1)", () => {
    expect(getNeighborHex(0, 0, 0)).toEqual({ q: 1, r: -1 });
  });
  it("direction 1 (E) from (0,0) → (1,0)", () => {
    expect(getNeighborHex(0, 0, 1)).toEqual({ q: 1, r: 0 });
  });
  it("direction 2 (SE) from (0,0) → (0,1)", () => {
    expect(getNeighborHex(0, 0, 2)).toEqual({ q: 0, r: 1 });
  });
  it("direction 3 (SW) from (0,0) → (-1,1)", () => {
    expect(getNeighborHex(0, 0, 3)).toEqual({ q: -1, r: 1 });
  });
  it("direction 4 (W) from (0,0) → (-1,0)", () => {
    expect(getNeighborHex(0, 0, 4)).toEqual({ q: -1, r: 0 });
  });
  it("direction 5 (NW) from (0,0) → (0,-1)", () => {
    expect(getNeighborHex(0, 0, 5)).toEqual({ q: 0, r: -1 });
  });
  it("works from non-origin hex: dir 1 from (3,2) → (4,2)", () => {
    expect(getNeighborHex(3, 2, 1)).toEqual({ q: 4, r: 2 });
  });
  it("throws for direction index < 0", () => {
    expect(() => getNeighborHex(0, 0, -1)).toThrow();
  });
  it("throws for direction index > 5", () => {
    expect(() => getNeighborHex(0, 0, 6)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// isTerrainDangerous
// ---------------------------------------------------------------------------

describe("isTerrainDangerous", () => {
  it("mountain is dangerous", () => expect(isTerrainDangerous("mountain")).toBe(true));
  it("swamp is dangerous", () => expect(isTerrainDangerous("swamp")).toBe(true));
  it("plains is not dangerous", () => expect(isTerrainDangerous("plains")).toBe(false));
  it("forest is not dangerous", () => expect(isTerrainDangerous("forest")).toBe(false));
  it("hills is not dangerous", () => expect(isTerrainDangerous("hills")).toBe(false));
  it("desert is not dangerous", () => expect(isTerrainDangerous("desert")).toBe(false));
  it("coast is not dangerous", () => expect(isTerrainDangerous("coast")).toBe(false));
  it("tundra is not dangerous", () => expect(isTerrainDangerous("tundra")).toBe(false));
  it("taiga is not dangerous", () => expect(isTerrainDangerous("taiga")).toBe(false));
});

// ---------------------------------------------------------------------------
// calculateTravelProgress
// ---------------------------------------------------------------------------

describe("calculateTravelProgress — pace on plains", () => {
  it("normal pace → 1 hex/watch", () => {
    const r = calculateTravelProgress("plains", "normal", "clear", 0);
    expect(r.hexesThisWatch).toBe(1);
    expect(r.blocked).toBe(false);
  });
  it("fast pace → 2 hexes/watch", () => {
    const r = calculateTravelProgress("plains", "fast", "clear", 0);
    expect(r.hexesThisWatch).toBe(2);
    expect(r.blocked).toBe(false);
  });
  it("slow pace → 0.5 hexes/watch", () => {
    const r = calculateTravelProgress("plains", "slow", "clear", 0);
    expect(r.hexesThisWatch).toBe(0.5);
    expect(r.blocked).toBe(false);
  });
});

describe("calculateTravelProgress — pace on other traversable terrains", () => {
  const nonCoastTerrains = TERRAIN_TYPES.filter((t) => t !== "coast");

  for (const terrain of nonCoastTerrains) {
    it(`normal pace on ${terrain} → 1 hex and not blocked`, () => {
      const r = calculateTravelProgress(terrain, "normal", "clear", 0);
      expect(r.blocked).toBe(false);
      expect(r.hexesThisWatch).toBe(1);
    });
    it(`fast pace on ${terrain} → 2 hexes and not blocked`, () => {
      const r = calculateTravelProgress(terrain, "fast", "clear", 0);
      expect(r.blocked).toBe(false);
      expect(r.hexesThisWatch).toBe(2);
    });
  }
});

describe("calculateTravelProgress — coast (impassable)", () => {
  it("coast + slow → blocked", () => {
    expect(calculateTravelProgress("coast", "slow", "clear", 0).blocked).toBe(true);
  });
  it("coast + normal → blocked", () => {
    expect(calculateTravelProgress("coast", "normal", "clear", 0).blocked).toBe(true);
  });
  it("coast + fast → blocked", () => {
    expect(calculateTravelProgress("coast", "fast", "clear", 0).blocked).toBe(true);
  });
  it("coast + blocked → hexesThisWatch = 0", () => {
    expect(calculateTravelProgress("coast", "normal", "clear", 0).hexesThisWatch).toBe(0);
  });
});

describe("calculateTravelProgress — storm intensity 2 (impassable)", () => {
  it("storm intensity 2 + plains + normal → blocked", () => {
    expect(calculateTravelProgress("plains", "normal", "storm", 2).blocked).toBe(true);
  });
  it("storm intensity 2 + fast → blocked", () => {
    expect(calculateTravelProgress("forest", "fast", "storm", 2).blocked).toBe(true);
  });
  it("storm intensity 2 blocked → hexesThisWatch = 0", () => {
    expect(calculateTravelProgress("plains", "fast", "storm", 2).hexesThisWatch).toBe(0);
  });
});

describe("calculateTravelProgress — weather halving (intensity ≥ 1)", () => {
  it("clear → no halving (normal = 1)", () => {
    expect(calculateTravelProgress("plains", "normal", "clear", 0).hexesThisWatch).toBe(1);
  });
  it("rain intensity 0 → no halving", () => {
    expect(calculateTravelProgress("plains", "normal", "rain", 0).hexesThisWatch).toBe(1);
  });
  it("rain intensity 1 + normal → 0.5 hexes", () => {
    expect(calculateTravelProgress("plains", "normal", "rain", 1).hexesThisWatch).toBe(0.5);
  });
  it("rain intensity 1 + fast → 1 hex (fast halved)", () => {
    expect(calculateTravelProgress("plains", "fast", "rain", 1).hexesThisWatch).toBe(1);
  });
  it("rain intensity 1 + slow → 0.25 hexes", () => {
    expect(calculateTravelProgress("plains", "slow", "rain", 1).hexesThisWatch).toBe(0.25);
  });
  it("fog intensity 1 + normal → 0.5 hexes", () => {
    expect(calculateTravelProgress("plains", "normal", "fog", 1).hexesThisWatch).toBe(0.5);
  });
  it("snow intensity 1 + normal → 0.5 hexes", () => {
    expect(calculateTravelProgress("plains", "normal", "snow", 1).hexesThisWatch).toBe(0.5);
  });
  it("storm intensity 1 + normal → 0.5 hexes (not fully blocked)", () => {
    expect(calculateTravelProgress("plains", "normal", "storm", 1).hexesThisWatch).toBe(0.5);
  });
  it("storm intensity 1 + fast → 1 hex", () => {
    expect(calculateTravelProgress("plains", "fast", "storm", 1).hexesThisWatch).toBe(1);
  });
  it("overcast + normal → no halving (intensity 0)", () => {
    expect(calculateTravelProgress("plains", "normal", "overcast", 0).hexesThisWatch).toBe(1);
  });
});

describe("calculateTravelProgress — pace flags", () => {
  it("fast → perceptionPenalty = -5", () => {
    expect(calculateTravelProgress("plains", "fast", "clear", 0).perceptionPenalty).toBe(-5);
  });
  it("normal → perceptionPenalty = 0", () => {
    expect(calculateTravelProgress("plains", "normal", "clear", 0).perceptionPenalty).toBe(0);
  });
  it("slow → perceptionPenalty = 0", () => {
    expect(calculateTravelProgress("plains", "slow", "clear", 0).perceptionPenalty).toBe(0);
  });
  it("fast → foragingDCPenalty = 5", () => {
    expect(calculateTravelProgress("plains", "fast", "clear", 0).foragingDCPenalty).toBe(5);
  });
  it("normal → foragingDCPenalty = 0", () => {
    expect(calculateTravelProgress("plains", "normal", "clear", 0).foragingDCPenalty).toBe(0);
  });
  it("slow → stealthAdvantage = true", () => {
    expect(calculateTravelProgress("plains", "slow", "clear", 0).stealthAdvantage).toBe(true);
  });
  it("normal → stealthAdvantage = false", () => {
    expect(calculateTravelProgress("plains", "normal", "clear", 0).stealthAdvantage).toBe(false);
  });
  it("fast → stealthAdvantage = false", () => {
    expect(calculateTravelProgress("plains", "fast", "clear", 0).stealthAdvantage).toBe(false);
  });
  it("slow → canForageWhileTraveling = true", () => {
    expect(calculateTravelProgress("plains", "slow", "clear", 0).canForageWhileTraveling).toBe(true);
  });
  it("normal → canForageWhileTraveling = false", () => {
    expect(calculateTravelProgress("plains", "normal", "clear", 0).canForageWhileTraveling).toBe(false);
  });
  it("fast → canForageWhileTraveling = false", () => {
    expect(calculateTravelProgress("plains", "fast", "clear", 0).canForageWhileTraveling).toBe(false);
  });
});

describe("calculateTravelProgress — overTravelLimit", () => {
  it("watchesTraveledToday = 0 → overTravelLimit = false", () => {
    expect(calculateTravelProgress("plains", "normal", "clear", 0, 0).overTravelLimit).toBe(false);
  });
  it("watchesTraveledToday = 1 → overTravelLimit = false", () => {
    expect(calculateTravelProgress("plains", "normal", "clear", 0, 1).overTravelLimit).toBe(false);
  });
  it("watchesTraveledToday = 2 → overTravelLimit = true (at MAX)", () => {
    expect(calculateTravelProgress("plains", "normal", "clear", 0, 2).overTravelLimit).toBe(true);
  });
  it("watchesTraveledToday = 3 → overTravelLimit = true (exceeds MAX)", () => {
    expect(calculateTravelProgress("plains", "normal", "clear", 0, 3).overTravelLimit).toBe(true);
  });
  it("default watchesTraveledToday (0) → overTravelLimit = false", () => {
    expect(calculateTravelProgress("plains", "normal", "clear", 0).overTravelLimit).toBe(false);
  });
  it("coast + watchesTraveledToday = 3 → blocked and overTravelLimit = true", () => {
    const r = calculateTravelProgress("coast", "normal", "clear", 0, 3);
    expect(r.blocked).toBe(true);
    expect(r.overTravelLimit).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveForaging — DC by terrain
// ---------------------------------------------------------------------------

describe("resolveForaging — terrain DC mapping", () => {
  const dcNormalTerrains = ["plains", "forest", "taiga"] as const;
  const dcHarshTerrains = ["hills", "mountain", "swamp", "desert", "coast", "tundra"] as const;

  for (const terrain of dcNormalTerrains) {
    it(`${terrain} has base DC ${FORAGE_DC_NORMAL}`, () => {
      // Roll exactly at DC, survivalMod 0 → success
      const r = resolveForaging(0, terrain, "clear", 0, 0, FORAGE_DC_NORMAL);
      expect(r.dc).toBe(FORAGE_DC_NORMAL);
      expect(r.success).toBe(true);
    });
  }

  for (const terrain of dcHarshTerrains) {
    it(`${terrain} has base DC ${FORAGE_DC_HARSH}`, () => {
      const r = resolveForaging(0, terrain, "clear", 0, 0, FORAGE_DC_HARSH);
      expect(r.dc).toBe(FORAGE_DC_HARSH);
      expect(r.success).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// resolveForaging — success / failure
// ---------------------------------------------------------------------------

describe("resolveForaging — success and failure", () => {
  it("roll 20, mod 0, plains DC 10 → success", () => {
    const r = resolveForaging(0, "plains", "clear", 0, 0, 20);
    expect(r.success).toBe(true);
  });
  it("roll 1, mod 0, plains DC 10 → failure", () => {
    const r = resolveForaging(0, "plains", "clear", 0, 0, 1);
    expect(r.success).toBe(false);
  });
  it("roll exactly at DC (10) → success", () => {
    const r = resolveForaging(0, "plains", "clear", 0, 0, 10);
    expect(r.success).toBe(true);
    expect(r.total).toBe(10);
  });
  it("roll DC - 1 (9) with mod 0 → failure", () => {
    const r = resolveForaging(0, "plains", "clear", 0, 0, 9);
    expect(r.success).toBe(false);
    expect(r.total).toBe(9);
  });
  it("failure → rationGain = 0", () => {
    expect(resolveForaging(0, "plains", "clear", 0, 0, 1).rationGain).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// resolveForaging — survivalMod
// ---------------------------------------------------------------------------

describe("resolveForaging — survivalMod applied", () => {
  it("roll 8, mod +2, DC 10 → total 10, success", () => {
    const r = resolveForaging(2, "plains", "clear", 0, 0, 8);
    expect(r.total).toBe(10);
    expect(r.success).toBe(true);
  });
  it("roll 8, mod -1, DC 10 → total 7, failure", () => {
    const r = resolveForaging(-1, "plains", "clear", 0, 0, 8);
    expect(r.total).toBe(7);
    expect(r.success).toBe(false);
  });
  it("roll field equals raw d20 (not modified by survivalMod)", () => {
    const r = resolveForaging(5, "plains", "clear", 0, 0, 12);
    expect(r.roll).toBe(12);
    expect(r.total).toBe(17);
  });
});

// ---------------------------------------------------------------------------
// resolveForaging — weather DC penalty
// ---------------------------------------------------------------------------

describe("resolveForaging — weather DC penalty", () => {
  it("rain intensity 0 → no weather DC penalty", () => {
    const r = resolveForaging(0, "plains", "rain", 0, 0, 10);
    expect(r.dc).toBe(FORAGE_DC_NORMAL); // 10
    expect(r.success).toBe(true);
  });
  it("rain intensity 1 → DC +5 = 15 (plains)", () => {
    const r = resolveForaging(0, "plains", "rain", 1, 0, 14);
    expect(r.dc).toBe(FORAGE_DC_NORMAL + FORAGE_DC_WEATHER_PENALTY); // 15
    expect(r.success).toBe(false); // 14 < 15
  });
  it("storm (any intensity) → DC +5 (plains)", () => {
    const r = resolveForaging(0, "plains", "storm", 1, 0, 10);
    expect(r.dc).toBe(15);
    expect(r.success).toBe(false); // 10 < 15
  });
  it("storm + plains + roll 15 → success (15 >= 15)", () => {
    const r = resolveForaging(0, "plains", "storm", 2, 0, 15);
    expect(r.dc).toBe(15);
    expect(r.success).toBe(true);
  });
  it("snow does not add weather DC penalty", () => {
    const r = resolveForaging(0, "plains", "snow", 1, 0, 10);
    expect(r.dc).toBe(FORAGE_DC_NORMAL); // no penalty
    expect(r.success).toBe(true);
  });
  it("fog does not add weather DC penalty", () => {
    const r = resolveForaging(0, "plains", "fog", 1, 0, 10);
    expect(r.dc).toBe(FORAGE_DC_NORMAL);
    expect(r.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveForaging — dcModifier (fast pace)
// ---------------------------------------------------------------------------

describe("resolveForaging — dcModifier", () => {
  it("dcModifier = 5 adds 5 to DC (plains DC becomes 15)", () => {
    const r = resolveForaging(0, "plains", "clear", 0, 5, 14);
    expect(r.dc).toBe(15);
    expect(r.success).toBe(false);
  });
  it("dcModifier = 0 no change", () => {
    const r = resolveForaging(0, "plains", "clear", 0, 0, 10);
    expect(r.dc).toBe(FORAGE_DC_NORMAL);
  });
  it("dcModifier = 5 + harsh terrain → DC = 20", () => {
    const r = resolveForaging(0, "mountain", "clear", 0, 5, 19);
    expect(r.dc).toBe(20);
    expect(r.success).toBe(false);
  });
  it("dcModifier = 5 + harsh terrain + roll 20 → success", () => {
    const r = resolveForaging(0, "mountain", "clear", 0, 5, 20);
    expect(r.dc).toBe(20);
    expect(r.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveForaging — yield clamping
// ---------------------------------------------------------------------------

describe("resolveForaging — yield calculation", () => {
  it("success: yieldRoll 1, survivalMod 0 → rationGain = max(1,1) = 1", () => {
    const r = resolveForaging(0, "plains", "clear", 0, 0, 20, 1);
    expect(r.rationGain).toBe(1);
  });
  it("success: yieldRoll 1, survivalMod -3 → rationGain clamped to 1", () => {
    const r = resolveForaging(-3, "plains", "clear", 0, 0, 20, 1);
    expect(r.rationGain).toBe(1);
  });
  it("success: yieldRoll 6, survivalMod 3 → rationGain = 9", () => {
    const r = resolveForaging(3, "plains", "clear", 0, 0, 20, 6);
    expect(r.rationGain).toBe(9);
  });
  it("success: yieldRoll 4, survivalMod 0 → rationGain = 4", () => {
    const r = resolveForaging(0, "plains", "clear", 0, 0, 20, 4);
    expect(r.rationGain).toBe(4);
  });
  it("failure → rationGain = 0 regardless of forcedYieldRoll", () => {
    const r = resolveForaging(0, "plains", "clear", 0, 0, 1, 6);
    expect(r.rationGain).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// resolveForaging — description
// ---------------------------------------------------------------------------

describe("resolveForaging — description", () => {
  it("success returns non-empty description", () => {
    const r = resolveForaging(0, "plains", "clear", 0, 0, 20);
    expect(r.description.length).toBeGreaterThan(0);
    expect(r.description).toContain("succeeds");
  });
  it("failure returns non-empty description", () => {
    const r = resolveForaging(0, "plains", "clear", 0, 0, 1);
    expect(r.description.length).toBeGreaterThan(0);
    expect(r.description).toContain("fails");
  });
  it("success description includes ration count", () => {
    const r = resolveForaging(0, "plains", "clear", 0, 0, 20, 3);
    expect(r.description).toContain("3 rations");
  });
  it("singular 'ration' when rationGain = 1", () => {
    const r = resolveForaging(0, "plains", "clear", 0, 0, 20, 1);
    expect(r.description).toMatch(/\b1 ration\b/);
    expect(r.description).not.toContain("1 rations");
  });
});

// ---------------------------------------------------------------------------
// generateWeatherCheck — persist paths
// ---------------------------------------------------------------------------

describe("generateWeatherCheck — clear persistence (60%)", () => {
  it("clear + roll 1 → persists (roll <= 12)", () => {
    const r = generateWeatherCheck("temperate", 1, "clear", 0, 1);
    expect(r.condition).toBe("clear");
    expect(r.intensity).toBe(0);
    expect(r.changed).toBe(false);
  });
  it("clear + roll 12 → persists (boundary)", () => {
    const r = generateWeatherCheck("temperate", 1, "clear", 0, 12);
    expect(r.condition).toBe("clear");
    expect(r.changed).toBe(false);
  });
  it("clear + roll 13 → worsens to overcast", () => {
    const r = generateWeatherCheck("temperate", 1, "clear", 0, 13);
    expect(r.condition).toBe("overcast");
    expect(r.changed).toBe(true);
  });
  it("clear + roll 20 → worsens", () => {
    const r = generateWeatherCheck("temperate", 1, "clear", 0, 20);
    expect(r.condition).not.toBe("clear");
    expect(r.changed).toBe(true);
  });
});

describe("generateWeatherCheck — storm(2) persistence (75%)", () => {
  it("storm(2) + roll 1 → persists (roll <= 15)", () => {
    const r = generateWeatherCheck("temperate", 1, "storm", 2, 1);
    expect(r.condition).toBe("storm");
    expect(r.intensity).toBe(2);
    expect(r.changed).toBe(false);
  });
  it("storm(2) + roll 15 → persists (boundary)", () => {
    const r = generateWeatherCheck("temperate", 1, "storm", 2, 15);
    expect(r.condition).toBe("storm");
    expect(r.intensity).toBe(2);
    expect(r.changed).toBe(false);
  });
  it("storm(2) + roll 16 → improves to storm(1)", () => {
    const r = generateWeatherCheck("temperate", 1, "storm", 2, 16);
    expect(r.condition).toBe("storm");
    expect(r.intensity).toBe(1);
    expect(r.changed).toBe(true);
  });
  it("storm(2) + roll 20 → improves", () => {
    const r = generateWeatherCheck("temperate", 1, "storm", 2, 20);
    expect(r.changed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateWeatherCheck — standard transitions
// ---------------------------------------------------------------------------

describe("generateWeatherCheck — standard persist (roll 5–14)", () => {
  it("overcast(0) + roll 5 → persists", () => {
    const r = generateWeatherCheck("temperate", 1, "overcast", 0, 5);
    expect(r.condition).toBe("overcast");
    expect(r.changed).toBe(false);
  });
  it("rain(0) + roll 14 → persists", () => {
    const r = generateWeatherCheck("temperate", 1, "rain", 0, 14);
    expect(r.condition).toBe("rain");
    expect(r.intensity).toBe(0);
    expect(r.changed).toBe(false);
  });
  it("rain(1) + roll 10 → persists", () => {
    const r = generateWeatherCheck("temperate", 1, "rain", 1, 10);
    expect(r.condition).toBe("rain");
    expect(r.intensity).toBe(1);
    expect(r.changed).toBe(false);
  });
  it("storm(1) + roll 7 → persists", () => {
    const r = generateWeatherCheck("temperate", 1, "storm", 1, 7);
    expect(r.condition).toBe("storm");
    expect(r.intensity).toBe(1);
    expect(r.changed).toBe(false);
  });
});

describe("generateWeatherCheck — worsen path (roll 1–4)", () => {
  it("overcast(0) + roll 1 → fog(0) (step up the ladder)", () => {
    const r = generateWeatherCheck("temperate", 1, "overcast", 0, 1);
    expect(r.condition).toBe("fog");
    expect(r.intensity).toBe(0);
    expect(r.changed).toBe(true);
  });
  it("fog(0) + roll 4 → rain(0)", () => {
    const r = generateWeatherCheck("temperate", 1, "fog", 0, 4);
    expect(r.condition).toBe("rain");
    expect(r.intensity).toBe(0);
    expect(r.changed).toBe(true);
  });
  it("rain(0) + roll 2 → rain(1)", () => {
    const r = generateWeatherCheck("temperate", 1, "rain", 0, 2);
    expect(r.condition).toBe("rain");
    expect(r.intensity).toBe(1);
    expect(r.changed).toBe(true);
  });
  it("rain(1) + roll 3 → storm(1)", () => {
    const r = generateWeatherCheck("temperate", 1, "rain", 1, 3);
    expect(r.condition).toBe("storm");
    expect(r.intensity).toBe(1);
    expect(r.changed).toBe(true);
  });
  it("storm(1) + roll 4 → storm(2)", () => {
    const r = generateWeatherCheck("temperate", 1, "storm", 1, 4);
    expect(r.condition).toBe("storm");
    expect(r.intensity).toBe(2);
    expect(r.changed).toBe(true);
  });
});

describe("generateWeatherCheck — improve path (roll 15–20)", () => {
  it("storm(1) + roll 20 → rain(1) (step down)", () => {
    const r = generateWeatherCheck("temperate", 1, "storm", 1, 20);
    expect(r.condition).toBe("rain");
    expect(r.intensity).toBe(1);
    expect(r.changed).toBe(true);
  });
  it("rain(1) + roll 15 → rain(0)", () => {
    const r = generateWeatherCheck("temperate", 1, "rain", 1, 15);
    expect(r.condition).toBe("rain");
    expect(r.intensity).toBe(0);
    expect(r.changed).toBe(true);
  });
  it("rain(0) + roll 18 → fog(0)", () => {
    const r = generateWeatherCheck("temperate", 1, "rain", 0, 18);
    expect(r.condition).toBe("fog");
    expect(r.intensity).toBe(0);
    expect(r.changed).toBe(true);
  });
  it("fog(0) + roll 17 → overcast(0)", () => {
    const r = generateWeatherCheck("temperate", 1, "fog", 0, 17);
    expect(r.condition).toBe("overcast");
    expect(r.intensity).toBe(0);
    expect(r.changed).toBe(true);
  });
  it("overcast(0) + roll 20 → clear(0)", () => {
    const r = generateWeatherCheck("temperate", 1, "overcast", 0, 20);
    expect(r.condition).toBe("clear");
    expect(r.intensity).toBe(0);
    expect(r.changed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateWeatherCheck — biome gates
// ---------------------------------------------------------------------------

describe("generateWeatherCheck — snow biome gate (winter only)", () => {
  it("tundra biome + winter + rain(0) step → snow(0)", () => {
    // Force worsen from overcast → fog step... but easier: start at rain and persist
    const r = generateWeatherCheck("tundra plains", 3, "rain", 0, 10); // persist → rain(0)
    expect(r.condition).toBe("snow");
    expect(r.intensity).toBe(0);
  });
  it("mountain biome + winter + rain(1) persists → snow(1)", () => {
    const r = generateWeatherCheck("mountain highland", 3, "rain", 1, 10);
    expect(r.condition).toBe("snow");
    expect(r.intensity).toBe(1);
  });
  it("taiga biome + winter + rain(0) worsens → snow(1)", () => {
    const r = generateWeatherCheck("taiga forest", 3, "rain", 0, 2); // worsen: rain(0) → rain(1)
    expect(r.condition).toBe("snow");
    expect(r.intensity).toBe(1);
  });
  it("temperate forest biome + winter + rain(0) persists → rain (no snow)", () => {
    const r = generateWeatherCheck("temperate broadleaf forest", 3, "rain", 0, 10);
    expect(r.condition).toBe("rain"); // forest is not snow-eligible
  });
  it("tundra + summer (season 1) + rain → rain (not winter, no snow)", () => {
    const r = generateWeatherCheck("tundra", 1, "rain", 0, 10);
    expect(r.condition).toBe("rain");
  });
  it("tundra + autumn (season 2) + rain → rain (not winter)", () => {
    const r = generateWeatherCheck("tundra", 2, "rain", 0, 10);
    expect(r.condition).toBe("rain");
  });
});

describe("generateWeatherCheck — fog blocked in desert/tundra biomes", () => {
  it("desert biome: fog step → overcast instead", () => {
    // Force worsen from overcast → fog step
    const r = generateWeatherCheck("hot desert", 1, "overcast", 0, 1); // worsen: overcast → fog
    expect(r.condition).toBe("overcast"); // fog replaced by overcast
  });
  it("tundra biome: fog step → overcast instead", () => {
    const r = generateWeatherCheck("tundra plain", 1, "overcast", 0, 1);
    expect(r.condition).toBe("overcast");
  });
  it("swamp biome: fog is allowed", () => {
    const r = generateWeatherCheck("tropical swamp", 1, "overcast", 0, 1);
    expect(r.condition).toBe("fog");
  });
});

// ---------------------------------------------------------------------------
// generateWeatherCheck — changed flag
// ---------------------------------------------------------------------------

describe("generateWeatherCheck — changed flag accuracy", () => {
  it("condition changes → changed = true", () => {
    const r = generateWeatherCheck("temperate", 1, "clear", 0, 13);
    expect(r.changed).toBe(true);
  });
  it("intensity changes → changed = true (rain 0→1)", () => {
    const r = generateWeatherCheck("temperate", 1, "rain", 0, 2); // worsen
    expect(r.changed).toBe(true);
  });
  it("condition and intensity identical → changed = false", () => {
    const r = generateWeatherCheck("temperate", 1, "overcast", 0, 5); // persist
    expect(r.condition).toBe("overcast");
    expect(r.intensity).toBe(0);
    expect(r.changed).toBe(false);
  });
  it("storm(2) persist → changed = false", () => {
    const r = generateWeatherCheck("temperate", 1, "storm", 2, 10);
    expect(r.changed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generateWeatherCheck — description field
// ---------------------------------------------------------------------------

describe("generateWeatherCheck — description", () => {
  it("result always has a non-empty description", () => {
    const r = generateWeatherCheck("temperate", 1, "rain", 0, 10);
    expect(typeof r.description).toBe("string");
    expect(r.description.length).toBeGreaterThan(0);
  });
  it("clear sky has expected description", () => {
    const r = generateWeatherCheck("temperate", 1, "clear", 0, 1); // persist
    expect(r.description).toContain("clear");
  });
  it("storm(2) has expected description mentioning travel impossibility", () => {
    const r = generateWeatherCheck("temperate", 1, "storm", 2, 1); // persist
    expect(r.description).toContain("impossible");
  });
  it("snow condition has description mentioning snow", () => {
    const r = generateWeatherCheck("tundra", 3, "rain", 0, 10); // persist → snow
    expect(r.description.toLowerCase()).toContain("snow");
  });
});
